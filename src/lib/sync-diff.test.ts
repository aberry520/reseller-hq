// Sync-diff checks — run with `npm run test:sync-diff`
// (scripts/verify-sync-diff.mjs compiles this file's assertions against
// src/lib/sync-diff.ts). The diff is what the review screen shows, so a
// false positive here would ask Austin to approve a change that isn't real.

import {
  buildPlan,
  computeDiff,
  defaultCheckedKeys,
  normalizeName,
  planPreview,
  SheetRow,
} from './sync-diff';
import { DEFAULT_SETTINGS, Item } from './types';

let failures = 0;

function check(name: string, ok: boolean): void {
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures += 1;
}

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'RB-001',
    name: 'Widget',
    purchase: 10,
    estShip: 5,
    suggestedPrice: 0,
    minPrice: 0,
    researchPrice: 0,
    notes: '',
    place: 'MAC.BID Anderson',
    datePurchased: '7/1/2026',
    status: 'Listed',
    dateListed: '',
    dateSold: '',
    soldPrice: 0,
    fees: 0,
    shipping: 0,
    profit: 0,
    revenue: 0,
    profitMargin: '',
    macBidFees: true,
    location: '',
    qrCode: 'reseller://item/RB-001',
    photos: [],
    whiteBgPhotos: [],
    createdAt: '2026-11-17T00:00:00.000Z',
    ...over,
  };
}

function makeRow(over: Partial<SheetRow> = {}): SheetRow {
  return {
    appId: 'RB-001',
    row: 3,
    item: 'Widget',
    purchase: 10,
    estShip: 5,
    researchPrice: 0,
    notes: '',
    place: 'MAC.BID Anderson',
    datePurchased: '7/1/2026',
    status: 'Listed',
    dateListed: '',
    dateSold: '',
    soldPrice: 0,
    fees: 0,
    shipping: 0,
    ...over,
  };
}

void DEFAULT_SETTINGS;

// 1. Name separator: sheet newlines vs app " | " are the same content.
check(
  'normalizeName equates sheet newlines and app separators',
  normalizeName('Widget\nLocation: Anderson') === normalizeName('Widget | Location: Anderson'),
);

const identical = computeDiff([makeItem()], [makeRow()], { tombstones: [], syncedIds: [] });
check('identical app and sheet rows produce an empty diff', 
  identical.appOnly.length === 0 && identical.sheetOnly.length === 0 &&
  identical.changed.length === 0 && identical.deletedInApp.length === 0);

// 2. A real change is reported, with the field named.
const statusChange = computeDiff(
  [makeItem()],
  [makeRow({ status: 'Sold', soldPrice: 20, dateSold: '11/1/2026' })],
  { tombstones: [], syncedIds: [] },
);
check(
  'status + sold change is one changed item with 3 diffs',
  statusChange.changed.length === 1 &&
    statusChange.changed[0].diffs.some((d) => d.field === 'Status') &&
    statusChange.changed[0].diffs.some((d) => d.field === 'Sold price') &&
    statusChange.changed[0].diffs.some((d) => d.field === 'Date sold'),
);

// 3. Money rounding: $4.44 vs $4.440 is not a change.
const rounding = computeDiff(
  [makeItem({ purchase: 4.44 })],
  [makeRow({ purchase: 4.44 })],
  { tombstones: [], syncedIds: [] },
);
check('money equal to the cent is not a change', rounding.changed.length === 0);

// 4. Sheet-only row (no App ID — added to the sheet, never synced).
const sheetOnly = computeDiff(
  [makeItem()],
  [makeRow(), makeRow({ appId: '', row: 4, item: 'New from sheet' })],
  { tombstones: [], syncedIds: [] },
);
check(
  'sheet row without an App ID is sheet-only',
  sheetOnly.sheetOnly.length === 1 && sheetOnly.sheetOnly[0].item === 'New from sheet',
);

// 5. App-only items: new vs previously synced.
const appOnly = computeDiff(
  [makeItem(), makeItem({ id: 'RB-002', name: 'Old one' })],
  [makeRow()],
  { tombstones: [], syncedIds: ['RB-002'] },
);
check(
  'app-only splits new items from previously-synced ones',
  appOnly.appOnly.length === 1 &&
    appOnly.appOnly[0].item.id === 'RB-002' &&
    appOnly.appOnly[0].wasSynced === true,
);

// 6. Tombstone whose sheet row still exists → deleted in app, and the row
// is NOT also offered as new-in-sheet (the tombstone wins).
const deleted = computeDiff([makeItem({ id: 'RB-002', name: 'Other' })], [makeRow()], {
  tombstones: ['RB-001'],
  syncedIds: [],
});
check(
  'tombstone with a live sheet row is deleted-in-app, not sheet-only',
  deleted.deletedInApp.length === 1 &&
    deleted.deletedInApp[0] === 'RB-001' &&
    deleted.sheetOnly.length === 0,
);

// 7. Blank status on both sides is Unlisted, not a change.
const blankStatus = computeDiff(
  [makeItem({ status: 'Unlisted' })],
  [makeRow({ status: '' })],
  { tombstones: [], syncedIds: [] },
);
check('blank sheet status equals Unlisted', blankStatus.changed.length === 0);

// --- Source of truth -------------------------------------------------------
// Fixture: RB-001 matches on both sides; RB-002 is app-only; RB-003 is
// changed (sheet says Sold); RB-004 is sheet-only; RB-005 was deleted in
// the app but its sheet row still exists.
const srcItems = [
  makeItem({ id: 'RB-001', name: 'Matched' }),
  makeItem({ id: 'RB-002', name: 'App only' }),
  makeItem({ id: 'RB-003', name: 'Changed' }),
];
const srcRows = [
  makeRow({ row: 3, appId: 'RB-001', item: 'Matched' }),
  makeRow({ row: 4, appId: 'RB-003', item: 'Changed', status: 'Sold' }),
  makeRow({ row: 5, appId: 'RB-004', item: 'Sheet only' }),
  makeRow({ row: 6, appId: 'RB-005', item: 'Deleted in app' }),
];
const srcDiff = computeDiff(srcItems, srcRows, { tombstones: ['RB-005'], syncedIds: [] });
check(
  'source fixture diff has all four groups',
  srcDiff.appOnly.length === 1 &&
    srcDiff.sheetOnly.length === 1 &&
    srcDiff.changed.length === 1 &&
    srcDiff.deletedInApp.length === 1,
);

// 8. App as source of truth: app items go to the sheet, changed items take
// the app's version, the deleted item is trashed in the sheet, and the
// sheet-only row is listed as left alone (not actionable).
const appPreview = planPreview(srcDiff, 'app');
check(
  'app preview groups',
  appPreview.map((g) => g.id).join(',') ===
    'add-to-sheet,update-sheet,trash-in-sheet,sheet-only-skipped',
);
check(
  'app preview: sheet-only group is not actionable',
  appPreview.find((g) => g.id === 'sheet-only-skipped')?.actionable === false,
);
const appChecked = defaultCheckedKeys(srcDiff, 'app');
check(
  'app defaults: every actionable item checked',
  appChecked.size === 3 &&
    appChecked.has('app:RB-002') &&
    appChecked.has('chg:RB-003') &&
    appChecked.has('del:RB-005'),
);
const appPlan = buildPlan(srcDiff, 'app', appChecked, srcRows);
check(
  'app plan pushes app-only + changed, trashes the deleted item',
  appPlan.upsertAppIds.join(',') === 'RB-002,RB-003' &&
    appPlan.trashAppIds.join(',') === 'RB-005' &&
    appPlan.importSheetRows.length === 0 &&
    appPlan.sheetWins.length === 0 &&
    appPlan.restoreRows.length === 0 &&
    appPlan.skippedAppIds.length === 0,
);

// 9. Sheet as source of truth: the sheet row comes in, the changed item
// takes the sheet's version, the deleted item is restored with its original
// id, and the app-only item is listed as left alone (not pushed).
const sheetPreview = planPreview(srcDiff, 'sheet');
check(
  'sheet preview groups',
  sheetPreview.map((g) => g.id).join(',') ===
    'add-to-app,update-app,restore-to-app,app-only-skipped',
);
check(
  'sheet preview: app-only group is not actionable',
  sheetPreview.find((g) => g.id === 'app-only-skipped')?.actionable === false,
);
const sheetChecked = defaultCheckedKeys(srcDiff, 'sheet');
check(
  'sheet defaults: every actionable item checked',
  sheetChecked.size === 3 &&
    sheetChecked.has('sheet:5') &&
    sheetChecked.has('chg:RB-003') &&
    sheetChecked.has('del:RB-005'),
);
const sheetPlan = buildPlan(srcDiff, 'sheet', sheetChecked, srcRows);
check(
  'sheet plan imports the sheet row and restores the deleted item',
  sheetPlan.importSheetRows.length === 1 &&
    sheetPlan.importSheetRows[0].appId === 'RB-004' &&
    sheetPlan.sheetWins.length === 1 &&
    sheetPlan.sheetWins[0].id === 'RB-003' &&
    sheetPlan.restoreRows.length === 1 &&
    sheetPlan.restoreRows[0].appId === 'RB-005' &&
    sheetPlan.upsertAppIds.length === 0 &&
    sheetPlan.trashAppIds.length === 0 &&
    sheetPlan.skippedAppIds.join(',') === 'RB-002',
);

// 10. Unchecking one item removes it from the plan.
const unchecked = new Set(sheetChecked);
unchecked.delete('sheet:5');
const uncheckedPlan = buildPlan(srcDiff, 'sheet', unchecked, srcRows);
check(
  'unchecked sheet row is not imported',
  uncheckedPlan.importSheetRows.length === 0 &&
    uncheckedPlan.sheetWins.length === 1 &&
    uncheckedPlan.restoreRows.length === 1,
);

if (failures > 0) throw new Error(`${failures} sync-diff check(s) failed`);
// eslint-disable-next-line no-console
console.log('Sync-diff checks done.');
