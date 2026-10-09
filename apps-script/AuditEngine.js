/**
 * ============================================================================
 * AYSO REGION 154 - AUDIT TRAIL & MASTER LEDGER SYNC ENGINE
 * ============================================================================
 * File: AuditEngine.js
 * Version: v2.1.0-FORMULA-EDITION
 * Last Updated: October 9, 2026, 08:45 AM PDT
 * Author: AYSO 154 Webmaster
 * 
 * CHANGELOG:
 * - [2026-10-09 08:45 AM] CRITICAL FIX: Replaced destructive sheet.clearContents()
 *   with an atomic in-place overwrite to prevent ledger wipe on script timeout.
 * - [2026-10-09 08:45 AM] UPGRADE: Injected native Google Sheets formulas 
 *   (=SUMIFS) into the Season_Master_Ledger. The sheet will now calculate 
 *   itself independently of the Apps Script runtime.
 * ============================================================================
 */

function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('AYSO 154 Test Tools')
      .addItem('Run Audit & Sync Ledger', 'runAuditAndSyncLedger')
      .addToUi();
  } catch (e) {
    Logger.log('onOpen skipped in non-interactive context: ' + e.message);
  }
}

/**
 * Main entrypoint to audit all form responses and synchronize the Season Master Ledger.
 */
function runAuditAndSyncLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('No active spreadsheet found.');
    return;
  }

  const auditSummary = auditFormResponses(ss);
  const ledgerSummary = syncSeasonMasterLedger(ss, auditSummary.teamPoints);

  const message = `Audit & Sync Complete!\n\n` +
    `• Form Responses Audited: ${auditSummary.totalRows}\n` +
    `• Valid Credited Shifts: ${auditSummary.validShifts}\n` +
    `• Duplicates Filtered: ${auditSummary.duplicates}\n` +
    `• NOCRA Filtered: ${auditSummary.nocra}\n` +
    `• Cap Exceeded (0 pts): ${auditSummary.capReached}\n` +
    `• Teams Synced in Master Ledger: ${ledgerSummary.teamsCount}`;

  Logger.log(message);

  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('AYSO 154 Audit Engine', message, ui.ButtonSet.OK);
  } catch (e) {}

  return { auditSummary, ledgerSummary };
}

/**
 * Audits 'Game Day Check-ins' (or 'Form Responses 1') and writes columns O, P, Q.
 */
function auditFormResponses(ss) {
  const sheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  if (!sheet || sheet.getLastRow() < 2) {
    return { totalRows: 0, validShifts: 0, duplicates: 0, nocra: 0, capReached: 0, teamPoints: {} };
  }

  sheet.getRange(1, 15).setValue('Audit Status');
  sheet.getRange(1, 16).setValue('Points Awarded');
  sheet.getRange(1, 17).setValue('Audit Reason');
  sheet.getRange('O1:Q1').setFontWeight('bold').setBackground('#002D62').setFontColor('#FFFFFF');

  const rows = sheet.getDataRange().getValues();
  const caps = (typeof getActiveCaps === 'function') ? getActiveCaps() : {
    onFieldRef: 10, fieldMarshal: 2, setup: 5, pic: 2, certifiedRef: 5, matchtrak: 2
  };

  const auditOutput = [];
  const teamCategoryCounts = {}; 
  const seenVolunteerSlots = new Set();

  let validShifts = 0, duplicates = 0, nocra = 0, capReached = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) {
      auditOutput.push(['', '', '']);
      continue;
    }

    const timestamp = row[0];
    let dateStr = '';
    if (timestamp instanceof Date) {
      dateStr = Utilities.formatDate(timestamp, 'America/Los_Angeles', 'yyyy-MM-dd');
    } else {
      const parsedDate = new Date(timestamp);
      dateStr = !isNaN(parsedDate.getTime()) ? Utilities.formatDate(parsedDate, 'America/Los_Angeles', 'yyyy-MM-dd') : String(timestamp).split(' ')[0];
    }

    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const volId = (`${firstName} ${lastName}`.trim().toLowerCase()) || email;

    const dutyRaw = String(row[4] || '').trim();
    const refPosition = String(row[5] || '').trim();
    const rowTeamRef = String(row[6] || '').trim();
    const refGameTime = String(row[7] || '').trim();
    const refField = String(row[8] || '').trim();
    const rowTeamFm = String(row[9] || '').trim();
    const fmField = String(row[10] || '').trim();
    const fmGameTime = String(row[11] || '').trim();
    const rowTeamSetup = String(row[12] || '').trim();
    const setupField = String(row[13] || '').trim();

    let teamCode = '', category = '', categoryCap = 0, timeSlot = '', field = '', isNocra = false;

    if (rowTeamRef || /ref/i.test(dutyRaw)) {
      teamCode = rowTeamRef || findMatchingTeamInRow(row);
      category = 'Referee Assignment';
      categoryCap = caps.onFieldRef;
      timeSlot = refGameTime || 'GameTime';
      field = refField || 'Field';
      if (/nocra|ussf/i.test(refPosition)) isNocra = true;
    } else if (rowTeamFm || /marshal/i.test(dutyRaw)) {
      teamCode = rowTeamFm || findMatchingTeamInRow(row);
      category = 'Field Marshal Shift';
      categoryCap = caps.fieldMarshal;
      timeSlot = fmGameTime || 'ShiftTime';
      field = fmField || 'Field';
    } else if (rowTeamSetup || /set\s*up/i.test(dutyRaw)) {
      teamCode = rowTeamSetup || findMatchingTeamInRow(row);
      category = 'Friday Night Field Setup';
      categoryCap = caps.setup;
      timeSlot = 'FridayNight';
      field = setupField || 'Field';
    } else if (/picture/i.test(dutyRaw)) {
      teamCode = findMatchingTeamInRow(row);
      category = 'Picture Day';
      categoryCap = caps.pic;
      timeSlot = 'PicShift';
      field = 'Picture Tent';
    }

    if (!teamCategoryCounts[teamCode]) teamCategoryCounts[teamCode] = { ref: 0, fm: 0, setup: 0, pic: 0 };

    let status = 'Recorded', pts = 0, reason = '';

    if (isNocra) {
      status = 'NOCRA - No Points';
      pts = 0;
      reason = 'Paid NOCRA / USSF center referee (no volunteer credit)';
      nocra++;
    } else {
      const normTime = String(timeSlot || '').replace(/\s+/g, '').toLowerCase();
      const normField = String(field || '').replace(/\s+/g, '').toLowerCase();
      const normPos = String(refPosition || '').replace(/\s+/g, '').toLowerCase();
      const slotKey = `${volId}|${dateStr}|${normTime}|${normField}|${category}|${normPos}`;

      if (seenVolunteerSlots.has(slotKey)) {
        status = 'Duplicate Submission (0)';
        pts = 0;
        reason = `Duplicate check-in: volunteer already logged for slot ${timeSlot} at ${field}${refPosition ? ` (${refPosition})` : ''}`;
        duplicates++;
      } else {
        let currentCount = 0;
        if (category === 'Referee Assignment') currentCount = teamCategoryCounts[teamCode].ref;
        else if (category === 'Field Marshal Shift') currentCount = teamCategoryCounts[teamCode].fm;
        else if (category === 'Friday Night Field Setup') currentCount = teamCategoryCounts[teamCode].setup;
        else if (category === 'Picture Day') currentCount = teamCategoryCounts[teamCode].pic;

        if (currentCount >= categoryCap) {
          status = 'Cap Reached';
          pts = 0;
          reason = `Team reached ${categoryCap}-point cap for ${category}`;
          capReached++;
        } else {
          status = 'Recorded';
          pts = 1;
          reason = `1 point awarded to ${teamCode}`;
          seenVolunteerSlots.add(slotKey);
          validShifts++;

          if (category === 'Referee Assignment') teamCategoryCounts[teamCode].ref++;
          else if (category === 'Field Marshal Shift') teamCategoryCounts[teamCode].fm++;
          else if (category === 'Friday Night Field Setup') teamCategoryCounts[teamCode].setup++;
          else if (category === 'Picture Day') teamCategoryCounts[teamCode].pic++;
        }
      }
    }
    auditOutput.push([status, pts, reason]);
  }

  if (auditOutput.length > 0) {
    sheet.getRange(2, 15, auditOutput.length, 3).setValues(auditOutput);
  }

  return { totalRows: auditOutput.length, validShifts, duplicates, nocra, capReached, teamPoints: teamCategoryCounts };
}

function findMatchingTeamInRow(row) {
  const master = (typeof MASTER_TEAMS !== 'undefined') ? MASTER_TEAMS : [];
  for (let c = 0; c < row.length; c++) {
    const cell = String(row[c] || '').trim();
    if (master.indexOf(cell) !== -1) return cell;
  }
  for (let c = 0; c < row.length; c++) {
    const cell = String(row[c] || '').trim();
    if (cell.split(' - ').length >= 3) return cell;
  }
  return '';
}

/**
 * Injects Native Google Sheets Formulas into 'Season_Master_Ledger'.
 * Ensures calculations survive backend crashes and operate autonomously.
 */
function syncSeasonMasterLedger(ss, auditedTeamPoints = {}) {
  let sheet = ss.getSheetByName('Season_Master_Ledger');
  if (!sheet) {
    sheet = ss.insertSheet('Season_Master_Ledger');
  }

  const headers = [
    'Division', 'Team Code', 'Head Coach', 'Referee Points (Max 10)',
    'Field Marshal Points (Max 2)', 'Field Setup Points (Max 5)',
    'Picture Day Points (Max 2)', 'Certified Ref Bonus (Max 5)',
    'MatchTrak Bonus (Max 2)', 'Other Adjustments', 'Total Verified Points',
    'Playoff Goal', 'Playoff Status', 'Last Audited'
  ];

  // Identify Check-in Tab name for formula linking
  const checkInTab = ss.getSheetByName('Game Day Check-ins') ? 'Game Day Check-ins' : 'Form Responses 1';

  // Atomic write for headers - NO sheet.clearContents()
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#002D62')
    .setFontColor('#FFFFFF');

  const teams = (typeof MASTER_TEAMS !== 'undefined') ? MASTER_TEAMS : Object.keys(auditedTeamPoints);
  const nowStr = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss');
  const rows = [];

  teams.forEach((rawTeam, index) => {
    if (!rawTeam || !rawTeam.trim() || rawTeam.startsWith('teamCode')) return;
    const parts = rawTeam.split(' - ');
    const division = parts.length >= 2 ? (parts[0].trim() + ' - ' + parts[1].trim()) : parts[0].trim();
    const coach = parts.length >= 3 ? parts.slice(2).join(' - ').trim() : parts[0].trim();

    // R is the row number (Row 2 onward)
    const r = index + 2; 

    // Live Spreadsheet Formulas
    const refFormula = `=MIN(10, SUMIFS('${checkInTab}'!$P:$P, '${checkInTab}'!$G:$G, $B${r}, '${checkInTab}'!$E:$E, "*Referee*"))`;
    const fmFormula = `=MIN(2, SUMIFS('${checkInTab}'!$P:$P, '${checkInTab}'!$J:$J, $B${r}, '${checkInTab}'!$E:$E, "*Marshal*"))`;
    const setupFormula = `=MIN(5, SUMIFS('${checkInTab}'!$P:$P, '${checkInTab}'!$M:$M, $B${r}, '${checkInTab}'!$E:$E, "*Set*"))`;
    const picFormula = `=MIN(2, SUMIFS('${checkInTab}'!$P:$P, '${checkInTab}'!$G:$G, $B${r}, '${checkInTab}'!$E:$E, "*Picture*") + SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$D:$D))`;
    const certFormula = `=MIN(5, SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$B:$B))`;
    const matchTrakFormula = `=MIN(2, SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$C:$C))`;
    const adjFormula = `=SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$E:$E)`;
    
    const totalFormula = `=MAX(0, D${r} + E${r} + F${r} + G${r} + H${r} + I${r} + J${r})`;
    const goalFormula = `=IF(ISNUMBER(SEARCH("Playground", A${r})), 4, IF(OR(ISNUMBER(SEARCH("05U", A${r})), ISNUMBER(SEARCH("06U", A${r}))), 8, 17))`;
    const statusFormula = `=IF(K${r} >= L${r}, "Qualified", (L${r} - K${r}) & " pts needed")`;

    rows.push([
      division, rawTeam, coach,
      refFormula, fmFormula, setupFormula, picFormula,
      certFormula, matchTrakFormula, adjFormula,
      totalFormula, goalFormula, statusFormula,
      nowStr
    ]);
  });

  if (rows.length > 0) {
    // Atomic overwrite. Google Sheets evaluates "=" strings automatically as formulas
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.autoResizeColumns(1, headers.length);
  }

  return { teamsCount: rows.length };
}
