function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);                          // serialise step-1 vs step-2 races
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(data.tab);
    if (!sheet) {
      return json({ ok: false, error: 'Tab not found: ' + data.tab });
    }

    // ── Legacy append: { tab, row: [...] } — all forms except the newsletter ──
    if (data.row) {
      sheet.appendRow(data.row);
      return json({ ok: true, mode: 'append' });
    }

    // ── Upsert by key: { tab, key: 'Email', data: { Header: value, ... } } ────
    if (data.data) {
      var lastCol = Math.max(1, sheet.getLastColumn());
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                         .map(function (h) { return String(h).trim(); });

      // Add any header present in the payload but missing from the sheet.
      Object.keys(data.data).forEach(function (h) {
        if (headers.indexOf(h) === -1) {
          sheet.getRange(1, headers.length + 1).setValue(h);
          headers.push(h);
        }
      });

      var keyCol = Math.max(0, headers.indexOf(data.key));
      var keyVal = String(data.data[data.key] || '').trim().toLowerCase();
      var lastRow = sheet.getLastRow();
      var rowIndex = -1;

      if (lastRow > 1 && keyVal) {
        var col = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < col.length; i++) {
          if (String(col[i][0]).trim().toLowerCase() === keyVal) { rowIndex = i + 2; break; }
        }
      }

      if (rowIndex === -1) {                      // insert new row
        sheet.appendRow(headers.map(function (h) {
          return Object.prototype.hasOwnProperty.call(data.data, h) ? data.data[h] : '';
        }));
        return json({ ok: true, mode: 'insert' });
      }

      headers.forEach(function (h, c) {            // update: only provided, non-empty cells
        if (Object.prototype.hasOwnProperty.call(data.data, h) && String(data.data[h]).length) {
          sheet.getRange(rowIndex, c + 1).setValue(data.data[h]);
        }
      });
      return json({ ok: true, mode: 'update' });
    }

    return json({ ok: false, error: 'no row or data' });
  } catch (err) {
    return json({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run this in the editor to test the upsert end-to-end (writes to the Newsletter tab).
function testDoPost() {
  // Step 1 — email arrives → inserts a row.
  Logger.log(doPost({ postData: { contents: JSON.stringify({
    tab: 'Newsletter', key: 'Email',
    data: { Date: '2026-05-20 10:00:00', Email: 'test@example.com', 'Statut opt-in': 'En attente (double opt-in)' }
  }) } }).getContent());

  // Step 2 — name + interests arrive → UPDATES the same row (should log mode:"update").
  Logger.log(doPost({ postData: { contents: JSON.stringify({
    tab: 'Newsletter', key: 'Email',
    data: { Email: 'test@example.com', 'Prénom': 'Jean', 'Nom': 'Test',
            'Intérêt Vente': 'Oui', 'Tous sujets': 'Non' }
  }) } }).getContent());
}
