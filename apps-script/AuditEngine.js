/**
 * ============================================================================
 * AYSO REGION 154 CYPRESS — AUTOMATED AUDIT & DISPUTE ENGINE (AuditEngine.gs)
 * Version: 4.5.0 (Check-In Auditor + Formula Injector + Automated Dispute Verifier)
 * ============================================================================
 */

/**
 * Master entry point: Audits all check-in rows, enforces caps/deduplication,
 * ensures the 116-team canonical roster, and injects live traceable formulas.
 */
function runAuditAndSyncLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Required sheets (Game Day Check-ins, Team_Awards, Season_Master_Ledger) not found.');
  }

  // 1. Build Canonical Team Dictionary from Team_Awards (116 teams)
  const awardsData = awardsSheet.getDataRange().getValues();
  const canonicalLookup = {};
  const coachLastLookup = {};

  for (let i = 1; i < awardsData.length; i++) {
    const teamCode = String(awardsData[i][0] || '').trim();
    if (!teamCode) continue;
    const cKey = canonicalComparisonKey_(teamCode);
    canonicalLookup[cKey] = teamCode;

    // Also map by Division + Coach Last Name (e.g., "BU08_RODRIGUEZ") for MatchTrak code resolution
    const parts = teamCode.split(' - ');
    if (parts.length >= 3) {
      const divRaw = parts[0].trim().replace(/^0+/, ''); // "8U"
      const gender = parts[1].trim().charAt(0).toUpperCase(); // "B" or "G"
      const coachWords = parts[2].trim().split(/\s+/);
      const lastName = coachWords[coachWords.length - 1].toUpperCase();
      coachLastLookup[`${gender}U${divRaw.replace('U', '')}_${lastName}`] = teamCode;
      coachLastLookup[`${gender}${divRaw}_${lastName}`] = teamCode;
    }
  }

  // 2. Ensure Col AB (Legacy_Backfill_Team) is locked before auditing
  const lastRow = checkinsSheet.getLastRow();
  if (lastRow < 2) return { auditedRows: 0 };

  const numCols = Math.max(28, checkinsSheet.getLastColumn());
  const data = checkinsSheet.getRange(1, 1, lastRow, numCols).getValues();

  // Set headers for Cols X..AB (indices 23..27)
  checkinsSheet.getRange(1, 24, 1, 5).setValues([[
    'Audit Status', 'Points Awarded', 'Audit Reason', 'Credited Team', 'Legacy_Backfill_Team'
  ]]);

  // Track caps & duplicates during chronological scan
  const seenCheckins = new Set();
  const setupDateTeamSet = new Set(); // Caps Field Setup at 1 pt per team per date
  const teamCategoryTallies = {}; // Tracks cumulative Ref (max 10), FM (max 2), Setup (max 5)

  const auditOutputs = []; // Rows 2..lastRow for Cols X..AB (5 cols)

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const ts = row[0];
    const dateKey = extractDateOnlyKey_(ts);
    const firstName = String(row[1] || '').trim();
    const lastName = String(row[2] || '').trim();
    const volKey = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
    const role = String(row[3] || '').trim();
    const refPos = String(row[4] || '').trim();
    const divSelection = String(row[12] || '').trim();
    const confirmAffil = String(row[22] || '').trim();

    // Preserve or initialize Legacy_Backfill_Team (Col AB, idx 27)
    let dropdownTeam = '';
    for (let c = 13; c <= 21; c++) {
      if (String(row[c] || '').trim() !== '') {
        dropdownTeam = String(row[c]).trim();
        break;
      }
    }
    const prevCredited = String(row[26] || '').trim();
    let legacyBackfill = String(row[27] || '').trim();
    if (!legacyBackfill && !dropdownTeam && prevCredited && !prevCredited.toUpperCase().includes('NOCRA')) {
      legacyBackfill = prevCredited;
    }

    const rawSelectedTeam = dropdownTeam || legacyBackfill;

    // Rule 1: Paid NOCRA / USSF / Neutral Referee check
    if (
      refPos.toUpperCase().includes('NOCRA') ||
      divSelection.toUpperCase().includes('NOCRA') ||
      confirmAffil.toUpperCase().includes('NOCRA') ||
      rawSelectedTeam.toUpperCase().includes('NOCRA') ||
      (/referee/i.test(role) && !rawSelectedTeam)
    ) {
      auditOutputs.push([
        'NOCRA - No Points',
        0,
        'Paid NOCRA / USSF or neutral referee (no team credit)',
        '',
        legacyBackfill
      ]);
      continue;
    }

    // Rule 2: Resolve Team against Canonical 116-Team Roster
    const cKey = canonicalComparisonKey_(rawSelectedTeam);
    const matchedTeam = canonicalLookup[cKey] || '';

    if (!matchedTeam) {
      auditOutputs.push([
        'Unrecognized Team',
        0,
        rawSelectedTeam ? `Team '${rawSelectedTeam}' not found in Master Ledger` : 'No valid team selected',
        '',
        legacyBackfill
      ]);
      continue;
    }

    if (!teamCategoryTallies[matchedTeam]) {
      teamCategoryTallies[matchedTeam] = { ref: 0, fm: 0, setup: 0 };
    }

    // Rule 3: Deduplication Check (Same volunteer + date + role + refPos + match/shift + team)
    const shiftContext = String(row[6] || row[7] || row[8] || row[10] || row[11] || '').trim();
    const dedupKey = `${dateKey}|${volKey}|${role.toLowerCase()}|${refPos.toLowerCase()}|${shiftContext.toLowerCase()}|${matchedTeam}`;
    if (seenCheckins.has(dedupKey)) {
      auditOutputs.push([
        'Duplicate Submission (0)',
        0,
        `Duplicate check-in: volunteer already logged this shift for ${matchedTeam}`,
        matchedTeam,
        legacyBackfill
      ]);
      continue;
    }
    seenCheckins.add(dedupKey);

    // Rule 4: Role-specific Cap Enforcement
    if (/set\s*up/i.test(role)) {
      const setupDayKey = `${dateKey}|${matchedTeam}`;
      if (setupDateTeamSet.has(setupDayKey)) {
        auditOutputs.push([
          'Cap Reached (Date)',
          0,
          `Team already earned maximum 1 Field Setup point on ${dateKey}`,
          matchedTeam,
          legacyBackfill
        ]);
        continue;
      }
      if (teamCategoryTallies[matchedTeam].setup >= 5) {
        auditOutputs.push([
          'Cap Reached',
          0,
          `Team already reached 5-point season Field Setup maximum`,
          matchedTeam,
          legacyBackfill
        ]);
        continue;
      }
      setupDateTeamSet.add(setupDayKey);
      teamCategoryTallies[matchedTeam].setup += 1;
      auditOutputs.push([
        'Recorded',
        1,
        `1 point awarded to ${matchedTeam}`,
        matchedTeam,
        legacyBackfill
      ]);
    } else if (/marshal/i.test(role)) {
      if (teamCategoryTallies[matchedTeam].fm >= 2) {
        auditOutputs.push([
          'Cap Reached',
          0,
          `Team already reached 2-point season Field Marshal maximum`,
          matchedTeam,
          legacyBackfill
        ]);
        continue;
      }
      teamCategoryTallies[matchedTeam].fm += 1;
      auditOutputs.push([
        'Recorded',
        1,
        `1 point awarded to ${matchedTeam}`,
        matchedTeam,
        legacyBackfill
      ]);
    } else {
      // Referee or Picture Day check-in
      if (/referee/i.test(role) && teamCategoryTallies[matchedTeam].ref >= 10) {
        auditOutputs.push([
          'Cap Reached',
          0,
          `Team already reached 10-point season Referee maximum`,
          matchedTeam,
          legacyBackfill
        ]);
        continue;
      }
      if (/referee/i.test(role)) {
        teamCategoryTallies[matchedTeam].ref += 1;
      }
      auditOutputs.push([
        'Recorded',
        1,
        `1 point awarded to ${matchedTeam}`,
        matchedTeam,
        legacyBackfill
      ]);
    }
  }

  // Write audited columns X..AB in one batch
  if (auditOutputs.length > 0) {
    checkinsSheet.getRange(2, 24, auditOutputs.length, 5).setValues(auditOutputs);
  }

  // Ensure Season_Master_Ledger has the clean 116-team roster and live formulas
  repairLedgerAndLockBackfill();

  return {
    auditedRows: auditOutputs.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Restores the 116-team canonical roster in Season_Master_Ledger Cols A:C,
 * locks Col AB in Game Day Check-ins, and injects live native spreadsheet formulas.
 */
function repairLedgerAndLockBackfill() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins');
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Missing one of required sheets: Game Day Check-ins, Team_Awards, or Season_Master_Ledger.');
  }

  // 1. Lock in Col AB (Legacy_Backfill_Team) in 'Game Day Check-ins'
  const ciLastRow = checkinsSheet.getLastRow();
  if (ciLastRow > 1) {
    const ciData = checkinsSheet.getRange(1, 1, ciLastRow, 28).getValues();
    checkinsSheet.getRange(1, 28).setValue('Legacy_Backfill_Team');

    const backfillValues = [];
    for (let r = 1; r < ciData.length; r++) {
      const row = ciData[r];
      const hasDropdownTeam = row.slice(13, 22).some(val => String(val || '').trim() !== '');
      const creditedTeam = String(row[26] || '').trim();
      const existingBackfill = String(row[27] || '').trim();

      if (existingBackfill) {
        backfillValues.push([existingBackfill]);
      } else if (!hasDropdownTeam && creditedTeam && !creditedTeam.toUpperCase().includes('NOCRA')) {
        backfillValues.push([creditedTeam]);
      } else {
        backfillValues.push(['']);
      }
    }
    checkinsSheet.getRange(2, 28, backfillValues.length, 1).setValues(backfillValues);
  }

  // 2. Rebuild Canonical 116-Team Roster in 'Season_Master_Ledger' Cols A:C
  const awardsData = awardsSheet.getDataRange().getValues();
  const canonicalTeams = [];

  for (let i = 1; i < awardsData.length; i++) {
    const teamCode = String(awardsData[i][0] || '').trim();
    if (!teamCode) continue;

    const parts = teamCode.split(' - ');
    let division = '';
    let headCoach = '';
    if (parts.length >= 3) {
      division = parts[0].trim() + ' - ' + parts[1].trim();
      headCoach = parts.slice(2).join(' - ').trim();
    } else if (parts.length === 2) {
      division = parts[0].trim() + ' - ' + parts[1].trim();
      headCoach = parts[1].trim();
    } else {
      division = teamCode;
      headCoach = teamCode;
    }
    canonicalTeams.push([division, teamCode, headCoach]);
  }

  if (canonicalTeams.length > 0) {
    ledgerSheet.getRange(2, 1, canonicalTeams.length, 3).setValues(canonicalTeams);
  }

  injectTraceableLedgerFormulas();
  SpreadsheetApp.flush();
}

/**
 * Injects native Google Sheets formulas across Columns D through W for all 116 teams in Season_Master_Ledger.
 */
function injectTraceableLedgerFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  if (!ledgerSheet) return;

  const lastRow = ledgerSheet.getLastRow();
  if (lastRow < 2) return;

  const numTeams = lastRow - 1;
  const formulaRows = [];
  const nowStamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss');

  for (let i = 0; i < numTeams; i++) {
    const r = i + 2;
    // Playoff goal: Playground = 4, 05U/06U = 8, Competitive (08U+) = 17
    const goalFormula = `=IF(REGEXMATCH($A${r}, "Playground"), 4, IF(REGEXMATCH($A${r}, "05U|5U|06U|6U"), 8, 17))`;

    formulaRows.push([
      `=MIN(10, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "Referee"))`, // Col D: Ref
      `=MIN(2, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "Field Marshal"))`, // Col E: FM
      `=MIN(5, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "Field Set Up"))`, // Col F: Setup
      `=MIN(2, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "*Pic*") + SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$D:$D))`, // Col G: Pic Day
      `=MIN(5, SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$B:$B))`, // Col H: Cert Ref Bonus
      `=MIN(2, SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$C:$C))`, // Col I: MatchTrak Bonus
      `=SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$E:$E)`, // Col J: Other Adjustments
      `=SUM(D${r}:J${r})`, // Col K: Current Verified Points
      goalFormula, // Col L: Playoff Goal
      `=MAX(0, 2 - E${r})`, // Col M: Pending FM Obligations
      `=K${r} + M${r}`, // Col N: Projected Base Points
      `=N${r} + MAX(0, 5 - F${r})`, // Col O: Projected with Full Setup
      `=MAX(0, L${r} - O${r})`, // Col P: Gap to 17 (With Full Setup)
      `=MAX(0, L${r} - N${r})`, // Col Q: Ref Match Target
      `0`, // Col R: Home Games Remaining
      `=R${r}*2`, // Col S: Home Ref Capacity
      `=ROUND(Q${r}/3, 1)`, // Col T: Target Shifts / Week
      `=IF(K${r}>=L${r}, "🟢 CLINCHED", IF(O${r}>=L${r}, "🟡 ON TRACK (Pending Setup)", IF(P${r}<=3, "🟠 ACTION REQUIRED", "🔴 CRITICAL DEFICIT")))`, // Col U: Tier
      `=IF(K${r}>=L${r}, "Playoff goal achieved!", IF(O${r}>=L${r}, "Within striking distance. Setup + FM closes gap.", "Must schedule " & P${r} & " more Referee shift(s) + Setup."))`, // Col V: Directive
      nowStamp // Col W: Last Audited
    ]);
  }

  ledgerSheet.getRange(2, 4, formulaRows.length, 20).setValues(formulaRows);
}

/**
 * ============================================================================
 * AUTOMATED DISPUTE AUDITOR & MATCHTRAK SCHEDULE CROSS-CHECKER
 * ============================================================================
 * Automatically cross-references:
 *   1. Every Dispute Ticket in 'Form Responses 2' against 'Game Day Check-ins' and 'Season_Master_Schedule'.
 *   2. Every completed game in 'Season_Master_Schedule' where a Region 154 Referee was signed up
 *      in MatchTrak (Center, AR1, AR2) to see if they forgot to scan the QR code on Game Day!
 * Outputs a clean, actionable 'Dispute_Audit_Report' tab for 1-click Board review.
 */
function runAutomatedDisputeAndScheduleAudit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const disputesSheet = ss.getSheetByName('Form Responses 2');
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins');
  const scheduleSheet = ss.getSheetByName('Season_Master_Schedule');
  const awardsSheet = ss.getSheetByName('Team_Awards');

  let reportSheet = ss.getSheetByName('Dispute_Audit_Report');
  if (!reportSheet) {
    reportSheet = ss.insertSheet('Dispute_Audit_Report');
  } else {
    reportSheet.clear();
  }

  // Load Check-ins for fast lookup
  const ciData = checkinsSheet ? checkinsSheet.getDataRange().getValues() : [];
  const checkinsList = [];
  for (let i = 1; i < ciData.length; i++) {
    const r = ciData[i];
    checkinsList.push({
      dateKey: extractDateOnlyKey_(r[0]),
      firstName: String(r[1] || '').trim(),
      lastName: String(r[2] || '').trim(),
      fullName: `${String(r[1] || '').trim()} ${String(r[2] || '').trim()}`.toLowerCase(),
      role: String(r[3] || '').trim(),
      status: String(r[23] || '').trim(),
      points: Number(r[24]) || 0,
      reason: String(r[25] || '').trim(),
      team: String(r[26] || r[27] || '').trim()
    });
  }

  // Load MatchTrak Schedule for fast lookup
  const schedData = scheduleSheet ? scheduleSheet.getDataRange().getValues() : [];
  const schedList = [];
  for (let i = 1; i < schedData.length; i++) {
    const r = schedData[i];
    schedList.push({
      dateKey: extractDateOnlyKey_(r[1]),
      time: formatTimeSafe_(r[2]),
      gameNum: String(r[3] || ''),
      division: String(r[4] || ''),
      field: String(r[8] || ''),
      homeTeam: String(r[10] || ''),
      awayTeam: String(r[14] || ''),
      centerName: String(r[20] || '').trim(),
      centerTeam: String(r[24] || '').trim(),
      ar1Name: String(r[25] || '').trim(),
      ar1Team: String(r[29] || '').trim(),
      ar2Name: String(r[30] || '').trim(),
      ar2Team: String(r[34] || '').trim()
    });
  }

  const reportRows = [];
  reportRows.push([
    'Ticket # / Type',
    'Submitted Date',
    'Division & Coach',
    'Challenged Category & Shifts',
    'Volunteer Name(s) Cited',
    'Shift Date(s) Cited',
    'QR Check-In Found?',
    'MatchTrak Assignment Found?',
    'Automated Audit Verdict & Recommended Board Action',
    'Coach Explanation'
  ]);

  // Scan all rows in Form Responses 2
  if (disputesSheet && disputesSheet.getLastRow() > 1) {
    const dispData = disputesSheet.getDataRange().getValues();
    for (let i = 1; i < dispData.length; i++) {
      const d = dispData[i];
      const ts = formatDateSafe_(d[0]);
      const division = String(d[8] || '').trim();
      const coach = String(d[9] || '').trim();
      const shiftsCount = String(d[11] || '').trim();
      const category = String(d[12] || '').trim();
      const shiftDates = String(d[13] || '').trim();
      const volNamesRaw = String(d[14] || '').trim();
      const explanation = String(d[17] || '').trim();

      // Search tokens (last names of cited volunteers or coach)
      const tokens = extractLastNameTokens_(volNamesRaw, coach);

      const matchedCheckins = [];
      const matchedSchedule = [];

      tokens.forEach(tok => {
        checkinsList.forEach(ci => {
          if (ci.lastName.toLowerCase().includes(tok) || ci.fullName.includes(tok)) {
            matchedCheckins.push(`${ci.dateKey}: ${ci.firstName} ${ci.lastName} (${ci.role} -> ${ci.team}, ${ci.points} pt [${ci.status}])`);
          }
        });
        schedList.forEach(sc => {
          const allRefs = `${sc.centerName} | ${sc.ar1Name} | ${sc.ar2Name}`.toLowerCase();
          if (allRefs.includes(tok)) {
            matchedSchedule.push(`${sc.dateKey} ${sc.time}: C=${sc.centerName}(${sc.centerTeam}) AR1=${sc.ar1Name}(${sc.ar1Team}) AR2=${sc.ar2Name}(${sc.ar2Team})`);
          }
        });
      });

      const ciSummary = matchedCheckins.length > 0 ? matchedCheckins.slice(0, 4).join('\n') : '❌ None found in QR Log';
      const scSummary = matchedSchedule.length > 0 ? matchedSchedule.slice(0, 4).join('\n') : '❌ Not listed in MatchTrak';

      // Determine Automated Recommendation based on Official 2026 Volunteer Rules
      let verdict = '';
      if (/not needed|agreed|other team|young kids/i.test(explanation) && matchedCheckins.length === 0) {
        verdict = '🔴 DENY (Rule 3): Ref rules require BOTH MatchTrak sign-up AND completed on-field assignment + QR check-in. Standing by or letting opposing ref solo does not earn points.';
      } else if (matchedSchedule.length > 0 && matchedCheckins.length === 0) {
        verdict = '🟡 VERIFY PAPER TENT SHEET: Volunteer is in MatchTrak schedule but missed QR check-in. Confirm coach team name was selected in MatchTrak & ref signed physical tent sheet.';
      } else if (matchedCheckins.some(m => m.includes('Cap Reached (Date)'))) {
        verdict = '🔴 DENY (Rule Cap): Volunteer checked in, but team already earned the 1-pt daily Field Setup cap on that date.';
      } else if (matchedCheckins.length > 0) {
        verdict = '🟢 PARTIALLY/ALREADY CREDITED: Check-in log shows recorded shifts for this volunteer; verify if missing date was before QR launch (8/29) or forgot QR scan.';
      } else {
        verdict = '🟠 MANUAL CARD CHECK: Neither QR check-in nor MatchTrak assignment found under this name. Check physical game card with RRA Vince Redmond.';
      }

      reportRows.push([
        `Dispute #${i}`,
        ts,
        `${division} - ${coach}`,
        `${shiftsCount} (${category})`,
        volNamesRaw,
        shiftDates,
        ciSummary,
        scSummary,
        verdict,
        explanation
      ]);
    }
  }

  reportSheet.getRange(1, 1, reportRows.length, reportRows[0].length).setValues(reportRows);
  reportSheet.getRange(1, 1, 1, reportRows[0].length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  reportSheet.setFrozenRows(1);
  reportSheet.autoResizeColumns(1, reportRows[0].length);

  return {
    status: 'ok',
    disputesAudited: reportRows.length - 1
  };
}

/**
 * Helper to return Dispute Audit Summary via API if needed.
 */
function getDisputeAuditSummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Dispute_Audit_Report');
  if (!sheet || sheet.getLastRow() < 2) {
    runAutomatedDisputeAndScheduleAudit();
  }
  const rows = ss.getSheetByName('Dispute_Audit_Report').getDataRange().getValues();
  return { status: 'ok', rows: rows };
}

/**
 * Extracts YYYY-MM-DD from any Date or timestamp string.
 */
function extractDateOnlyKey_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd');
  }
  return s;
}

/**
 * Extracts meaningful last-name search tokens from free-text volunteer strings.
 */
function extractLastNameTokens_(volStr, coachStr) {
  const cleaned = String(volStr || '')
    .replace(/\d+\/\d+(\/\d+)?/g, ' ')
    .replace(/[,;&()]/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3 && !/^(and|the|unknown|other|teams|had|young|kids|that|agreed|ref|entire|game|sat|sept|aug)$/i.test(w));
  const tokens = new Set();
  words.forEach(w => tokens.add(w.toLowerCase()));
  if (tokens.size === 0 && coachStr) {
    const cWords = String(coachStr).trim().split(/\s+/);
    if (cWords.length > 0) tokens.add(cWords[cWords.length - 1].toLowerCase());
  }
  return Array.from(tokens);
}

/**
 * Optional 1-click installer to run `runAuditAndSyncLedger` automatically every hour on weekends.
 */
function installAutomatedAuditTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'runAuditAndSyncLedger') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runAuditAndSyncLedger')
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getActiveSpreadsheet().toast('✅ Automated Hourly Audit Trigger installed!', 'AYSO 154 Automation', 5);
}