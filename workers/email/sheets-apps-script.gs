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

    // ── Protected read for the production DOI reminder worker ─────────────
    // This is the only path that returns subscriber addresses. Keep it behind
    // a Script Property shared only with the production email worker.
    if (data.action === 'listPendingNewsletterReminders') {
      var expectedToken = PropertiesService.getScriptProperties().getProperty('SHEET_INTERNAL_TOKEN');
      if (!expectedToken || !secureTokenEqual(data.token, expectedToken)) {
        return json({ ok: false, error: 'Forbidden' });
      }
      var reminderHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]
                                 .map(function (h) { return String(h).trim(); });
      if (reminderHeaders.indexOf('Date rappel opt-in') === -1) {
        sheet.getRange(1, reminderHeaders.length + 1).setValue('Date rappel opt-in');
        reminderHeaders.push('Date rappel opt-in');
      }
      var dateCol = reminderHeaders.indexOf('Date');
      var emailCol = reminderHeaders.indexOf('Email');
      var statusCol = reminderHeaders.indexOf('Statut opt-in');
      var reminderCol = reminderHeaders.indexOf('Date rappel opt-in');
      if (dateCol === -1 || emailCol === -1 || statusCol === -1) {
        return json({ ok: false, error: 'Newsletter headers incomplete' });
      }
      var reminderRecords = [];
      var reminderLastRow = sheet.getLastRow();
      if (reminderLastRow > 1) {
        var reminderRows = sheet.getRange(2, 1, reminderLastRow - 1, reminderHeaders.length).getValues();
        reminderRows.forEach(function (row) {
          var status = String(row[statusCol] || '').trim().toLowerCase();
          var email = String(row[emailCol] || '').trim().toLowerCase();
          if (status.indexOf('en attente') !== 0 || !email) return;
          var signupValue = row[dateCol];
          var reminderValue = row[reminderCol];
          reminderRecords.push({
            email: email,
            signupAt: signupValue instanceof Date ? signupValue.toISOString() : String(signupValue || '').trim(),
            reminderAt: reminderValue instanceof Date ? reminderValue.toISOString() : String(reminderValue || '').trim()
          });
        });
      }
      return json({ ok: true, records: reminderRecords });
    }

    // ── Legacy append: { tab, row: [...] } — all forms except the newsletter ──
    if (data.row) {
      sheet.appendRow(data.row);
      return json({ ok: true, mode: 'append' });
    }

    // ── Batch update existing rows (newsletter confirmation reconciliation) ──
    if (Array.isArray(data.records)) {
      var batchLastCol = Math.max(1, sheet.getLastColumn());
      var batchHeaders = sheet.getRange(1, 1, 1, batchLastCol).getValues()[0]
                              .map(function (h) { return String(h).trim(); });
      var batchKeyCol = batchHeaders.indexOf(data.key);
      if (batchKeyCol === -1) return json({ ok: false, error: 'Key header not found: ' + data.key });

      var batchLastRow = sheet.getLastRow();
      var rowsByKey = {};
      if (batchLastRow <= 1) {
        return json({ ok: true, mode: 'batch-update', matchedRecords: 0, updatedRows: 0 });
      }
      if (batchLastRow > 1) {
        var batchKeys = sheet.getRange(2, batchKeyCol + 1, batchLastRow - 1, 1).getValues();
        batchKeys.forEach(function (row, i) {
          var value = String(row[0]).trim().toLowerCase();
          if (!value) return;
          if (!rowsByKey[value]) rowsByKey[value] = [];
          rowsByKey[value].push(i + 2);
        });
      }

      var batchWriteOnce = Array.isArray(data.writeOnce) ? data.writeOnce : [];
      var matchedRecords = 0;
      var updatedRows = 0;
      var updateColumns = {};
      var missingHeaders = {};
      data.records.forEach(function (record) {
        Object.keys(record).forEach(function (h) {
          if (h === data.key) return;
          if (batchHeaders.indexOf(h) === -1) missingHeaders[h] = true;
          else updateColumns[h] = true;
        });
      });
      var missingHeaderNames = Object.keys(missingHeaders);
      if (missingHeaderNames.length) {
        return json({ ok: false, error: 'Headers not found: ' + missingHeaderNames.join(', ') });
      }
      var columnValues = {};
      Object.keys(updateColumns).forEach(function (h) {
        var columnIndex = batchHeaders.indexOf(h);
        columnValues[h] = sheet.getRange(2, columnIndex + 1, Math.max(0, batchLastRow - 1), 1).getValues();
      });

      data.records.forEach(function (record) {
        var recordKey = String(record[data.key] || '').trim().toLowerCase();
        var matchingRows = rowsByKey[recordKey] || [];
        if (!matchingRows.length) return;          // updateOnly: never insert imports
        matchedRecords++;
        matchingRows.forEach(function (rowIndex) {
          Object.keys(updateColumns).forEach(function (h) {
            if (!Object.prototype.hasOwnProperty.call(record, h) || !String(record[h]).length) return;
            var valueIndex = rowIndex - 2;
            if (batchWriteOnce.indexOf(h) !== -1 && String(columnValues[h][valueIndex][0]).length) return;
            columnValues[h][valueIndex][0] = record[h];
          });
          updatedRows++;
        });
      });
      Object.keys(updateColumns).forEach(function (h) {
        var columnIndex = batchHeaders.indexOf(h);
        sheet.getRange(2, columnIndex + 1, batchLastRow - 1, 1).setValues(columnValues[h]);
      });
      return json({ ok: true, mode: 'batch-update', matchedRecords: matchedRecords, updatedRows: updatedRows });
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
      var rowIndexes = [];

      if (lastRow > 1 && keyVal) {
        var col = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < col.length; i++) {
          if (String(col[i][0]).trim().toLowerCase() === keyVal) rowIndexes.push(i + 2);
        }
      }

      if (!rowIndexes.length) {                   // insert new row
        sheet.appendRow(headers.map(function (h) {
          return Object.prototype.hasOwnProperty.call(data.data, h) ? data.data[h] : '';
        }));
        return json({ ok: true, mode: 'insert' });
      }

      var writeOnce = Array.isArray(data.writeOnce) ? data.writeOnce : [];
      rowIndexes.forEach(function (rowIndex) {
        headers.forEach(function (h, c) {          // update all matching duplicate rows
          if (!Object.prototype.hasOwnProperty.call(data.data, h) || !String(data.data[h]).length) return;
          var cell = sheet.getRange(rowIndex, c + 1);
          if (writeOnce.indexOf(h) !== -1 && String(cell.getValue()).length) return;
          cell.setValue(data.data[h]);
        });
      });
      return json({ ok: true, mode: 'update', rows: rowIndexes.length });
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

function secureTokenEqual(provided, expected) {
  var left = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(provided || ''), Utilities.Charset.UTF_8
  );
  var right = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(expected || ''), Utilities.Charset.UTF_8
  );
  var diff = 0;
  for (var i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
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
