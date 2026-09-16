/**
 * ============================================================================
 * AYSO REGION 154 - AUDIT TRAIL & MASTER LEDGER SYNC ENGINE
 * ============================================================================
 * File: AuditEngine.js
 * Description: Populates Columns O, P, Q in 'Form Responses 1' with audit trails,
 *              enforces duplicate check-in filtering, applies board category caps,
 *              and synchronizes 'Season_Master_Ledger' with verified point totals.
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
  } catch (e) {
    // Non-UI context (trigger/clasp/script execution)
  }

  return { auditSummary, ledgerSummary };
}

/**
 * Audits 'Form Responses 1' and writes columns O, P, Q.
 */
function auditFormResponses(ss) {
  const sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet || sheet.getLastRow() < 2) {
    return { totalRows: 0, validShifts: 0, duplicates: 0, nocra: 0, capReached: 0, teamPoints: {} };
  }

  // Ensure Headers in Row 1 (Cols O, P, Q -> 15, 16, 17)
  sheet.getRange(1, 15).setValue('Audit Status');
  sheet.getRange(1, 16).setValue('Points Awarded');
  sheet.getRange(1, 17).setValue('Audit Reason');
  sheet.getRange('O1:Q1').setFontWeight('bold').setBackground('#002D62').setFontColor('#FFFFFF');

  const rows = sheet.getDataRange().getValues();
  const caps = (typeof getActiveCaps === 'function') ? getActiveCaps() : {
    onFieldRef: 10,
    fieldMarshal: 2,
    setup: 5,
    pic: 2,
    certifiedRef: 5,
    matchtrak: 2
  };

  const auditOutput = [];
  const teamCategoryCounts = {}; // teamCode -> { ref: 0, fm: 0, setup: 0, pic: 0 }
  const seenVolunteerSlots = new Set(); // volId + date + time + field + role

  let validShifts = 0;
  let duplicates = 0;
  let nocra = 0;
  let capReached = 0;

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
      dateStr = !isNaN(parsedDate.getTime())
        ? Utilities.formatDate(parsedDate, 'America/Los_Angeles', 'yyyy-MM-dd')
        : String(timestamp).split(' ')[0];
    }

    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const volId = email || (firstName + ' ' + lastName).trim().toLowerCase();

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

    // Identify target team, role/category, time slot, and field
    let teamCode = '';
    let category = '';
    let categoryCap = 0;
    let timeSlot = '';
    let field = '';
    let isNocra = false;

    if (rowTeamRef || /ref/i.test(dutyRaw)) {
      teamCode = rowTeamRef || findMatchingTeamInRow(row);
      category = 'Referee Assignment';
      categoryCap = caps.onFieldRef;
      timeSlot = refGameTime || 'GameTime';
      field = refField || 'Field';
      if (/nocra|ussf/i.test(refPosition)) {
        isNocra = true;
      }
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

    if (!teamCategoryCounts[teamCode]) {
      teamCategoryCounts[teamCode] = { ref: 0, fm: 0, setup: 0, pic: 0 };
    }

    let status = 'Recorded';
    let pts = 0;
    let reason = '';

    if (isNocra) {
      status = 'NOCRA - No Points';
      pts = 0;
      reason = 'Paid NOCRA / USSF center referee (no volunteer credit)';
      nocra++;
    } else {
      // De-duplication slot key: volunteer + date + time + field + category
      const normTime = String(timeSlot || '').replace(/\s+/g, '').toLowerCase();
      const normField = String(field || '').replace(/\s+/g, '').toLowerCase();
      const slotKey = `${volId}|${dateStr}|${normTime}|${normField}|${category}`;

      if (seenVolunteerSlots.has(slotKey)) {
        status = 'Duplicate Submission (0)';
        pts = 0;
        reason = `Duplicate check-in: volunteer already logged for slot ${timeSlot} at ${field}`;
        duplicates++;
      } else {
        // Check category cap
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

  // Write audit columns back to 'Form Responses 1'
  if (auditOutput.length > 0) {
    sheet.getRange(2, 15, auditOutput.length, 3).setValues(auditOutput);
  }

  return {
    totalRows: auditOutput.length,
    validShifts,
    duplicates,
    nocra,
    capReached,
    teamPoints: teamCategoryCounts
  };
}

/**
 * Finds team string from row if column wasn't explicitly populated
 */
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
 * Synchronizes 'Season_Master_Ledger' with verified point totals, awards, and qualification status.
 */
function syncSeasonMasterLedger(ss, auditedTeamPoints = {}) {
  let sheet = ss.getSheetByName('Season_Master_Ledger');
  if (!sheet) {
    sheet = ss.insertSheet('Season_Master_Ledger');
  }

  // Headers
  const headers = [
    'Division',
    'Team Code',
    'Head Coach',
    'Referee Points (Max 10)',
    'Field Marshal Points (Max 2)',
    'Field Setup Points (Max 5)',
    'Picture Day Points (Max 2)',
    'Certified Ref Bonus (Max 5)',
    'MatchTrak Bonus (Max 2)',
    'Other Adjustments',
    'Total Verified Points',
    'Playoff Goal',
    'Playoff Status',
    'Last Audited'
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#002D62')
    .setFontColor('#FFFFFF');

  // Collect Awards from Team_Awards
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const teamAwardsMap = {}; // teamCode -> { certRef: 0, matchtrak: 0, other: 0 }
  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    const awardRows = awardsSheet.getDataRange().getValues();
    for (let j = 1; j < awardRows.length; j++) {
      const aRow = awardRows[j];
      const aTeam = String(aRow[1] || '').trim();
      const aType = String(aRow[2] || '').trim();
      const aPts = Number(aRow[3]) || 0;

      if (!teamAwardsMap[aTeam]) {
        teamAwardsMap[aTeam] = { certRef: 0, matchtrak: 0, other: 0 };
      }

      if (aType === 'Certified Team Referees') {
        teamAwardsMap[aTeam].certRef = Math.min(5, teamAwardsMap[aTeam].certRef + aPts);
      } else if (aType === 'MatchTrak Filled by Sep 26') {
        teamAwardsMap[aTeam].matchtrak = Math.min(2, teamAwardsMap[aTeam].matchtrak + aPts);
      } else {
        teamAwardsMap[aTeam].other += aPts;
      }
    }
  }

  const teams = (typeof MASTER_TEAMS !== 'undefined') ? MASTER_TEAMS : Object.keys(auditedTeamPoints);
  const nowStr = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
  const ledgerRows = [];

  teams.forEach(rawTeam => {
    if (!rawTeam || !rawTeam.trim()) return;
    const parts = rawTeam.split(' - ');
    const division = parts.length >= 2 ? (parts[0].trim() + ' - ' + parts[1].trim()) : parts[0].trim();
    const coach = parts.length >= 3 ? parts.slice(2).join(' - ').trim() : parts[0].trim();

    const audited = auditedTeamPoints[rawTeam] || { ref: 0, fm: 0, setup: 0, pic: 0 };
    const awards = teamAwardsMap[rawTeam] || { certRef: 0, matchtrak: 0, other: 0 };

    const refPts = Math.min(10, audited.ref);
    const fmPts = Math.min(2, audited.fm);
    const setupPts = Math.min(5, audited.setup);
    const picPts = Math.min(2, audited.pic);
    const certRefPts = awards.certRef;
    const matchtrakPts = awards.matchtrak;
    const otherPts = awards.other;

    const totalPts = Math.max(0, refPts + fmPts + setupPts + picPts + certRefPts + matchtrakPts + otherPts);

    // Determine division target goal
    let goal = 17;
    if (division.includes('Playground')) goal = 4;
    else if (division.startsWith('05U') || division.startsWith('06U')) goal = 8;

    let status = 'In Progress';
    if (totalPts >= goal) {
      status = 'Qualified';
    } else {
      const remaining = goal - totalPts;
      status = `${remaining} pts needed`;
    }

    ledgerRows.push([
      division,
      rawTeam,
      coach,
      refPts,
      fmPts,
      setupPts,
      picPts,
      certRefPts,
      matchtrakPts,
      otherPts,
      totalPts,
      goal,
      status,
      nowStr
    ]);
  });

  if (ledgerRows.length > 0) {
    sheet.getRange(2, 1, ledgerRows.length, headers.length).setValues(ledgerRows);
    sheet.autoResizeColumns(1, headers.length);
  }

  return { teamsCount: ledgerRows.length };
}
