// Local-first storage with expo-sqlite. Works offline in the garage.
// First run: seeds from src/lib/seed-data.ts (generated from seed-purchase.csv).
// Google Sheets is the backup/export source, NOT a live sync in v1.

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
let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) db = SQLite.openDatabaseSync(DB_NAME);
  return db;
}

export function initDb(): void {
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
  const count = d.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM items');
  if ((count?.c ?? 0) === 0) {
    const now = new Date().toISOString();
    for (const s of SEED_ITEMS) {
      d.runSync(
        `INSERT INTO items (id, name, purchase, estShip, suggestedPrice, minPrice,
          researchPrice, notes, place, datePurchased, status, dateListed, dateSold,
          soldPrice, fees, shipping, profit, revenue, profitMargin,
          location, qrCode, photos, whiteBgPhotos, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

type ItemRow = Omit<Item, 'photos' | 'whiteBgPhotos'> & {
  photos: string;
  whiteBgPhotos: string;
};

function rowToItem(row: ItemRow): Item {
  return {
    ...row,
    status: row.status as ItemStatus,
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
  const rows = getDb().getAllSync<ItemRow>(
    'SELECT * FROM items ORDER BY datePurchased DESC, id ASC',
  );
  return rows.map(rowToItem);
}

export function getItem(id: string): Item | null {
  const row = getDb().getFirstSync<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
  return row ? rowToItem(row) : null;
}

export function getCounts(): Record<string, number> {
  const rows = getDb().getAllSync<{ status: string; c: number }>(
    'SELECT status, COUNT(*) AS c FROM items GROUP BY status',
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.c;
  return out;
}

export function updateItem(id: string, patch: Partial<Item>): void {
  const current = getItem(id);
  if (!current) return;
  const next: Item = { ...current, ...patch };
  getDb().runSync(
    `UPDATE items SET name=?, purchase=?, estShip=?, suggestedPrice=?, minPrice=?,
      researchPrice=?, notes=?, place=?, datePurchased=?, status=?, dateListed=?,
      dateSold=?, soldPrice=?, fees=?, shipping=?, profit=?, revenue=?,
      profitMargin=?, location=?, qrCode=?, photos=?, whiteBgPhotos=?
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
    location: '',
    qrCode: qrFor(id),
    photos: [],
    whiteBgPhotos: [],
    createdAt: new Date().toISOString(),
  };
  getDb().runSync(
    `INSERT INTO items (id, name, purchase, estShip, suggestedPrice, minPrice,
      researchPrice, notes, place, datePurchased, status, dateListed, dateSold,
      soldPrice, fees, shipping, profit, revenue, profitMargin,
      location, qrCode, photos, whiteBgPhotos, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const d = getDb();
  for (const [key, value] of Object.entries(s)) {
    d.runSync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, String(value)],
    );
  }
}
