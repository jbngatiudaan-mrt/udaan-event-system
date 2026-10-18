/**
 * Optional live Google Sheet mirror for Udaan.
 * 1. Create a Google Sheet. Extensions → Apps Script. Paste this file. Save.
 * 2. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Deploy.
 * 3. Copy the web-app URL into SHEETS_WEBHOOK_URL on the server and restart it.
 * One row per visitor, updated in place on check-in and when they win.
 */
const HEADERS = ['Ticket', 'Name', 'WhatsApp', 'Email', 'City', 'Business', 'Status', 'Registered', 'Checked in', 'Gate', 'Winner', 'Round', 'Last event'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
    const rows = JSON.parse(e.postData.contents).rows || [];
    const codes = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map((r) => r[0]) : [];
    rows.forEach((r) => {
      const values = [r.ticket_code, r.name, "'+" + r.phone, r.email, r.city, r.business, r.status, r.registered_at, r.checked_in_at, r.checked_in_by,
        r.won_prize ? 'Yes' : '', r.won_round, r.type];
      const i = codes.indexOf(r.ticket_code);
      if (i >= 0) sheet.getRange(i + 2, 1, 1, values.length).setValues([values]);
      else { sheet.appendRow(values); codes.push(r.ticket_code); }
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, n: rows.length })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
