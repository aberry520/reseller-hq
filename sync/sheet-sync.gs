// Reseller HQ — Google Sheets sync endpoint (Google Apps Script)
//
// WHAT IT IS
//   A tiny web API bound to the Purchase sheet. The Reseller HQ app calls it
//   to fetch the sheet's rows (GET) and to apply approved changes (POST).
//   The app never talks to Google directly, so no OAuth sign-in is needed
//   inside the app and Expo Go keeps working.
//
// DEPLOY (Austin — one time, ~5 minutes)
//   1. Open the tracker sheet, then Extensions → Apps Script.
//   2. Delete the default Code.gs content and paste this whole file in.
//   3. Set the password: in the left sidebar, Project Settings (gear) →
//      Script Properties → Add script property:
//        Property: SYNC_TOKEN   Value: <pick a long random string>
//      Save it. This is the password the app sends with every request —
//      keep it private, and use the SAME value in the app's Settings.
//   4. Deploy → New deployment → type: Web app.
//        Execute as: Me
//        Who has access: Anyone
//      Deploy, copy the Web app URL (ends in /exec).
//   5. In Reseller HQ → Settings, paste the Web app URL into "Sheet sync URL"
//      and the same SYNC_TOKEN value into "Sheet sync token".
//
// HOW IT WORKS
//   - App ID lives in column W ("App ID", header row 2). Every item the app
//     knows has an RB-xxx id; the script matches app items to sheet rows by
//     that id, so rows can move without breaking the sync.
//   - Only the INPUT columns are ever written: Item, Purchase, Est Ship,
//     Research Price, Notes, Place, Date Purchased, Status, Date Listed,
//     Date Sold, Sold Price, Fees, Shipping. The formula columns
//     (Suggested Price, Min Price, Profit, Revenue, Profit Margin) are never
//     touched — they keep calculating from the inputs. New rows get their
//     formulas copied from the row above.
//   - GET returns every data row as JSON. POST applies a batch of approved
//     changes: upserts (update or add a row), assignIds (stamp a fresh RB-xxx
//     onto a sheet row the app just imported), trash (set Status = Trash).

var SPREADSHEET_ID = '10dHhA-fFnko35JzCwTUi1H3Lj1uO2h9mXyV7u_3Qvng';
var SHEET_NAME = 'Purchase';

// Column numbers (1-based). App ID is column W, past the summary block S-V.
var COL = {
  item: 1, purchase: 2, estShip: 3,
  // 4 Suggested Price, 5 Min Price — formulas, never written.
  researchPrice: 6, notes: 7, place: 8, datePurchased: 9, status: 10,
  dateListed: 11, dateSold: 12, soldPrice: 13, fees: 14, shipping: 15,
  // 16 Profit, 17 Revenue, 18 Profit Margin — formulas, never written.
  appId: 23
};
var FORMULA_COLS = [4, 5, 16, 17, 18];
var HEADER_ROW = 2; // Row 1 is the summary row; row 2 is the header.

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN') || '';
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  var expected = getToken_();
  if (!expected) return 'sync token not set (add SYNC_TOKEN in Script Properties)';
  if (!token || token !== expected) return 'bad token';
  return null;
}

function parseDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  return null;
}

function fmtDate_(v) {
  var d = parseDate_(v);
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d/yyyy');
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function str_(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// GET ?token=...  →  { rows: [{ appId, row, item, purchase, estShip,
//   researchPrice, notes, place, datePurchased, status, dateListed,
//   dateSold, soldPrice, fees, shipping }] }
function doGet(e) {
  try {
    var err = checkToken_(e.parameter.token);
    if (err) return json_({ error: err });
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    var lastRow = sheet.getLastRow();
    var rows = [];
    if (lastRow > HEADER_ROW) {
      var values = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, COL.appId).getValues();
      for (var i = 0; i < values.length; i++) {
        var r = values[i];
        var item = str_(r[COL.item - 1]).trim();
        var appId = str_(r[COL.appId - 1]).trim();
        if (!item && !appId) continue; // skip blank rows
        rows.push({
          appId: appId,
          row: HEADER_ROW + 1 + i,
          item: item,
          purchase: num_(r[COL.purchase - 1]),
          estShip: num_(r[COL.estShip - 1]),
          researchPrice: num_(r[COL.researchPrice - 1]),
          notes: str_(r[COL.notes - 1]),
          place: str_(r[COL.place - 1]),
          datePurchased: fmtDate_(r[COL.datePurchased - 1]),
          status: str_(r[COL.status - 1]),
          dateListed: fmtDate_(r[COL.dateListed - 1]),
          dateSold: fmtDate_(r[COL.dateSold - 1]),
          soldPrice: num_(r[COL.soldPrice - 1]),
          fees: num_(r[COL.fees - 1]),
          shipping: num_(r[COL.shipping - 1])
        });
      }
    }
    return json_({ rows: rows });
  } catch (ex) {
    return json_({ error: String(ex) });
  }
}

// POST { token, upserts: [{ appId, fields }], assignIds: [{ row, appId }],
//        trash: [appId] }
//   upserts: update the row with this appId (input columns only), or append
//     a new row if the appId is not in the sheet yet.
//   assignIds: stamp a fresh appId onto an existing sheet row.
//   trash: set Status = "Trash" on the row with this appId.
// Returns { ok: true, upserted, added, assigned, trashed, errors: [] }.
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    var body = JSON.parse(e.postData.contents);
    var err = checkToken_(body.token);
    if (err) return json_({ error: err });

    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    var result = { ok: true, upserted: 0, added: 0, assigned: 0, trashed: 0, errors: [] };

    // Index rows by appId (column W).
    var lastRow = sheet.getLastRow();
    var idToRow = {};
    if (lastRow > HEADER_ROW) {
      var ids = sheet.getRange(HEADER_ROW + 1, COL.appId, lastRow - HEADER_ROW, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        var id = str_(ids[i][0]).trim();
        if (id) idToRow[id] = HEADER_ROW + 1 + i;
      }
    }

    function writeInputCells_(row, f) {
      // A:C — Item, Purchase, Est Ship.
      sheet.getRange(row, COL.item, 1, 3).setValues([[
        str_(f.item), num_(f.purchase), num_(f.estShip)
      ]]);
      // F:O — Research Price … Shipping (dates converted to real dates).
      sheet.getRange(row, COL.researchPrice, 1, 10).setValues([[
        num_(f.researchPrice), str_(f.notes), str_(f.place),
        parseDate_(f.datePurchased) || '', str_(f.status),
        parseDate_(f.dateListed) || '', parseDate_(f.dateSold) || '',
        num_(f.soldPrice), num_(f.fees), num_(f.shipping)
      ]]);
    }

    function copyFormulas_(fromRow, toRow) {
      for (var k = 0; k < FORMULA_COLS.length; k++) {
        var c = FORMULA_COLS[k];
        sheet.getRange(fromRow, c, 1, 1).copyTo(sheet.getRange(toRow, c, 1, 1));
      }
    }

    (body.upserts || []).forEach(function (u) {
      try {
        var appId = str_(u.appId).trim();
        if (!appId) { result.errors.push('upsert without appId'); return; }
        var row = idToRow[appId];
        if (row) {
          writeInputCells_(row, u.fields || {});
          result.upserted++;
        } else {
          var newRow = sheet.getLastRow() + 1;
          writeInputCells_(newRow, u.fields || {});
          sheet.getRange(newRow, COL.appId, 1, 1).setValue(appId);
          if (newRow > HEADER_ROW + 1) copyFormulas_(newRow - 1, newRow);
          idToRow[appId] = newRow;
          result.added++;
        }
      } catch (ex2) {
        result.errors.push('upsert ' + (u.appId || '?') + ': ' + String(ex2));
      }
    });

    (body.assignIds || []).forEach(function (a) {
      try {
        sheet.getRange(a.row, COL.appId, 1, 1).setValue(str_(a.appId).trim());
        result.assigned++;
      } catch (ex3) {
        result.errors.push('assignId row ' + a.row + ': ' + String(ex3));
      }
    });

    (body.trash || []).forEach(function (appId) {
      try {
        var row = idToRow[str_(appId).trim()];
        if (row) {
          sheet.getRange(row, COL.status, 1, 1).setValue('Trash');
          result.trashed++;
        }
      } catch (ex4) {
        result.errors.push('trash ' + appId + ': ' + String(ex4));
      }
    });

    SpreadsheetApp.flush();
    return json_(result);
  } catch (ex) {
    return json_({ error: String(ex) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}
