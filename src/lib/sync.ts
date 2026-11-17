// Two-way sheet sync, review-first (git-style). The pure diff lives in
// sync-diff.ts; this file does the impure parts: fetching the sheet through
// the Apps Script endpoint (sync/sheet-sync.gs) and applying an approved
// plan. Nothing is written to the sheet without going through the review
// screen (app/sync.tsx).

import {
  addItem,
  clearDeletedIds,
  getAllItems,
  getSettings,
  getSyncState,
  saveSyncState,
  updateItem,
} from './db';
import {
  itemToSheetFields,
  sheetRowToPatch,
  SheetRow,
  SyncPlan,
} from './sync-diff';
import { Expense, FreeItem, Item, normaliseFreeStatus } from './types';

export type { SheetRow, SyncPlan } from './sync-diff';

export async function fetchSheetRows(): Promise<SheetRow[]> {
  const { syncUrl, syncToken } = getSettings();
  if (!syncUrl.trim()) throw new Error('Sheet sync URL is not set (Settings → Sheet sync).');
  if (!syncToken.trim()) throw new Error('Sheet sync token is not set (Settings → Sheet sync).');
  const url = `${syncUrl.replace(/\/$/, '')}?token=${encodeURIComponent(syncToken.trim())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet sync failed (HTTP ${res.status}). Check the URL in Settings.`);
  const data = (await res.json()) as { rows?: SheetRow[]; error?: string };
  if (data.error) throw new Error(`Sheet sync failed: ${data.error}`);
  if (!Array.isArray(data.rows)) throw new Error('Sheet sync returned an unexpected response.');
  return data.rows;
}

// Dashboard refresh: pull the Free and Expenses tabs from the sheet and
// return them as local items (ids by tab row order — these lists are
// replaced wholesale, the sheet is their source of truth).
export async function fetchFreeRows(): Promise<FreeItem[]> {
  const rows = await fetchTabRows('Free');
  return (rows as Array<Record<string, unknown>>).map((r, i) => ({
    id: `FR-${String(i + 1).padStart(3, '0')}`,
    name: String(r.name ?? ''),
    box: String(r.box ?? ''),
    recPrice: Number(r.recPrice ?? 0) || 0,
    status: normaliseFreeStatus(String(r.status ?? '')),
    dateListed: String(r.dateListed ?? ''),
    dateSold: String(r.dateSold ?? ''),
    soldPrice: Number(r.soldPrice ?? 0) || 0,
    fees: Number(r.fees ?? 0) || 0,
    shipping: Number(r.shipping ?? 0) || 0,
  }));
}

export async function fetchExpenseRows(): Promise<Expense[]> {
  const rows = await fetchTabRows('Expenses');
  return (rows as Array<Record<string, unknown>>).map((r, i) => ({
    id: `EX-${String(i + 1).padStart(3, '0')}`,
    name: String(r.name ?? ''),
    price: Number(r.price ?? 0) || 0,
    date: String(r.date ?? ''),
    status: String(r.status ?? ''),
  }));
}

async function fetchTabRows(tab: string): Promise<unknown[]> {
  const { syncUrl, syncToken } = getSettings();
  if (!syncUrl.trim() || !syncToken.trim()) {
    throw new Error('Sheet sync URL/token is not set (Settings → Sheet sync).');
  }
  const url = `${syncUrl.replace(/\/$/, '')}?token=${encodeURIComponent(syncToken.trim())}&tab=${tab}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet sync failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { rows?: unknown[]; error?: string };
  if (data.error) throw new Error(`Sheet sync failed: ${data.error}`);
  if (!Array.isArray(data.rows)) throw new Error('Sheet sync returned an unexpected response.');
  return data.rows;
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
  const { syncUrl, syncToken } = getSettings();
  if (!syncUrl.trim() || !syncToken.trim()) {
    throw new Error('Sheet sync URL/token is not set (Settings → Sheet sync).');
  }
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
      const created = addItem({
        name: sheet.item,
        purchase: sheet.purchase,
        estShip: sheet.estShip,
        place: sheet.place,
        datePurchased: sheet.datePurchased,
        notes: sheet.notes,
      });
      updateItem(created.id, sheetRowToPatch(sheet, created, settings));
      assignIds.push({ row: sheet.row, appId: created.id });
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
  const body = {
    token: syncToken.trim(),
    upserts,
    assignIds,
    trash: plan.trashAppIds,
  };
  const res = await fetch(syncUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheet sync failed (HTTP ${res.status}). Nothing was applied.`);
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    upserted?: number;
    added?: number;
    assigned?: number;
    trashed?: number;
    errors?: string[];
  };
  if (data.error) throw new Error(`Sheet sync failed: ${data.error}`);
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

  return result;
}
