/**
 * ============================================================================
 * AYSO REGION 154 CYPRESS — AUTOMATED AUDIT & DISPUTE ENGINE (AuditEngine.gs)
 * Version: 4.5.1 (Check-In Auditor + Formula Injector + Automated Dispute Verifier)
 * ============================================================================
 */

/**
 * Master entry point: Audits all check-in rows, enforces caps/deduplication,
 * ensures the 116-team canonical roster, and injects live traceable formulas.
 */
function runAuditAndSyncLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS
    : { CHECKINS: 'Game Day Check-ins', AWARDS: 'Team_Awards', LEDGER: 'Season_Master_Ledger' };
  const checkinsSheet = getGameDayCheckinsSheet(ss);
  const awardsSheet = ss.getSheetByName(sheets.AWARDS);
  const ledgerSheet = ss.getSheetByName(sheets.LEDGER);

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Required sheets (Game Day Check-ins / Form Responses 3 / Form Responses 1, Team_Awards, Season_Master_Ledger) not found.');
  }

  // 1. Build Canonical Team Dictionary from Team_Awards (116 teams)
  const awardsData = awardsSheet.getDataRange().getValues();
  const canonicalLookup = {};
  const coachLastLookup = {};

  for (let i = 1; i < awardsData.length; i++) {
    if (isLegacyTeamAwardLogRow_(awardsData[i])) continue;
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
  const policyCaps = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.CATEGORY_CAPS)
    ? VOLUNTEER_POLICY.CATEGORY_CAPS
    : { FIELD_SETUP: 5, FIELD_MARSHAL: 2, REFEREE: 10 };
  const seenCheckins = new Set();
  const setupDateTeamSet = new Set(); // Caps Field Setup at 1 pt per team per date
  const teamCategoryTallies = {}; // Tracks cumulative Ref, FM, Setup

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
      if (teamCategoryTallies[matchedTeam].setup >= policyCaps.FIELD_SETUP) {
        auditOutputs.push([
          'Cap Reached',
          0,
          `Team already reached ${policyCaps.FIELD_SETUP}-point season Field Setup maximum`,
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
      if (teamCategoryTallies[matchedTeam].fm >= policyCaps.FIELD_MARSHAL) {
        auditOutputs.push([
          'Cap Reached',
          0,
          `Team already reached ${policyCaps.FIELD_MARSHAL}-point season Field Marshal maximum`,
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
      if (/referee/i.test(role) && teamCategoryTallies[matchedTeam].ref >= policyCaps.REFEREE) {
        auditOutputs.push([
          'Cap Reached',
          0,
          `Team already reached ${policyCaps.REFEREE}-point season Referee maximum`,
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
  const sheets = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS
    : { CHECKINS: 'Game Day Check-ins', AWARDS: 'Team_Awards', LEDGER: 'Season_Master_Ledger' };
  const checkinsSheet = getGameDayCheckinsSheet(ss);
  const awardsSheet = ss.getSheetByName(sheets.AWARDS);
  const ledgerSheet = ss.getSheetByName(sheets.LEDGER);

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Missing one of required sheets: Game Day Check-ins (or Form Responses 3 / Form Responses 1), Team_Awards, or Season_Master_Ledger.');
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
    if (isLegacyTeamAwardLogRow_(awardsData[i])) continue;
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

  // Sync Field_Setup_Audit tab if present or initialize it
  if (typeof syncFieldSetupAuditTab === 'function') {
    syncFieldSetupAuditTab(ss);
  }

  injectTraceableLedgerFormulas(checkinsSheet.getName());
  SpreadsheetApp.flush();
}

/**
 * Injects native Google Sheets formulas across Columns D through W for all teams in Season_Master_Ledger.
 */
function injectTraceableLedgerFormulas(checkinsTabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerName = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS.LEDGER
    : 'Season_Master_Ledger';
  const ledgerSheet = ss.getSheetByName(ledgerName);
  if (!ledgerSheet) return;

  const lastRow = ledgerSheet.getLastRow();
  if (lastRow < 2) return;

  injectFormulasIntoLedger_(ledgerSheet, 2, lastRow, checkinsTabName);
}

/**
 * Core Formula Injector for Season_Master_Ledger.
 * Injects dynamic SSOT-derived formulas across Columns D through W without hardcoded numbers.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet Target ledger sheet
 * @param {number} startRow Starting row number (e.g. 2)
 * @param {number} endRow Ending row number
 * @param {string} [checkinsTabName] Optional checkins tab name
 */
function injectFormulasIntoLedger_(sheet, startRow, endRow, checkinsTabName) {
  if (!sheet) return;
  const ss = sheet.getParent ? sheet.getParent() : SpreadsheetApp.getActiveSpreadsheet();
  const sheets = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS
    : { CHECKINS: 'Game Day Check-ins', AWARDS: 'Team_Awards', LEDGER: 'Season_Master_Ledger', FIELD_SETUP_AUDIT: 'Field_Setup_Audit' };
  const tabName = checkinsTabName || (getGameDayCheckinsSheet(ss) || { getName: () => sheets.CHECKINS }).getName();
  const ci = `'${tabName.replace(/'/g, "''")}'`;
  const awardsTab = sheets.AWARDS || 'Team_Awards';
  const fsaTabName = (sheets && sheets.FIELD_SETUP_AUDIT) ? sheets.FIELD_SETUP_AUDIT : 'Field_Setup_Audit';
  const hasFsa = ss && typeof ss.getSheetByName === 'function' && Boolean(ss.getSheetByName(fsaTabName));

  const caps = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.CATEGORY_CAPS)
    ? VOLUNTEER_POLICY.CATEGORY_CAPS
    : { REFEREE: 10, FIELD_MARSHAL: 2, FIELD_SETUP: 5, PICTURE_DAY: 2, CERTIFIED_REF: 5, MATCHTRAK_BONUS: 2, OTHER_ADJUSTMENTS: 5 };

  const formulaRows = [];
  const nowStamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss');

  for (let r = startRow; r <= endRow; r++) {
    const goalFormula = (typeof getLedgerGoalFormula === 'function')
      ? getLedgerGoalFormula(r)
      : `=IF(REGEXMATCH($A${r}, "Playground"), 4, IF(REGEXMATCH($A${r}, "05U|5U|06U|6U"), 7, IF(REGEXMATCH($A${r}, "08U|8U"), 15, 17)))`;

    const gapFormula = (typeof getLedgerGapFormula === 'function')
      ? getLedgerGapFormula(r)
      : `=MAX(0, L${r} - O${r})`;

    const setupFormula = (typeof getLedgerSetupFormula === 'function')
      ? getLedgerSetupFormula(r, tabName, hasFsa ? fsaTabName : null)
      : (hasFsa
          ? `=IFERROR(VLOOKUP($B${r}, '${fsaTabName.replace(/'/g, "''")}'!$A:$G, 7, FALSE), MIN(${caps.FIELD_SETUP}, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Field Set Up")))`
          : `=MIN(${caps.FIELD_SETUP}, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Field Set Up"))`);

    formulaRows.push([
      `=MIN(${caps.REFEREE}, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Referee"))`, // Col D: Ref
      `=MIN(${caps.FIELD_MARSHAL}, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Field Marshal"))`, // Col E: FM
      setupFormula, // Col F: Setup
      `=MIN(${caps.PICTURE_DAY}, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "*Pic*") + SUMIF(${awardsTab}!$A:$A, $B${r}, ${awardsTab}!$D:$D))`, // Col G: Pic Day
      `=MIN(${caps.CERTIFIED_REF || 5}, SUMIF(${awardsTab}!$A:$A, $B${r}, ${awardsTab}!$B:$B))`, // Col H: Cert Ref Bonus
      `=MIN(${caps.MATCHTRAK_BONUS || 2}, SUMIF(${awardsTab}!$A:$A, $B${r}, ${awardsTab}!$C:$C))`, // Col I: MatchTrak Bonus
      `=SUMIF(${awardsTab}!$A:$A, $B${r}, ${awardsTab}!$E:$E)`, // Col J: Other Adjustments
      `=SUM(D${r}:J${r})`, // Col K: Current Verified Points
      goalFormula, // Col L: Playoff Goal
      `=MAX(0, ${caps.FIELD_MARSHAL} - E${r})`, // Col M: Pending FM Obligations
      `=K${r} + M${r}`, // Col N: Projected Base Points
      `=N${r} + MAX(0, ${caps.FIELD_SETUP} - F${r})`, // Col O: Projected with Full Setup
      gapFormula, // Col P: Gap to Playoff Goal (With Full Setup)
      `=MAX(0, L${r} - N${r})`, // Col Q: Ref Match Target
      `0`, // Col R: Home Games Remaining
      `=R${r}*2`, // Col S: Home Ref Capacity
      `=ROUND(Q${r}/3, 1)`, // Col T: Target Shifts / Week
      `=IF(K${r}>=L${r}, "🟢 CLINCHED", IF(O${r}>=L${r}, "🟡 ON TRACK (Pending Setup)", IF(P${r}<=3, "🟠 ACTION REQUIRED", "🔴 CRITICAL DEFICIT")))`, // Col U: Tier
      `=IF(K${r}>=L${r}, "Playoff goal achieved!", IF(O${r}>=L${r}, "Within striking distance. Setup + FM closes gap.", "Must schedule " & P${r} & " more Referee shift(s) + Setup."))`, // Col V: Directive
      nowStamp // Col W: Last Audited
    ]);
  }

  // Ensure Column P header remains generic
  try {
    sheet.getRange(1, 16).setValue('Gap to Playoff Goal (With Full Setup)');
  } catch (e) {}

  if (formulaRows.length > 0) {
    sheet.getRange(startRow, 4, formulaRows.length, 20).setValues(formulaRows);
  }
}

/**
 * Synchronizes and protects the 'Field_Setup_Audit' tab:
 * - Enforces standard column order:
 *     Col A: Team Code
 *     Col B: Head Coach
 *     Col C: Division
 *     Col D: First Game Setup Obligations (<= 11/01)
 *     Col E: Field Setup Check-Ins Recorded
 *     Col F: Audit Result
 *     Col G: Audited Setup Points (5 or 0)
 * - Does NOT wipe existing rows or overwrite Col D/E with static zeroes.
 * - Restores Col A..C if previously swapped, and reconstructs Col D from Season_Master_Schedule
 *   if Col D was previously wiped to zeroes.
 * - Injects SSOT-derived formulas into Col F and Col G:
 *     Col F: =IF(D{r}>0, IF(E{r}>=D{r}, "Met All Obligations", "Incomplete / Missed"), IF(E{r}>0, "Volunteer Setup Completed", "No Setup Required"))
 *     Col G: =IF(D{r}>0, IF(E{r}>=D{r}, 5, 0), MIN(5, E{r}))
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] Optional active spreadsheet
 * @returns {Object} Sync statistics
 */
function syncFieldSetupAuditTab(ss) {
  const targetSs = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!targetSs) return { status: 'no_spreadsheet' };

  const sheets = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS
    : { CHECKINS: 'Game Day Check-ins', LEDGER: 'Season_Master_Ledger', FIELD_SETUP_AUDIT: 'Field_Setup_Audit' };
  const fsaTabName = (sheets && sheets.FIELD_SETUP_AUDIT) ? sheets.FIELD_SETUP_AUDIT : 'Field_Setup_Audit';
  const ledgerTabName = (sheets && sheets.LEDGER) ? sheets.LEDGER : 'Season_Master_Ledger';
  const checkinsSheet = getGameDayCheckinsSheet(targetSs);
  const ciTabName = checkinsSheet ? checkinsSheet.getName() : (sheets.CHECKINS || 'Game Day Check-ins');
  const ci = `'${ciTabName.replace(/'/g, "''")}'`;

  let fsaSheet = targetSs.getSheetByName(fsaTabName);
  const ledgerSheet = targetSs.getSheetByName(ledgerTabName);

  if (!fsaSheet) {
    if (typeof targetSs.insertSheet !== 'function') return { status: 'mock_no_insert' };
    fsaSheet = targetSs.insertSheet(fsaTabName);
    if (fsaSheet.setTabColor) fsaSheet.setTabColor('#34a853');
  }

  const lastRow = ledgerSheet ? ledgerSheet.getLastRow() : Math.max(fsaSheet.getLastRow(), 117);
  if (lastRow < 2) return { status: 'empty_ledger' };
  const numTeams = lastRow - 1;

  // Read existing values & formulas BEFORE modifying anything
  const existingLastRow = Math.max(1, fsaSheet.getLastRow());
  const existingValues = existingLastRow >= 1
    ? fsaSheet.getRange(1, 1, existingLastRow, 7).getValues()
    : [];
  const existingFormulas = (existingLastRow >= 1 && typeof fsaSheet.getRange(1, 1, existingLastRow, 7).getFormulas === 'function')
    ? fsaSheet.getRange(1, 1, existingLastRow, 7).getFormulas()
    : [];

  // Standard Header Row (Row 1): Col A = Team Code, Col B = Head Coach, Col C = Division
  const headers = [[
    'Team Code',
    'Head Coach',
    'Division',
    'First Game Setup Obligations (<= 11/01)',
    'Field Setup Check-Ins Recorded',
    'Audit Result',
    'Audited Setup Points (5 or 0)'
  ]];
  fsaSheet.getRange(1, 1, 1, headers[0].length)
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground('#1a365d')
    .setFontColor('#ffffff')
    .setWrap(true)
    .setVerticalAlignment('middle');

  // Detect if Cols A..C are empty or were corrupted (e.g. Division in Col A instead of Team Code)
  const headerA1 = existingValues.length > 0 ? String(existingValues[0][0] || '').trim() : '';
  const sampleFormulaA2 = (existingFormulas.length > 1 && existingFormulas[1]) ? String(existingFormulas[1][0] || '') : '';
  const sampleValA2 = (existingValues.length > 1 && existingValues[1]) ? String(existingValues[1][0] || '').trim() : '';
  const sampleValB2 = (existingValues.length > 1 && existingValues[1]) ? String(existingValues[1][1] || '').trim() : '';
  const colsAbcCorrupted = existingLastRow < 2 ||
    /^division$/i.test(headerA1) ||
    /!A2$/i.test(sampleFormulaA2) ||
    (sampleValB2.split(' - ').length >= 3 && sampleValA2.split(' - ').length < 3);

  if (colsAbcCorrupted) {
    const abcRows = [];
    for (let i = 0; i < numTeams; i++) {
      const r = i + 2;
      // Season_Master_Ledger has Col A = Division, Col B = Team Code, Col C = Head Coach
      // Field_Setup_Audit standard has Col A = Team Code, Col B = Head Coach, Col C = Division
      abcRows.push([
        `='${ledgerTabName}'!B${r}`,
        `='${ledgerTabName}'!C${r}`,
        `='${ledgerTabName}'!A${r}`
      ]);
    }
    if (abcRows.length > 0) {
      fsaSheet.getRange(2, 1, abcRows.length, 3).setValues(abcRows);
    }
  }

  // Inspect Col D (First Game Setup Obligations) to protect existing formulas/values
  let hasAnyColDFormula = false;
  let hasAnyNonZeroColD = false;
  let hasSwappedColDRef = false;
  for (let rIdx = 1; rIdx < existingValues.length; rIdx++) {
    const fD = (existingFormulas[rIdx] && existingFormulas[rIdx][3]) ? String(existingFormulas[rIdx][3]) : '';
    const vD = existingValues[rIdx] ? Number(existingValues[rIdx][3]) || 0 : 0;
    if (fD) {
      hasAnyColDFormula = true;
      if (/\$B\d+/i.test(fD)) hasSwappedColDRef = true;
    }
    if (vD > 0) hasAnyNonZeroColD = true;
  }

  if (hasAnyColDFormula && hasSwappedColDRef) {
    // Fix any formula in Col D that referenced $B{r} when Team Code was in Col B
    const fixedColD = [];
    for (let i = 0; i < numTeams; i++) {
      const r = i + 2;
      const fD = (existingFormulas[r - 1] && existingFormulas[r - 1][3]) ? String(existingFormulas[r - 1][3]) : '';
      const vD = (existingValues[r - 1] && existingValues[r - 1][3] !== '') ? existingValues[r - 1][3] : 0;
      fixedColD.push([fD ? fD.replace(/\$B(\d+)/g, '$$A$1') : vD]);
    }
    fsaSheet.getRange(2, 4, fixedColD.length, 1).setValues(fixedColD);
  } else if (!hasAnyColDFormula && !hasAnyNonZeroColD) {
    // Col D was wiped to static zeroes with no formula; reconstruct from Season_Master_Schedule
    const obligationsMap = computeFirstGameSetupObligations_(targetSs);
    if (obligationsMap && Object.keys(obligationsMap).length > 0 && ledgerSheet) {
      const ledgerData = ledgerSheet.getRange(2, 1, numTeams, 3).getValues();
      const restoredColD = [];
      for (let i = 0; i < numTeams; i++) {
        const tCode = String(ledgerData[i][1] || '').trim();
        const cKey = canonicalComparisonKey_(tCode);
        restoredColD.push([obligationsMap[cKey] || 0]);
      }
      fsaSheet.getRange(2, 4, restoredColD.length, 1).setValues(restoredColD);
    }
  }

  // Inspect Col E (Field Setup Check-Ins Recorded): protect valid formulas/values, fix $B{r} -> $A{r} if needed
  const setupCap = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.CATEGORY_CAPS && VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_SETUP)
    ? VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_SETUP
    : 5;

  let needsColERepair = existingLastRow < 2;
  for (let rIdx = 1; rIdx < existingValues.length; rIdx++) {
    const fE = (existingFormulas[rIdx] && existingFormulas[rIdx][4]) ? String(existingFormulas[rIdx][4]) : '';
    if (fE && /\$B\d+/i.test(fE)) {
      needsColERepair = true;
      break;
    }
  }

  if (needsColERepair) {
    const colERows = [];
    for (let i = 0; i < numTeams; i++) {
      const r = i + 2;
      const existingFE = (existingFormulas[r - 1] && existingFormulas[r - 1][4]) ? String(existingFormulas[r - 1][4]) : '';
      if (existingFE && /\$B\d+/i.test(existingFE)) {
        colERows.push([existingFE.replace(/\$B(\d+)/g, '$$A$1')]);
      } else if (existingFE) {
        colERows.push([existingFE]);
      } else {
        colERows.push([`=SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $A${r}, ${ci}!$D:$D, "Field Set Up")`]);
      }
    }
    fsaSheet.getRange(2, 5, colERows.length, 1).setValues(colERows);
  }

  // Inject dynamic SSOT formulas into Col F (Audit Result) and Col G (Audited Setup Points) ONLY
  const fgFormulas = [];
  for (let i = 0; i < numTeams; i++) {
    const r = i + 2;
    const fResult = (typeof getFieldSetupAuditResultFormula === 'function')
      ? getFieldSetupAuditResultFormula(r)
      : `=IF(D${r}>0, IF(E${r}>=D${r}, "Met All Obligations", "Incomplete / Missed"), IF(E${r}>0, "Volunteer Setup Completed", "No Setup Required"))`;

    const fPoints = (typeof getFieldSetupAuditedPointsFormula === 'function')
      ? getFieldSetupAuditedPointsFormula(r)
      : `=IF(D${r}>0, IF(E${r}>=D${r}, ${setupCap}, 0), MIN(${setupCap}, E${r}))`;

    fgFormulas.push([fResult, fPoints]);
  }

  if (fgFormulas.length > 0) {
    fsaSheet.getRange(2, 6, fgFormulas.length, 2).setValues(fgFormulas);
    if (fsaSheet.autoResizeColumns) {
      try { fsaSheet.autoResizeColumns(1, headers[0].length); } catch (e) {}
    }
  }

  return {
    status: 'ok',
    teamsAudited: fgFormulas.length
  };
}

/**
 * Reconstructs each team's First Game Setup Obligations (<= 11/01) from Season_Master_Schedule
 * when Column D in Field_Setup_Audit has been wiped to zeroes.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {Object.<string, number>} Map of canonicalComparisonKey_(teamCode) -> obligation count
 */
function computeFirstGameSetupObligations_(ss) {
  const obligations = {};
  if (!ss || typeof ss.getSheetByName !== 'function') return obligations;

  const scheduleSheet = ss.getSheetByName('Season_Master_Schedule');
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  if (!scheduleSheet || scheduleSheet.getLastRow() < 2) return obligations;

  // Build canonical team lookup and Division+CoachLastName lookup
  const canonicalLookup = {};
  const coachLastLookup = {};
  const sourceSheet = awardsSheet || ledgerSheet;
  if (sourceSheet && sourceSheet.getLastRow() > 1) {
    const tData = sourceSheet.getDataRange().getValues();
    const isLedger = (sourceSheet === ledgerSheet);
    for (let i = 1; i < tData.length; i++) {
      if (!isLedger && typeof isLegacyTeamAwardLogRow_ === 'function' && isLegacyTeamAwardLogRow_(tData[i])) continue;
      const teamCode = String(tData[i][isLedger ? 1 : 0] || '').trim();
      if (!teamCode) continue;
      const cKey = canonicalComparisonKey_(teamCode);
      canonicalLookup[cKey] = teamCode;

      const parts = teamCode.split(' - ');
      if (parts.length >= 3) {
        const divRaw = parts[0].trim().replace(/^0+/, '');
        const gender = parts[1].trim().charAt(0).toUpperCase();
        const coachWords = parts[2].trim().split(/\s+/);
        const lastName = coachWords[coachWords.length - 1].toUpperCase();
        coachLastLookup[`${gender}U${divRaw.replace('U', '')}_${lastName}`] = cKey;
        coachLastLookup[`${gender}${divRaw}_${lastName}`] = cKey;
      }
    }
  }

  const schedData = scheduleSheet.getDataRange().getValues();
  if (schedData.length < 2) return obligations;
  const header = schedData[0].map(h => String(h || '').trim());
  const idxDate = header.indexOf('Date') !== -1 ? header.indexOf('Date') : 1;
  const idxTime = header.indexOf('Time') !== -1 ? header.indexOf('Time') : 2;
  const idxDiv = header.indexOf('Division') !== -1 ? header.indexOf('Division') : 4;
  const idxField = header.indexOf('Field') !== -1 ? header.indexOf('Field') : 8;
  const idxHome = header.indexOf('Home Team') !== -1 ? header.indexOf('Home Team') : 10;
  const idxCanceled = header.indexOf('Canceled');
  const idxPostponed = header.indexOf('Postponed');

  // Helper to resolve a raw schedule team string to canonical comparison key
  function resolveHomeTeamKey(rawHome, rawDiv, row) {
    // Check helper columns AR:AT (indices 43..45) first if present
    for (let c = 43; c <= 45; c++) {
      if (row.length > c && row[c]) {
        const candKey = canonicalComparisonKey_(String(row[c]));
        if (canonicalLookup[candKey]) return candKey;
      }
    }
    const directKey = canonicalComparisonKey_(rawHome);
    if (canonicalLookup[directKey]) return directKey;

    const cleanHome = String(rawHome || '').trim().replace(/^E154-/i, '');
    const hWords = cleanHome.split(/[\s\-]+/).filter(Boolean);
    const lastWord = hWords.length > 0 ? hWords[hWords.length - 1].toUpperCase() : '';
    const dNorm = String(rawDiv || '').trim().toUpperCase().replace(/^0+/, '');
    if (lastWord && dNorm) {
      if (coachLastLookup[`${dNorm}_${lastWord}`]) return coachLastLookup[`${dNorm}_${lastWord}`];
      const m = dNorm.match(/^(\d+U)\s*-\s*([BG])/i);
      if (m) {
        const k1 = `${m[2].toUpperCase()}U${m[1].replace(/U/i, '')}_${lastWord}`;
        if (coachLastLookup[k1]) return coachLastLookup[k1];
      }
    }
    return '';
  }

  // Group valid games <= 2026-11-01 by (dateKey, fieldKey) and find earliest game on each field/day
  const earliestByDateField = {};
  for (let i = 1; i < schedData.length; i++) {
    const r = schedData[i];
    if (idxCanceled !== -1 && String(r[idxCanceled] || '').toUpperCase() === 'Y') continue;
    if (idxPostponed !== -1 && String(r[idxPostponed] || '').toUpperCase() === 'Y') continue;

    const dateKey = extractDateOnlyKey_(r[idxDate]);
    if (!dateKey || dateKey > '2026-11-01' || dateKey < '2026-08-01') continue;

    const rawField = String(r[idxField] || '').trim();
    if (!rawField || /BYE/i.test(rawField)) continue;

    const timeVal = r[idxTime];
    let sortableTime = '99:99:99';
    if (typeof normalizeTimeSortable === 'function') {
      sortableTime = normalizeTimeSortable(timeVal);
    } else {
      const tStr = formatTimeSafe_(timeVal);
      const m = String(tStr).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (m) {
        let hh = parseInt(m[1], 10);
        const mer = m[3] ? m[3].toUpperCase() : '';
        if (mer === 'PM' && hh < 12) hh += 12;
        if (mer === 'AM' && hh === 12) hh = 0;
        sortableTime = ('0' + hh).slice(-2) + ':' + m[2] + ':00';
      }
    }

    const fieldKey = `${dateKey}|${rawField.toUpperCase().replace(/\s+/g, ' ')}`;
    if (!earliestByDateField[fieldKey] || sortableTime < earliestByDateField[fieldKey].sortableTime) {
      earliestByDateField[fieldKey] = {
        sortableTime: sortableTime,
        row: r,
        rawHome: String(r[idxHome] || '').trim(),
        rawDiv: String(r[idxDiv] || '').trim()
      };
    }
  }

  Object.keys(earliestByDateField).forEach(fk => {
    const item = earliestByDateField[fk];
    const cKey = resolveHomeTeamKey(item.rawHome, item.rawDiv, item.row);
    if (!cKey) return;
    const canonicalTeam = canonicalLookup[cKey] || item.rawHome;
    // Playground, 05U, and 06U do not have scheduled 5-pt opening field setup obligations
    if (/playground|schoolyard|\b0?[56]u\b|\b[bg]u0?[56]\b/i.test(canonicalTeam)) return;
    obligations[cKey] = (obligations[cKey] || 0) + 1;
  });

  return obligations;
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
  const checkinsSheet = getGameDayCheckinsSheet(ss);
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
 * Automatic Form Submit Trigger Handler for Game Day Check-ins.
 * Immediately audits new check-in rows and updates Season_Master_Ledger without manual intervention.
 */
function onFormSubmit(e) {
  return runAuditAndSyncLedger();
}

/**
 * Installs automated triggers (`onFormSubmit` for instant check-in processing and hourly backup)
 * and removes any legacy manual-push triggers.
 */
function installAutomatedAuditTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'runAuditAndSyncLedger' || fn === 'onFormSubmit' || fn === 'pushPendingSubmissionsOnly') {
      ScriptApp.deleteTrigger(t);
    }
  });
  if (ss) {
    ScriptApp.newTrigger('onFormSubmit')
      .forSpreadsheet(ss)
      .onFormSubmit()
      .create();
  }
  ScriptApp.newTrigger('runAuditAndSyncLedger')
    .timeBased()
    .everyHours(1)
    .create();
  if (ss && ss.toast) {
    ss.toast('✅ Automated Form Submit & Hourly Audit Triggers installed!', 'AYSO 154 Automation', 5);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runAuditAndSyncLedger,
    repairLedgerAndLockBackfill,
    injectTraceableLedgerFormulas,
    injectFormulasIntoLedger_,
    syncFieldSetupAuditTab,
    computeFirstGameSetupObligations_,
    onFormSubmit,
    installAutomatedAuditTriggers,
    runAutomatedDisputeAndScheduleAudit,
    getDisputeAuditSummary_,
    extractDateOnlyKey_,
    extractLastNameTokens_
  };
}
