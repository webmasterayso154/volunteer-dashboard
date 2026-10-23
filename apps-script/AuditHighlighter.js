/**
 * ============================================================================
 * AYSO REGION 154 — VISUAL AUDIT HIGHLIGHTER & FORMULA SHADOW TABS
 * File: AuditHighlighter.gs (v3 - Explicit Tab Names & Debugger)
 * ============================================================================
 */

// ⚠️ EDIT THESE TWO STRINGS IF YOUR EXACT TAB NAMES DIFFER:
const CHECKIN_TAB_NAME = 'Game Day Check-ins';
const LEDGER_TAB_NAME = 'Season_Master_Ledger';

const AUDIT_SHADOW_TAB = 'Formula_Audit_Shadow';
const PLAYOFF_17_TAB = 'Playoff_Qualified_17Pts';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Board Audit Tools')
    .addItem('1. Highlight Changed Math & Filtered Check-ins', 'highlightArithmeticAndAuditChanges')
    .addItem('2. Build Formula_Audit_Shadow & 17-Pt Playoff Tabs', 'buildStandaloneAuditTabs')
    .addSeparator()
    .addItem('3. Reset Highlights & Notes (Clean Fill)', 'resetAllAuditHighlights')
    .addItem('4. Delete Standalone Audit Tabs', 'removeStandaloneAuditTabs')
    .addToUi();
}

/**
 * Safely fetches a sheet by exact name, or logs all available tab names if not found.
 */
function getSheetSafely_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    // Fallback: search case-insensitively or ignoring underscores/spaces
    const sheets = ss.getSheets();
    const availableNames = sheets.map(s => s.getName());
    const cleanTarget = sheetName.replace(/[\s_]/g, '').toLowerCase();
    
    for (let i = 0; i < sheets.length; i++) {
      const cleanCurrent = sheets[i].getName().replace(/[\s_]/g, '').toLowerCase();
      if (cleanCurrent === cleanTarget) {
        return sheets[i];
      }
    }
    
    throw new Error(`Could not find sheet "${sheetName}". Available tabs in this spreadsheet are: [${availableNames.join(', ')}]. Please update CHECKIN_TAB_NAME or LEDGER_TAB_NAME at the top of AuditHighlighter.gs.`);
  }
  return sheet;
}

/**
 * Visually highlights cells in Season_Master_Ledger and Game_Day_Check-ins
 * where raw check-in counts differ from audited points.
 */
function highlightArithmeticAndAuditChanges() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const checkinSheet = getSheetSafely_(ss, CHECKIN_TAB_NAME);
  const ledgerSheet = getSheetSafely_(ss, LEDGER_TAB_NAME);

  // 1. Scan Check-ins and highlight any row where Points Awarded == 0
  const checkinData = checkinSheet.getDataRange().getValues();
  const checkinBgs = checkinSheet.getDataRange().getBackgrounds();

  const teamStats = {}; // teamCode -> { refRaw, refPts, fmRaw, fmPts, fsRaw, fsPts, notes: [] }

  for (let r = 1; r < checkinData.length; r++) {
    const row = checkinData[r];
    const role = String(row[3] || '').trim();        // Col D: Volunteer Role
    const status = String(row[23] || '').trim();     // Col X: Audit Status
    const pts = Number(row[24] || 0);                // Col Y: Points Awarded
    const reason = String(row[25] || '').trim();     // Col Z: Audit Reason
    const team = String(row[26] || '').trim();       // Col AA: Credited Team

    if (pts === 0) {
      let fillColor = '#fce8e6'; // Light Red default
      if (status.indexOf('Cap Reached') !== -1) {
        fillColor = '#fff2cc'; // Warm Yellow: Daily Field Setup Cap or Season Cap
      } else if (status.indexOf('Duplicate') !== -1) {
        fillColor = '#f4cccc'; // Coral Pink: Duplicate submission
      } else if (status.indexOf('NOCRA') !== -1) {
        fillColor = '#e8eaed'; // Light Gray: Neutral/Paid NOCRA ref
      }
      checkinBgs[r][23] = fillColor;
      checkinBgs[r][24] = fillColor;
      checkinBgs[r][25] = fillColor;
      checkinBgs[r][26] = fillColor;
    }

    if (team) {
      if (!teamStats[team]) {
        teamStats[team] = { refRaw: 0, refPts: 0, fmRaw: 0, fmPts: 0, fsRaw: 0, fsPts: 0, notes: [] };
      }
      if (role === 'Referee') {
        teamStats[team].refRaw += 1;
        teamStats[team].refPts += pts;
      } else if (role === 'Field Marshal') {
        teamStats[team].fmRaw += 1;
        teamStats[team].fmPts += pts;
      } else if (role === 'Field Set Up') {
        teamStats[team].fsRaw += 1;
        teamStats[team].fsPts += pts;
      }
      if (pts === 0) {
        const volName = `${row[1]} ${row[2]}`.trim();
        const dateStr = row[0] instanceof Date
          ? Utilities.formatDate(row[0], 'America/Los_Angeles', 'yyyy-MM-dd')
          : String(row[0]).slice(0, 10);
        teamStats[team].notes.push(`• ${dateStr} (${role} - ${volName}): ${status} — ${reason}`);
      }
    }
  }

  checkinSheet.getDataRange().setBackgrounds(checkinBgs);

  // 2. Highlight cells in Ledger where Raw Check-ins != Audited Points
  const ledgerData = ledgerSheet.getDataRange().getValues();
  const ledgerBgs = ledgerSheet.getDataRange().getBackgrounds();
  const ledgerNotes = ledgerSheet.getDataRange().getNotes();

  for (let r = 1; r < ledgerData.length; r++) {
    const row = ledgerData[r];
    const teamCode = String(row[1] || '').trim(); // Col B: Team Code
    const st = teamStats[teamCode];
    if (!st) continue;

    let teamModified = false;

    // Col D: Referee Points (Max 10)
    if (st.refRaw !== st.refPts) {
      ledgerBgs[r][3] = '#ffd966';
      ledgerNotes[r][3] = `AUDIT DIFF:\nRaw Referee Submissions: ${st.refRaw}\nVerified Points Awarded: ${st.refPts}\n\n` + st.notes.join('\n');
      teamModified = true;
    }

    // Col E: Field Marshal Points (Max 2)
    if (st.fmRaw !== st.fmPts) {
      ledgerBgs[r][4] = '#ffd966';
      ledgerNotes[r][4] = `AUDIT DIFF:\nRaw Field Marshal Submissions: ${st.fmRaw}\nVerified Points Awarded: ${st.fmPts}\n\n` + st.notes.join('\n');
      teamModified = true;
    }

    // Col F: Field Setup Points (Max 5)
    if (st.fsRaw !== st.fsPts) {
      ledgerBgs[r][5] = '#ffd966';
      ledgerNotes[r][5] = `AUDIT DIFF:\nRaw Field Setup Submissions: ${st.fsRaw}\nVerified Points Awarded: ${st.fsPts} (1 pt/day cap)\n\n` + st.notes.join('\n');
      teamModified = true;
    }

    if (teamModified) {
      ledgerBgs[r][1] = '#fff2cc';  // Col B: Team Code
      ledgerBgs[r][10] = '#fff2cc'; // Col K: Current Verified Points
      ledgerNotes[r][10] = `Raw Check-ins Total: ${st.refRaw + st.fmRaw + st.fsRaw}\nAudited Check-ins Total: ${st.refPts + st.fmPts + st.fsPts}\n\nDetails:\n` + st.notes.join('\n');
    }

    if (Number(row[10]) >= 17 && Number(row[11]) === 17) {
      ledgerBgs[r][10] = '#b7e1cd';
    }
  }

  ledgerSheet.getDataRange().setBackgrounds(ledgerBgs);
  ledgerSheet.getDataRange().setNotes(ledgerNotes);
  SpreadsheetApp.flush();
}

/**
 * Helper to reset all cell fills and audit notes.
 */
function resetAllAuditHighlights() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checkinSheet = getSheetSafely_(ss, CHECKIN_TAB_NAME);
  const ledgerSheet = getSheetSafely_(ss, LEDGER_TAB_NAME);

  if (checkinSheet) {
    const lr = checkinSheet.getLastRow();
    if (lr > 1) checkinSheet.getRange(2, 24, lr - 1, 4).setBackground(null);
  }
  if (ledgerSheet) {
    const lr = ledgerSheet.getLastRow();
    if (lr > 1) {
      const rng = ledgerSheet.getRange(2, 1, lr - 1, ledgerSheet.getLastColumn());
      rng.setBackground(null);
      rng.clearNote();
    }
  }
}

/**
 * Creates the standalone 'Formula_Audit_Shadow' and 'Playoff_Qualified_17Pts' tabs.
 */
function buildStandaloneAuditTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = getSheetSafely_(ss, LEDGER_TAB_NAME);
  const lastRow = ledgerSheet.getLastRow();
  const numTeams = lastRow - 1;
  const ledgerName = ledgerSheet.getName();
  const checkinSheet = getSheetSafely_(ss, CHECKIN_TAB_NAME);
  const checkinName = checkinSheet.getName();

  // --- TAB 1: Formula_Audit_Shadow ---
  let sheet = ss.getSheetByName(AUDIT_SHADOW_TAB);
  if (sheet) sheet.clear();
  else {
    sheet = ss.insertSheet(AUDIT_SHADOW_TAB, ss.getNumSheets());
    sheet.setTabColor('#1a73e8');
  }

  const headers = [[
    'Division',
    'Team Code',
    'Head Coach',
    'Raw Ref Check-ins',
    'Audited Ref Pts (Max 10)',
    'Raw FM Check-ins',
    'Audited FM Pts (Max 2)',
    'Raw Setup Check-ins',
    'Audited Setup Pts (Max 5)',
    'Award: Picture Day (Max 2)',
    'Award: Cert Ref Bonus (Max 5)',
    'Award: MatchTrak (Max 2)',
    'Award: Adjustments',
    'Formula Verified Total',
    'Ledger Verified Total',
    'Raw vs Audited Diff',
    'Audit Trace Status'
  ]];

  sheet.getRange(1, 1, 1, headers[0].length)
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground('#1a365d')
    .setFontColor('#ffffff')
    .setWrap(true);

  const formulas = [];
  for (let i = 0; i < numTeams; i++) {
    const r = i + 2;
    formulas.push([
      `='${ledgerName}'!A${r}`,
      `='${ledgerName}'!B${r}`,
      `='${ledgerName}'!C${r}`,
      `=COUNTIFS('${checkinName}'!$AA:$AA, $B${r}, '${checkinName}'!$D:$D, "Referee")`,
      `=MIN(10, SUMIFS('${checkinName}'!$Y:$Y, '${checkinName}'!$AA:$AA, $B${r}, '${checkinName}'!$D:$D, "Referee"))`,
      `=COUNTIFS('${checkinName}'!$AA:$AA, $B${r}, '${checkinName}'!$D:$D, "Field Marshal")`,
      `=MIN(2, SUMIFS('${checkinName}'!$Y:$Y, '${checkinName}'!$AA:$AA, $B${r}, '${checkinName}'!$D:$D, "Field Marshal"))`,
      `=COUNTIFS('${checkinName}'!$AA:$AA, $B${r}, '${checkinName}'!$D:$D, "Field Set Up")`,
      `=MIN(5, SUMIFS('${checkinName}'!$Y:$Y, '${checkinName}'!$AA:$AA, $B${r}, '${checkinName}'!$D:$D, "Field Set Up"))`,
      `=MIN(2, N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$D:$D, 0)))`,
      `=MIN(5, N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$B:$B, 0)))`,
      `=MIN(2, N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$C:$C, 0)))`,
      `=N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$E:$E, 0))`,
      `=E${r}+G${r}+I${r}+SUM(J${r}:M${r})`,
      `='${ledgerName}'!K${r}`,
      `=(D${r}-E${r})+(F${r}-G${r})+(H${r}-I${r})`,
      `=IF(N${r}<>O${r}, "❌ LEDGER MISMATCH", IF(P${r}>0, "🔍 " & P${r} & " Check-in(s) Capped/Dup", "✅ Exact 1:1"))`
    ]);
  }

  sheet.getRange(2, 1, numTeams, headers[0].length).setFormulas(formulas);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);

  // --- TAB 2: Playoff_Qualified_17Pts ---
  let pSheet = ss.getSheetByName(PLAYOFF_17_TAB);
  if (pSheet) pSheet.clear();
  else {
    pSheet = ss.insertSheet(PLAYOFF_17_TAB, ss.getNumSheets());
    pSheet.setTabColor('#0f9d58');
  }

  pSheet.getRange('A1:K1').merge()
    .setValue('🟢 CLINCHED PLAYOFF ELIGIBILITY (17+ VERIFIED POINTS)')
    .setFontWeight('bold')
    .setBackground('#0f9d58')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  pSheet.getRange('M1:R1').merge()
    .setValue('🟡 ON THE BUBBLE (14–16 VERIFIED POINTS)')
    .setFontWeight('bold')
    .setBackground('#f4b400')
    .setHorizontalAlignment('center');

  pSheet.getRange('A2').setFormula(
    `=IFERROR(QUERY('${ledgerName}'!A1:W, "SELECT A, B, C, D, E, F, G, H, I, J, K WHERE K >= 17 AND L = 17 ORDER BY K DESC, A ASC", 1), "No teams at 17+ points yet.")`
  );
  pSheet.getRange('M2').setFormula(
    `=IFERROR(QUERY('${ledgerName}'!A1:W, "SELECT A, B, C, K, P, U WHERE K >= 14 AND K < 17 AND L = 17 ORDER BY K DESC, A ASC", 1), "No bubble teams.")`
  );
  pSheet.setFrozenRows(2);
}

/**
 * Deletes standalone tabs cleanly.
 */
function removeStandaloneAuditTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [AUDIT_SHADOW_TAB, PLAYOFF_17_TAB].forEach(function(name) {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });
}