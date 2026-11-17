// Local-first storage. Works offline in the garage.
// First run: seeds from src/lib/seed-data.ts (generated from seed-purchase.csv).
// Google Sheets is the backup/export source, NOT a live sync in v1.
//
// Two backends, same sync API (every screen calls these synchronously):
//   - Native (iOS/Android): expo-sqlite, database file reseller.db.
//   - Web: localStorage-backed in-memory store. expo-sqlite's sync API on web
//     needs SharedArrayBuffer, which needs COOP/COEP headers that the Expo
//     dev server does not send — it crashes at startup with
//     "SharedArrayBuffer is not defined". So the web build never opens
//     SQLite at all; items/settings live in localStorage instead. Same seed,
//     same 192 items, same behaviour. Web changes do NOT sync to the phone
//     (and vice versa) — the sheet is the shared source of truth in v1.

import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { SEED_ITEMS } from './seed-data';
import {
  DEFAULT_SETTINGS,
  Item,
  ItemStatus,
  normaliseStatus,
  qrFor,
  Settings,
} from './types';

const DB_NAME = 'reseller.db';
const IS_WEB = Platform.OS === 'web';
let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (IS_WEB) {
    throw new Error('getDb is not available on web — the web build uses localStorage.');
  }
  if (!db) db = SQLite.openDatabaseSync(DB_NAME);
  return db;
}

// ---------------------------------------------------------------------------
// Web store (localStorage)
// ---------------------------------------------------------------------------

const WEB_ITEMS_KEY = 'reseller-hq-items-v1';
const WEB_SETTINGS_KEY = 'reseller-hq-settings-v1';
let webItems: Item[] | null = null;
let webSettings: Settings | null = null;

function webRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function webWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / storage full: keep the in-memory copy, skip persisting.
  }
}

function seedToItem(s: (typeof SEED_ITEMS)[number], now: string): Item {
  return {
    id: s.id,
    name: s.name,
    purchase: s.purchase,
    estShip: s.estShip,
    suggestedPrice: s.suggestedPrice,
    minPrice: s.minPrice,
    researchPrice: s.researchPrice,
    notes: s.notes,
    place: s.place,
    datePurchased: s.datePurchased,
    status: normaliseStatus(s.status),
    dateListed: s.dateListed,
    dateSold: s.dateSold,
    soldPrice: s.soldPrice,
    fees: s.fees,
    shipping: s.shipping,
    profit: s.profit,
    revenue: s.revenue,
    profitMargin: s.profitMargin,
    macBidFees: s.place.toLowerCase().includes('mac'),
    location: '',
    qrCode: qrFor(s.id),
    photos: [],
    whiteBgPhotos: [],
    createdAt: now,
  };
}

function webLoad(): void {
  if (webItems !== null && webSettings !== null) return;
  const now = new Date().toISOString();
  const rawItems = webRead(WEB_ITEMS_KEY);
  let loaded: Item[] | null = null;
  if (rawItems) {
    try {
      const parsed: unknown = JSON.parse(rawItems);
      if (Array.isArray(parsed) && parsed.length > 0) loaded = parsed as Item[];
    } catch {
      loaded = null;
    }
  }
  webItems = loaded ?? SEED_ITEMS.map((s) => seedToItem(s, now));
  if (!loaded) webWrite(WEB_ITEMS_KEY, JSON.stringify(webItems));
  const rawSettings = webRead(WEB_SETTINGS_KEY);
  if (rawSettings) {
    try {
      webSettings = { ...DEFAULT_SETTINGS, ...(JSON.parse(rawSettings) as Partial<Settings>) };
    } catch {
      webSettings = { ...DEFAULT_SETTINGS };
    }
  } else {
    webSettings = { ...DEFAULT_SETTINGS };
  }
}

function webSaveItems(): void {
  if (webItems) webWrite(WEB_ITEMS_KEY, JSON.stringify(webItems));
}

function webSaveSettings(): void {
  if (webSettings) webWrite(WEB_SETTINGS_KEY, JSON.stringify(webSettings));
}

function sortItems(items: Item[]): Item[] {
  return [...items].sort(
    (a, b) =>
      b.datePurchased.localeCompare(a.datePurchased) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Shared API
// ---------------------------------------------------------------------------

export function initDb(): void {
  if (IS_WEB) {
    webLoad();
    return;
  }
  const d = getDb();
  d.execSync(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      purchase REAL NOT NULL DEFAULT 0,
      estShip REAL NOT NULL DEFAULT 0,
      suggestedPrice REAL NOT NULL DEFAULT 0,
      minPrice REAL NOT NULL DEFAULT 0,
      researchPrice REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      datePurchased TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Unlisted',
      dateListed TEXT NOT NULL DEFAULT '',
      dateSold TEXT NOT NULL DEFAULT '',
      soldPrice REAL NOT NULL DEFAULT 0,
      fees REAL NOT NULL DEFAULT 0,
      shipping REAL NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      revenue REAL NOT NULL DEFAULT 0,
      profitMargin TEXT NOT NULL DEFAULT '',
      macBidFees INTEGER NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT '',
      qrCode TEXT NOT NULL DEFAULT '',
      photos TEXT NOT NULL DEFAULT '[]',
      whiteBgPhotos TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Migration for installs seeded before macBidFees existed: add the column
  // (fails harmlessly if it is already there) and backfill it from place.
  try {
    d.execSync(`ALTER TABLE items ADD COLUMN macBidFees INTEGER NOT NULL DEFAULT 0;`);
    d.runSync(`UPDATE items SET macBidFees = 1 WHERE lower(place) LIKE '%mac%'`);
  } catch {
    // Column already exists.
  }
  const count = d.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM items');
  if ((count?.c ?? 0) === 0) {
    const now = new Date().toISOString();
    for (const s of SEED_ITEMS) {
      d.runSync(
        `INSERT INTO items (id, name, purchase, estShip, suggestedPrice, minPrice,
          researchPrice, notes, place, datePurchased, status, dateListed, dateSold,
          soldPrice, fees, shipping, profit, revenue, profitMargin, macBidFees,
          location, qrCode, photos, whiteBgPhotos, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.name,
          s.purchase,
          s.estShip,
          s.suggestedPrice,
          s.minPrice,
          s.researchPrice,
          s.notes,
          s.place,
          s.datePurchased,
          normaliseStatus(s.status),
          s.dateListed,
          s.dateSold,
          s.soldPrice,
          s.fees,
          s.shipping,
          s.profit,
          s.revenue,
          s.profitMargin,
          s.place.toLowerCase().includes('mac') ? 1 : 0,
          '',
          qrFor(s.id),
          '[]',
          '[]',
          now,
        ],
      );
    }
  }
  // Default settings, only where missing.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    d.runSync(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      [key, String(value)],
    );
  }
}

type ItemRow = Omit<Item, 'photos' | 'whiteBgPhotos' | 'macBidFees'> & {
  photos: string;
  whiteBgPhotos: string;
  macBidFees: number;
};

function rowToItem(row: ItemRow): Item {
  return {
    ...row,
    status: row.status as ItemStatus,
    macBidFees: row.macBidFees === 1,
    photos: safeParse(row.photos),
    whiteBgPhotos: safeParse(row.whiteBgPhotos),
  };
}

function safeParse(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export function getAllItems(): Item[] {
  if (IS_WEB) {
    webLoad();
    return sortItems(webItems as Item[]);
  }
  const rows = getDb().getAllSync<ItemRow>(
    'SELECT * FROM items ORDER BY datePurchased DESC, id ASC',
  );
  return rows.map(rowToItem);
}

export function getItem(id: string): Item | null {
  if (IS_WEB) {
    webLoad();
    return (webItems as Item[]).find((it) => it.id === id) ?? null;
  }
  const row = getDb().getFirstSync<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
  return row ? rowToItem(row) : null;
}

export function getCounts(): Record<string, number> {
  if (IS_WEB) {
    webLoad();
    const out: Record<string, number> = {};
    for (const it of webItems as Item[]) out[it.status] = (out[it.status] ?? 0) + 1;
    return out;
  }
  const rows = getDb().getAllSync<{ status: string; c: number }>(
    'SELECT status, COUNT(*) AS c FROM items GROUP BY status',
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.c;
  return out;
}

export function updateItem(id: string, patch: Partial<Item>): void {
  if (IS_WEB) {
    webLoad();
    const idx = (webItems as Item[]).findIndex((it) => it.id === id);
    if (idx < 0) return;
    (webItems as Item[])[idx] = { ...(webItems as Item[])[idx], ...patch };
    webSaveItems();
    return;
  }
  const current = getItem(id);
  if (!current) return;
  const next: Item = { ...current, ...patch };
  getDb().runSync(
    `UPDATE items SET name=?, purchase=?, estShip=?, suggestedPrice=?, minPrice=?,
      researchPrice=?, notes=?, place=?, datePurchased=?, status=?, dateListed=?,
      dateSold=?, soldPrice=?, fees=?, shipping=?, profit=?, revenue=?,
      profitMargin=?, macBidFees=?, location=?, qrCode=?, photos=?, whiteBgPhotos=?
     WHERE id=?`,
    [
      next.name,
      next.purchase,
      next.estShip,
      next.suggestedPrice,
      next.minPrice,
      next.researchPrice,
      next.notes,
      next.place,
      next.datePurchased,
      next.status,
      next.dateListed,
      next.dateSold,
      next.soldPrice,
      next.fees,
      next.shipping,
      next.profit,
      next.revenue,
      next.profitMargin,
      next.macBidFees ? 1 : 0,
      next.location,
      next.qrCode,
      JSON.stringify(next.photos),
      JSON.stringify(next.whiteBgPhotos),
      id,
    ],
  );
}

export function setStatus(id: string, status: ItemStatus): void {
  const patch: Partial<Item> = { status };
  const today = new Date().toLocaleDateString('en-US');
  if (status === 'Listed') patch.dateListed = today;
  if (status === 'Sold') patch.dateSold = today;
  updateItem(id, patch);
}

export function addItem(input: {
  name: string;
  purchase: number;
  estShip: number;
  place: string;
  datePurchased: string;
  notes: string;
}): Item {
  const all = getAllItems();
  const maxNum = all.reduce((m, it) => {
    const n = parseInt(it.id.replace('RB-', ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  const id = `RB-${String(maxNum + 1).padStart(3, '0')}`;
  const item: Item = {
    id,
    name: input.name,
    purchase: input.purchase,
    estShip: input.estShip,
    suggestedPrice: 0,
    minPrice: 0,
    researchPrice: 0,
    notes: input.notes,
    place: input.place,
    datePurchased: input.datePurchased,
    status: 'Unlisted',
    dateListed: '',
    dateSold: '',
    soldPrice: 0,
    fees: 0,
    shipping: 0,
    profit: 0,
    revenue: 0,
    profitMargin: '',
    macBidFees: input.place.toLowerCase().includes('mac'),
    location: '',
    qrCode: qrFor(id),
    photos: [],
    whiteBgPhotos: [],
    createdAt: new Date().toISOString(),
  };
  if (IS_WEB) {
    webLoad();
    (webItems as Item[]).push(item);
    webSaveItems();
    return item;
  }
  getDb().runSync(
    `INSERT INTO items (id, name, purchase, estShip, suggestedPrice, minPrice,
      researchPrice, notes, place, datePurchased, status, dateListed, dateSold,
      soldPrice, fees, shipping, profit, revenue, profitMargin, macBidFees,
      location, qrCode, photos, whiteBgPhotos, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.name,
      item.purchase,
      item.estShip,
      item.suggestedPrice,
      item.minPrice,
      item.researchPrice,
      item.notes,
      item.place,
      item.datePurchased,
      item.status,
      item.dateListed,
      item.dateSold,
      item.soldPrice,
      item.fees,
      item.shipping,
      item.profit,
      item.revenue,
      item.macBidFees ? 1 : 0,
      item.profitMargin,
      item.location,
      item.qrCode,
      '[]',
      '[]',
      item.createdAt,
    ],
  );
  return item;
}

export function getSettings(): Settings {
  if (IS_WEB) {
    webLoad();
    return { ...(webSettings as Settings) };
  }
  const rows = getDb().getAllSync<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  );
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === 'bgRemoverUrl') out.bgRemoverUrl = r.value;
    if (r.key === 'warehouse') out.warehouse = r.value;
    if (r.key === 'ebayFeePct') out.ebayFeePct = parseFloat(r.value) || 0.136;
    if (r.key === 'targetMarginPct') out.targetMarginPct = parseFloat(r.value) || 0.3;
    if (r.key === 'salesTaxPct') out.salesTaxPct = parseFloat(r.value) || 0.07;
  }
  return out;
}

export function saveSettings(s: Settings): void {
  if (IS_WEB) {
    webLoad();
    webSettings = { ...s };
    webSaveSettings();
    return;
  }
  const d = getDb();
  for (const [key, value] of Object.entries(s)) {
    d.runSync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, String(value)],
    );
  }
}
