// sheet-sync.gs — the Reseller HQ sheet sync endpoint.
// Works with ANY reseller sheet that has the columns below (in any order).
// A "free" item is just a row whose cost (Purchase) is 0 — there is no
// separate Free tab; everything lives on one Inventory tab.
//
// Setup (once):
//   1. In your sheet: Extensions → Apps Script, paste this file.
//   2. Project Settings → Script Properties → add SYNC_TOKEN (a long
//      random string you make up).
//   3. Deploy → New deployment → Web app, Execute as Me, Who has access
//      Anyone. Copy the Web app URL.
//   4. In the app: Settings → paste the URL + the same token, and the tab
//      name (default "Inventory").
// The app sends the token on every request. Keep it private — anyone with
// the URL and the token can read and change the sheet.
//
// What it does:
//   GET  ?token=...[&tab=Name]  →  { rows: [...] } for the tab (default
//        CONFIG.SHEET_NAME). The optional Expenses tab is read the same way
//        (?tab=Expenses) for the dashboard.
//   POST { token, action, ... } → one of:
//        merge     { upserts, assignIds, trash } — the review-first sync:
//                  update rows by App ID, stamp App IDs on imported rows,
//                  mark deleted items Trash. (Default when no action given.)
//        overwrite { rows } — replace the whole tab with the given rows.
//        clear     {} — delete all data rows, keep the header.
//        overwriteExpenses { rows } — replace the Expenses tab with the
//                  given rows (the Expenses page's "Send to sheet").
//        ebayDrafts { rows: [[...11 columns...]] } — append eBay bulk
//                  draft rows to the ebay-draft tab (eBay's own template:
//                  #INFO rows, header row, data below). Rows whose SKU
//                  (Custom label) already exists are skipped, so sending
//                  the same item twice does not duplicate the draft.
//        uploadPhoto { itemId, index, filename, mimeType, data } — save
//                  one photo (base64) to the "Reseller HQ Photos" Drive
//                  folder, share it "anyone with the link can view", and
//                  return { fileId, url }. The app stores the URL on the
//                  item (Photo URLs column) so the photo is reachable from
//                  the web version and the posting extension — the local
//                  file only exists on the phone that took it.
//
// Columns are found by HEADER TEXT, not by letter, and the header row is
// found by scanning the first few rows — so a sheet works as long as it has
// the headers below, whatever row they sit on and whatever order they are
// in. Extra columns (listing checkboxes, a summary block) are left alone.
// The data area is the mapped columns below the header row.

// ---------------------------------------------------------------------------
// CONFIG — change these for your own sheet.
// ---------------------------------------------------------------------------
var SPREADSHEET_ID = '10wBKzvzqS4IyFIUGTI6vbfDQr2FTLn9bkpL1Mcg9Snk';
var SHEET_NAME = 'Inventory';   // the tab with the inventory
var APP_ID_HEADER = 'App ID';   // the column that holds the app's item id
// The Drive folder photos are uploaded to. Create the folder in Drive
// yourself, open it, and paste the ID from its URL
// (drive.google.com/drive/folders/<ID>). Pointing at an existing folder
// avoids DriveApp.createFolder, which some deployments refuse even when
// the script is authorized for Drive. Leave '' to fall back to finding
// (or creating) a folder named "Reseller HQ Photos".
var PHOTOS_FOLDER_ID = '';
// The sheet's own fee/margin used by its Suggested/Min formulas (decimals).
var SHEET_FEE_PCT = 0.13;
var SHEET_MARGIN_PCT = 0.30;

// Header → field. If your sheet uses different header names, rename them
// here (the field names on the right are what the app expects). Headers
// your sheet does not have are simply skipped — the app treats them as
// blank/0 — so a sheet only needs the required ones to work.
var FIELD_BY_HEADER = {
  'Item': 'item',
  'Purchase': 'purchase',
  'Est Ship': 'estShip',
  'Research Price': 'researchPrice',
  'Notes': 'notes',
  'Location': 'location',
  'Place of Purchase': 'place',
  'Date Purchased': 'datePurchased',
  'Status': 'status',
  'Date Listed': 'dateListed',
  'Date Sold': 'dateSold',
  'Sold Price': 'soldPrice',
  'Fees': 'fees',
  'Shipping': 'shipping',
  // Hosted photo URLs (JSON array string, one per photo, aligned with the
  // app's photos list). A sheet without this column simply skips it.
  'Photo URLs': 'photoUrls'
};
// Headers that hold formulas — read but never written by the app. The
// script fills them in for new rows (see formulaFor_).
var FORMULA_BY_HEADER = {
  'Suggested Price': 'suggested',
  'Min Price': 'min',
  'Profit': 'profit',
  'Revenue': 'revenue',
  'Profit Mrgin': 'margin',
  'Profit Margin': 'margin'
};
// The sync needs at least these headers to work.
var REQUIRED_HEADERS = ['Item', 'Purchase', 'Status'];

// The Expenses tab (optional, for the dashboard): header → field.
var EXPENSES_BY_HEADER = {
  'Item': 'name',
  'Price': 'price',
  'Date': 'date',
  'Status': 'status'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function checkToken_(token) {
  if (!token) return 'missing token';
  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!expected) return 'SYNC_TOKEN is not set (Script Properties)';
  if (token !== expected) return 'bad token';
  return null;
}

function str_(v) {
  return v === null || v === undefined ? '' : String(v);
}

function num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmtDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'M/d/yyyy');
  }
  return str_(v);
}

// "M/d/yyyy" (or "M/d/yy") → a real Date, or null.
function parseDate_(s) {
  var m = str_(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  var y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function tabNames_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheets()
    .map(function (s) {
      return s.getName();
    });
}

// Find the header row: the first row (of the first 5) containing all the
// required headers. Returns { cols, formulas, headerRow, found } where cols
// maps field → column (1-based) for every known header present, formulas
// maps formula kind → column, and found lists the header names seen.
// Throws a clear error naming the missing headers when no header row is
// found, so a sheet with different header names fails loudly instead of
// silently syncing the wrong columns.
function colMap_(sheet, fieldByHeader, requiredHeaders) {
  var lastCol = sheet.getLastColumn();
  var headerRow = 0;
  var headers = null;
  for (var r = 1; r <= 5; r++) {
    var rowVals = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    var names = rowVals.map(function (v) {
      return str_(v).trim();
    });
    var ok = true;
    for (var i = 0; i < requiredHeaders.length; i++) {
      if (names.indexOf(requiredHeaders[i]) === -1) {
        ok = false;
        break;
      }
    }
    if (ok) {
      headerRow = r;
      headers = names;
      break;
    }
  }
  if (!headerRow) {
    throw new Error(
      'No header row found in tab "' + sheet.getName() + '" (looked in rows 1-5). ' +
      'Required headers: ' + requiredHeaders.join(', ') +
      '. Rename the headers in the sheet or in FIELD_BY_HEADER at the top of this script.',
    );
  }
  var cols = {};
  var formulas = {};
  var found = [];
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    if (!h) continue;
    found.push(h);
    if (fieldByHeader[h]) cols[fieldByHeader[h]] = c + 1;
    if (FORMULA_BY_HEADER[h]) formulas[FORMULA_BY_HEADER[h]] = c + 1;
    if (h === APP_ID_HEADER) cols.appId = c + 1;
  }
  return { cols: cols, formulas: formulas, headerRow: headerRow, found: found };
}

function openTab_(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(
      'Tab "' + name + '" not found. Tabs in this sheet: ' + tabNames_().join(', ') + '.',
    );
  }
  return sheet;
}

// The last data row: the last non-empty cell in the Item column (below the
// header). Using the Item column — not getLastRow() — so a summary block in
// other columns never moves the append point.
function lastDataRow_(sheet, itemCol, headerRow) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return headerRow;
  var values = sheet.getRange(headerRow + 1, itemCol, lastRow - headerRow, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (str_(values[i][0]).trim() !== '') return headerRow + 1 + i;
  }
  return headerRow;
}

// The formula for a formula column on a given row, built from the actual
// column letters (so it works whatever order the columns are in). Returns
// null when the columns a formula needs are not in the sheet. The margin
// formula is built by writeRow_, which knows the Profit column.
function formulaFor_(kind, row, cols) {
  function L(field) {
    return cols[field] ? colLetter_(cols[field]) + row : null;
  }
  var purchase = L('purchase');
  var estShip = L('estShip');
  var sold = L('soldPrice');
  var fees = L('fees');
  var shipping = L('shipping');
  if (kind === 'suggested') {
    if (!purchase || !estShip) return null;
    var denom = (1 - SHEET_FEE_PCT - SHEET_MARGIN_PCT).toFixed(2);
    return '=(' + purchase + '+' + estShip + ')/' + denom;
  }
  if (kind === 'min') {
    if (!purchase || !estShip) return null;
    var denomMin = (1 - SHEET_FEE_PCT).toFixed(2);
    return '=(' + purchase + '+' + estShip + ')/' + denomMin;
  }
  if (kind === 'profit') {
    if (!sold || !purchase || !fees || !shipping) return null;
    return '=IF(' + sold + '<>"", ' + sold + '-' + purchase + '-' + fees + '-' + shipping + ', "")';
  }
  if (kind === 'revenue') {
    if (!sold || !fees || !shipping) return null;
    return '=IF(' + sold + '<>"", ' + sold + '-' + fees + '-' + shipping + ', "")';
  }
  return null;
}

// Read every data row of a tab as named objects.
function readInventory_(tabName) {
  var sheet = openTab_(tabName);
  var map = colMap_(sheet, FIELD_BY_HEADER, REQUIRED_HEADERS);
  var cols = map.cols;
  var headerRow = map.headerRow;
  var lastRow = lastDataRow_(sheet, cols.item, headerRow);
  var rows = [];
  if (lastRow > headerRow) {
    var maxCol = Math.max.apply(null, Object.values(cols));
    var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, maxCol).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var item = str_(r[cols.item - 1]).trim();
      var appId = cols.appId ? str_(r[cols.appId - 1]).trim() : '';
      if (!item && !appId) continue; // skip blank rows
      rows.push({
        appId: appId,
        row: headerRow + 1 + i,
        item: item,
        purchase: num_(r[cols.purchase - 1]),
        estShip: cols.estShip ? num_(r[cols.estShip - 1]) : 0,
        researchPrice: cols.researchPrice ? num_(r[cols.researchPrice - 1]) : 0,
        notes: cols.notes ? str_(r[cols.notes - 1]) : '',
        location: cols.location ? str_(r[cols.location - 1]) : '',
        place: cols.place ? str_(r[cols.place - 1]) : '',
        datePurchased: cols.datePurchased ? fmtDate_(r[cols.datePurchased - 1]) : '',
        status: str_(r[cols.status - 1]),
        dateListed: cols.dateListed ? fmtDate_(r[cols.dateListed - 1]) : '',
        dateSold: cols.dateSold ? fmtDate_(r[cols.dateSold - 1]) : '',
        soldPrice: cols.soldPrice ? num_(r[cols.soldPrice - 1]) : 0,
        fees: cols.fees ? num_(r[cols.fees - 1]) : 0,
        shipping: cols.shipping ? num_(r[cols.shipping - 1]) : 0,
        photoUrls: cols.photoUrls ? str_(r[cols.photoUrls - 1]) : ''
      });
    }
  }
  return rows;
}

function readExpenses_() {
  var sheet = openTab_('Expenses');
  var map = colMap_(sheet, EXPENSES_BY_HEADER, ['Item', 'Price']);
  var cols = map.cols;
  var headerRow = map.headerRow;
  var lastRow = lastDataRow_(sheet, cols.name, headerRow);
  var rows = [];
  if (lastRow > headerRow) {
    var maxCol = Math.max.apply(null, Object.values(cols));
    var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, maxCol).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var name = str_(r[cols.name - 1]).trim();
      if (!name) continue;
      rows.push({
        row: headerRow + 1 + i,
        name: name,
        price: num_(r[cols.price - 1]),
        date: cols.date ? fmtDate_(r[cols.date - 1]) : '',
        status: cols.status ? str_(r[cols.status - 1]) : ''
      });
    }
  }
  return rows;
}

// Clear the data area: every mapped column below the header row. Other
// columns (listing checkboxes, a summary block) are left alone.
function clearData_(sheet, map) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= map.headerRow) return 0;
  var allCols = Object.values(map.cols).concat(Object.values(map.formulas));
  for (var i = 0; i < allCols.length; i++) {
    sheet.getRange(map.headerRow + 1, allCols[i], lastRow - map.headerRow, 1).clearContent();
  }
  return lastRow - map.headerRow;
}

// Write one inventory row (input columns + formula columns + App ID).
// `fields` uses the app's field names; dates arrive as "M/d/yyyy" strings.
function writeRow_(sheet, row, appId, fields, map) {
  var cols = map.cols;
  var formulas = map.formulas;
  function set(field, value) {
    if (cols[field]) sheet.getRange(row, cols[field]).setValue(value);
  }
  set('item', fields.item || '');
  set('purchase', num_(fields.purchase));
  set('estShip', num_(fields.estShip));
  set('researchPrice', num_(fields.researchPrice));
  set('notes', fields.notes || '');
  set('location', fields.location || '');
  set('place', fields.place || '');
  set('datePurchased', parseDate_(fields.datePurchased));
  set('status', fields.status || '');
  set('dateListed', parseDate_(fields.dateListed));
  set('dateSold', parseDate_(fields.dateSold));
  set('soldPrice', num_(fields.soldPrice));
  set('fees', num_(fields.fees));
  set('shipping', num_(fields.shipping));
  set('photoUrls', fields.photoUrls || '');
  if (cols.appId) sheet.getRange(row, cols.appId).setValue(appId || '');
  // Formula columns, built from the actual column letters.
  for (var kind in formulas) {
    var f = null;
    if (kind === 'margin') {
      // Profit margin = Profit / Sold Price. The Profit column is the
      // formula column found under the 'Profit' header (formulas.profit).
      var profitCol = formulas.profit;
      var soldCol = cols.soldPrice ? colLetter_(cols.soldPrice) + row : null;
      if (profitCol && soldCol) {
        var pL = colLetter_(profitCol) + row;
        f = '=IF(AND(' + pL + '<>"",' + soldCol + '<>""),' + pL + '/' + soldCol + ',"")';
      }
    } else {
      f = formulaFor_(kind, row, cols);
    }
    if (f) sheet.getRange(row, formulas[kind]).setFormula(f);
  }
}

// ---------------------------------------------------------------------------
// GET ?token=...[&tab=Name]  →  { rows: [...] }
//   tab defaults to CONFIG.SHEET_NAME ("Inventory"). ?tab=Expenses reads the
//   Expenses tab for the dashboard.
// ---------------------------------------------------------------------------
function doGet(e) {
  try {
    var err = checkToken_(e.parameter.token);
    if (err) return json_({ error: err });
    var tab = e.parameter.tab || SHEET_NAME;
    if (tab === 'Expenses') return json_({ rows: readExpenses_() });
    return json_({ rows: readInventory_(tab) });
  } catch (ex) {
    return json_({ error: String(ex) });
  }
}

// ---------------------------------------------------------------------------
// POST { token, action, ... }
//   merge     { upserts: [{appId, fields}], assignIds: [{row, appId}],
//               trash: [appId] } — update by App ID, stamp ids, Trash deletes.
//   overwrite { rows: [{appId, fields}] } — replace the whole tab.
//   clear     {} — delete all data rows, keep the header.
// ---------------------------------------------------------------------------
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var body = JSON.parse(e.postData.contents);
    var err = checkToken_(body.token);
    if (err) return json_({ error: err });
    var action = body.action || 'merge';
    // Expenses is its own tab with its own columns (Item, Price, Date,
    // Status) and no App ID, so it is written by whole-list replace, not
    // by the inventory merge below.
    if (action === 'overwriteExpenses') {
      var expSheet = openTab_('Expenses');
      var expMap = colMap_(expSheet, EXPENSES_BY_HEADER, ['Item', 'Price']);
      clearData_(expSheet, expMap);
      var expRows = body.rows || [];
      var expWritten = 0;
      var expErrors = [];
      for (var i = 0; i < expRows.length; i++) {
        try {
          var er = expRows[i];
          var eRow = expMap.headerRow + 1 + i;
          if (expMap.cols.name) expSheet.getRange(eRow, expMap.cols.name).setValue(er.name || '');
          if (expMap.cols.price) expSheet.getRange(eRow, expMap.cols.price).setValue(num_(er.price));
          if (expMap.cols.date) expSheet.getRange(eRow, expMap.cols.date).setValue(parseDate_(er.date));
          if (expMap.cols.status) expSheet.getRange(eRow, expMap.cols.status).setValue(er.status || '');
          expWritten++;
        } catch (ex) {
          expErrors.push('row ' + (i + 1) + ': ' + String(ex));
        }
      }
      return json_({ ok: true, written: expWritten, errors: expErrors });
    }

    // eBay bulk draft rows go to the ebay-draft tab (eBay's own template:
    // #INFO rows, header row, data below). The header row is found by
    // scanning for the "Custom label (SKU)" header, so it works whatever
    // row the template puts it on. Rows are appended after the last data
    // row; a row whose SKU already exists in the tab is skipped, so
    // sending the same item twice does not duplicate the draft.
    if (action === 'ebayDrafts') {
      var draftSheet = openTab_('ebay-draft');
      var draftLastCol = draftSheet.getLastColumn();
      var draftHeaderRow = 0;
      var draftSkuCol = 0;
      for (var hr = 1; hr <= 8; hr++) {
        var hVals = draftSheet.getRange(hr, 1, 1, draftLastCol).getValues()[0];
        for (var hc = 0; hc < hVals.length; hc++) {
          if (str_(hVals[hc]).trim() === 'Custom label (SKU)') {
            draftHeaderRow = hr;
            draftSkuCol = hc + 1;
            break;
          }
        }
        if (draftHeaderRow) break;
      }
      if (!draftHeaderRow) {
        return json_({ error: 'ebay-draft tab has no "Custom label (SKU)" header row (looked in rows 1-8).' });
      }
      var draftRows = body.rows || [];
      var draftLastRow = draftSheet.getLastRow();
      var existingSkus = {};
      if (draftLastRow > draftHeaderRow) {
        var skuVals = draftSheet.getRange(draftHeaderRow + 1, draftSkuCol, draftLastRow - draftHeaderRow, 1).getValues();
        for (var s = 0; s < skuVals.length; s++) {
          var sku = str_(skuVals[s][0]).trim();
          if (sku) existingSkus[sku] = true;
        }
      }
      var draftWritten = 0;
      var draftSkipped = [];
      var draftErrors = [];
      var nextDraftRow = draftLastRow + 1;
      for (var d = 0; d < draftRows.length; d++) {
        try {
          var dRow = draftRows[d];
          var dSku = str_(dRow[1]).trim();
          if (dSku && existingSkus[dSku]) {
            draftSkipped.push(dSku);
            continue;
          }
          draftSheet.getRange(nextDraftRow, 1, 1, dRow.length).setValues([dRow]);
          if (dSku) existingSkus[dSku] = true;
          nextDraftRow++;
          draftWritten++;
        } catch (ex) {
          draftErrors.push('row ' + (d + 1) + ': ' + String(ex));
        }
      }
      return json_({ ok: true, written: draftWritten, skipped: draftSkipped, errors: draftErrors });
    }

    // Save one photo to Drive and return a public link for it. The app
    // uploads the white-bg version (manually, once it is ready) so the
    // photo is reachable from the web version and the posting extension.
    // A re-upload of the same photo replaces the old file, so Drive does
    // not fill with duplicates.
    if (action === 'uploadPhoto') {
      var upItemId = str_(body.itemId).trim();
      var upIndex = Number(body.index) || 0;
      var upData = str_(body.data || '').trim();
      if (!upItemId || !upData) {
        return json_({ error: 'uploadPhoto needs itemId and data (base64 image).' });
      }
      var upName = str_(body.filename || '').trim() || (upItemId + '-' + (upIndex + 1) + '.jpg');
      var upMime = str_(body.mimeType || '').trim() || 'image/jpeg';
      // Use the configured folder when set (no createFolder call). Fall
      // back to finding — or creating — "Reseller HQ Photos" when it is
      // not set.
      var folder;
      if (PHOTOS_FOLDER_ID) {
        folder = DriveApp.getFolderById(PHOTOS_FOLDER_ID);
      } else {
        var folders = DriveApp.getFoldersByName('Reseller HQ Photos');
        folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Reseller HQ Photos');
      }
      var existing = folder.getFilesByName(upName);
      while (existing.hasNext()) existing.next().setTrashed(true);
      var blob = Utilities.newBlob(Utilities.base64Decode(upData), upMime, upName);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return json_({
        ok: true,
        fileId: file.getId(),
        url: 'https://drive.google.com/uc?export=download&id=' + file.getId()
      });
    }

    var tab = body.tab || SHEET_NAME;
    var sheet = openTab_(tab);
    var map = colMap_(sheet, FIELD_BY_HEADER, REQUIRED_HEADERS);
    var cols = map.cols;
    var headerRow = map.headerRow;

    if (action === 'clear') {
      var cleared = clearData_(sheet, map);
      return json_({ ok: true, cleared: cleared });
    }

    if (action === 'overwrite') {
      clearData_(sheet, map);
      var rows = body.rows || [];
      var written = 0;
      var errors = [];
      for (var i = 0; i < rows.length; i++) {
        try {
          writeRow_(sheet, headerRow + 1 + i, rows[i].appId, rows[i].fields || {}, map);
          written++;
        } catch (ex) {
          errors.push('row ' + (i + 1) + ': ' + String(ex));
        }
      }
      return json_({ ok: true, written: written, errors: errors });
    }

    // merge (default): upserts by App ID, id stamps, trashes.
    var upserts = body.upserts || [];
    var assignIds = body.assignIds || [];
    var trash = body.trash || [];
    var lastRow = lastDataRow_(sheet, cols.item, headerRow);
    var byAppId = {};
    if (cols.appId && lastRow > headerRow) {
      var idValues = sheet
        .getRange(headerRow + 1, cols.appId, lastRow - headerRow, 1)
        .getValues();
      for (var i = 0; i < idValues.length; i++) {
        var id = str_(idValues[i][0]).trim();
        if (id) byAppId[id] = headerRow + 1 + i;
      }
    }
    var upserted = 0;
    var added = 0;
    var errors = [];
    var nextRow = lastRow + 1;
    for (var u = 0; u < upserts.length; u++) {
      var appId = upserts[u].appId;
      var fields = upserts[u].fields || {};
      var row = byAppId[appId];
      try {
        if (row) {
          writeRow_(sheet, row, appId, fields, map);
          upserted++;
        } else {
          writeRow_(sheet, nextRow, appId, fields, map);
          byAppId[appId] = nextRow;
          nextRow++;
          added++;
        }
      } catch (ex) {
        errors.push(appId + ': ' + String(ex));
      }
    }
    var assigned = 0;
    for (var a = 0; a < assignIds.length; a++) {
      try {
        if (cols.appId) {
          sheet.getRange(assignIds[a].row, cols.appId).setValue(assignIds[a].appId);
          assigned++;
        }
      } catch (ex) {
        errors.push('assign ' + assignIds[a].appId + ': ' + String(ex));
      }
    }
    var trashed = 0;
    for (var t = 0; t < trash.length; t++) {
      try {
        var tRow = byAppId[trash[t]];
        if (tRow && cols.status) {
          sheet.getRange(tRow, cols.status).setValue('Trash');
          trashed++;
        }
      } catch (ex) {
        errors.push('trash ' + trash[t] + ': ' + String(ex));
      }
    }
    return json_({
      ok: true,
      upserted: upserted,
      added: added,
      assigned: assigned,
      trashed: trashed,
      errors: errors
    });
  } catch (ex) {
    return json_({ error: String(ex) });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}
