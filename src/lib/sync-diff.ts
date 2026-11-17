// Pure sheet-sync diff logic — no storage, no network, no React Native.
// Kept separate from sync.ts so it can be verified in plain Node
// (scripts/verify-sync-diff.mjs) against real sheet data.
//
// The diff is the heart of the review-first sync: it compares the app's
// items with the sheet's rows (matched by App ID) and reports exactly what
// is different, so the Sync screen can show it and Austin can approve each
// piece. Nothing here writes anything.

import { macBidAllIn, minEbayPrice, roundMoney, suggestedEbayPrice } from './pricing';
import { appliesMacBidFees, Item, normaliseStatus, Settings, SyncSource } from './types';

// One row of the Purchase sheet, as the Apps Script returns it. Dates are
// "M/d/yyyy" strings (or ""), money is numbers.
export interface SheetRow {
  appId: string;
  row: number;
  item: string;
  purchase: number;
  estShip: number;
  researchPrice: number;
  notes: string;
  place: string;
  datePurchased: string;
  status: string;
  dateListed: string;
  dateSold: string;
  soldPrice: number;
  fees: number;
  shipping: number;
}

// The 13 input columns — the only fields that ever sync. Photos, location,
// the per-item MAC.BID switch and the computed prices stay in the app;
// the sheet's formula columns stay in the sheet.
export interface SheetFields {
  item: string;
  purchase: number;
  estShip: number;
  researchPrice: number;
  notes: string;
  place: string;
  datePurchased: string;
  status: string;
  dateListed: string;
  dateSold: string;
  soldPrice: number;
  fees: number;
  shipping: number;
}

export interface FieldDiff {
  field: string;
  app: string;
  sheet: string;
}

export interface ChangedItem {
  item: Item;
  sheet: SheetRow;
  diffs: FieldDiff[];
}

export interface AppOnlyEntry {
  item: Item;
  // True when this id was in sync before but its sheet row is gone (row
  // deleted in the sheet). Those default to unchecked — re-adding them is
  // a deliberate choice, not a given.
  wasSynced: boolean;
}

export interface SyncDiff {
  appOnly: AppOnlyEntry[];
  sheetOnly: SheetRow[];
  changed: ChangedItem[];
  // Ids deleted in the app whose sheet row still exists.
  deletedInApp: string[];
}

const FIELD_LABELS: Array<{ key: keyof SheetFields; label: string }> = [
  { key: 'item', label: 'Item' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'estShip', label: 'Est ship' },
  { key: 'researchPrice', label: 'Research price' },
  { key: 'notes', label: 'Notes' },
  { key: 'place', label: 'Place' },
  { key: 'datePurchased', label: 'Date purchased' },
  { key: 'status', label: 'Status' },
  { key: 'dateListed', label: 'Date listed' },
  { key: 'dateSold', label: 'Date sold' },
  { key: 'soldPrice', label: 'Sold price' },
  { key: 'fees', label: 'Fees' },
  { key: 'shipping', label: 'Shipping' },
];

const MONEY_KEYS: Array<keyof SheetFields> = [
  'purchase',
  'estShip',
  'researchPrice',
  'soldPrice',
  'fees',
  'shipping',
];

const DATE_KEYS: Array<keyof SheetFields> = ['datePurchased', 'dateListed', 'dateSold'];

// Item names carry the same content in two separators: the sheet stores
// real newlines (from the MAC.BID copy-paste), the app's seed turned them
// into " | ". Compare on the content, not the separator, or the first sync
// would flag all 147 MAC.BID items as changed.
export function normalizeName(v: string): string {
  return (v || '')
    .replace(/ \| /g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function itemToSheetFields(item: Item): SheetFields {
  return {
    // Write the sheet's separator back: the app stores " | ", the sheet
    // stores newlines. Content identical, format unchanged.
    item: item.name.split(' | ').join('\n'),
    purchase: item.purchase,
    estShip: item.estShip,
    researchPrice: item.researchPrice,
    notes: item.notes,
    place: item.place,
    datePurchased: item.datePurchased,
    status: item.status,
    dateListed: item.dateListed,
    dateSold: item.dateSold,
    soldPrice: item.soldPrice,
    fees: item.fees,
    shipping: item.shipping,
  };
}

// The app-side patch for a sheet row: the 13 fields plus the app's own
// recomputed prices and the sheet's profit/revenue/margin (same formulas
// the sheet uses: profit = sold − purchase − fees − shipping,
// revenue = sold − fees − shipping).
export function sheetRowToPatch(
  sheet: SheetRow,
  existing: Item | null,
  settings: Settings,
): Partial<Item> {
  const macBid = existing
    ? appliesMacBidFees(existing)
    : sheet.place.toLowerCase().includes('mac');
  const allIn = macBid ? macBidAllIn(sheet.purchase, false, settings.salesTaxPct) : sheet.purchase;
  const suggested = suggestedEbayPrice(
    allIn,
    sheet.estShip,
    sheet.researchPrice,
    settings.ebayFeePct,
    settings.targetMarginPct,
  );
  const min = minEbayPrice(allIn, sheet.estShip, settings.ebayFeePct, settings.targetMarginPct);
  const sold = sheet.soldPrice;
  const profit = sold > 0 ? roundMoney(sold - sheet.purchase - sheet.fees - sheet.shipping) : 0;
  const revenue = sold > 0 ? roundMoney(sold - sheet.fees - sheet.shipping) : 0;
  const profitMargin =
    sold > 0 && profit !== 0 ? `${((profit / sold) * 100).toFixed(2)}%` : '';
  return {
    name: sheet.item,
    purchase: sheet.purchase,
    estShip: sheet.estShip,
    researchPrice: sheet.researchPrice,
    notes: sheet.notes,
    place: sheet.place,
    datePurchased: sheet.datePurchased,
    status: normaliseStatus(sheet.status),
    dateListed: sheet.dateListed,
    dateSold: sheet.dateSold,
    soldPrice: sheet.soldPrice,
    fees: sheet.fees,
    shipping: sheet.shipping,
    suggestedPrice: suggested,
    minPrice: min,
    profit,
    revenue,
    profitMargin,
    macBidFees: macBid,
  };
}

function moneyStr(v: number): string {
  return `$${(Math.round(v * 100) / 100).toFixed(2)}`;
}

// Canonical date for comparison: "M/d/yyyy" (either side) → "yyyy-m-d".
function canonDate(v: string): string {
  const s = (v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  return `${m[3]}-${Number(m[1])}-${Number(m[2])}`;
}

function fieldDiffs(item: Item, sheet: SheetRow): FieldDiff[] {
  const appFields = itemToSheetFields(item);
  const diffs: FieldDiff[] = [];
  for (const { key, label } of FIELD_LABELS) {
    const a = appFields[key];
    const b = sheet[key] as string | number;
    let same: boolean;
    let appStr: string;
    let sheetStr: string;
    if (key === 'item') {
      same = normalizeName(String(a)) === normalizeName(String(b));
      appStr = String(a || '—');
      sheetStr = String(b || '—');
    } else if (key === 'status') {
      same = normaliseStatus(String(a)) === normaliseStatus(String(b));
      appStr = normaliseStatus(String(a));
      sheetStr = normaliseStatus(String(b));
    } else if ((MONEY_KEYS as string[]).includes(key)) {
      same = Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
      appStr = moneyStr(Number(a));
      sheetStr = moneyStr(Number(b));
    } else if ((DATE_KEYS as string[]).includes(key)) {
      same = canonDate(String(a)) === canonDate(String(b));
      appStr = String(a || '—');
      sheetStr = String(b || '—');
    } else {
      same = String(a ?? '').trim() === String(b ?? '').trim();
      appStr = String(a || '—');
      sheetStr = String(b || '—');
    }
    if (!same) diffs.push({ field: label, app: appStr, sheet: sheetStr });
  }
  return diffs;
}

export function computeDiff(
  items: Item[],
  sheetRows: SheetRow[],
  opts: { tombstones: string[]; syncedIds: string[] },
): SyncDiff {
  const byAppId = new Map<string, SheetRow>();
  for (const r of sheetRows) {
    if (r.appId) byAppId.set(r.appId, r);
  }
  const syncedIds = new Set(opts.syncedIds);
  const tombstones = new Set(opts.tombstones);

  const appOnly: AppOnlyEntry[] = [];
  const changed: ChangedItem[] = [];

  for (const item of items) {
    const sheet = byAppId.get(item.id);
    if (!sheet) {
      appOnly.push({ item, wasSynced: syncedIds.has(item.id) });
      continue;
    }
    const diffs = fieldDiffs(item, sheet);
    if (diffs.length > 0) changed.push({ item, sheet, diffs });
  }

  const sheetOnly = sheetRows.filter((r) => {
    // A row whose App ID was deleted in the app is "deleted in app"
    // (→ Trash in the sheet), never "new in sheet" — the tombstone wins.
    if (r.appId && tombstones.has(r.appId)) return false;
    // Rows with no App ID (added to the sheet before ever syncing) are new.
    if (!r.appId) return true;
    // Rows whose App ID the app doesn't know are new too.
    return !items.some((it) => it.id === r.appId);
  });

  const deletedInApp = [...tombstones].filter((id) => byAppId.has(id));

  return { appOnly, sheetOnly, changed, deletedInApp };
}

// ---------------------------------------------------------------------------
// Source of truth — one choice drives the whole sync run.
//   'app':   the app wins. App-only items go to the sheet, changed items
//            take the app's version, items deleted in the app are marked
//            Trash in the sheet. Sheet-only rows are left alone (listed
//            for awareness, not imported).
//   'sheet': the sheet wins. Sheet-only rows come into the app, changed
//            items take the sheet's version, items deleted in the app are
//            restored from their sheet row (same RB-xxx). App-only items
//            are left alone (listed for awareness, not pushed).
// The preview shows what will happen; every actionable item starts checked
// and can be unchecked before applying, so nothing happens without approval.
// ---------------------------------------------------------------------------

// What applySync (sync.ts) receives after Austin approves the preview.
export interface SyncPlan {
  source: SyncSource;
  // App items to push to the sheet (app-truth: app-only + changed).
  upsertAppIds: string[];
  // Sheet rows to import as new app items (sheet-truth: sheet-only).
  importSheetRows: SheetRow[];
  // Changed items where the sheet wins (sheet-truth).
  sheetWins: Array<{ id: string; sheet: SheetRow }>;
  // Sheet rows to re-import as app items with their original id
  // (sheet-truth: deleted in the app, still in the sheet).
  restoreRows: SheetRow[];
  // Tombstone ids to mark Trash in the sheet (app-truth).
  trashAppIds: string[];
  // App ids skipped this run (sheet-truth: app-only). They leave the
  // synced set — the sheet no longer has them, so they are not in sync.
  skippedAppIds: string[];
}

export interface PreviewItem {
  key: string;
  label: string;
  sub?: string;
}

export interface PreviewGroup {
  id: string;
  title: string;
  note?: string;
  // False for the "left alone" groups: shown for awareness, no checkbox.
  actionable: boolean;
  items: PreviewItem[];
}

export const keyForAppOnly = (id: string): string => `app:${id}`;
export const keyForChanged = (id: string): string => `chg:${id}`;
export const keyForSheetOnly = (row: number): string => `sheet:${row}`;
export const keyForDeleted = (id: string): string => `del:${id}`;

// The groups the Sync screen shows for a diff + source of truth.
export function planPreview(diff: SyncDiff, source: SyncSource): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  if (source === 'app') {
    if (diff.appOnly.length > 0) {
      groups.push({
        id: 'add-to-sheet',
        title: 'Will be added to the sheet',
        actionable: true,
        items: diff.appOnly.map((e) => ({
          key: keyForAppOnly(e.item.id),
          label: e.item.name,
          sub: e.wasSynced ? `${e.item.id} · was in the sheet before` : e.item.id,
        })),
      });
    }
    if (diff.changed.length > 0) {
      groups.push({
        id: 'update-sheet',
        title: 'Will be updated in the sheet (app wins)',
        actionable: true,
        items: diff.changed.map((c) => ({
          key: keyForChanged(c.item.id),
          label: c.item.name,
          sub: c.diffs.map((d) => `${d.field}: ${d.app} → ${d.sheet}`).join(' · '),
        })),
      });
    }
    if (diff.deletedInApp.length > 0) {
      groups.push({
        id: 'trash-in-sheet',
        title: 'Will be marked Trash in the sheet',
        actionable: true,
        items: diff.deletedInApp.map((id) => ({ key: keyForDeleted(id), label: id })),
      });
    }
    if (diff.sheetOnly.length > 0) {
      groups.push({
        id: 'sheet-only-skipped',
        title: 'In the sheet only — left alone',
        note: 'The app is the source of truth, so these rows stay in the sheet and are not imported. Pick Sheet as the source of truth to bring them in.',
        actionable: false,
        items: diff.sheetOnly.map((r) => ({
          key: keyForSheetOnly(r.row),
          label: r.item,
          sub: `sheet row ${r.row}`,
        })),
      });
    }
  } else {
    if (diff.sheetOnly.length > 0) {
      groups.push({
        id: 'add-to-app',
        title: 'Will be added to the app',
        actionable: true,
        items: diff.sheetOnly.map((r) => ({
          key: keyForSheetOnly(r.row),
          label: r.item,
          sub: `sheet row ${r.row}${r.appId ? ` · ${r.appId}` : ''}`,
        })),
      });
    }
    if (diff.changed.length > 0) {
      groups.push({
        id: 'update-app',
        title: 'Will be updated in the app (sheet wins)',
        actionable: true,
        items: diff.changed.map((c) => ({
          key: keyForChanged(c.item.id),
          label: c.item.name,
          sub: c.diffs.map((d) => `${d.field}: ${d.app} → ${d.sheet}`).join(' · '),
        })),
      });
    }
    if (diff.deletedInApp.length > 0) {
      groups.push({
        id: 'restore-to-app',
        title: 'Will be restored to the app',
        note: 'These were deleted in the app but the sheet still has them. The sheet is the source of truth, so they come back with the same ID.',
        actionable: true,
        items: diff.deletedInApp.map((id) => ({ key: keyForDeleted(id), label: id })),
      });
    }
    if (diff.appOnly.length > 0) {
      groups.push({
        id: 'app-only-skipped',
        title: 'In the app only — left alone',
        note: 'The sheet is the source of truth, so these stay in the app and are not added to the sheet. Pick App as the source of truth to push them.',
        actionable: false,
        items: diff.appOnly.map((e) => ({
          key: keyForAppOnly(e.item.id),
          label: e.item.name,
          sub: e.wasSynced ? `${e.item.id} · was in the sheet before` : e.item.id,
        })),
      });
    }
  }
  return groups;
}

// Every actionable item starts checked for the given source.
export function defaultCheckedKeys(diff: SyncDiff, source: SyncSource): Set<string> {
  const keys = new Set<string>();
  for (const g of planPreview(diff, source)) {
    if (!g.actionable) continue;
    for (const it of g.items) keys.add(it.key);
  }
  return keys;
}

export function buildPlan(
  diff: SyncDiff,
  source: SyncSource,
  checked: Set<string>,
  sheetRows: SheetRow[],
): SyncPlan {
  const plan: SyncPlan = {
    source,
    upsertAppIds: [],
    importSheetRows: [],
    sheetWins: [],
    restoreRows: [],
    trashAppIds: [],
    skippedAppIds: [],
  };
  if (source === 'app') {
    for (const e of diff.appOnly) {
      if (checked.has(keyForAppOnly(e.item.id))) plan.upsertAppIds.push(e.item.id);
    }
    for (const c of diff.changed) {
      if (checked.has(keyForChanged(c.item.id))) plan.upsertAppIds.push(c.item.id);
    }
    for (const id of diff.deletedInApp) {
      if (checked.has(keyForDeleted(id))) plan.trashAppIds.push(id);
    }
  } else {
    for (const r of diff.sheetOnly) {
      if (checked.has(keyForSheetOnly(r.row))) plan.importSheetRows.push(r);
    }
    for (const c of diff.changed) {
      if (checked.has(keyForChanged(c.item.id))) {
        plan.sheetWins.push({ id: c.item.id, sheet: c.sheet });
      }
    }
    // Restores resolve from the fetched sheet rows: the tombstoned id is
    // the sheet row's App ID, so the item comes back with its original id.
    const byAppId = new Map(sheetRows.filter((r) => r.appId).map((r) => [r.appId, r]));
    for (const id of diff.deletedInApp) {
      if (!checked.has(keyForDeleted(id))) continue;
      const row = byAppId.get(id);
      if (row) plan.restoreRows.push(row);
    }
    for (const e of diff.appOnly) {
      plan.skippedAppIds.push(e.item.id);
    }
  }
  return plan;
}
