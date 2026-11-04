// The Apps Script someone pastes into their Google Sheet. Kept apart from src/server/sheet-sync.ts
// so tests can run it against a stand-in for Google (src/lib/sheet-script.test.ts).

/** The script someone pastes into their sheet (Extensions > Apps Script). */
export function sheetScript(secret: string) {
  return `// Flaw Patrol: keeps a tab of this sheet up to date with a test run.
// Paste this in Extensions > Apps Script, then Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone) and copy the Web app URL into Flaw Patrol.
// It either rewrites a tab of its own, or fills picked cells of a tab you keep,
// leaving any cell a person typed in alone.
const KEY = "${secret}";
// Cells that count as empty, so Flaw Patrol may fill them.
const FREE = ["", "untested", "—", "-", "not tested"];

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== KEY) return reply({ ok: false, error: "This sheet's script has a different key. Copy the script from Flaw Patrol again." });
  if (body.action === "read") return readTab(body);
  if (body.action === "fill") return fillTab(body);
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = book.getSheetByName(body.tab);
    const isNew = !sheet;
    if (isNew) sheet = book.insertSheet(body.tab);
    const look = body.look;
    const n = body.rows.length;
    const width = body.rows[0].length;
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    if (sheet.getMaxRows() < n) sheet.insertRowsAfter(sheet.getMaxRows(), n - sheet.getMaxRows());
    const max = sheet.getMaxRows();
    const all = sheet.getRange(1, 1, max, width);
    all.breakApart();
    all.clearContent();
    all.clearDataValidations();
    all.setBorder(false, false, false, false, false, false);
    if (max > n) sheet.getRange(n + 1, 1, max - n, width).setBackground(null);

    sheet.getRange(1, 1, n, width).setNumberFormat("@").setValues(body.rows);
    sheet.getRange(1, 1, 1, width).setBackground(look.header).setFontColor(look.headerText).setFontFamily(look.headerFont)
      .setFontSize(look.headerSize).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
    // The header over the case statuses is a live percentage, as in the cycle sheets.
    sheet.getRange(1, 8).setNumberFormat("0.00%").setFormula("=" + body.formula);
    if (n > 1) {
      const rest = sheet.getRange(2, 1, n - 1, width);
      rest.setBackgrounds(look.backgrounds).setFontColors(look.fontColors).setFontFamily(look.font).setFontWeight("normal")
        .setFontSize(look.size).setVerticalAlignment("middle").setHorizontalAlignment("left").setWrap(false);
      look.wrapped.forEach(function (c) { sheet.getRange(2, c, n - 1, 1).setWrap(true); });
      look.centered.forEach(function (c) { sheet.getRange(2, c, n - 1, 1).setHorizontalAlignment("center").setFontFamily(look.statusFont); });
    }
    body.merges.forEach(function (m) { sheet.getRange(m[0], m[1], m[2], 1).merge(); });
    // Status colors follow the word, so they stay right when someone edits the sheet.
    if (n > 1) {
      const statusCols = [sheet.getRange(2, 8, n - 1, 1), sheet.getRange(2, 10, n - 1, 1)];
      const ours = body.chips.map(function (c) {
        return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c.status).setBackground(c.fill).setFontColor(c.text).setRanges(statusCols).build();
      });
      // Anyone named in Executed By, but not "—" for nobody.
      ours.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(I2<>"",I2<>"—")')
        .setBackground(body.testerChip.fill).setFontColor(body.testerChip.text).setRanges([sheet.getRange(2, 9, n - 1, 1)]).build());
      const others = sheet.getConditionalFormatRules().filter(function (r) {
        return !r.getRanges().some(function (g) { return g.getColumn() >= 8 && g.getColumn() <= 10; });
      });
      sheet.setConditionalFormatRules(others.concat(ours));
    }
    // Dropdowns on each case's status and tester, like the cycle sheets.
    if (body.caseStarts.length) {
      const pick = function (list) { return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build(); };
      sheet.getRangeList(body.caseStarts.map(function (r) { return "H" + r; })).getRanges().forEach(function (r) { r.setDataValidation(pick(body.lists.status)); });
      sheet.getRangeList(body.caseStarts.map(function (r) { return "I" + r; })).getRanges().forEach(function (r) { r.setDataValidation(pick(body.lists.testers)); });
    }
    // A line under each case, wherever the cases now fall.
    const last = String.fromCharCode(64 + width);
    if (body.caseEnds.length) {
      sheet.getRangeList(body.caseEnds.map(function (r) { return "A" + r + ":" + last + r; }))
        .setBorder(null, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
    // Filter buttons on the header, covering every row now in the tab.
    if (sheet.getFilter()) sheet.getFilter().remove();
    sheet.getRange(1, 1, n, width).createFilter();
    if (isNew) {
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(look.frozenColumns);
      look.widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, Math.round(w * 7 + 5)); });
      look.hidden.forEach(function (c) { sheet.hideColumns(c); });
    }
    return reply({ ok: true, url: book.getUrl() + "#gid=" + sheet.getSheetId() });
  } finally {
    lock.releaseLock();
  }
}

// What's in the tab: the words as shown, and each column's dropdown choices.
function readTab(body) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(body.tab);
  if (!sheet) return reply({ ok: false, error: 'This sheet has no tab called "' + body.tab + '".' });
  const rows = Math.min(sheet.getLastRow(), 3000);
  const cols = Math.min(sheet.getLastColumn(), 60);
  const url = book.getUrl() + "#gid=" + sheet.getSheetId();
  if (!rows || !cols) return reply({ ok: true, version: 2, values: [], lists: [], url: url });
  const values = sheet.getRange(1, 1, rows, cols).getDisplayValues();
  const rules = sheet.getRange(1, 1, Math.min(rows, 300), cols).getDataValidations();
  const lists = [];
  for (let c = 0; c < cols; c++) {
    let list = null;
    for (let r = 0; r < rules.length && !list; r++) {
      const v = rules[r][c];
      if (v && v.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) list = v.getCriteriaValues()[0];
    }
    lists.push(list);
  }
  return reply({ ok: true, version: 2, values: values, lists: lists, url: url });
}

// Fills the cells Flaw Patrol sent, but only ones that are empty or still hold what
// Flaw Patrol last wrote there. A cell someone typed in is kept as it is.
function fillTab(body) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(body.tab);
    if (!sheet) return reply({ ok: false, error: 'This sheet has no tab called "' + body.tab + '".' });
    const props = PropertiesService.getDocumentProperties();
    const mine = props.getProperties();
    let maxR = 1, maxC = 1;
    body.cells.forEach(function (x) { maxR = Math.max(maxR, x.r); maxC = Math.max(maxC, x.c); });
    if (sheet.getMaxRows() < maxR || sheet.getMaxColumns() < maxC) return reply({ ok: false, error: "The " + body.tab + " tab changed size. Look at the sheet again in Flaw Patrol." });
    const now = sheet.getRange(1, 1, maxR, maxC).getDisplayValues();
    const save = {};
    let filled = 0, kept = 0;
    body.cells.forEach(function (x) {
      const id = "fp:" + body.tab + "!" + x.r + ":" + x.c;
      const was = now[x.r - 1][x.c - 1];
      const shown = x.v.charAt(0) === "'" ? x.v.slice(1) : x.v;
      const ours = FREE.indexOf(was.trim().toLowerCase()) >= 0 || mine[id] === was.slice(0, 100);
      if (!ours) { if (was !== shown) kept++; return; }
      save[id] = shown.slice(0, 100);
      if (was === shown) return;
      const cell = sheet.getRange(x.r, x.c);
      if (x.links && x.links.length) {
        const text = SpreadsheetApp.newRichTextValue().setText(shown);
        x.links.forEach(function (l) {
          const at = shown.indexOf(l.text);
          if (at >= 0) text.setLinkUrl(at, at + l.text.length, l.url);
        });
        cell.setRichTextValue(text.build());
      } else {
        cell.setValue(x.v);
      }
      filled++;
    });
    props.setProperties(save);
    return reply({ ok: true, version: 2, filled: filled, kept: kept, url: book.getUrl() + "#gid=" + sheet.getSheetId() });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
