// Local-first storage. Works offline in the garage.
// First run: seeds from src/lib/seed-data.ts (generated from seed-purchase.csv).
// Google Sheets sync (two-way, review-first) lives in src/lib/sync.ts and
// talks to the Apps Script endpoint in sync/sheet-sync.gs. The sheet is the
// shared source of truth between the app on this device and the sheet itself;
// the app's photos stay local-only (the sheet has no photo column).
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
import { FREE_SEED_ITEMS } from './free-seed-data';
import { EXPENSES_SEED_ITEMS } from './expenses-seed-data';
import {
  DEFAULT_SETTINGS,
  Expense,
  FreeItem,
  Item,
  ItemStatus,
  normaliseFreeStatus,
  normaliseStatus,
  qrFor,
  Settings,
  SyncSource,
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
const WEB_TOMBSTONES_KEY = 'reseller-hq-tombstones-v1';
const WEB_SYNC_STATE_KEY = 'reseller-hq-sync-state-v1';
const WEB_OUT_OF_SYNC_KEY = 'reseller-hq-out-of-sync-v1';
const WEB_FREE_ITEMS_KEY = 'reseller-hq-free-items-v1';
const WEB_EXPENSES_KEY = 'reseller-hq-expenses-v1';
// Set once the seed has run. After a deliberate clear (clearLocalData) this
// stays set, so the next load does NOT re-seed — an empty DB means "start
// fresh", not "first run".
const WEB_SEEDED_KEY = 'reseller-hq-seeded-v1';
let webItems: Item[] | null = null;
let webSettings: Settings | null = null;
let webFreeItems: FreeItem[] | null = null;
let webExpenses: Expense[] | null = null;

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
    location: s.location || '',
    qrCode: qrFor(s.id),
    photos: [],
    whiteBgPhotos: [],
    createdAt: now,
  };
}

function webLoad(): void {
  if (webItems !== null && webSettings !== null) return;
  const now = new Date().toISOString();
  // Seeding happens once (first run). After a deliberate clear the marker
  // is set, so a missing key means "empty on purpose", not "seed me".
  const seeded = webRead(WEB_SEEDED_KEY) === '1';
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
  webItems = loaded ?? (seeded ? [] : SEED_ITEMS.map((s) => seedToItem(s, now)));
  if (!loaded && !seeded) webWrite(WEB_ITEMS_KEY, JSON.stringify(webItems));
  // Free items + expenses: seeded from the sheet's Free/Expenses tabs; the
  // dashboard refreshes them from the sheet when sync is configured.
  const rawFree = webRead(WEB_FREE_ITEMS_KEY);
  let loadedFree: FreeItem[] | null = null;
  if (rawFree) {
    try {
      const parsed: unknown = JSON.parse(rawFree);
      if (Array.isArray(parsed) && parsed.length > 0) loadedFree = parsed as FreeItem[];
    } catch {
      loadedFree = null;
    }
  }
  webFreeItems = loadedFree ?? (seeded ? [] : [...FREE_SEED_ITEMS]);
  if (!loadedFree && !seeded) webWrite(WEB_FREE_ITEMS_KEY, JSON.stringify(webFreeItems));
  const rawExp = webRead(WEB_EXPENSES_KEY);
  let loadedExp: Expense[] | null = null;
  if (rawExp) {
    try {
      const parsed: unknown = JSON.parse(rawExp);
      if (Array.isArray(parsed) && parsed.length > 0) loadedExp = parsed as Expense[];
    } catch {
      loadedExp = null;
    }
  }
  webExpenses = loadedExp ?? (seeded ? [] : [...EXPENSES_SEED_ITEMS]);
  if (!loadedExp && !seeded) webWrite(WEB_EXPENSES_KEY, JSON.stringify(webExpenses));
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
  if (!seeded) webWrite(WEB_SEEDED_KEY, '1');
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
    CREATE TABLE IF NOT EXISTS tombstones (
      id TEXT PRIMARY KEY,
      deletedAt TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS free_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      box TEXT NOT NULL DEFAULT '',
      recPrice REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft',
      dateListed TEXT NOT NULL DEFAULT '',
      dateSold TEXT NOT NULL DEFAULT '',
      soldPrice REAL NOT NULL DEFAULT 0,
      fees REAL NOT NULL DEFAULT 0,
      shipping REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT ''
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
  // Seeding happens once (first run). The '__seeded' marker distinguishes a
  // deliberate clear (empty on purpose — do NOT re-seed) from a first run.
  const seededRow = d.getFirstSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = '__seeded'",
  );
  const seeded = !!seededRow;
  if ((count?.c ?? 0) === 0 && !seeded) {
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
  // Free items + expenses, seeded from the sheet tabs when empty (first run).
  const freeCount = d.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM free_items');
  if ((freeCount?.c ?? 0) === 0 && !seeded) {
    for (const f of FREE_SEED_ITEMS) {
      d.runSync(
        `INSERT INTO free_items (id, name, box, recPrice, status, dateListed,
          dateSold, soldPrice, fees, shipping)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          f.id,
          f.name,
          f.box,
          f.recPrice,
          f.status,
          f.dateListed,
          f.dateSold,
          f.soldPrice,
          f.fees,
          f.shipping,
        ],
      );
    }
  }
  const expCount = d.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM expenses');
  if ((expCount?.c ?? 0) === 0 && !seeded) {
    for (const e of EXPENSES_SEED_ITEMS) {
      d.runSync(
        'INSERT INTO expenses (id, name, price, date, status) VALUES (?, ?, ?, ?, ?)',
        [e.id, e.name, e.price, e.date, e.status],
      );
    }
  }
  // Mark the seed as done, so a later empty DB is a deliberate clear.
  d.runSync("INSERT OR IGNORE INTO settings (key, value) VALUES ('__seeded', '1')");
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

// ---------------------------------------------------------------------------
// Sync bookkeeping: tombstones (ids deleted in the app) and sync state
// (which appIds were in sync with the sheet at the last successful apply).
// Tombstones let the sync tell "deleted in the app" (→ mark Trash in the
// sheet) apart from "never synced" (→ add to the sheet). Sync state lets it
// tell "new in the app" apart from "row removed from the sheet".
// ---------------------------------------------------------------------------

export function recordDeletedId(id: string): void {
  if (IS_WEB) {
    const ids = getDeletedIds();
    if (!ids.includes(id)) {
      ids.push(id);
      webWrite(WEB_TOMBSTONES_KEY, JSON.stringify(ids));
    }
    return;
  }
  getDb().runSync(
    'INSERT OR IGNORE INTO tombstones (id, deletedAt) VALUES (?, ?)',
    [id, new Date().toISOString()],
  );
}

export function getDeletedIds(): string[] {
  if (IS_WEB) {
    try {
      const raw = webRead(WEB_TOMBSTONES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return getDb()
    .getAllSync<{ id: string }>('SELECT id FROM tombstones')
    .map((r) => r.id);
}

export function clearDeletedIds(ids: string[]): void {
  if (ids.length === 0) return;
  if (IS_WEB) {
    const remaining = getDeletedIds().filter((id) => !ids.includes(id));
    webWrite(WEB_TOMBSTONES_KEY, JSON.stringify(remaining));
    return;
  }
  const d = getDb();
  for (const id of ids) d.runSync('DELETE FROM tombstones WHERE id = ?', [id]);
}

export interface SyncState {
  ids: string[]; // appIds present on both sides after the last successful apply
  at: string; // ISO timestamp of that apply
  source?: SyncSource; // source of truth picked for the last sync run
}

export function getSyncState(): SyncState | null {
  if (IS_WEB) {
    try {
      const raw = webRead(WEB_SYNC_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SyncState;
      return Array.isArray(parsed.ids) ? parsed : null;
    } catch {
      return null;
    }
  }
  const row = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = '__syncState'",
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as SyncState;
    return Array.isArray(parsed.ids) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSyncState(ids: string[], at: string, source?: SyncSource): void {
  const value = JSON.stringify({ ids, at, source });
  if (IS_WEB) {
    webWrite(WEB_SYNC_STATE_KEY, value);
    return;
  }
  getDb().runSync(
    "INSERT INTO settings (key, value) VALUES ('__syncState', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [value],
  );
}

// ---------------------------------------------------------------------------
// Out-of-sync flag: true when a sheet push failed (offline) and the app
// has changes the sheet does not. Persisted so it survives restarts.
// Set by the write-through (sync.ts) on a failed push; cleared when a
// push or a sync apply succeeds. The banner and the transaction gate
// read it; listeners let them update live without a reload.
// ---------------------------------------------------------------------------

const outOfSyncListeners = new Set<() => void>();

export function onOutOfSyncChange(fn: () => void): () => void {
  outOfSyncListeners.add(fn);
  return () => {
    outOfSyncListeners.delete(fn);
  };
}

export function isOutOfSync(): boolean {
  if (IS_WEB) {
    return webRead(WEB_OUT_OF_SYNC_KEY) === '1';
  }
  const row = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = '__outOfSync'",
  );
  return row?.value === '1';
}

export function setOutOfSync(v: boolean): void {
  if (IS_WEB) {
    webWrite(WEB_OUT_OF_SYNC_KEY, v ? '1' : '0');
  } else {
    getDb().runSync(
      "INSERT INTO settings (key, value) VALUES ('__outOfSync', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [v ? '1' : '0'],
    );
  }
  for (const fn of outOfSyncListeners) fn();
}

export function setStatus(id: string, status: ItemStatus): void {
  const patch: Partial<Item> = { status };
  const today = new Date().toLocaleDateString('en-US');
  if (status === 'Listed') patch.dateListed = today;
  if (status === 'Sold') patch.dateSold = today;
  updateItem(id, patch);
}

// The next free item id, continuing the id series the app already uses.
// Ids are "<prefix><number>" (RHQ-000001, RB-001, ...). The prefix with the
// most items wins, and its zero-padding is kept, so a sheet that uses
// RHQ-000001 keeps getting RHQ-000254, RHQ-000255, ... while an older
// RB-xxx set keeps getting RB-193, RB-194, ...
function nextItemId(all: Item[]): string {
  const byPrefix = new Map<string, { count: number; max: number; width: number }>();
  for (const it of all) {
    const m = it.id.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const prefix = m[1];
    const n = parseInt(m[2], 10);
    const cur = byPrefix.get(prefix) ?? { count: 0, max: 0, width: m[2].length };
    cur.count += 1;
    if (n > cur.max) cur.max = n;
    if (m[2].length > cur.width) cur.width = m[2].length;
    byPrefix.set(prefix, cur);
  }
  if (byPrefix.size === 0) return 'RB-001';
  let best: { prefix: string; count: number; max: number; width: number } | null = null;
  for (const [prefix, v] of byPrefix) {
    if (!best || v.count > best.count || (v.count === best.count && v.max > best.max)) {
      best = { prefix, ...v };
    }
  }
  if (!best) return 'RB-001';
  return `${best.prefix}${String(best.max + 1).padStart(best.width, '0')}`;
}

export function addItem(input: {
  name: string;
  purchase: number;
  estShip: number;
  place: string;
  datePurchased: string;
  notes: string;
  // Optional fixed id (sync restores): re-creates a deleted item with its
  // original RB-xxx so the sheet row keeps matching. Otherwise the next
  // free RB-xxx is assigned.
  id?: string;
}): Item {
  const all = getAllItems();
  const existing = input.id ? all.find((it) => it.id === input.id) : undefined;
  if (existing) return existing;
  const id = input.id ?? nextItemId(all);
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

// ---------------------------------------------------------------------------
// Free inventory + expenses (the sheet's Free/Expenses tabs). Read-only in
// the app for now: the dashboard aggregates them, and a sheet refresh
// (when sync is configured) replaces the whole local copy with the sheet's
// current rows — the sheet is the source of truth for these two lists.
// ---------------------------------------------------------------------------

export function getFreeItems(): FreeItem[] {
  if (IS_WEB) {
    webLoad();
    return [...(webFreeItems as FreeItem[])];
  }
  return getDb()
    .getAllSync<FreeItem>('SELECT * FROM free_items ORDER BY id')
    .map((r) => ({ ...r, status: normaliseFreeStatus(r.status) }));
}

export function replaceFreeItems(items: FreeItem[]): void {
  if (IS_WEB) {
    webFreeItems = [...items];
    webWrite(WEB_FREE_ITEMS_KEY, JSON.stringify(webFreeItems));
    return;
  }
  const d = getDb();
  d.runSync('DELETE FROM free_items');
  for (const f of items) {
    d.runSync(
      `INSERT INTO free_items (id, name, box, recPrice, status, dateListed,
        dateSold, soldPrice, fees, shipping)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.id, f.name, f.box, f.recPrice, f.status, f.dateListed, f.dateSold, f.soldPrice, f.fees, f.shipping],
    );
  }
}

export function getExpenses(): Expense[] {
  if (IS_WEB) {
    webLoad();
    return [...(webExpenses as Expense[])];
  }
  return getDb().getAllSync<Expense>('SELECT * FROM expenses ORDER BY id');
}

export function replaceExpenses(items: Expense[]): void {
  if (IS_WEB) {
    webExpenses = [...items];
    webWrite(WEB_EXPENSES_KEY, JSON.stringify(webExpenses));
    return;
  }
  const d = getDb();
  d.runSync('DELETE FROM expenses');
  for (const e of items) {
    d.runSync('INSERT INTO expenses (id, name, price, date, status) VALUES (?, ?, ?, ?, ?)', [
      e.id,
      e.name,
      e.price,
      e.date,
      e.status,
    ]);
  }
}

function nextExpenseId(all: Expense[]): string {
  const maxNum = all.reduce((m, e) => {
    const n = parseInt(e.id.replace('EX-', ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `EX-${String(maxNum + 1).padStart(3, '0')}`;
}

export function addExpense(input: {
  name: string;
  price: number;
  date: string;
  status?: string;
}): Expense {
  const expense: Expense = {
    id: nextExpenseId(getExpenses()),
    name: input.name,
    price: input.price,
    date: input.date,
    status: input.status ?? '',
  };
  if (IS_WEB) {
    webLoad();
    (webExpenses as Expense[]).push(expense);
    webWrite(WEB_EXPENSES_KEY, JSON.stringify(webExpenses));
    return expense;
  }
  getDb().runSync(
    'INSERT INTO expenses (id, name, price, date, status) VALUES (?, ?, ?, ?, ?)',
    [expense.id, expense.name, expense.price, expense.date, expense.status],
  );
  return expense;
}

export function updateExpense(id: string, patch: Partial<Expense>): void {
  if (IS_WEB) {
    webLoad();
    const idx = (webExpenses as Expense[]).findIndex((e) => e.id === id);
    if (idx < 0) return;
    (webExpenses as Expense[])[idx] = { ...(webExpenses as Expense[])[idx], ...patch };
    webWrite(WEB_EXPENSES_KEY, JSON.stringify(webExpenses));
    return;
  }
  const current = getDb().getFirstSync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
  if (!current) return;
  const next: Expense = { ...current, ...patch };
  getDb().runSync(
    'UPDATE expenses SET name=?, price=?, date=?, status=? WHERE id=?',
    [next.name, next.price, next.date, next.status, id],
  );
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
    if (r.key === 'syncUrl') out.syncUrl = r.value;
    if (r.key === 'syncToken') out.syncToken = r.value;
    if (r.key === 'syncSheet') out.syncSheet = r.value || 'Inventory';
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

// ---------------------------------------------------------------------------
// Clear local data — a fresh restart on this device.
// Wipes the items (including their photos), free items, expenses,
// tombstones, and sync history. NOTHING is re-seeded: an empty DB after a
// clear means "start fresh", and the '__seeded' marker stops the next launch
// from putting the seed back (that re-seed is why the old clear looked like
// it did nothing — the 192 items came straight back). Settings are kept
// (sync URL/token, sheet tab, BG remover URL, fee/margin defaults), so a
// re-sync after the reset just works. The sheet itself is never touched.
// To fill the app again, use Sync → "Update app from sheet".
// ---------------------------------------------------------------------------

// Wipe the app's items, tombstones, and sync history (no re-seed).
export function clearAppItems(): void {
  if (IS_WEB) {
    try {
      window.localStorage.removeItem(WEB_ITEMS_KEY);
      window.localStorage.removeItem(WEB_TOMBSTONES_KEY);
      window.localStorage.removeItem(WEB_SYNC_STATE_KEY);
      window.localStorage.removeItem(WEB_OUT_OF_SYNC_KEY);
      window.localStorage.setItem(WEB_SEEDED_KEY, '1');
    } catch {
      // Storage unavailable — the in-memory reset below still applies.
    }
    webItems = null;
    return;
  }
  const d = getDb();
  d.runSync('DELETE FROM items');
  d.runSync('DELETE FROM tombstones');
  d.runSync("DELETE FROM settings WHERE key = '__syncState'");
  d.runSync("DELETE FROM settings WHERE key = '__outOfSync'");
  d.runSync(
    "INSERT INTO settings (key, value) VALUES ('__seeded', '1') ON CONFLICT(key) DO UPDATE SET value='1'",
  );
}

export function clearLocalData(): void {
  clearAppItems();
  if (IS_WEB) {
    try {
      window.localStorage.removeItem(WEB_FREE_ITEMS_KEY);
      window.localStorage.removeItem(WEB_EXPENSES_KEY);
    } catch {
      // Storage unavailable — the in-memory reset below still applies.
    }
    webFreeItems = null;
    webExpenses = null;
    return;
  }
  const d = getDb();
  d.runSync('DELETE FROM free_items');
  d.runSync('DELETE FROM expenses');
}
