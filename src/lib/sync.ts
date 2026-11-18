// Two-way sheet sync, review-first (git-style), plus the start-fresh
// actions (overwrite one side from the other, or clear a side). The pure
// diff lives in sync-diff.ts; this file does the impure parts: fetching the
// sheet through the Apps Script endpoint (sync/sheet-sync.gs) and applying
// an approved plan. Nothing is written to the sheet without going through
// the review screen (app/sync.tsx) — except the explicit overwrite/clear
// actions there, which each ask for confirmation first.
//
// The sheet is universal: one Inventory tab, columns found by header text,
// and a free item is just a row whose cost (Purchase) is 0. The tab name
// comes from Settings (syncSheet, default 'Inventory').

import { Alert } from 'react-native';
import {
  addItem,
  clearAppItems,
  clearDeletedIds,
  getAllItems,
  getSettings,
  getSyncState,
  saveSyncState,
  setOutOfSync,
  updateItem,
} from './db';
import {
  itemToSheetFields,
  sheetRowToPatch,
  SheetRow,
  SyncPlan,
} from './sync-diff';
import { ebayDraftRow } from './listing';
import { Expense, Item, normaliseStatus } from './types';

export type { SheetRow, SyncPlan } from './sync-diff';

function syncConfig(): { url: string; token: string; tab: string } {
  const { syncUrl, syncToken, syncSheet } = getSettings();
  if (!syncUrl.trim()) throw new Error('Sheet sync URL is not set (Settings → Sheet sync).');
  if (!syncToken.trim()) throw new Error('Sheet sync token is not set (Settings → Sheet sync).');
  return {
    url: syncUrl.replace(/\/$/, ''),
    token: syncToken.trim(),
    tab: (syncSheet || 'Inventory').trim(),
  };
}

export async function fetchSheetRows(): Promise<SheetRow[]> {
  const { url, token, tab } = syncConfig();
  const res = await fetch(`${url}?token=${encodeURIComponent(token)}&tab=${encodeURIComponent(tab)}`);
  if (!res.ok) throw new Error(`Sheet sync failed (HTTP ${res.status}). Check the URL in Settings.`);
  const data = (await res.json()) as { rows?: SheetRow[]; error?: string };
  if (data.error) throw new Error(`Sheet sync failed: ${data.error}`);
  if (!Array.isArray(data.rows)) throw new Error('Sheet sync returned an unexpected response.');
  return data.rows;
}

// Dashboard refresh: pull the Expenses tab from the sheet (ids by tab row
// order — the list is replaced wholesale, the sheet is its source of truth).
export async function fetchExpenseRows(): Promise<Expense[]> {
  const rows = await fetchTabRows('Expenses');
  return (rows as Array<Record<string, unknown>>).map((r, i) => ({
    id: `EX-${String(i + 1).padStart(3, '0')}`,
    name: String(r.name ?? ''),
    price: Number(r.price ?? 0) || 0,
    date: String(r.date ?? ''),
    // Trim so a status with stray whitespace still matches 'Deleted'.
    status: String(r.status ?? '').trim(),
  }));
}

async function fetchTabRows(tab: string): Promise<unknown[]> {
  const { url, token } = syncConfig();
  const res = await fetch(`${url}?token=${encodeURIComponent(token)}&tab=${encodeURIComponent(tab)}`);
  if (!res.ok) throw new Error(`Sheet sync failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { rows?: unknown[]; error?: string };
  if (data.error) throw new Error(`Sheet sync failed: ${data.error}`);
  if (!Array.isArray(data.rows)) throw new Error('Sheet sync returned an unexpected response.');
  return data.rows;
}

// POST a body to the script and return its JSON. Throws on HTTP errors or
// on an { error } response, so callers never apply a half-finished result.
async function postSync(body: Record<string, unknown>): Promise<{
  ok?: boolean;
  error?: string;
  upserted?: number;
  added?: number;
  assigned?: number;
  trashed?: number;
  written?: number;
  cleared?: number;
  errors?: string[];
}> {
  const { url, token, tab } = syncConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token, tab }),
  });
  if (!res.ok) throw new Error(`Sheet sync failed (HTTP ${res.status}). Nothing was applied.`);
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    upserted?: number;
    added?: number;
    assigned?: number;
    trashed?: number;
    written?: number;
    cleared?: number;
    errors?: string[];
  };
  if (data.error) throw new Error(`Sheet sync failed: ${data.error}`);
  return data;
}

export interface SyncResult {
  addedToSheet: number;
  addedToApp: number;
  updatedSheet: number;
  updatedApp: number;
  restoredToApp: number;
  trashedInSheet: number;
  errors: string[];
}

export async function applySync(plan: SyncPlan): Promise<SyncResult> {
  const settings = getSettings();
  const result: SyncResult = {
    addedToSheet: 0,
    addedToApp: 0,
    updatedSheet: 0,
    updatedApp: 0,
    restoredToApp: 0,
    trashedInSheet: 0,
    errors: [],
  };

  const allItems = getAllItems();
  const byId = new Map(allItems.map((it) => [it.id, it]));

  // 1. Sheet → app: import new rows, apply sheet-wins updates, and restore
  // deleted items from their sheet row (same RB-xxx — the sheet row's App
  // ID already matches, so no id stamp is needed for restores).
  const assignIds: Array<{ row: number; appId: string }> = [];
  for (const sheet of plan.importSheetRows) {
    try {
      // Reuse the sheet's App ID when it has one (a row the app doesn't
      // know yet, e.g. after a clear) — generating a new ID here would
      // orphan the row's identity and leave its QR pointing at the old
      // ID. Only rows with no App ID get a fresh one, stamped back below.
      const created = addItem({
        id: sheet.appId || undefined,
        name: sheet.item,
        purchase: sheet.purchase,
        estShip: sheet.estShip,
        place: sheet.place,
        datePurchased: sheet.datePurchased,
        notes: sheet.notes,
      });
      updateItem(created.id, sheetRowToPatch(sheet, created, settings));
      if (!sheet.appId) assignIds.push({ row: sheet.row, appId: created.id });
      result.addedToApp++;
    } catch (e) {
      result.errors.push(`import "${sheet.item}": ${String(e)}`);
    }
  }
  for (const sheet of plan.restoreRows) {
    try {
      const restored = addItem({
        id: sheet.appId,
        name: sheet.item,
        purchase: sheet.purchase,
        estShip: sheet.estShip,
        place: sheet.place,
        datePurchased: sheet.datePurchased,
        notes: sheet.notes,
      });
      updateItem(restored.id, sheetRowToPatch(sheet, restored, settings));
      result.restoredToApp++;
    } catch (e) {
      result.errors.push(`restore ${sheet.appId}: ${String(e)}`);
    }
  }
  for (const { id, sheet } of plan.sheetWins) {
    try {
      const existing = byId.get(id);
      if (!existing) continue;
      updateItem(id, sheetRowToPatch(sheet, existing, settings));
      result.updatedApp++;
    } catch (e) {
      result.errors.push(`update ${id}: ${String(e)}`);
    }
  }

  // 2. App → sheet: post the approved upserts, id stamps, and trashes.
  const upserts = plan.upsertAppIds
    .map((id) => byId.get(id))
    .filter((it): it is Item => !!it)
    .map((it) => ({ appId: it.id, fields: itemToSheetFields(it) }));
  const data = await postSync({
    action: 'merge',
    upserts,
    assignIds,
    trash: plan.trashAppIds,
  });
  result.addedToSheet = data.added ?? 0;
  result.updatedSheet = data.upserted ?? 0;
  result.trashedInSheet = data.trashed ?? 0;
  if (data.errors) result.errors.push(...data.errors);

  // 3. Bookkeeping: clear the applied tombstones (trashed and restored)
  // and record what is in sync now (previously synced ids, plus anything
  // just added to the sheet, imported, or restored, minus anything just
  // trashed or skipped because the sheet is the source of truth).
  clearDeletedIds([...plan.trashAppIds, ...plan.restoreRows.map((r) => r.appId)]);
  const previous = getSyncState()?.ids ?? [];
  const nowInSync = new Set(previous);
  for (const id of plan.upsertAppIds) nowInSync.add(id);
  for (const a of assignIds) nowInSync.add(a.appId);
  for (const r of plan.restoreRows) nowInSync.add(r.appId);
  for (const id of plan.trashAppIds) nowInSync.delete(id);
  for (const id of plan.skippedAppIds) nowInSync.delete(id);
  saveSyncState([...nowInSync], new Date().toISOString(), plan.source);
  // A clean apply means the app and the sheet agree again.
  if (result.errors.length === 0) setOutOfSync(false);

  return result;
}

// ---------------------------------------------------------------------------
// Start-fresh actions. Each one is explicit and destructive in one direction
// only; the Sync screen confirms every one before calling it.
// ---------------------------------------------------------------------------

export interface OverwriteResult {
  count: number;
  errors: string[];
}

// Replace everything in the app with the sheet's rows. Rows that already
// have an App ID keep it; rows without one get a new RB-xxx, which is
// stamped back to the sheet so the next merge sync does not re-import them.
// Deleted rows are skipped: they live only in the sheet.
export async function overwriteAppFromSheet(): Promise<OverwriteResult> {
  const rows = await fetchSheetRows();
  const settings = getSettings();
  clearAppItems();
  const errors: string[] = [];
  const ids: string[] = [];
  const assignIds: Array<{ row: number; appId: string }> = [];
  for (const sheet of rows) {
    if (normaliseStatus(sheet.status) === 'Deleted') continue;
    try {
      const created = addItem({
        id: sheet.appId || undefined,
        name: sheet.item,
        purchase: sheet.purchase,
        estShip: sheet.estShip,
        place: sheet.place,
        datePurchased: sheet.datePurchased,
        notes: sheet.notes,
      });
      updateItem(created.id, sheetRowToPatch(sheet, created, settings));
      ids.push(created.id);
      if (!sheet.appId) assignIds.push({ row: sheet.row, appId: created.id });
    } catch (e) {
      errors.push(`import "${sheet.item}": ${String(e)}`);
    }
  }
  if (assignIds.length > 0) {
    try {
      const data = await postSync({ action: 'merge', upserts: [], assignIds, trash: [] });
      if (data.errors) errors.push(...data.errors);
    } catch (e) {
      errors.push(`stamping App IDs back to the sheet: ${String(e)}`);
    }
  }
  saveSyncState(ids, new Date().toISOString(), getSyncState()?.source);
  if (errors.length === 0) setOutOfSync(false);
  return { count: ids.length, errors };
}

// Replace the sheet's Expenses tab with the app's expenses. The Expenses
// tab has no App ID column, so this is a whole-list replace (the same
// "update sheet from app" idea as the inventory overwrite), not a merge.
export async function pushExpenseRows(expenses: Expense[]): Promise<OverwriteResult> {
  const data = await postSync({
    action: 'overwriteExpenses',
    rows: expenses.map((e) => ({
      name: e.name,
      price: e.price,
      date: e.date,
      status: e.status,
    })),
  });
  return { count: data.written ?? expenses.length, errors: data.errors ?? [] };
}

// Send eBay bulk draft rows to the ebay-draft tab (eBay's own template).
// The Apps Script appends them after the last data row and skips any row
// whose SKU (Custom label) is already in the tab, so sending the same
// item twice does not duplicate the draft. Returns how many were written
// and which SKUs were skipped as already there.
export async function pushEbayDrafts(items: Item[]): Promise<{
  written: number;
  skipped: string[];
  errors: string[];
}> {
  const data = await postSync({
    action: 'ebayDrafts',
    rows: items.map((it) => ebayDraftRow(it)),
  });
  const extra = data as { skipped?: string[] };
  return {
    written: data.written ?? items.length,
    skipped: extra.skipped ?? [],
    errors: data.errors ?? [],
  };
}

// Push one or more items to the sheet as upserts (merge). Used when an
// item is removed: the Deleted status goes to the sheet right away, so
// removing an item changes its status to Deleted in the app AND the
// sheet, without waiting for a full sync review. Best-effort — it throws
// when sync is not configured or the sheet cannot be reached, and the
// caller lets the regular sync pick the Deleted item up as a changed
// item (App wins pushes it then).
export async function pushItemsToSheet(items: Item[]): Promise<void> {
  if (items.length === 0) return;
  await postSync({
    action: 'merge',
    upserts: items.map((it) => ({ appId: it.id, fields: itemToSheetFields(it) })),
    assignIds: [],
    trash: [],
  });
}

// Live write-through for user edits: push items to the sheet right away
// and, when the sheet cannot be reached, pop up once (per offline
// episode) so Austin knows the app and the sheet are out of sync. The
// change is already saved in the app; the regular sync still picks it
// up later. No popup when sync is not configured — that is a setup
// matter, not an outage.
let offlineNoticeShown = false;

function isNotConfigured(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /is not set/.test(m);
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const m = e instanceof Error ? e.message : String(e);
  return /network request failed|failed to fetch|networkerror|offline/i.test(m);
}

export function pushItemsToSheetLive(items: Item[]): void {
  // Deleted items are only pushed when they are known to be in the sheet;
  // a Deleted row for an app-only item would be clutter. New/updated
  // items are always pushed — the merge upsert adds the row when it is
  // not there yet, so adding an item in the app adds it to the sheet.
  const synced = new Set(getSyncState()?.ids ?? []);
  const toPush = items.filter((it) => it.status !== 'Deleted' || synced.has(it.id));
  if (toPush.length === 0) return;
  pushItemsToSheet(toPush)
    .then(() => {
      offlineNoticeShown = false;
      setOutOfSync(false);
    })
    .catch((e) => {
      if (isNotConfigured(e)) return;
      setOutOfSync(true);
      if (offlineNoticeShown) return;
      offlineNoticeShown = true;
      const offline = isNetworkError(e);
      Alert.alert(
        offline ? "You're offline" : 'Sheet not updated',
        offline
          ? 'This change was saved in the app, but the sheet could not be updated because you are offline. The app and the sheet are out of sync — run a sync when you are back online and it will catch up.'
          : `This change was saved in the app, but the sheet could not be updated (${e instanceof Error ? e.message : 'error'}). The app and the sheet are out of sync — run a sync later and it will catch up.`,
        [{ text: 'OK' }],
      );
    });
}

// Replace the whole sheet tab with the app's items.
export async function overwriteSheetFromApp(): Promise<OverwriteResult> {
  const items = getAllItems();
  const data = await postSync({
    action: 'overwrite',
    rows: items.map((it) => ({ appId: it.id, fields: itemToSheetFields(it) })),
  });
  saveSyncState(
    items.map((it) => it.id),
    new Date().toISOString(),
    getSyncState()?.source,
  );
  if ((data.errors ?? []).length === 0) setOutOfSync(false);
  return { count: data.written ?? items.length, errors: data.errors ?? [] };
}

// Delete all data rows from the sheet tab (keeps the header). The app is
// not touched, and nothing is in sync afterwards.
export async function clearSheetOnServer(): Promise<OverwriteResult> {
  const data = await postSync({ action: 'clear' });
  saveSyncState([], new Date().toISOString(), getSyncState()?.source);
  return { count: data.cleared ?? 0, errors: data.errors ?? [] };
}
