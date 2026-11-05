# AYSO Region 154 - Core Volunteer Apps Script Architecture (Offline Analysis Copy)
- **Export Date:** 2026-10-27 06:14:51
- **Mode:** Read-Only Audit Export (Zero Production Modifications)
- **Total Modules Included:** 12

## Table of Contents
- [appsscript.json](#appsscriptjson) — *(16 lines)*
- [AuditEngine.js](#auditenginejs) — *(519 lines)*
- [Code.js](#codejs) — *(594 lines)*
- [ScheduleSyncEngine.js](#schedulesyncenginejs) — *(400 lines)*
- [TeamAwards.js](#teamawardsjs) — *(42 lines)*
- [ExecutiveSummary.js](#executivesummaryjs) — *(201 lines)*
- [ScheduleLogTrigger.js](#schedulelogtriggerjs) — *(21 lines)*
- [AuditHighlighter.js](#audithighlighterjs) — *(267 lines)*
- [AYSO154_Playoff_Audit.js](#ayso154_playoff_auditjs) — *(1888 lines)*
- [AdminConfig.js](#adminconfigjs) — *(165 lines)*
- [BoardApp.js](#boardappjs) — *(293 lines)*
- [BoardPortal.html](#boardportalhtml) — *(560 lines)*

---

## appsscript.json
```json
{
  "timeZone": "America/Los_Angeles",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/forms",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

---

## AuditEngine.js
```javascript
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
  const checkinsSheet = getGameDayCheckinsSheet(ss);
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

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
  const checkinsSheet = getGameDayCheckinsSheet(ss);
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

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

  injectTraceableLedgerFormulas(checkinsSheet.getName());
  SpreadsheetApp.flush();
}

/**
 * Injects native Google Sheets formulas across Columns D through W for all 116 teams in Season_Master_Ledger.
 */
function injectTraceableLedgerFormulas(checkinsTabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  if (!ledgerSheet) return;

  // Formulas must point at whichever check-ins tab is live (Game Day Check-ins / Form Responses 3 / Form Responses 1)
  const tabName = checkinsTabName || (getGameDayCheckinsSheet(ss) || { getName: () => 'Game Day Check-ins' }).getName();
  const ci = `'${tabName.replace(/'/g, "''")}'`;

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
      `=MIN(10, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Referee"))`, // Col D: Ref
      `=MIN(2, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Field Marshal"))`, // Col E: FM
      `=MIN(5, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "Field Set Up"))`, // Col F: Setup
      `=MIN(2, SUMIFS(${ci}!$Y:$Y, ${ci}!$AA:$AA, $B${r}, ${ci}!$D:$D, "*Pic*") + SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$D:$D))`, // Col G: Pic Day
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
```

---

## Code.js
```javascript
/**
 * ============================================================================
 * AYSO REGION 154 CYPRESS — GAME DAY HUB & VOLUNTEER DASHBOARD API (Code.gs)
 * Version: 4.5.0 (Full 3-Section Sync + Team_Awards Log Injection + Auto-Audit Menu)
 * ============================================================================
 */

const CONFIG = {
  SHEETS: {
    CHECKINS: 'Game Day Check-ins',
    FALLBACK_CHECKINS: 'Form Responses 3',
    LEGACY_CHECKINS: 'Form Responses 1',
    DISPUTES: 'Form Responses 2',
    LEDGER: 'Season_Master_Ledger',
    AWARDS: 'Team_Awards',
    SCHEDULE: 'Season_Master_Schedule',
    ADMIN: 'Admin_Config',
    SETTINGS: 'Settings',
    DISPUTE_REPORT: 'Dispute_Audit_Report'
  },
  CAPS: {
    REFEREE: 10,
    FIELD_MARSHAL: 2,
    FIELD_SETUP: 5,
    PICTURE_DAY: 2,
    CERTIFIED_REF: 5,
    MATCHTRAK_BONUS: 2,
    PLAYOFF_GOAL: 17
  }
};

/**
 * Returns the live check-ins tab: 'Game Day Check-ins', else 'Form Responses 3', else 'Form Responses 1'.
 * Declared here (not in a feature file) because Code.js, AuditEngine.js, BoardApp.js,
 * ExecutiveSummary.js, Mock_Submissions.js and Test_Suite.js all call it.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] defaults to the active spreadsheet
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getGameDayCheckinsSheet(ss) {
  const targetSs = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!targetSs) return null;
  return targetSs.getSheetByName(CONFIG.SHEETS.CHECKINS) ||
         targetSs.getSheetByName(CONFIG.SHEETS.FALLBACK_CHECKINS) ||
         targetSs.getSheetByName(CONFIG.SHEETS.LEGACY_CHECKINS);
}

/**
 * True for Team_Awards rows written in the old append-log layout
 * [Timestamp, TeamCode, AwardType, Points, Note, Author] — i.e. a date in Col A.
 * The live layout is one row per team with the Team Code in Col A.
 */
function isLegacyTeamAwardLogRow_(row) {
  const a = row ? row[0] : '';
  if (Object.prototype.toString.call(a) === '[object Date]') return true;
  return /^\d{4}-\d{2}-\d{2}/.test(String(a || '').trim());
}

/**
 * Adds custom administrative menu on spreadsheet open.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚽ AYSO 154 Board Tools')
    .addItem('🔄 Run Full Audit & Sync Ledger', 'runAuditAndSyncLedger')
    .addItem('🕵️‍♂️ Audit Dispute Tickets & MatchTrak Cross-Check', 'runAutomatedDisputeAndScheduleAudit')
    .addSeparator()
    .addItem('📅 Sync Form Schedule Dropdowns', 'syncContainerFormSchedule')
    .addItem('🛠️ Repair Ledger Roster & Lock Legacy Backfill', 'repairLedgerAndLockBackfill')
    .addItem('⏰ Enable Automated Hourly Audit Trigger', 'installAutomatedAuditTriggers')
    .addItem('🧹 Migrate Legacy Team_Awards Log Rows', 'migrateLegacyTeamAwardLogRows')
    .addToUi();

  if (typeof addDiagnosticsMenu_ === 'function') {
    addDiagnosticsMenu_();
  }
}

/**
 * Main WebApp GET Endpoint — powers Public Coach Dashboard & Board Control Panel.
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = String(params.action || 'dashboard').toLowerCase();

    if (action === 'board' || params.view === 'board') {
      if (typeof renderBoardApp === 'function') {
        return renderBoardApp(e);
      }
    }

    // index.html sends ?action=getDirectory and ?action=getTeamStats&teamCode=...
    const teamParam = params.teamCode || params.team || '';

    let payload;
    if (action === 'getdirectory' || action === 'directory') {
      payload = getDirectoryData();
    } else if (action === 'getboardledger') {
      payload = getBoardLedgerData();
    } else if ((action === 'getteamstats' || action === 'team') && teamParam) {
      payload = getTeamStatsData(teamParam);
    } else if (action === 'disputes') {
      payload = getDisputeAuditSummary_();
    } else {
      // Full Dashboard Payload (supports single-fetch frontend architecture)
      payload = buildFullDashboardPayload_(teamParam);
    }

    const jsonString = JSON.stringify(payload);

    // Support JSONP callback if requested
    if (params.callback) {
      return ContentService.createTextOutput(`${params.callback}(${jsonString})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService.createTextOutput(jsonString)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    const errorPayload = {
      status: 'error',
      message: err.message,
      stack: err.stack,
      syncTimestamp: new Date().toISOString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorPayload))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Main WebApp POST Endpoint — handles manual sync triggers or Board Award overrides.
 */
function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
    const action = String(body.action || '').toLowerCase();

    if (action === 'sync' || action === 'audit') {
      const result = runAuditAndSyncLedger();
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', result: result }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'override') {
      if (typeof applyBoardAwardOverride !== 'function' || typeof getBoardUserSession !== 'function') {
        throw new Error('Board override handler not installed (BoardApp.gs missing).');
      }
      // The web app runs as ANYONE_ANONYMOUS, so draft mode (empty allowlist) must not
      // open point overrides to the internet: require a signed-in, allowlisted board user.
      const session = getBoardUserSession();
      if (session.isDraftMode || !session.isAuthorized || !Session.getActiveUser().getEmail()) {
        throw new Error('Unauthorized: overrides require a signed-in account on the Admin_Config allowlist.');
      }
      const result = applyBoardAwardOverride(body.teamCode, body.awardType, body.points, body.note);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', result: result }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'No action specified' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Normalizes team strings so "08U" vs "8U", middle dots, and minor coach typos resolve identically.
 */
function normalizeTeamKey_(rawTeam) {
  if (!rawTeam) return '';
  let s = String(rawTeam).trim();
  if (!s) return '';

  // Standardize separators (middle dot, em-dash, en-dash -> " - ")
  s = s.replace(/\s*[·•—–]\s*/g, ' - ');
  s = s.replace(/\s+-\s+/g, ' - ');
  s = s.replace(/\bCoach\s+/gi, '');

  // Fix known coach spelling variations between Form and Ledger
  s = s.replace(/Brennen\s+Portalski/gi, 'Brennen Poralski');
  if (/^06U\s*-\s*Boys\s*-\s*Brennen\s+Poralski$/i.test(s)) {
    s = '06U - Boys - Brennen Portalski';
  }
  s = s.replace(/Lucky\s+Realtor/gi, 'Lucky Relator');
  s = s.replace(/Dustin\s+Breiger/gi, 'Dustin Brieger');

  return s.trim();
}

/**
 * Builds a lookup key stripping leading zeros on divisions (e.g., "08U" == "8U") for fuzzy matching.
 */
function canonicalComparisonKey_(teamStr) {
  const norm = normalizeTeamKey_(teamStr).toLowerCase();
  return norm.replace(/^0+(\d+u)/i, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * Formats display division names without leading zero if preferred on UI, while keeping exact keys.
 */
function cleanDivisionLabel_(divStr) {
  return String(divStr || '').trim();
}

/**
 * Builds the complete payload for the Public Coach Dashboard (all teams, directory, categories, and logs).
 */
function buildFullDashboardPayload_(requestedTeam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName(CONFIG.SHEETS.LEDGER);
  const awardsSheet = ss.getSheetByName(CONFIG.SHEETS.AWARDS);
  const checkinsSheet = getGameDayCheckinsSheet(ss);

  if (!ledgerSheet) {
    throw new Error('Season_Master_Ledger sheet not found.');
  }

  // 1. Read Team_Awards into a Map by canonical comparison key
  const awardsMap = {};
  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    const awardsData = awardsSheet.getDataRange().getValues();
    for (let i = 1; i < awardsData.length; i++) {
      const r = awardsData[i];
      if (isLegacyTeamAwardLogRow_(r)) continue;
      const tCode = String(r[0] || '').trim();
      if (!tCode) continue;
      const cKey = canonicalComparisonKey_(tCode);
      awardsMap[cKey] = {
        teamCode: tCode,
        preSeasonRefs: Math.min(CONFIG.CAPS.CERTIFIED_REF, Number(r[1]) || 0),
        matchTrakBonus: Math.min(CONFIG.CAPS.MATCHTRAK_BONUS, Number(r[2]) || 0),
        pictureDay: Math.min(CONFIG.CAPS.PICTURE_DAY, Number(r[3]) || 0),
        adjustment: Number(r[4]) || 0,
        reason: String(r[5] || '').trim(),
        grantedBy: String(r[6] || 'Board Admin').trim(),
        lastUpdated: r[7] ? formatDateSafe_(r[7]) : 'Season Award'
      };
    }
  }

  // 2. Read all Game Day Check-ins and group by canonical team key
  const checkinsByTeam = {};
  if (checkinsSheet && checkinsSheet.getLastRow() > 1) {
    const ciData = checkinsSheet.getDataRange().getValues();
    for (let i = 1; i < ciData.length; i++) {
      const row = ciData[i];
      const role = String(row[3] || '').trim(); // Col D: Volunteer Role
      const refPos = String(row[4] || '').trim(); // Col E: Referee Position

      // Skip NOCRA / USSF paid referee rows on public team logs
      const auditStatus = String(row[23] || '').trim(); // Col X
      if (auditStatus === 'NOCRA - No Points' || refPos.toUpperCase().includes('NOCRA')) {
        continue;
      }

      // Coalesce Team from Credited Team (Col AA, idx 26), Legacy Backfill (Col AB, idx 27), or Dropdowns (Cols N-V, idx 13-21)
      let rawTeam = String(row[26] || '').trim() || String(row[27] || '').trim();
      if (!rawTeam) {
        for (let c = 13; c <= 21; c++) {
          if (String(row[c] || '').trim() !== '') {
            rawTeam = String(row[c]).trim();
            break;
          }
        }
      }
      if (!rawTeam || rawTeam.toUpperCase().includes('NOCRA')) continue;

      const cKey = canonicalComparisonKey_(rawTeam);
      if (!checkinsByTeam[cKey]) {
        checkinsByTeam[cKey] = [];
      }

      const firstName = String(row[1] || '').trim();
      const lastName = String(row[2] || '').trim();
      const volunteerName = formatPrivacyName_(firstName, lastName);
      const timestampStr = formatDateSafe_(row[0]);
      const pointsAwarded = Number(row[24]) || 0; // Col Y
      const auditReason = String(row[25] || '').trim(); // Col Z

      // Extract location/field context for display note
      const fieldOrMatch = extractShiftDetail_(row, role, refPos);

      checkinsByTeam[cKey].push({
        timestamp: timestampStr,
        date: timestampStr,
        volunteer: volunteerName,
        role: normalizeRoleLabel_(role),
        duty: normalizeRoleLabel_(role) + (fieldOrMatch ? ` (${fieldOrMatch})` : ''),
        status: auditStatus || (pointsAwarded > 0 ? 'Recorded' : 'Pending'),
        points: pointsAwarded,
        reason: auditReason || fieldOrMatch,
        note: auditReason || fieldOrMatch,
        source: 'QR Check-In'
      });
    }
  }

  // 3. Read Season_Master_Ledger (Cols A-W) to build unified Teams & Directory objects
  const ledgerData = ledgerSheet.getDataRange().getValues();
  const teams = {};
  const directory = {};
  const seenTeams = new Set();

  for (let i = 1; i < ledgerData.length; i++) {
    const row = ledgerData[i];
    const division = cleanDivisionLabel_(row[0]);
    const teamCode = String(row[1] || '').trim();
    const headCoach = String(row[2] || '').trim();

    if (!teamCode || teamCode.toUpperCase().includes('NOCRA')) continue;

    const cKey = canonicalComparisonKey_(teamCode);
    if (seenTeams.has(cKey)) continue; // Guard against any duplicate rows
    seenTeams.add(cKey);

    // Category Points directly from verified Season_Master_Ledger formulas (Cols D-J)
    const refPts = Math.min(CONFIG.CAPS.REFEREE, Number(row[3]) || 0);
    const fmPts = Math.min(CONFIG.CAPS.FIELD_MARSHAL, Number(row[4]) || 0);
    const setupPts = Math.min(CONFIG.CAPS.FIELD_SETUP, Number(row[5]) || 0);
    const picPts = Math.min(CONFIG.CAPS.PICTURE_DAY, Number(row[6]) || 0);
    const certRefPts = Math.min(CONFIG.CAPS.CERTIFIED_REF, Number(row[7]) || 0);
    const matchTrakPts = Math.min(CONFIG.CAPS.MATCHTRAK_BONUS, Number(row[8]) || 0);
    const otherAdjPts = Number(row[9]) || 0;

    // Total Verified Points (Col K) — guaranteed equal to sum of D..J
    const totalPoints = refPts + fmPts + setupPts + picPts + certRefPts + matchTrakPts + otherAdjPts;
    const playoffGoal = Number(row[11]) || CONFIG.CAPS.PLAYOFF_GOAL;

    // Build synthetic Check-In Log items from Team_Awards so Bottom Section matches Top & Middle
    const awardObj = awardsMap[cKey] || {
      teamCode: teamCode,
      preSeasonRefs: certRefPts,
      matchTrakBonus: matchTrakPts,
      pictureDay: picPts,
      adjustment: otherAdjPts,
      reason: 'Board Verified Credit',
      grantedBy: 'Board Admin',
      lastUpdated: 'Season Award'
    };

    const awardLogEntries = getTeamAwardsLogEntries_(awardObj, picPts, certRefPts, matchTrakPts, otherAdjPts);
    const qrLogEntries = checkinsByTeam[cKey] || [];

    // Combine QR check-ins (newest first) + Team_Awards entries at the bottom of the log
    const combinedAuditLog = qrLogEntries.slice().reverse().concat(awardLogEntries);

    // Categories dictionary. The canonical keys are the ones index.html activeCats
    // and Contract_Tests.js read: Referee Assignment, Field Marshal Shift,
    // Friday Night Field Setup, Saturday Field Setup, Picture Day,
    // Certified Team Referees, Early Ref Scheduling Incentive, Other Adjustments.
    const categories = {
      'Referee Assignment': refPts,
      'Referee (On-Field)': refPts,
      'Referee': refPts,
      'Early Ref Scheduling Incentive': matchTrakPts,
      'MatchTrak Compliance': matchTrakPts,
      'MatchTrak Bonus': matchTrakPts,
      'Field Marshal Shift': fmPts,
      'Field Marshal': fmPts,
      'Friday Night Field Setup': setupPts,
      'Saturday Field Setup': setupPts,
      'Friday Night Setup': setupPts,
      'Field Setup': setupPts,
      'Field Set Up': setupPts,
      'Picture Day': picPts,
      'Picture Picnic Day': picPts,
      'Certified Team Referees': certRefPts,
      'Certified Ref Bonus': certRefPts,
      'Administrative Adjustment': otherAdjPts,
      'Other Adjustments': otherAdjPts,
      'Admin Bonus / Adjustments (Cert Refs + Adj)': certRefPts + otherAdjPts
    };

    const teamObj = {
      division: division,
      teamCode: teamCode,
      coach: headCoach,
      headCoach: headCoach,
      totalPoints: totalPoints,
      playoffGoal: playoffGoal,
      pointsNeeded: Math.max(0, playoffGoal - totalPoints),
      eligibilityStatus: String(row[20] || ''),
      actionDirective: String(row[21] || ''),
      lastAudited: formatDateSafe_(row[22]),
      categories: categories,
      categoryBreakdown: [
        { label: 'Referee (On-Field)', earned: refPts, max: CONFIG.CAPS.REFEREE },
        { label: 'Certified Ref Bonus', earned: certRefPts, max: CONFIG.CAPS.CERTIFIED_REF },
        { label: 'Early Ref Scheduling Incentive', earned: matchTrakPts, max: CONFIG.CAPS.MATCHTRAK_BONUS },
        { label: 'Field Setup', earned: setupPts, max: CONFIG.CAPS.FIELD_SETUP },
        { label: 'Field Marshal', earned: fmPts, max: CONFIG.CAPS.FIELD_MARSHAL },
        { label: 'Picture Picnic Day', earned: picPts, max: CONFIG.CAPS.PICTURE_DAY },
        ...(otherAdjPts !== 0 ? [{ label: 'Administrative Adjustment', earned: otherAdjPts, max: otherAdjPts }] : [])
      ],
      audit: combinedAuditLog,
      logs: combinedAuditLog
    };

    teams[teamCode] = teamObj;

    // Also index without leading zero (e.g., "8U - Boys - ...") so any URL param lookup succeeds
    const noZeroKey = teamCode.replace(/^0+(\d+U)/i, '$1');
    if (noZeroKey !== teamCode) {
      teams[noZeroKey] = teamObj;
    }

    if (!directory[division]) {
      directory[division] = [];
    }
    directory[division].push({
      teamCode: teamCode,
      coach: headCoach,
      label: `${division} · Coach ${headCoach}`,
      totalPoints: totalPoints,
      playoffGoal: playoffGoal
    });
  }

  // If a single team was requested, attach its top-level properties for backwards compatibility
  let selectedTeamData = null;
  if (requestedTeam) {
    const reqKey = canonicalComparisonKey_(requestedTeam);
    for (const k in teams) {
      if (canonicalComparisonKey_(k) === reqKey) {
        selectedTeamData = teams[k];
        break;
      }
    }
  }

  return {
    status: 'ok',
    syncTimestamp: new Date().toISOString(),
    PlayoffThreshold: CONFIG.CAPS.PLAYOFF_GOAL,
    RefMaxCap: CONFIG.CAPS.REFEREE,
    directory: directory,
    teams: teams,
    ...(selectedTeamData ? {
      teamCode: selectedTeamData.teamCode,
      totalPoints: selectedTeamData.totalPoints,
      playoffGoal: selectedTeamData.playoffGoal,
      categories: selectedTeamData.categories,
      categoryBreakdown: selectedTeamData.categoryBreakdown,
      audit: selectedTeamData.audit,
      logs: selectedTeamData.logs
    } : {})
  };
}

/**
 * Returns data for a single team (used when ?action=team&team=... is called).
 */
function getTeamStatsData(teamName) {
  return buildFullDashboardPayload_(teamName);
}

/**
 * Returns the division/team directory dictionary.
 */
function getDirectoryData() {
  const full = buildFullDashboardPayload_('');
  return {
    status: 'ok',
    syncTimestamp: full.syncTimestamp,
    directory: full.directory
  };
}

/**
 * Flat team list for board.html (?action=getBoardLedger). Same numbers as the
 * public dashboard; status is 'Qualified' | 'In Progress' | 'At-Risk'.
 */
function getBoardLedgerData() {
  const full = buildFullDashboardPayload_('');
  const seen = new Set();
  const teams = [];

  Object.keys(full.teams).forEach(key => {
    const t = full.teams[key];
    if (seen.has(t.teamCode)) return; // skip the no-leading-zero alias keys
    seen.add(t.teamCode);

    let status = 'In Progress';
    if (t.totalPoints >= t.playoffGoal) {
      status = 'Qualified';
    } else if (/CRITICAL|ACTION REQUIRED/i.test(t.eligibilityStatus)) {
      status = 'At-Risk';
    }

    teams.push({
      division: t.division,
      teamCode: t.teamCode,
      headCoach: t.headCoach,
      verifiedPoints: t.totalPoints,
      playoffGoal: t.playoffGoal,
      refPoints: t.categories['Referee Assignment'],
      fmPoints: t.categories['Field Marshal Shift'],
      status: status,
      isCompetitive: t.playoffGoal >= CONFIG.CAPS.PLAYOFF_GOAL,
      lastAudited: t.lastAudited
    });
  });

  return {
    status: 'ok',
    syncTimestamp: full.syncTimestamp,
    teams: teams
  };
}

/**
 * Generates Check-In Log entries for a team's verified awards in Team_Awards
 * so the Bottom Section Check-In Log sums to the exact Top Section total.
 */
function getTeamAwardsLogEntries_(awardObj, picPts, certRefPts, matchTrakPts, otherAdjPts) {
  const logs = [];
  const teamCode = awardObj.teamCode || '';
  const grantedBy = awardObj.grantedBy || 'Board Admin';
  const lastUpdated = awardObj.lastUpdated || 'Season Award';
  const customReason = awardObj.reason || 'Board Verified Credit';

  if (certRefPts > 0) {
    logs.push({
      timestamp: lastUpdated,
      date: lastUpdated,
      volunteer: grantedBy,
      role: 'Certified Ref Bonus',
      duty: `Certified Ref Bonus (${certRefPts} Rostered Ref${certRefPts > 1 ? 's' : ''})`,
      points: certRefPts,
      status: 'Recorded',
      reason: `Pre-season certified referee bonus (+${certRefPts} pt${certRefPts > 1 ? 's' : ''})`,
      note: `Pre-season certified referee bonus (+${certRefPts} pt${certRefPts > 1 ? 's' : ''})`,
      team: teamCode,
      source: 'Team_Awards'
    });
  }

  if (matchTrakPts > 0) {
    logs.push({
      timestamp: lastUpdated,
      date: lastUpdated,
      volunteer: grantedBy,
      role: 'Early Ref Scheduling Incentive',
      duty: 'Early Ref Scheduling Incentive (MatchTrak Bonus)',
      points: matchTrakPts,
      status: 'Recorded',
      reason: `MatchTrak schedule compliance bonus (+${matchTrakPts} pts)`,
      note: `MatchTrak schedule compliance bonus (+${matchTrakPts} pts)`,
      team: teamCode,
      source: 'Team_Awards'
    });
  }

  if (picPts > 0) {
    logs.push({
      timestamp: lastUpdated,
      date: lastUpdated,
      volunteer: grantedBy,
      role: 'Picture Picnic Day',
      duty: 'Picture Picnic Day Volunteer Credit',
      points: picPts,
      status: 'Recorded',
      reason: `Picture Day tent check-in credit (+${picPts} pt${picPts > 1 ? 's' : ''})`,
      note: `Picture Day tent check-in credit (+${picPts} pt${picPts > 1 ? 's' : ''})`,
      team: teamCode,
      source: 'Team_Awards'
    });
  }

  if (otherAdjPts !== 0) {
    const sign = otherAdjPts > 0 ? '+' : '';
    logs.push({
      timestamp: lastUpdated,
      date: lastUpdated,
      volunteer: grantedBy,
      role: 'Administrative Adjustment',
      duty: `Admin Adjustment (${customReason})`,
      points: otherAdjPts,
      status: 'Recorded',
      reason: `${customReason} (${sign}${otherAdjPts} pt${Math.abs(otherAdjPts) !== 1 ? 's' : ''})`,
      note: `${customReason} (${sign}${otherAdjPts} pt${Math.abs(otherAdjPts) !== 1 ? 's' : ''})`,
      team: teamCode,
      source: 'Team_Awards'
    });
  }

  return logs;
}

/**
 * Formats volunteer name for public scoreboard privacy (e.g., "Steve A.").
 */
function formatPrivacyName_(first, last) {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  if (!f && !l) return 'Volunteer';
  if (!l) return f;
  return `${f} ${l.charAt(0).toUpperCase()}.`;
}

/**
 * Standardizes role names for clean UI badges.
 */
function normalizeRoleLabel_(rawRole) {
  const r = String(rawRole || '').trim();
  if (/referee/i.test(r)) return 'Referee (On-Field)';
  if (/marshal/i.test(r)) return 'Field Marshal';
  if (/set\s*up/i.test(r)) return 'Field Setup';
  if (/pic/i.test(r)) return 'Picture Picnic Day';
  return r || 'Volunteer Shift';
}

/**
 * Extracts match or field details from a check-in row.
 */
function extractShiftDetail_(row, role, refPos) {
  // Match selections in Cols G, H, I (indices 6, 7, 8) or Field in Col L (idx 11) or Shift Time in Col K (idx 10)
  const matchLJHS = String(row[6] || '').trim();
  const matchParkLex = String(row[7] || '').trim();
  const matchLuther = String(row[8] || '').trim();
  const shiftTime = formatTimeSafe_(row[10]);
  const fieldName = String(row[11] || '').trim();

  const matchStr = matchLJHS || matchParkLex || matchLuther;
  if (/referee/i.test(role)) {
    const shortPos = /assistant/i.test(refPos) ? 'AR' : (/center|referee/i.test(refPos) ? 'Center Ref' : refPos);
    return [shortPos, matchStr || fieldName].filter(Boolean).join(' · ');
  }
  if (/marshal/i.test(role)) {
    const venue = String(row[9] || row[5] || '').trim();
    return [venue, shiftTime].filter(Boolean).join(' · ');
  }
  if (/set\s*up/i.test(role)) {
    return fieldName || 'Field Setup Shift';
  }
  return fieldName || matchStr || '';
}

/**
 * Safely formats dates/timestamps.
 */
function formatDateSafe_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
  }
  return String(val).trim();
}

/**
 * Safely formats shift time values from Sheets.
 */
function formatTimeSafe_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'America/Los_Angeles', 'h:mm a');
  }
  return String(val).trim();
}
```

---

## ScheduleSyncEngine.js
```javascript
/**
 * ============================================================================
 * AYSO REGION 154 — SCHEDULE SYNC ENGINE (ScheduleSyncEngine.gs)
 * Version: build_20261021_v5 (Strict Fri–Sun Window; Excludes Thursday Outliers)
 * ============================================================================
 */

const SCHEDULE_CONFIG = {
  DRIVE_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  SCHEDULE_TAB_NAME: 'Master_Schedule',
  SEASON_SCHEDULE_TAB_NAME: 'Season_Master_Schedule',
  SYNC_LOG_TAB_NAME: 'Schedule_Sync_Log',
  TIMEZONE: 'America/Los_Angeles',
  MIN_GAMES_THRESHOLD: 5,
  UNLISTED_MATCH_OPTION: '⚠️ Other / Rescheduled / Unlisted Match'
};

/**
 * Resolves the upcoming Friday–Sunday date window (excludes Thursday outliers).
 * @return {{dates: string[], isOverride: boolean, startYMD: string}}
 */
function resolveUpcomingWeekendDates() {
  let overrideDateStr = null;
  try {
    const settings = (typeof getAdminConfigSettings === 'function') ? getAdminConfigSettings() : {};
    overrideDateStr = settings.TargetWeekendStart || null;
  } catch (e) {}

  if (overrideDateStr) {
    const startYMD = normalizeToYMD(overrideDateStr);
    if (startYMD) {
      const parts = startYMD.split('-');
      const start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return {
        dates: [
          startYMD, // Friday
          Utilities.formatDate(new Date(start.getTime() + 86400000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'),  // Saturday
          Utilities.formatDate(new Date(start.getTime() + 172800000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd') // Sunday
        ],
        isOverride: true,
        startYMD: startYMD
      };
    }
  }

  const now = new Date();
  const dayStr = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'u'); // 1 = Mon ... 7 = Sun
  const dayOfWeek = parseInt(dayStr, 10);

  let daysToFri = 0;
  if (dayOfWeek <= 4) daysToFri = 5 - dayOfWeek;
  else if (dayOfWeek === 5) daysToFri = 0;
  else if (dayOfWeek === 6) daysToFri = -1;
  else if (dayOfWeek === 7) daysToFri = -2;

  const nowYMD = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
  const baseMidnight = new Date(Number(nowYMD[0]), Number(nowYMD[1]) - 1, Number(nowYMD[2]));
  const fri = new Date(baseMidnight.getTime() + (daysToFri * 86400000));
  const sat = new Date(fri.getTime() + 86400000);
  const sun = new Date(fri.getTime() + 172800000);

  return {
    dates: [
      Utilities.formatDate(fri, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'), // Friday
      Utilities.formatDate(sat, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'), // Saturday
      Utilities.formatDate(sun, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd')  // Sunday
    ],
    isOverride: false,
    startYMD: Utilities.formatDate(fri, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd')
  };
}

/**
 * Main automated/manual entry point:
 * Finds newest schedule CSV in Drive, filters to Fri–Sun only, updates Master_Schedule,
 * merges into Season_Master_Schedule, and updates live Google Form dropdown lists.
 */
function autoIngestWeeklySchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = DriveApp.getFolderById(SCHEDULE_CONFIG.DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const fileList = [];

  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName().toLowerCase();
    if (name.endsWith('.csv') || f.getMimeType() === MimeType.CSV || f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      fileList.push(f);
    }
  }

  if (fileList.length === 0) {
    Logger.log('ABORTED: No schedule files found in Drive folder.');
    return;
  }

  // Sort newest first
  fileList.sort(function(a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

  const weekendWindow = resolveUpcomingWeekendDates();
  const latestFile = fileList[0];
  const parsedRaw = extractDataFromFile(latestFile);
  const filteredData = filterScheduleForTargetWeekend(parsedRaw, weekendWindow.dates);
  const totalMatches = filteredData.length - 1;

  if (totalMatches < SCHEDULE_CONFIG.MIN_GAMES_THRESHOLD) {
    const msg = `ABORTED: Found only ${totalMatches} games for ${weekendWindow.dates.join(', ')}. Minimum threshold is ${SCHEDULE_CONFIG.MIN_GAMES_THRESHOLD}.`;
    Logger.log(msg);
    logScheduleSyncEvent(latestFile.getName(), weekendWindow.startYMD, totalMatches, 0, 0, 0, 'ABORTED_LOW_COUNT');
    return;
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(filteredData);
  const startDateLabel = weekendWindow.dates[0];
  const endDateLabel = weekendWindow.dates[weekendWindow.dates.length - 1];

  try {
    const ui = SpreadsheetApp.getUi();
    const prompt = `TARGET DATES (Fri–Sun Only): ${startDateLabel} to ${endDateLabel}\n` +
                   `MATCHES IDENTIFIED (${totalMatches} total):\n` +
                   `• 🏟️ Park Lexington: ${parkLexMatches.length - 1}\n` +
                   `• 🏫 Luther Elementary: ${lutherMatches.length - 1}\n` +
                   `• 🏫 LJHS / Arnold: ${ljhsArnoldMatches.length - 1}\n\n` +
                   `⚠️ Overwrite "${SCHEDULE_CONFIG.SCHEDULE_TAB_NAME}" and update live Form dropdowns?`;
    const res = ui.alert('Confirm Live Game Day Sync', prompt, ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  } catch (e) {
    Logger.log('Headless/trigger execution detected — proceeding without UI prompt.');
  }

  // 1. Write filtered Fri–Sun schedule to Master_Schedule
  writeScheduleToSheet(ss, SCHEDULE_CONFIG.SCHEDULE_TAB_NAME, filteredData);

  // 2. Upsert into cumulative Season_Master_Schedule (by Game #)
  upsertSeasonMasterSchedule(ss, filteredData);

  // 3. Push venue match lists to live linked Google Form dropdowns
  updateLiveFormMatchDropdowns(ss, weekendWindow.dates, parkLexMatches, lutherMatches, ljhsArnoldMatches);

  // 4. Log sync event
  logScheduleSyncEvent(
    latestFile.getName(),
    weekendWindow.startYMD,
    totalMatches,
    parkLexMatches.length - 1,
    lutherMatches.length - 1,
    ljhsArnoldMatches.length - 1,
    'SUCCESS'
  );
}

/**
 * Extracts 2D array from CSV or Google Sheet file.
 */
function extractDataFromFile(file) {
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  const csvText = file.getBlob().getDataAsString();
  return Utilities.parseCsv(csvText);
}

/**
 * Filters raw CSV rows so ONLY rows matching targetDates (Fri, Sat, Sun) and non-BYE fields remain.
 */
function filterScheduleForTargetWeekend(rawRows, targetDates) {
  if (!rawRows || rawRows.length === 0) return [];
  const header = rawRows[0];
  const dateIdx = header.indexOf('Date');
  const fieldIdx = header.indexOf('Field');
  if (dateIdx === -1) throw new Error('Schedule CSV is missing "Date" column.');

  const dateSet = {};
  for (let i = 0; i < targetDates.length; i++) {
    dateSet[targetDates[i]] = true;
  }

  const out = [header];
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const rowDate = normalizeToYMD(row[dateIdx]);
    const fieldVal = fieldIdx !== -1 ? String(row[fieldIdx] || '').toUpperCase() : '';
    if (rowDate && dateSet[rowDate] && fieldVal.indexOf('BYE') === -1) {
      const cloned = row.slice();
      cloned[dateIdx] = rowDate;
      out.push(cloned);
    }
  }
  return out;
}

/**
 * Builds formatted dropdown strings grouped by the 3 venue dropdowns on the Game Day Form.
 */
function buildScheduleDropdownOptionsByVenue(filteredData) {
  const parkLexMatches = [];
  const lutherMatches = [];
  const ljhsArnoldMatches = [];

  if (!filteredData || filteredData.length < 2) {
    return {
      parkLexMatches: [SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION],
      lutherMatches: [SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION],
      ljhsArnoldMatches: [SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION]
    };
  }

  const h = filteredData[0];
  const idxDate = h.indexOf('Date');
  const idxTime = h.indexOf('Time');
  const idxDiv = h.indexOf('Division');
  const idxField = h.indexOf('Field');
  const idxHome = h.indexOf('Home Team');
  const idxAway = h.indexOf('Away Team');
  const idxCanceled = h.indexOf('Canceled');
  const idxPostponed = h.indexOf('Postponed');

  // Sort chronologically by Date + Time + Field
  const body = filteredData.slice(1).sort(function(a, b) {
    const da = String(a[idxDate] || '') + ' ' + normalizeTimeSortable(a[idxTime]);
    const db = String(b[idxDate] || '') + ' ' + normalizeTimeSortable(b[idxTime]);
    if (da !== db) return da < db ? -1 : 1;
    return String(a[idxField] || '').localeCompare(String(b[idxField] || ''));
  });

  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    if (idxCanceled !== -1 && String(row[idxCanceled] || '').toUpperCase() === 'Y') continue;
    if (idxPostponed !== -1 && String(row[idxPostponed] || '').toUpperCase() === 'Y') continue;

    const rawField = String(row[idxField] || '');
    if (!rawField || rawField.toUpperCase().indexOf('BYE') !== -1) continue;

    const dayLabel = formatDayAbbrev(row[idxDate]);
    const timeLabel = formatTime12Hr(row[idxTime]);
    const shortField = formatShortFieldName(rawField);
    const divLabel = formatShortDivision(row[idxDiv]);
    const homeShort = formatShortTeamName(row[idxHome]);
    const awayShort = formatShortTeamName(row[idxAway]);

    const optionStr = `🗓️ ${dayLabel} • ⏰ ${timeLabel} • 📍 ${shortField} • ⚽ ${divLabel}: ${homeShort} vs ${awayShort}`;

    const upperField = rawField.toUpperCase();
    if (upperField.indexOf('PARK LEX') !== -1) {
      if (parkLexMatches.indexOf(optionStr) === -1) parkLexMatches.push(optionStr);
    } else if (upperField.indexOf('LUTHER') !== -1) {
      if (lutherMatches.indexOf(optionStr) === -1) lutherMatches.push(optionStr);
    } else if (upperField.indexOf('LEXINGTON JHS') !== -1 || upperField.indexOf('LJHS') !== -1 || upperField.indexOf('ARNOLD') !== -1) {
      if (ljhsArnoldMatches.indexOf(optionStr) === -1) ljhsArnoldMatches.push(optionStr);
    }
  }

  parkLexMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);
  lutherMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);
  ljhsArnoldMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);

  return { parkLexMatches, lutherMatches, ljhsArnoldMatches };
}

/**
 * Updates the 3 venue match dropdown questions on the linked Google Form.
 */
function updateLiveFormMatchDropdowns(ss, weekendDates, parkLexMatches, lutherMatches, ljhsArnoldMatches) {
  const formUrl = ss.getFormUrl();
  if (!formUrl) {
    Logger.log('No linked Google Form found on this spreadsheet.');
    return;
  }

  const form = FormApp.openByUrl(formUrl);
  const items = form.getItems(FormApp.ItemType.LIST);
  const dateRangeBadge = formatWeekendBadge(weekendDates);

  for (let i = 0; i < items.length; i++) {
    const listItem = items[i].asListItem();
    const title = listItem.getTitle();
    if (title.indexOf('Select Match') === -1) continue;

    if (title.indexOf('Park Lex') !== -1) {
      listItem.setTitle(`Select Match - 🏟️ Park Lex (${dateRangeBadge})`);
      listItem.setChoiceValues(parkLexMatches);
    } else if (title.indexOf('Luther') !== -1) {
      listItem.setTitle(`Select Match - 🏫 Luther Elementary (${dateRangeBadge})`);
      listItem.setChoiceValues(lutherMatches);
    } else if (title.indexOf('Lexington Junior High') !== -1 || title.indexOf('LJHS') !== -1) {
      listItem.setTitle(`Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary (${dateRangeBadge})`);
      listItem.setChoiceValues(ljhsArnoldMatches);
    }
  }
}

/**
 * Writes filtered schedule to Master_Schedule tab.
 */
function writeScheduleToSheet(ss, sheetName, data) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  if (data && data.length > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
}

/**
 * Upserts filtered weekend matches into cumulative Season_Master_Schedule by Game #.
 */
function upsertSeasonMasterSchedule(ss, filteredData) {
  if (!filteredData || filteredData.length < 2) return;
  let seasonSheet = ss.getSheetByName(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
  if (!seasonSheet) {
    seasonSheet = ss.insertSheet(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
    seasonSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
    return;
  }

  const existing = seasonSheet.getDataRange().getValues();
  if (existing.length < 1) {
    seasonSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
    return;
  }

  const header = existing[0];
  const gameNumIdx = header.indexOf('Game #');
  if (gameNumIdx === -1) return;

  const rowMap = {};
  for (let r = 1; r < existing.length; r++) {
    const gNum = String(existing[r][gameNumIdx] || '').trim();
    if (gNum) rowMap[gNum] = r;
  }

  for (let i = 1; i < filteredData.length; i++) {
    const newRow = filteredData[i];
    const gNum = String(newRow[gameNumIdx] || '').trim();
    if (gNum && rowMap.hasOwnProperty(gNum)) {
      existing[rowMap[gNum]] = newRow;
    } else {
      existing.push(newRow);
    }
  }

  seasonSheet.clearContents();
  seasonSheet.getRange(1, 1, existing.length, existing[0].length).setValues(existing);
}

/**
 * Appends a row to Schedule_Sync_Log.
 */
function logScheduleSyncEvent(sourceFile, weekendStart, totalRows, parkLexCount, lutherCount, ljhsArnoldCount, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName(SCHEDULE_CONFIG.SYNC_LOG_TAB_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(SCHEDULE_CONFIG.SYNC_LOG_TAB_NAME);
    logSheet.appendRow(['Timestamp', 'Source File', 'Weekend Start', 'Total Rows', 'Park Lex Games', 'Luther Games', 'LJHS/Arnold Games', 'Status']);
  }
  const ts = Utilities.formatDate(new Date(), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  logSheet.appendRow([ts, sourceFile, weekendStart, totalRows, parkLexCount, lutherCount, ljhsArnoldCount, status]);
}

/* ==================== FORMATTING HELPERS ==================== */

function normalizeToYMD(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mdy) {
    const mm = ('0' + mdy[1]).slice(-2);
    const dd = ('0' + mdy[2]).slice(-2);
    const yyyy = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function formatDayAbbrev(ymd) {
  const norm = normalizeToYMD(ymd);
  if (!norm) return '';
  const p = norm.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Utilities.formatDate(d, SCHEDULE_CONFIG.TIMEZONE, 'EEE');
}

function normalizeTimeSortable(val) {
  if (!val) return '00:00:00';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, SCHEDULE_CONFIG.TIMEZONE, 'HH:mm:ss');
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return ('0' + m[1]).slice(-2) + ':' + m[2] + ':00';
  return s;
}

function formatTime12Hr(val) {
  const norm = normalizeTimeSortable(val);
  const m = norm.match(/^(\d{2}):(\d{2})/);
  if (!m) return String(val || '');
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = hh >= 12 ? 'PM' : 'AM';
  if (hh === 0) hh = 12;
  else if (hh > 12) hh = hh - 12;
  return `${hh}:${mm} ${ampm}`;
}

function formatShortFieldName(rawField) {
  const f = String(rawField || '');
  const upper = f.toUpperCase();
  if (upper.indexOf('PARK LEX') !== -1) {
    return upper.indexOf('TURF') !== -1 ? 'Park Lex Turf' : 'Park Lex Grass';
  }
  if (upper.indexOf('LUTHER') !== -1) {
    const m = f.match(/Field\s*(\d+)/i);
    return m ? `Luther Field ${m[1]}` : 'Luther';
  }
  if (upper.indexOf('ARNOLD') !== -1) {
    const m = f.match(/Field\s*(\d+)/i);
    return m ? `Arnold Field ${m[1]}` : 'Arnold';
  }
  if (upper.indexOf('LEXINGTON JHS') !== -1 || upper.indexOf('LJHS') !== -1) {
    const m = f.match(/Field\s*(\d+)/i);
    return m ? `LJHS Field ${m[1]}` : 'LJHS';
  }
  return f;
}

function formatShortDivision(rawDiv) {
  const d = String(rawDiv || '').trim().toUpperCase();
  const m = d.match(/^([BG])U(\d{1,2})$/);
  if (m) {
    const age = ('0' + m[2]).slice(-2) + 'U';
    return `${age}-${m[1]}`;
  }
  return d;
}

function formatShortTeamName(rawTeam) {
  const t = String(rawTeam || '').trim();
  return t.replace(/^E154-/i, '');
}

function formatWeekendBadge(dates) {
  if (!dates || dates.length === 0) return '';
  const first = dates[0].split('-');
  const last = dates[dates.length - 1].split('-');
  const dStart = new Date(Number(first[0]), Number(first[1]) - 1, Number(first[2]));
  const monthAbbrev = Utilities.formatDate(dStart, SCHEDULE_CONFIG.TIMEZONE, 'MMM');
  return `${monthAbbrev} ${parseInt(first[2], 10)}-${parseInt(last[2], 10)}`;
}
```

---

## TeamAwards.js
```javascript
/**
 * AYSO Region 154 - Team Awards & Point Overrides Engine
 * Connects manual board adjustments to the public dashboard and audit log.
 */

function getTeamStatsWithAwards(targetTeam) {
  return getTeamStatsData(targetTeam);
}

function setTeamAward(teamCode, awardType, points, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Team_Awards');
  if (!sheet) {
    sheet = ss.insertSheet('Team_Awards');
    sheet.appendRow(['Timestamp', 'TeamCode', 'AwardType', 'Points', 'Note', 'Author']);
    sheet.getRange('A1:F1').setFontWeight('bold').setBackground('#0F2537').setFontColor('#FFFFFF');
  }

  const author = Session.getActiveUser().getEmail() || 'Board Admin';
  const pts = Number(points);
  sheet.appendRow([new Date(), teamCode, awardType, pts, note, author]);
  SpreadsheetApp.flush();

  return { success: true };
}

function getAllTeamAwards(targetTeam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Team_Awards');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getDataRange().getValues();
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] === targetTeam) {
      results.push({
        timestamp: row[0],
        teamCode: row[1],
        awardType: row[2],
        points: Number(row[3]) || 0,
        note: row[4],
        author: row[5]
      });
    }
  }

  return results;
}
```

---

## ExecutiveSummary.js
```javascript
/**
 * ============================================================================
 * AYSO REGION 154 - EXECUTIVE BOARD SUMMARY & KPI ENGINE
 * ============================================================================
 * File: ExecutiveSummary.gs
 * Description: Generates and formats the dedicated 'Executive_Summary' tab inside
 *              the production Google Sheet to provide the board with an instant
 *              read-only snapshot of submission counts, venue coverage, verification
 *              status, and volunteer points breakdown.
 * ============================================================================
 */

const EXECUTIVE_SUMMARY_SHEET = "Executive_Summary";

/**
 * Builds or refreshes the dedicated Executive Summary tab in the active or target spreadsheet.
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [targetSpreadsheet] Optional spreadsheet instance
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The formatted Executive Summary sheet
 */
function setupExecutiveSummarySheet(targetSpreadsheet) {
  const ss = targetSpreadsheet || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (!ss) {
    if (typeof Logger !== 'undefined') Logger.log("No spreadsheet available to build Executive Summary tab.");
    return null;
  }

  const brandNavy = "#002D62";
  const brandLightBg = "#F8FAFC";
  const brandHeaderBg = "#002D62";
  const brandHeaderTxt = "#FFFFFF";
  const brandSubheaderBg = "#E2E8F0";
  const brandSubheaderTxt = "#002D62";

  let sheet = ss.getSheetByName(EXECUTIVE_SUMMARY_SHEET) || ss.getSheetByName("Executive Summary");
  if (!sheet) {
    sheet = ss.insertSheet(EXECUTIVE_SUMMARY_SHEET);
  }

  // Clear existing content and formats
  sheet.clear();
  sheet.clearFormats();

  // Set visual column widths
  sheet.setColumnWidth(1, 380); // A: Category / Metric Label
  sheet.setColumnWidth(2, 160); // B: Primary Count / Value
  sheet.setColumnWidth(3, 200); // C: Share / Points / Sub-metric
  sheet.setColumnWidth(4, 280); // D: Notes / Qualification Status

  // Row 1: Main Title Banner
  sheet.getRange("A1:D1").merge()
    .setValue("AYSO REGION 154 — EXECUTIVE BOARD VOLUNTEER SUMMARY")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(13)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // Row 2: Live Dashboard Link & Dynamic Status Banner
  sheet.getRange("A2:D2").merge()
    .setValue("📊 Public Volunteer Dashboard: https://webmasterayso154.github.io/volunteer-dashboard/   •   Status: Live Automated Sync")
    .setBackground(brandLightBg)
    .setFontColor(brandNavy)
    .setFontStyle("italic")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 24);

  // Freeze top 2 banner rows
  sheet.setFrozenRows(2);

  // ==========================================================================
  // SECTION 1: KEY PERFORMANCE INDICATORS (KPIs)
  // ==========================================================================
  sheet.getRange("A4:D4").merge()
    .setValue("1. CHECK-IN VOLUME & AUDIT VERIFICATION STATUS")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A5:D5")
    .setValues([["Metric Description", "Submissions Count", "Metric Share", "Operational Status"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const targetCheckInTab = (ss && typeof ss.getSheetByName === 'function' && ss.getSheetByName('Form Responses 1') && !ss.getSheetByName('Game Day Check-ins'))
    ? 'Form Responses 1'
    : 'Game Day Check-ins';

  const kpiData = [
    ["Total Volunteer Check-In Submissions", `=MAX(0, COUNTA('${targetCheckInTab}'!A2:A))`, "100.0%", "Raw intake from Google Form"],
    ["Verified & Clean Check-Ins (Audited)", `=COUNTIF('${targetCheckInTab}'!O2:O, "Verified")`, "=IF($B$6>0, B7/$B$6, 0)", "Credited towards team playoff points"],
    ["Pending / Recorded Submissions (Awaiting Audit)", `=COUNTIF('${targetCheckInTab}'!O2:O, "") + COUNTIF('${targetCheckInTab}'!O2:O, "Recorded")`, "=IF($B$6>0, B8/$B$6, 0)", "Under routine 48h board triage window"],
    ["Filtered Submissions (Duplicate / NOCRA / Cap Met)", `=COUNTIF('${targetCheckInTab}'!O2:O, "Duplicate*") + COUNTIF('${targetCheckInTab}'!O2:O, "NOCRA*") + COUNTIF('${targetCheckInTab}'!O2:O, "Cap Met*")`, "=IF($B$6>0, B9/$B$6, 0)", "Deduplicated or zero-point exceptions"],
    ["Total Verified Volunteer Points Logged", `=SUM('${targetCheckInTab}'!P2:P)`, "-", "Cumulative season points credited"]
  ];
  sheet.getRange("A6:D10").setValues(kpiData);

  // ==========================================================================
  // SECTION 2: VOLUNTEER ROLES & POINTS BREAKDOWN
  // ==========================================================================
  sheet.getRange("A12:D12").merge()
    .setValue("2. VOLUNTEER DUTIES & POINTS CONTRIBUTION")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A13:D13")
    .setValues([["Duty Category", "Submissions Count", "Points Awarded", "Official Category Cap Rule"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const rolesData = [
    ["Referee (Center Referee & Assistant Referee)", `=COUNTIF('${targetCheckInTab}'!E2:E, "*Referee*")`, `=SUMIFS('${targetCheckInTab}'!P2:P, '${targetCheckInTab}'!E2:E, "*Referee*")`, "Max 10 On-Field Ref Points/Team"],
    ["Field Marshal Shift", `=COUNTIF('${targetCheckInTab}'!E2:E, "*Field Marshal*")`, `=SUMIFS('${targetCheckInTab}'!P2:P, '${targetCheckInTab}'!E2:E, "*Field Marshal*")`, "Max 2 Field Marshal Points/Team"],
    ["Friday Night Field Setup & Takedown", `=COUNTIF('${targetCheckInTab}'!E2:E, "*Set Up*") + COUNTIF('${targetCheckInTab}'!E2:E, "*Setup*")`, `=SUMIFS('${targetCheckInTab}'!P2:P, '${targetCheckInTab}'!E2:E, "*Set*")`, "Max 1 Setup Point/Team (5 for U8/U6)"],
    ["Picture Day & Special Regional Events", `=COUNTIF('${targetCheckInTab}'!E2:E, "*Picture*")`, `=SUMIFS('${targetCheckInTab}'!P2:P, '${targetCheckInTab}'!E2:E, "*Picture*")`, "Max 2 Picture Day Points/Team"]
  ];
  sheet.getRange("A14:D17").setValues(rolesData);

  // ==========================================================================
  // SECTION 3: VENUE COVERAGE BREAKDOWN
  // ==========================================================================
  sheet.getRange("A19:D19").merge()
    .setValue("3. VENUE COVERAGE & DISTRIBUTION (MATCHTRAK ROUTING)")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A20:D20")
    .setValues([["Venue Complex", "Check-Ins Logged", "Coverage Share", "Active Dropdown Question Status"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const venueData = [
    ["🌲 Park Lexington (Denni & Cerritos)", `=COUNTIF('${targetCheckInTab}'!I2:I, "*Park Lex*") + COUNTIF('${targetCheckInTab}'!K2:K, "*Park Lex*") + COUNTIF('${targetCheckInTab}'!N2:N, "*Park Lex*")`, "=IF($B$6>0, B21/$B$6, 0)", "Turf & Grass Fields Synced"],
    ["🏫 Luther Elementary (U8/U10 Complex)", `=COUNTIF('${targetCheckInTab}'!I2:I, "*Luther*") + COUNTIF('${targetCheckInTab}'!K2:K, "*Luther*") + COUNTIF('${targetCheckInTab}'!N2:N, "*Luther*")`, "=IF($B$6>0, B22/$B$6, 0)", "Active with Zero-Game Fallback"],
    ["🏫 Lexington Junior High (LJHS) & Arnold", `=COUNTIF('${targetCheckInTab}'!I2:I, "*LJHS*") + COUNTIF('${targetCheckInTab}'!I2:I, "*Lexington*") + COUNTIF('${targetCheckInTab}'!I2:I, "*Arnold*") + COUNTIF('${targetCheckInTab}'!K2:K, "*LJHS*") + COUNTIF('${targetCheckInTab}'!K2:K, "*Arnold*") + COUNTIF('${targetCheckInTab}'!N2:N, "*LJHS*") + COUNTIF('${targetCheckInTab}'!N2:N, "*Arnold*")`, "=IF($B$6>0, B23/$B$6, 0)", "Fields #1–#10 & Overflow"]
  ];
  sheet.getRange("A21:D23").setValues(venueData);

  // ==========================================================================
  // SECTION 4: TEAM PLAYOFF QUALIFICATION SNAPSHOT
  // ==========================================================================
  sheet.getRange("A25:D25").merge()
    .setValue("4. TEAM PLAYOFF QUALIFICATION SNAPSHOT (SEASON MASTER LEDGER)")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A26:D26")
    .setValues([["Standings Qualification Tier", "Team Count", "Percentage of Teams", "Playoff Target Requirement"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const playoffData = [
    ["🏆 Qualified / Playoff Target Met", "=IF(ISREF(Season_Master_Ledger!E2:E), COUNTIF(Season_Master_Ledger!E2:E, \">= 17\"), 0)", "=IF($B$29>0, B27/$B$29, 0)", ">= 17 Points (Competitive Divisions)"],
    ["⏳ In Progress (Working Towards Target)", "=IF(ISREF(Season_Master_Ledger!E2:E), MAX(0, COUNTIF(Season_Master_Ledger!E2:E, \"< 17\") - COUNTIF(Season_Master_Ledger!E2:E, \"\")), 0)", "=IF($B$29>0, B28/$B$29, 0)", "< 17 Points (Active Volunteer Effort)"],
    ["📊 Total Teams Tracked in Master Ledger", "=IF(ISREF(Season_Master_Ledger!A2:A), MAX(0, COUNTA(Season_Master_Ledger!A2:A) - 1), 116)", "100.0%", "116 Master Roster Teams"]
  ];
  sheet.getRange("A27:D29").setValues(playoffData);

  // ==========================================================================
  // FORMATTING & STYLING PASS
  // ==========================================================================
  // Format numbers
  sheet.getRange("B6:B10").setNumberFormat("#,##0");
  sheet.getRange("C7:C9").setNumberFormat("0.0%");
  sheet.getRange("B14:C17").setNumberFormat("#,##0");
  sheet.getRange("B21:B23").setNumberFormat("#,##0");
  sheet.getRange("C21:C23").setNumberFormat("0.0%");
  sheet.getRange("B27:B29").setNumberFormat("#,##0");
  sheet.getRange("C27:C28").setNumberFormat("0.0%");

  // Alignments & Font styling
  sheet.getRange("A4:D29").setFontFamily("Arial");
  sheet.getRange("B6:C10").setHorizontalAlignment("center");
  sheet.getRange("B14:C17").setHorizontalAlignment("center");
  sheet.getRange("B21:C23").setHorizontalAlignment("center");
  sheet.getRange("B27:C29").setHorizontalAlignment("center");
  sheet.getRange("A6:A10").setFontWeight("bold");
  sheet.getRange("A14:A17").setFontWeight("bold");
  sheet.getRange("A21:A23").setFontWeight("bold");
  sheet.getRange("A27:A29").setFontWeight("bold");

  const borderStyle = (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.BorderStyle) ? SpreadsheetApp.BorderStyle.SOLID : null;
  sheet.getRange("A5:D10").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);
  sheet.getRange("A13:D17").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);
  sheet.getRange("A20:D23").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);
  sheet.getRange("A26:D29").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);

  if (typeof Logger !== 'undefined') {
    Logger.log("Executive Summary tab successfully constructed and formatted.");
  }

  return sheet;
}

/**
 * Alias for setupExecutiveSummarySheet for on-demand menu triggers.
 */
function refreshExecutiveSummaryTab() {
  const sheet = setupExecutiveSummarySheet();
  if (sheet && typeof SpreadsheetApp !== 'undefined') {
    try {
      SpreadsheetApp.getUi().alert("Executive Summary", "Executive Summary tab has been refreshed successfully!", SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      // Non-interactive context
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setupExecutiveSummarySheet,
    refreshExecutiveSummaryTab,
    EXECUTIVE_SUMMARY_SHEET
  };
}
```

---

## ScheduleLogTrigger.js
```javascript
/**
 * Call this function from whatever script triggers when a new file is dropped 
 * in the folder. Pass it the file name and the data array that was extracted.
 */
function logScheduleSyncEvent(fileName, parsedDataArray) {
  const syncLogSheetId = '1RWPNUjVeRRcHiI18b8_IzLn1RzKHG3hLJvIbZjWq6Bc'; // Your New Sheet ID
  const ss = SpreadsheetApp.openById(syncLogSheetId);
  let logTab = ss.getSheetByName('Schedule_Sync_Log');
  
  // Create the log tab if it doesn't exist
  if (!logTab) {
    logTab = ss.insertSheet('Schedule_Sync_Log');
    logTab.appendRow(['Timestamp', 'Trigger File Name', 'Status', 'Total Rows Parsed']);
    logTab.getRange("A1:D1").setFontWeight("bold");
  }

  const timestamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss');
  const rowsFound = parsedDataArray ? parsedDataArray.length : 0;
  let status = rowsFound > 5 ? "SUCCESS" : "WARNING - NO DATA";

  // Write to the log
  logTab.appendRow([timestamp, fileName, status, rowsFound]);
}
```

---

## AuditHighlighter.js
```javascript
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
```

---

## AYSO154_Playoff_Audit.js
```javascript
/**
 * Cypress AYSO Region 154 — Fall 2026 Volunteer Point Review
 *
 * Deploy this as a standalone Apps Script project. Run setupAuditSystem() once.
 * The script creates a mobile-friendly Google Form, normalized audit workbook,
 * submission automation, duplicate-challenge detection, emails, and dashboard.
 *
 * Design rule: one Head Coach/Team Manager submission per team per challenge.
 * A team may submit a later, genuinely different challenge. Exact repeats are
 * flagged through a challenge fingerprint instead of silently creating work.
 */

const AUDIT = Object.freeze({
  VERSION: '2026.09.10',
  TIME_ZONE: 'America/Los_Angeles',
  REGION_NAME: 'Cypress AYSO Region 154',
  SEASON: 'Fall 2026',
  FORM_TITLE: 'Cypress AYSO Region 154 — Volunteer Point Review',
  SPREADSHEET_NAME: 'AYSO 154 - 2026 Playoff Audit Responses',
  REQUIRED_POINTS: 17,
  MAX_SHIFTS_PER_CHALLENGE: 5,
  POSTING_DELAY_HOURS: 48,
  LOOKBACK_DAYS: 14,
  STANDARD_CUTOFF: '2026-11-08T17:00:00-08:00',
  FINAL_WINDOW_START: '2026-11-07T00:00:00-08:00',
  FINAL_WINDOW_END: '2026-11-10T23:59:59-08:00',
  FINAL_EXCEPTION_CUTOFF: '2026-11-11T12:00:00-08:00',
  FINAL_DECISION_DEADLINE: '2026-11-11T18:00:00-08:00',
  ELIGIBILITY_CERTIFICATION: '2026-11-12T12:00:00-08:00',
  POST_SEASON_START: '2026-11-13T00:00:00-08:00',
  EARLY_RECONCILIATION: '2026-11-01T17:00:00-08:00',
  SUPPORT_EMAIL: '', // Optional. Add a monitored Region email before deployment.
  SEND_EMAILS: true,
  BRAND_NAVY: '#002D62',
  BRAND_RED: '#C8102E',
  BRAND_LIGHT_BLUE: '#DBEAFE',
  BRAND_GOLD: '#F4C542',
  VENUES: [
    'Park Lexington Fields',
    'Lexington Jr. HS Fields',
    'Other / Regional Event'
  ],
  DIVISIONS: [
    '08U - Boys', '08U - Girls', '09U - Boys', '09U - Girls',
    '10U - Boys', '10U - Girls', '11U - Boys', '11U - Girls',
    '12U - Boys', '12U - Girls', '13U - Boys', '13U - Girls',
    '14U - Boys', '14U - Girls', '16U - Boys', '16U - Girls',
    '19U - Boys', '19U - Girls', 'EXTRA'
  ],
  // Verify these caps with the Board before launch. Edit here and rerun
  // refreshConfigurationSheet() if Region policy changes.
  CATEGORIES: [
    { name: 'Referee (Center / Assistant Referee)', cap: 10, defaultPoints: 1 },
    { name: 'Field Marshal', cap: 2, defaultPoints: 1 },
    { name: 'Friday Field Setup', cap: 1, defaultPoints: 1 },
    { name: 'Picture Day / Special Regional Event', cap: 2, defaultPoints: 1 },
    { name: 'Other Board-Approved Assignment', cap: '', defaultPoints: 1 }
  ]
});

const PROP = Object.freeze({
  FORM_ID: 'AUDIT_FORM_ID',
  SPREADSHEET_ID: 'AUDIT_SPREADSHEET_ID',
  FORM_BUILT_VERSION: 'AUDIT_FORM_BUILT_VERSION',
  NEXT_TICKET: 'AUDIT_NEXT_TICKET'
});

const SHEET = Object.freeze({
  RESPONSES: 'Audit Submissions',
  LEGACY_RESPONSES: 'Form Responses',
  QUEUE: 'Audit Queue',
  SHIFTS: 'Shift Details',
  TEAM_STATUS: 'Team Status',
  DASHBOARD: 'Dashboard',
  CONFIG: 'Configuration',
  LOG: 'Audit Log'
});

const QUEUE_HEADERS = [
  'Ticket ID', 'Received Timestamp', 'Challenge Fingerprint', 'Duplicate Of',
  'Concurrent Team Ticket?', 'Request Type', 'Workflow Status', 'Decision',
  'Priority', 'Timely?', 'Applicable Deadline', 'Submitter Name',
  'Submitter Role', 'Email', 'Cell Phone', 'Division', 'Team Code',
  'Head Coach', 'Current Verified Points', 'Points Needed', 'Shift Count',
  'Potential Points', 'Net Point Adjustment', 'Revised Team Total',
  'Qualification Result', 'Sibling / Multi-Team?', 'Possible Cross-Team Allocation?',
  'Sibling Details', 'Auditor Assigned', 'Physical Log Reference',
  'Auditor Notes', 'Missing Information', 'Decision Date',
  'Notification Status', 'Notification Timestamp', 'Form Response ID'
];

const SHIFT_HEADERS = [
  'Ticket ID', 'Shift Number', 'Team Code', 'Division', 'Shift Start',
  'Venue', 'Field / Location', 'Volunteer Full Name', 'Category',
  'Expected Points', 'Team Credited at Check-In', 'Evidence / Identifying Details',
  'Supporting Link', 'Shift Classification', 'Applicable Deadline',
  'Timely?', '48-Hour Posting Window Complete?', 'Shift Decision',
  'Approved Points', 'Physical Log Reference', 'Auditor Notes'
];

/** Primary deployment entry point. Safe to rerun. */
function setupAuditSystem() {
  validateConfiguration_();
  const ss = getOrCreateSpreadsheet_();
  ensureWorkbook_(ss);
  const form = getOrCreateForm_();

  if (PropertiesService.getScriptProperties().getProperty(PROP.FORM_BUILT_VERSION) !== AUDIT.VERSION) {
    if (form.getItems().length > 0) {
      throw new Error(
        'An existing form was found but its build version differs. To protect live responses, ' +
        'run rebuildAuditForm() intentionally or update AUDIT.VERSION only after reviewing changes.'
      );
    }
    buildAuditForm_(form);
    PropertiesService.getScriptProperties().setProperty(PROP.FORM_BUILT_VERSION, AUDIT.VERSION);
  }

  linkFormToSpreadsheet_(form, ss);
  installAuditTriggers_();
  refreshFormPhase();
  refreshDashboard();
  writeSetupReport_(ss, form);

  Logger.log('Form edit URL: ' + form.getEditUrl());
  Logger.log('Form respondent URL: ' + form.getPublishedUrl());
  Logger.log('Response workbook: ' + ss.getUrl());
}

/**
 * Deliberately rebuilds the questions in the existing form.
 * Existing response rows remain in the destination spreadsheet, but item
 * mappings may change. Use before launch or after making a backup.
 */
function rebuildAuditForm() {
  const form = getOrCreateForm_();
  for (let i = form.getItems().length - 1; i >= 0; i--) form.deleteItem(i);
  buildAuditForm_(form);
  PropertiesService.getScriptProperties().setProperty(PROP.FORM_BUILT_VERSION, AUDIT.VERSION);
  refreshFormPhase();
}

function buildAuditForm_(form) {
  form
    .setTitle(AUDIT.FORM_TITLE)
    .setDescription(formDescriptionForPhase_(new Date()))
    .setConfirmationMessage(
      'Thank you. Your volunteer point review request has been received.\n\n' +
      'A confirmation email will include your ticket number. Please do not submit the same ' +
      'challenge again. If the Board needs more information, reply to the confirmation email.'
    )
    .setAllowResponseEdits(false)
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setProgressBar(true)
    .setPublishingSummary(false)
    .setShowLinkToRespondAgain(false)
    .setShuffleQuestions(false)
    .setIsQuiz(false)
    .setPublished(true);

  // PAGE 1 — role gate.
  const role = form.addMultipleChoiceItem()
    .setTitle('What is your official role for this team?')
    .setHelpText('One rostered Head Coach or Team Manager should submit each team challenge.')
    .setRequired(true);

  // This PageBreakItem begins the threshold page. Role choices jump here.
  const thresholdPage = form.addPageBreakItem()
    .setTitle('Check the Team Dashboard First')
    .setHelpText('Teams at 17 verified points are already qualified and do not need a review.');

  const points = form.addListItem()
    .setTitle('How many verified points are currently shown for your team?')
    .setHelpText('Use the live dashboard total. Choose 17+ if the team has already qualified.')
    .setRequired(true);

  // PAGE 3 — team identity.
  const identityPage = form.addPageBreakItem()
    .setTitle('Team Leadership and Team Information')
    .setHelpText('Enter the information exactly as it appears in SportsConnect and the dashboard.');

  addRequiredText_(form, 'Submitter Full Name');
  addRequiredText_(form, 'SportsConnect Registered Email')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  addRequiredText_(form, 'Submitter Cell Phone Number')
    .setHelpText('Used only if the auditor needs clarification.');
  form.addListItem().setTitle('Division').setChoiceValues(AUDIT.DIVISIONS).setRequired(true);
  addRequiredText_(form, 'Team Number or Dashboard Code')
    .setHelpText('Example: 10UB-04. Use the exact code shown on the dashboard.');
  addRequiredText_(form, 'Head Coach Full Name');

  // PAGE 4 — first shift is always required.
  const shift1Page = form.addPageBreakItem()
    .setTitle('Missing Shift 1')
    .setHelpText('Provide the details needed to locate the physical or digital record.');
  addShiftQuestions_(form, 1, true);
  const more1 = addMoreShiftQuestion_(form, 2);

  const shift2Page = form.addPageBreakItem().setTitle('Missing Shift 2');
  addShiftQuestions_(form, 2, true);
  const more2 = addMoreShiftQuestion_(form, 3);

  const shift3Page = form.addPageBreakItem().setTitle('Missing Shift 3');
  addShiftQuestions_(form, 3, true);
  const more3 = addMoreShiftQuestion_(form, 4);

  const shift4Page = form.addPageBreakItem().setTitle('Missing Shift 4');
  addShiftQuestions_(form, 4, true);
  const more4 = addMoreShiftQuestion_(form, 5);

  const shift5Page = form.addPageBreakItem()
    .setTitle('Missing Shift 5')
    .setHelpText('Five is the maximum number of shifts in one consolidated challenge.');
  addShiftQuestions_(form, 5, true);

  // PAGE 9 — sibling and multi-team allocation check.
  const siblingPage = form.addPageBreakItem()
    .setTitle('Sibling and Multi-Team Check')
    .setHelpText('This helps locate points accidentally credited to another child or team.');
  form.addMultipleChoiceItem()
    .setTitle('Does any listed volunteer have a player on another Region 154 team?')
    .setChoiceValues(['No', 'Yes', 'Not sure'])
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('Sibling or Other-Team Details')
    .setHelpText('If Yes or Not sure, list the player name, division, team code, and coach if known.');

  // PAGE 10 — certification.
  const certificationPage = form.addPageBreakItem()
    .setTitle('Review and Certification')
    .setHelpText('Please confirm each statement before submitting.');
  const acknowledgments = [
    'I am the rostered Head Coach or Team Manager for this team.',
    'I checked the current team total on the live dashboard before submitting.',
    'I am submitting one consolidated request for this specific team challenge.',
    'Except for the final-game exception, I allowed 48 hours for each shift to post.',
    'The information is accurate to the best of my knowledge.'
  ];
  form.addCheckboxItem()
    .setTitle('Required acknowledgments')
    .setChoiceValues(acknowledgments)
    .setValidation(
      FormApp.createCheckboxValidation()
        .requireSelectExactly(acknowledgments.length)
        .setHelpText('Select all five acknowledgments to continue.')
        .build()
    )
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('Anything Else the Auditor Should Know?')
    .setHelpText('Optional. Do not repeat the shift details already entered.');

  // PAGE 11 — terminal role screen.
  const roleExitPage = form.addPageBreakItem()
    .setTitle('Please Coordinate Through Team Leadership')
    .setHelpText(
      'Thank you for volunteering. To keep the review process manageable and prevent duplicate ' +
      'requests, please send your information to your Head Coach or Team Manager. They can review ' +
      'the team total and submit one consolidated challenge through the private leadership link.'
    );

  // PAGE 12 — terminal qualified-team screen.
  const qualifiedExitPage = form.addPageBreakItem()
    .setTitle('Your Team Is Already Qualified')
    .setHelpText(
      'Your team has reached the 17 verified points required for post-season eligibility. ' +
      'Additional points do not change qualification or seeding, so no audit request is needed.'
    );

  // Branch wiring. A PageBreakItem's navigation setting applies to the page
  // immediately before that page break; choice-based navigation takes priority.
  role.setChoices([
    role.createChoice('Head Coach', thresholdPage),
    role.createChoice('Team Manager', thresholdPage),
    role.createChoice('Parent / Volunteer / Other', roleExitPage)
  ]);

  const pointChoices = [];
  for (let p = 0; p < AUDIT.REQUIRED_POINTS; p++) {
    pointChoices.push(points.createChoice(String(p), identityPage));
  }
  pointChoices.push(points.createChoice('17 or more — team is qualified', qualifiedExitPage));
  points.setChoices(pointChoices);

  more1.setChoices([
    more1.createChoice('Yes — add Shift 2', shift2Page),
    more1.createChoice('No — continue', siblingPage)
  ]);
  more2.setChoices([
    more2.createChoice('Yes — add Shift 3', shift3Page),
    more2.createChoice('No — continue', siblingPage)
  ]);
  more3.setChoices([
    more3.createChoice('Yes — add Shift 4', shift4Page),
    more3.createChoice('No — continue', siblingPage)
  ]);
  more4.setChoices([
    more4.createChoice('Yes — add Shift 5', shift5Page),
    more4.createChoice('No — continue', siblingPage)
  ]);

  // Completing Shift 5 proceeds linearly to sibling review.
  // Completing certification submits instead of displaying a terminal page.
  roleExitPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
  // Completing the role terminal page submits. The qualified page is last and
  // therefore submits naturally.
  qualifiedExitPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
}

function addRequiredText_(form, title) {
  return form.addTextItem().setTitle(title).setRequired(true);
}

function addMoreShiftQuestion_(form, nextNumber) {
  return form.addMultipleChoiceItem()
    .setTitle('Do you need to include another missing shift in this same challenge?')
    .setHelpText('Choose Yes only when it belongs to this same team review request.')
    .setRequired(true);
}

function addShiftQuestions_(form, number, required) {
  const prefix = 'Shift ' + number + ' — ';
  form.addDateTimeItem()
    .setTitle(prefix + 'Start Date and Approximate Time')
    .setHelpText('Use the scheduled start time or the closest time you remember.')
    .setRequired(required);
  form.addListItem()
    .setTitle(prefix + 'Venue')
    .setChoiceValues(AUDIT.VENUES)
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Field Number or Specific Location')
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Volunteer Full Name')
    .setHelpText('Use the name entered at the tent, QR check-in, or referee record.')
    .setRequired(required);
  form.addListItem()
    .setTitle(prefix + 'Category')
    .setChoiceValues(AUDIT.CATEGORIES.map(function (c) { return c.name; }))
    .setRequired(required);
  form.addListItem()
    .setTitle(prefix + 'Expected Points')
    .setChoiceValues(['1', '2', '3', '4', '5'])
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Team Credited at Check-In, if Known')
    .setHelpText('Leave blank if the volunteer selected this team or does not remember.');
  form.addParagraphTextItem()
    .setTitle(prefix + 'Evidence or Identifying Details')
    .setHelpText('Example: QR confirmation, match card, paper backup, field tent, or referee crew.')
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Supporting Documentation Link')
    .setHelpText(
      'Optional. Use a viewable link or reply to the ticket email with attachments. ' +
      'Do not place sensitive personal information in a publicly shared file.'
    );
}

/** Form submission trigger. */
function handleAuditFormSubmit(e) {
  if (!e || !e.response) throw new Error('This function must run from an installable Form submit trigger.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    processFormResponse_(e.response);
  } finally {
    lock.releaseLock();
  }
}

function processFormResponse_(response) {
  const ss = getAuditSpreadsheet_();
  const answers = responseMap_(response);
  const received = response.getTimestamp();
  const ticketId = nextTicketId_();
  const currentPoints = parseInt(String(answers['How many verified points are currently shown for your team?'] || '0'), 10) || 0;
  const teamCode = normalizeTeamCode_(answers['Team Number or Dashboard Code']);
  const division = clean_(answers.Division);
  const email = clean_(answers['SportsConnect Registered Email']);
  const shifts = extractShifts_(answers, ticketId, teamCode, division, received);
  const potentialPoints = shifts.reduce(function (sum, shift) { return sum + shift.expectedPoints; }, 0);
  const pointsNeeded = Math.max(0, AUDIT.REQUIRED_POINTS - currentPoints);
  const fingerprint = challengeFingerprint_(teamCode, shifts);
  const duplicateOf = findDuplicateTicket_(ss, fingerprint);
  const concurrent = findConcurrentTeamTicket_(ss, teamCode);
  const timing = summarizeTicketTiming_(shifts, received);
  const sibling = clean_(answers['Does any listed volunteer have a player on another Region 154 team?']);
  const missingInfo = findMissingInformation_(answers, shifts);

  let requestType = timing.requestType;
  let workflow = missingInfo ? 'Needs Information' : 'New';
  let decision = 'Pending';
  let priority = calculatePriority_(pointsNeeded, potentialPoints, received, timing, missingInfo);

  if (currentPoints >= AUDIT.REQUIRED_POINTS) {
    requestType = 'Already Qualified';
    workflow = 'Closed';
    decision = 'Not Needed — Team Already Qualified';
    priority = 'Closed';
  } else if (duplicateOf) {
    requestType = 'Duplicate Challenge';
    workflow = 'Closed';
    decision = 'Duplicate';
    priority = 'Closed';
  } else if (!timing.timely) {
    requestType = 'Untimely — Board Confirmation Required';
    workflow = 'Ready for Decision';
    decision = 'Pending';
    priority = 'Urgent Review';
  } else if (timing.hasTooRecentStandardShift) {
    workflow = 'Waiting — 48-Hour Posting Window';
  }

  const queueRow = objectToRow_(QUEUE_HEADERS, {
    'Ticket ID': ticketId,
    'Received Timestamp': received,
    'Challenge Fingerprint': fingerprint,
    'Duplicate Of': duplicateOf,
    'Concurrent Team Ticket?': concurrent ? 'Yes — ' + concurrent : 'No',
    'Request Type': requestType,
    'Workflow Status': workflow,
    'Decision': decision,
    'Priority': priority,
    'Timely?': timing.timely ? 'Yes' : 'No',
    'Applicable Deadline': timing.applicableDeadline,
    'Submitter Name': clean_(answers['Submitter Full Name']),
    'Submitter Role': clean_(answers['What is your official role for this team?']),
    'Email': email,
    'Cell Phone': clean_(answers['Submitter Cell Phone Number']),
    'Division': division,
    'Team Code': teamCode,
    'Head Coach': clean_(answers['Head Coach Full Name']),
    'Current Verified Points': currentPoints,
    'Points Needed': pointsNeeded,
    'Shift Count': shifts.length,
    'Potential Points': potentialPoints,
    'Net Point Adjustment': '',
    'Revised Team Total': currentPoints,
    'Qualification Result': currentPoints >= AUDIT.REQUIRED_POINTS ? 'Qualified' : 'Pending',
    'Sibling / Multi-Team?': sibling,
    'Possible Cross-Team Allocation?': sibling === 'Yes' || sibling === 'Not sure' ? 'Yes' : 'No',
    'Sibling Details': clean_(answers['Sibling or Other-Team Details']),
    'Auditor Assigned': '',
    'Physical Log Reference': '',
    'Auditor Notes': '',
    'Missing Information': missingInfo,
    'Decision Date': '',
    'Notification Status': '',
    'Notification Timestamp': '',
    'Form Response ID': response.getId()
  });

  appendRow_(ss.getSheetByName(SHEET.QUEUE), queueRow);
  shifts.forEach(function (shift) {
    appendRow_(ss.getSheetByName(SHEET.SHIFTS), objectToRow_(SHIFT_HEADERS, shift));
  });
  appendAuditLog_(ss, ticketId, 'Created', '', workflow, 'Automated intake');
  upsertTeamStatus_(ss, teamCode, division, currentPoints, ticketId, workflow);
  refreshDashboard();

  if (AUDIT.SEND_EMAILS && email) {
    sendAcknowledgment_(email, ticketId, teamCode, shifts.length, timing, workflow, duplicateOf, missingInfo);
    updateQueueNotification_(ss, ticketId, 'Acknowledgment Sent');
  }
}

function responseMap_(response) {
  const map = {};
  response.getItemResponses().forEach(function (itemResponse) {
    map[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });
  return map;
}

function extractShifts_(answers, ticketId, teamCode, division, received) {
  const shifts = [];
  for (let n = 1; n <= AUDIT.MAX_SHIFTS_PER_CHALLENGE; n++) {
    const prefix = 'Shift ' + n + ' — ';
    const start = answers[prefix + 'Start Date and Approximate Time'];
    if (!start) continue;
    const timing = classifyShiftTiming_(new Date(start), received);
    shifts.push({
      'Ticket ID': ticketId,
      'Shift Number': n,
      'Team Code': teamCode,
      'Division': division,
      'Shift Start': new Date(start),
      'Venue': clean_(answers[prefix + 'Venue']),
      'Field / Location': clean_(answers[prefix + 'Field Number or Specific Location']),
      'Volunteer Full Name': clean_(answers[prefix + 'Volunteer Full Name']),
      'Category': clean_(answers[prefix + 'Category']),
      'Expected Points': parseInt(answers[prefix + 'Expected Points'], 10) || 0,
      'Team Credited at Check-In': clean_(answers[prefix + 'Team Credited at Check-In, if Known']),
      'Evidence / Identifying Details': clean_(answers[prefix + 'Evidence or Identifying Details']),
      'Supporting Link': clean_(answers[prefix + 'Supporting Documentation Link']),
      'Shift Classification': timing.classification,
      'Applicable Deadline': timing.deadline,
      'Timely?': timing.timely ? 'Yes' : 'No',
      '48-Hour Posting Window Complete?': timing.postingWindowComplete ? 'Yes' : 'No',
      'Shift Decision': 'Pending',
      'Approved Points': '',
      'Physical Log Reference': '',
      'Auditor Notes': ''
    });
  }
  return shifts;
}

function classifyShiftTiming_(shiftStart, received) {
  const standardCutoff = new Date(AUDIT.STANDARD_CUTOFF);
  const finalStart = new Date(AUDIT.FINAL_WINDOW_START);
  const finalEnd = new Date(AUDIT.FINAL_WINDOW_END);
  const finalCutoff = new Date(AUDIT.FINAL_EXCEPTION_CUTOFF);
  const inFinalWindow = shiftStart >= finalStart && shiftStart <= finalEnd;
  const postingReady = received.getTime() >= shiftStart.getTime() + AUDIT.POSTING_DELAY_HOURS * 3600000;
  const lookbackDeadline = new Date(shiftStart.getTime() + AUDIT.LOOKBACK_DAYS * 86400000);
  const deadline = inFinalWindow
    ? finalCutoff
    : new Date(Math.min(lookbackDeadline.getTime(), standardCutoff.getTime()));
  const timely = received <= deadline && received >= shiftStart;

  let classification = inFinalWindow ? 'Final-Game Exception' : 'Standard Review';
  if (received < shiftStart) classification = 'Invalid — Future Shift';
  else if (!timely) classification = 'Untimely';
  else if (!inFinalWindow && !postingReady) classification = 'Waiting — 48-Hour Posting Window';

  return {
    classification: classification,
    requestType: inFinalWindow ? 'Final-Game Exception' : 'Standard Review',
    deadline: deadline,
    timely: timely,
    postingWindowComplete: postingReady || inFinalWindow,
    inFinalWindow: inFinalWindow
  };
}

function summarizeTicketTiming_(shifts, received) {
  if (!shifts.length) {
    return {
      requestType: 'Incomplete', timely: false, applicableDeadline: received,
      hasTooRecentStandardShift: false
    };
  }
  const allFinal = shifts.every(function (s) { return s['Shift Classification'] === 'Final-Game Exception'; });
  const anyFinal = shifts.some(function (s) { return s['Shift Classification'] === 'Final-Game Exception'; });
  const timely = shifts.every(function (s) { return s['Timely?'] === 'Yes'; });
  const deadline = shifts.reduce(function (earliest, s) {
    const d = new Date(s['Applicable Deadline']);
    return !earliest || d < earliest ? d : earliest;
  }, null);
  return {
    requestType: allFinal ? 'Final-Game Exception' : (anyFinal ? 'Mixed — Standard and Final-Game' : 'Standard Review'),
    timely: timely,
    applicableDeadline: deadline,
    hasTooRecentStandardShift: shifts.some(function (s) {
      return s['Shift Classification'] === 'Waiting — 48-Hour Posting Window';
    })
  };
}

function challengeFingerprint_(teamCode, shifts) {
  const parts = shifts.map(function (s) {
    return [
      dateKey_(s['Shift Start']),
      normalize_(s['Volunteer Full Name']),
      normalize_(s.Category),
      normalize_(s.Venue),
      normalize_(s['Field / Location'])
    ].join('|');
  }).sort();
  const raw = normalizeTeamCode_(teamCode) + '||' + parts.join('||');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 24);
}

function findDuplicateTicket_(ss, fingerprint) {
  if (!fingerprint) return '';
  const sheet = ss.getSheetByName(SHEET.QUEUE);
  const rows = dataObjects_(sheet);
  const match = rows.find(function (row) { return String(row['Challenge Fingerprint']) === fingerprint; });
  return match ? String(match['Ticket ID']) : '';
}

function findConcurrentTeamTicket_(ss, teamCode) {
  const openStatuses = ['New', 'Needs Information', 'Assigned', 'In Review', 'Ready for Decision', 'Waiting — 48-Hour Posting Window'];
  const rows = dataObjects_(ss.getSheetByName(SHEET.QUEUE));
  const match = rows.find(function (row) {
    return normalizeTeamCode_(row['Team Code']) === teamCode && openStatuses.indexOf(String(row['Workflow Status'])) >= 0;
  });
  return match ? String(match['Ticket ID']) : '';
}

function calculatePriority_(pointsNeeded, potentialPoints, received, timing, missingInfo) {
  if (missingInfo) return 'Needs Information';
  if (!timing.timely) return 'Urgent Review';
  if (timing.requestType.indexOf('Final-Game') >= 0) return 'Critical — Final Window';
  if (potentialPoints >= pointsNeeded && pointsNeeded <= 3) return 'High — Qualification Impact';
  const hoursLeft = (new Date(AUDIT.FINAL_DECISION_DEADLINE).getTime() - received.getTime()) / 3600000;
  return hoursLeft <= 72 ? 'High — Deadline Near' : 'Normal';
}

function findMissingInformation_(answers, shifts) {
  const missing = [];
  if (!clean_(answers['Team Number or Dashboard Code'])) missing.push('Team code');
  if (!clean_(answers['SportsConnect Registered Email'])) missing.push('Email');
  if (!shifts.length) missing.push('Shift details');
  shifts.forEach(function (s) {
    if (!s['Volunteer Full Name']) missing.push('Shift ' + s['Shift Number'] + ' volunteer name');
    if (!s.Venue) missing.push('Shift ' + s['Shift Number'] + ' venue');
  });
  return Array.from(new Set(missing)).join('; ');
}

function nextTicketId_() {
  const props = PropertiesService.getScriptProperties();
  const next = parseInt(props.getProperty(PROP.NEXT_TICKET) || '1', 10);
  props.setProperty(PROP.NEXT_TICKET, String(next + 1));
  return 'R154-2026-' + String(next).padStart(4, '0');
}

function sendAcknowledgment_(email, ticketId, teamCode, shiftCount, timing, workflow, duplicateOf, missingInfo) {
  let statusText = 'Your request is in the audit queue.';
  if (duplicateOf) statusText = 'This appears to duplicate ticket ' + duplicateOf + '. The Board will use the earlier ticket.';
  else if (!timing.timely) statusText = 'The request was received outside the applicable filing window and is pending a final timeliness decision.';
  else if (missingInfo) statusText = 'More information is needed: ' + missingInfo + '.';
  else if (workflow === 'Waiting — 48-Hour Posting Window') statusText = 'At least one standard shift is still inside the normal 48-hour posting window.';

  const subject = '[' + ticketId + '] Region 154 volunteer point review received';
  const body = [
    'Thank you. Your Region 154 volunteer point review request has been received.',
    '',
    'Ticket: ' + ticketId,
    'Team: ' + teamCode,
    'Shifts included: ' + shiftCount,
    'Request type: ' + timing.requestType,
    'Applicable deadline: ' + formatDateTime_(timing.applicableDeadline),
    '',
    statusText,
    '',
    'Please do not submit this same challenge again. If additional documentation is requested, reply to this email and keep the ticket number in the subject.',
    '',
    'Submission does not guarantee that points will be approved. The Board will compare the request with the official field, event, and referee records.',
    '',
    'Cypress AYSO Region 154'
  ].join('\n');
  const options = { name: AUDIT.REGION_NAME };
  if (AUDIT.SUPPORT_EMAIL) options.replyTo = AUDIT.SUPPORT_EMAIL;
  MailApp.sendEmail(email, subject, body, options);
}

/** Spreadsheet edit trigger: logs workflow/decision changes and sends decisions. */
function handleAuditQueueEdit(e) {
  if (!e || !e.range || e.range.getRow() < 2) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET.QUEUE) return;
  const headers = headerMap_(sheet);
  const editedHeader = sheet.getRange(1, e.range.getColumn()).getValue();
  if (['Workflow Status', 'Decision', 'Net Point Adjustment', 'Auditor Assigned'].indexOf(editedHeader) < 0) return;

  const row = rowObject_(sheet, e.range.getRow());
  appendAuditLog_(
    sheet.getParent(), String(row['Ticket ID']), editedHeader,
    typeof e.oldValue === 'undefined' ? '' : e.oldValue,
    typeof e.value === 'undefined' ? '' : e.value,
    Session.getActiveUser().getEmail() || 'Board editor'
  );

  if (editedHeader === 'Net Point Adjustment') {
    const adjustment = Number(row['Net Point Adjustment']) || 0;
    const revised = Math.min(AUDIT.REQUIRED_POINTS, Number(row['Current Verified Points']) + Math.max(0, adjustment));
    sheet.getRange(e.range.getRow(), headers['Revised Team Total']).setValue(revised);
    sheet.getRange(e.range.getRow(), headers['Qualification Result'])
      .setValue(revised >= AUDIT.REQUIRED_POINTS ? 'Qualified' : 'Not Qualified');
    upsertTeamStatus_(
      sheet.getParent(), normalizeTeamCode_(row['Team Code']), row.Division,
      revised, row['Ticket ID'], revised >= AUDIT.REQUIRED_POINTS ? 'Qualified' : row['Workflow Status']
    );
    if (['Approved', 'Partially Approved'].indexOf(String(row.Decision)) >= 0 &&
        row['Notification Status'] === 'Awaiting Net Point Adjustment') {
      if (AUDIT.SEND_EMAILS) sendDecisionEmail_(sheet, e.range.getRow(), headers);
      sheet.getRange(e.range.getRow(), headers['Workflow Status']).setValue('Closed');
      appendAuditLog_(sheet.getParent(), String(row['Ticket ID']), 'Workflow Status', row['Workflow Status'], 'Closed', 'Automated after adjustment');
    }
  }

  if (editedHeader === 'Decision' && String(e.value || '') !== 'Pending') {
    sheet.getRange(e.range.getRow(), headers['Decision Date']).setValue(new Date());
    const approvedDecision = ['Approved', 'Partially Approved'].indexOf(String(e.value)) >= 0;
    if (approvedDecision && row['Net Point Adjustment'] === '') {
      sheet.getRange(e.range.getRow(), headers['Notification Status']).setValue('Awaiting Net Point Adjustment');
    } else {
      if (String(e.value) !== 'Duplicate' && AUDIT.SEND_EMAILS) {
        sendDecisionEmail_(sheet, e.range.getRow(), headers);
      }
      sheet.getRange(e.range.getRow(), headers['Workflow Status']).setValue('Closed');
      appendAuditLog_(sheet.getParent(), String(row['Ticket ID']), 'Workflow Status', row['Workflow Status'], 'Closed', 'Automated after decision');
    }
  }
  refreshDashboard();
}

function sendDecisionEmail_(sheet, rowNumber, headers) {
  const row = rowObject_(sheet, rowNumber);
  const email = clean_(row.Email);
  if (!email || row['Notification Status'] === 'Decision Sent') return;
  const ticketId = row['Ticket ID'];
  const subject = '[' + ticketId + '] Region 154 volunteer point review decision';
  const body = [
    'The Board has completed its review of your volunteer point challenge.',
    '',
    'Ticket: ' + ticketId,
    'Team: ' + row['Team Code'],
    'Decision: ' + row.Decision,
    'Net point adjustment: ' + (row['Net Point Adjustment'] === '' ? '0' : row['Net Point Adjustment']),
    'Revised verified total: ' + row['Revised Team Total'],
    'Eligibility result: ' + row['Qualification Result'],
    '',
    clean_(row['Auditor Notes']) || 'No additional notes were entered.',
    '',
    'Thank you for supporting Cypress AYSO Region 154.'
  ].join('\n');
  const options = { name: AUDIT.REGION_NAME };
  if (AUDIT.SUPPORT_EMAIL) options.replyTo = AUDIT.SUPPORT_EMAIL;
  MailApp.sendEmail(email, subject, body, options);
  sheet.getRange(rowNumber, headers['Notification Status']).setValue('Decision Sent');
  sheet.getRange(rowNumber, headers['Notification Timestamp']).setValue(new Date());
}

function refreshFormPhase() {
  const form = getOrCreateForm_();
  const now = new Date();
  form.setDescription(formDescriptionForPhase_(now));
  if (now > new Date(AUDIT.FINAL_EXCEPTION_CUTOFF)) {
    form.setCustomClosedFormMessage(
      'The Fall 2026 volunteer point review window closed Wednesday, November 11 at noon Pacific Time. ' +
      'The Board is completing final eligibility certification.'
    );
    form.setAcceptingResponses(false);
  } else {
    form.setAcceptingResponses(true);
  }
}

function formDescriptionForPhase_(now) {
  const standardCutoff = new Date(AUDIT.STANDARD_CUTOFF);
  const finalCutoff = new Date(AUDIT.FINAL_EXCEPTION_CUTOFF);
  const intro =
    'FALL 2026 POST-SEASON ELIGIBILITY\n\n' +
    'This private link is for rostered Head Coaches and Team Managers. Submit one consolidated ' +
    'request per team challenge. Teams with 17 verified points are already qualified.\n\n';
  if (now <= standardCutoff) {
    return intro +
      'STANDARD REQUEST DEADLINE: Sunday, November 8 at 5:00 PM Pacific Time.\n' +
      'Allow 48 hours for a completed shift to appear. Ordinary discrepancies must be submitted ' +
      'within 14 calendar days of the shift and no later than the standard deadline.\n\n' +
      'Shifts worked November 7–10 have a limited final-game exception ending Wednesday, November 11 at noon Pacific Time.';
  }
  if (now <= finalCutoff) {
    return intro +
      'FINAL-GAME EXCEPTION ONLY: The standard request window has closed. New submissions are accepted ' +
      'only for shifts completed November 7–10. The exception closes Wednesday, November 11 at noon Pacific Time. ' +
      'It cannot revive an older discrepancy.';
  }
  return intro + 'The Fall 2026 submission window is closed.';
}

function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create(AUDIT.SPREADSHEET_NAME);
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  ss.setSpreadsheetTimeZone(AUDIT.TIME_ZONE);
  return ss;
}

function getOrCreateForm_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP.FORM_ID);
  if (id) return FormApp.openById(id);
  const form = FormApp.create(AUDIT.FORM_TITLE);
  props.setProperty(PROP.FORM_ID, form.getId());
  return form;
}

function getAuditSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!id) throw new Error('Run setupAuditSystem() first.');
  return SpreadsheetApp.openById(id);
}

function ensureWorkbook_(ss) {
  ss.setSpreadsheetTimeZone(AUDIT.TIME_ZONE);
  const first = ss.getSheets()[0];
  if (ss.getSheets().length === 1 && first.getLastRow() === 0 && first.getName() === 'Sheet1') {
    first.setName(SHEET.CONFIG);
  }
  ensureSheet_(ss, SHEET.CONFIG, ['Setting', 'Value', 'Notes']);
  ensureSheet_(ss, SHEET.QUEUE, QUEUE_HEADERS);
  ensureSheet_(ss, SHEET.SHIFTS, SHIFT_HEADERS);
  ensureSheet_(ss, SHEET.TEAM_STATUS, [
    'Team Code', 'Division', 'Current Verified Points', 'Points Needed',
    'Reconciliation Status', 'Latest Ticket ID', 'Last Updated'
  ]);
  ensureSheet_(ss, SHEET.DASHBOARD, ['Metric', 'Value']);
  ensureSheet_(ss, SHEET.LOG, ['Timestamp', 'Ticket ID', 'Field / Event', 'Old Value', 'New Value', 'Changed By']);
  refreshConfigurationSheet();
  applyQueueValidation_(ss.getSheetByName(SHEET.QUEUE));
  applyWorkbookFormatting_(ss);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else {
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach(function (header, i) {
      if (!existing[i]) sheet.getRange(1, i + 1).setValue(header);
      else if (existing[i] !== header) throw new Error('Unexpected header in ' + name + ' column ' + (i + 1) + ': ' + existing[i]);
    });
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function linkFormToSpreadsheet_(form, ss) {
  let destinationId = '';
  try { destinationId = form.getDestinationId() || ''; } catch (err) { destinationId = ''; }
  if (destinationId && destinationId !== ss.getId()) {
    throw new Error('The form is already linked to a different spreadsheet. Disconnect it manually before continuing.');
  }
  if (!destinationId) form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  const responseSheet = waitForResponseSheet_(ss);
  if (responseSheet.getName() !== SHEET.RESPONSES && !ss.getSheetByName(SHEET.RESPONSES)) {
    responseSheet.setName(SHEET.RESPONSES);
  }
}

function waitForResponseSheet_(ss) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const match = ss.getSheets().find(function (sheet) {
      return /^Form Responses(?: \d+)?$/.test(sheet.getName()) ||
        String(sheet.getRange(1, 1).getValue()).toLowerCase() === 'timestamp';
    });
    if (match) return match;
    Utilities.sleep(500);
    SpreadsheetApp.flush();
  }
  throw new Error('The linked Form Responses sheet was not created. Wait briefly and rerun setupAuditSystem().');
}

function refreshConfigurationSheet() {
  const ss = getAuditSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET.CONFIG) || ss.insertSheet(SHEET.CONFIG);
  const rows = [
    ['Setting', 'Value', 'Notes'],
    ['Script Version', AUDIT.VERSION, 'Change AUDIT.VERSION only when intentionally rebuilding.'],
    ['Required Points', AUDIT.REQUIRED_POINTS, 'Qualification threshold.'],
    ['Posting Delay Hours', AUDIT.POSTING_DELAY_HOURS, 'Normal processing allowance.'],
    ['Lookback Days', AUDIT.LOOKBACK_DAYS, 'Rolling discrepancy deadline.'],
    ['Early Reconciliation', new Date(AUDIT.EARLY_RECONCILIATION), '80% reconciliation checkpoint.'],
    ['Standard Cutoff', new Date(AUDIT.STANDARD_CUTOFF), 'Older shifts cannot be revived afterward.'],
    ['Final Exception Cutoff', new Date(AUDIT.FINAL_EXCEPTION_CUTOFF), 'Only November 7–10 shifts.'],
    ['Final Decision Deadline', new Date(AUDIT.FINAL_DECISION_DEADLINE), 'Board processing deadline.'],
    ['Eligibility Certification', new Date(AUDIT.ELIGIBILITY_CERTIFICATION), 'Final qualification lock.'],
    ['Support Email', AUDIT.SUPPORT_EMAIL || 'NOT CONFIGURED', 'Set AUDIT.SUPPORT_EMAIL before launch.'],
    ['', '', ''],
    ['Category', 'Cap', 'Default Points']
  ];
  AUDIT.CATEGORIES.forEach(function (c) { rows.push([c.name, c.cap, c.defaultPoints]); });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(13, 1, 1, 3).setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.autoResizeColumns(1, 3);
  sheet.setFrozenRows(1);
}

function applyQueueValidation_(sheet) {
  const h = headerMap_(sheet);
  const workflowRule = SpreadsheetApp.newDataValidation().requireValueInList([
    'New', 'Needs Information', 'Waiting — 48-Hour Posting Window', 'Assigned',
    'In Review', 'Ready for Decision', 'Closed'
  ], true).setAllowInvalid(false).build();
  const decisionRule = SpreadsheetApp.newDataValidation().requireValueInList([
    'Pending', 'Approved', 'Partially Approved', 'Denied — No Physical Record',
    'Denied — Category Cap Reached', 'Denied — Untimely', 'Duplicate',
    'Not Needed — Team Already Qualified', 'Not Reviewed — Threshold Reached'
  ], true).setAllowInvalid(false).build();
  const adjustmentRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, AUDIT.REQUIRED_POINTS)
    .setAllowInvalid(false)
    .setHelpText('Enter approved points as a number from 0 through ' + AUDIT.REQUIRED_POINTS + '.')
    .build();
  sheet.getRange(2, h['Workflow Status'], 1000, 1).setDataValidation(workflowRule);
  sheet.getRange(2, h.Decision, 1000, 1).setDataValidation(decisionRule);
  sheet.getRange(2, h['Net Point Adjustment'], 1000, 1).setDataValidation(adjustmentRule);
}

function applyWorkbookFormatting_(ss) {
  [SHEET.QUEUE, SHEET.SHIFTS, SHEET.TEAM_STATUS, SHEET.LOG].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const cols = sheet.getLastColumn();
    if (cols) sheet.getRange(1, 1, 1, cols)
      .setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (cols >= 1) {
      if (sheet.getFilter()) sheet.getFilter().remove();
      sheet.getRange(1, 1, 1000, cols).createFilter();
    }
  });
  const queue = ss.getSheetByName(SHEET.QUEUE);
  const h = headerMap_(queue);
  queue.getRange(2, h['Received Timestamp'], 1000, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
  queue.getRange(2, h['Applicable Deadline'], 1000, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
  queue.getRange(2, h['Decision Date'], 1000, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
  queue.getRange(2, 1, 1000, queue.getLastColumn()).setVerticalAlignment('top');

  const dataRange = queue.getRange(2, 1, 999, queue.getLastColumn());
  const timelyCol = columnLetter_(h['Timely?']);
  const priorityCol = columnLetter_(h.Priority);
  const workflowCol = columnLetter_(h['Workflow Status']);
  const qualificationCol = columnLetter_(h['Qualification Result']);
  queue.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + timelyCol + '2="No"')
      .setBackground('#FECACA').setFontColor('#7F1D1D').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=REGEXMATCH($' + priorityCol + '2,"Critical|Urgent")')
      .setBackground('#FED7AA').setFontColor('#7C2D12').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + workflowCol + '2="Needs Information"')
      .setBackground('#FEF3C7').setFontColor('#78350F').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + qualificationCol + '2="Qualified"')
      .setBackground('#DCFCE7').setFontColor('#14532D').setRanges([dataRange]).build()
  ]);
}

function refreshDashboard() {
  const ss = getAuditSpreadsheet_();
  const dashboard = ss.getSheetByName(SHEET.DASHBOARD);
  const queueName = "'" + SHEET.QUEUE.replace(/'/g, "''") + "'";
  const teamName = "'" + SHEET.TEAM_STATUS.replace(/'/g, "''") + "'";
  const qh = headerMap_(ss.getSheetByName(SHEET.QUEUE));
  const th = headerMap_(ss.getSheetByName(SHEET.TEAM_STATUS));
  const col = function (n) { return columnLetter_(n); };
  const rows = [
    ['Region 154 Fall 2026 Volunteer Point Review', ''],
    ['Last Refreshed', new Date()],
    ['Teams at 17+', '=COUNTIF(' + teamName + '!' + col(th['Current Verified Points']) + '2:' + col(th['Current Verified Points']) + ',">=17")'],
    ['Teams below 17', '=COUNTIFS(' + teamName + '!' + col(th['Current Verified Points']) + '2:' + col(th['Current Verified Points']) + ',"<17",' + teamName + '!' + col(th['Team Code']) + '2:' + col(th['Team Code']) + ',"<>")'],
    ['Open Tickets', '=COUNTIFS(' + queueName + '!' + col(qh['Ticket ID']) + '2:' + col(qh['Ticket ID']) + ',"<>",' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"<>Closed")'],
    ['Needs Information', '=COUNTIF(' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"Needs Information")'],
    ['Unassigned Open Tickets', '=COUNTIFS(' + queueName + '!' + col(qh['Auditor Assigned']) + '2:' + col(qh['Auditor Assigned']) + ',"",' + queueName + '!' + col(qh['Ticket ID']) + '2:' + col(qh['Ticket ID']) + ',"<>",' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"<>Closed")'],
    ['Final-Game Exceptions', '=COUNTIF(' + queueName + '!' + col(qh['Request Type']) + '2:' + col(qh['Request Type']) + ',"*Final-Game*")'],
    ['Duplicate Challenges', '=COUNTIF(' + queueName + '!' + col(qh.Decision) + '2:' + col(qh.Decision) + ',"Duplicate")'],
    ['Standard Tickets Received', '=COUNTIF(' + queueName + '!' + col(qh['Request Type']) + '2:' + col(qh['Request Type']) + ',"Standard Review")'],
    ['Standard Tickets Closed', '=COUNTIFS(' + queueName + '!' + col(qh['Request Type']) + '2:' + col(qh['Request Type']) + ',"Standard Review",' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"Closed")'],
    ['Standard Resolution %', '=IFERROR(B11/B10,0)'],
    ['80% Goal', '=0.8'],
    ['Goal Status', '=IF(B12>=B13,"ON TRACK","ACTION NEEDED")']
  ];
  dashboard.getDataRange().breakApart();
  dashboard.clear();
  dashboard.getRange(1, 1, rows.length, 2).setValues(rows);
  dashboard.getRange('A1:B1').merge().setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  dashboard.getRange('B12:B13').setNumberFormat('0%');
  dashboard.setColumnWidth(1, 260);
  dashboard.setColumnWidth(2, 180);
  dashboard.setFrozenRows(1);
}

function upsertTeamStatus_(ss, teamCode, division, points, ticketId, workflow) {
  const sheet = ss.getSheetByName(SHEET.TEAM_STATUS);
  const rows = dataObjects_(sheet);
  const index = rows.findIndex(function (r) { return normalizeTeamCode_(r['Team Code']) === teamCode; });
  const values = [teamCode, division, points, Math.max(0, AUDIT.REQUIRED_POINTS - points), workflow, ticketId, new Date()];
  if (index >= 0) sheet.getRange(index + 2, 1, 1, values.length).setValues([values]);
  else appendRow_(sheet, values);
}

function updateQueueNotification_(ss, ticketId, status) {
  const sheet = ss.getSheetByName(SHEET.QUEUE);
  const h = headerMap_(sheet);
  const rows = dataObjects_(sheet);
  const index = rows.findIndex(function (row) { return String(row['Ticket ID']) === ticketId; });
  if (index < 0) return;
  sheet.getRange(index + 2, h['Notification Status']).setValue(status);
  sheet.getRange(index + 2, h['Notification Timestamp']).setValue(new Date());
}

function appendAuditLog_(ss, ticketId, event, oldValue, newValue, changedBy) {
  appendRow_(ss.getSheetByName(SHEET.LOG), [new Date(), ticketId, event, oldValue, newValue, changedBy]);
}

function installAuditTriggers_() {
  const form = getOrCreateForm_();
  const ss = getAuditSpreadsheet_();
  const handlers = ['handleAuditFormSubmit', 'handleAuditQueueEdit', 'refreshFormPhase', 'sendDailyQueueSummary'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('handleAuditFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('handleAuditQueueEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('refreshFormPhase').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendDailyQueueSummary').timeBased().atHour(7).everyDays(1).inTimezone(AUDIT.TIME_ZONE).create();
}

function sendDailyQueueSummary() {
  if (!AUDIT.SUPPORT_EMAIL || !AUDIT.SEND_EMAILS) return;
  const now = new Date();
  if (now < new Date(AUDIT.EARLY_RECONCILIATION) || now > new Date(AUDIT.ELIGIBILITY_CERTIFICATION)) return;
  const rows = dataObjects_(getAuditSpreadsheet_().getSheetByName(SHEET.QUEUE));
  const open = rows.filter(function (r) { return r['Ticket ID'] && r['Workflow Status'] !== 'Closed'; });
  const unassigned = open.filter(function (r) { return !r['Auditor Assigned']; }).length;
  const needsInfo = open.filter(function (r) { return r['Workflow Status'] === 'Needs Information'; }).length;
  const critical = open.filter(function (r) { return String(r.Priority).indexOf('Critical') >= 0; }).length;
  MailApp.sendEmail(
    AUDIT.SUPPORT_EMAIL,
    '[AYSO 154 Audit] Daily queue summary — ' + formatDate_(now),
    [
      'Open tickets: ' + open.length,
      'Unassigned: ' + unassigned,
      'Needs information: ' + needsInfo,
      'Critical final-window tickets: ' + critical,
      '',
      'Open the response workbook to assign and resolve the queue.'
    ].join('\n'),
    { name: AUDIT.REGION_NAME }
  );
}

function writeSetupReport_(ss, form) {
  const sheet = ss.getSheetByName(SHEET.CONFIG);
  const start = 22;
  const rows = [
    ['SETUP REPORT', ''],
    ['Form respondent URL', form.getPublishedUrl()],
    ['Form edit URL', form.getEditUrl()],
    ['Response workbook URL', ss.getUrl()],
    ['Required manual step', 'Upload the approved 4:1 header image and set the theme color to ' + AUDIT.BRAND_NAVY],
    ['Required policy check', 'Verify every category cap in the AUDIT.CATEGORIES configuration.'],
    ['Required email check', AUDIT.SUPPORT_EMAIL ? 'Configured: ' + AUDIT.SUPPORT_EMAIL : 'Set AUDIT.SUPPORT_EMAIL before launch.'],
    ['Distribution control', 'Share the respondent URL only in the closed Head Coach and Team Manager WhatsApp groups.']
  ];
  sheet.getRange(start, 1, 14, 3).clearContent().clearFormat();
  sheet.getRange(start, 1, rows.length, 2).setValues(rows);
  sheet.getRange(start, 1, 1, 2).setBackground(AUDIT.BRAND_RED).setFontColor('#FFFFFF').setFontWeight('bold');
}

function validateConfiguration_() {
  const dates = [
    AUDIT.EARLY_RECONCILIATION, AUDIT.STANDARD_CUTOFF, AUDIT.FINAL_WINDOW_START,
    AUDIT.FINAL_WINDOW_END, AUDIT.FINAL_EXCEPTION_CUTOFF,
    AUDIT.FINAL_DECISION_DEADLINE, AUDIT.ELIGIBILITY_CERTIFICATION, AUDIT.POST_SEASON_START
  ].map(function (value) { return new Date(value); });
  if (dates.some(function (d) { return isNaN(d.getTime()); })) throw new Error('One or more configured dates are invalid.');
  if (!(dates[0] < dates[1] && dates[1] < dates[4] && dates[4] < dates[5] && dates[5] < dates[6] && dates[6] < dates[7])) {
    throw new Error('Configured milestone dates are not in chronological order.');
  }
  if (AUDIT.REQUIRED_POINTS <= 0 || AUDIT.MAX_SHIFTS_PER_CHALLENGE < 1) throw new Error('Point and shift limits must be positive.');
}

/** Pure-logic smoke tests. Run before launch. */
function runSelfTests() {
  const cases = [
    {
      name: 'Standard timely', shift: '2026-10-20T10:00:00-07:00', received: '2026-10-23T10:01:00-07:00',
      expected: 'Standard Review', timely: true
    },
    {
      name: 'Standard too recent', shift: '2026-10-20T10:00:00-07:00', received: '2026-10-21T10:00:00-07:00',
      expected: 'Waiting — 48-Hour Posting Window', timely: true
    },
    {
      name: 'Older than 14 days', shift: '2026-10-01T10:00:00-07:00', received: '2026-10-16T10:00:00-07:00',
      expected: 'Untimely', timely: false
    },
    {
      name: 'Old shift after standard cutoff', shift: '2026-10-30T10:00:00-07:00', received: '2026-11-09T10:00:00-08:00',
      expected: 'Untimely', timely: false
    },
    {
      name: 'Final-game exception', shift: '2026-11-10T18:00:00-08:00', received: '2026-11-10T21:00:00-08:00',
      expected: 'Final-Game Exception', timely: true
    },
    {
      name: 'Late final-game exception', shift: '2026-11-10T18:00:00-08:00', received: '2026-11-11T12:01:00-08:00',
      expected: 'Untimely', timely: false
    }
  ];
  cases.forEach(function (test) {
    const result = classifyShiftTiming_(new Date(test.shift), new Date(test.received));
    if (result.classification !== test.expected || result.timely !== test.timely) {
      throw new Error(test.name + ' failed: ' + JSON.stringify(result));
    }
  });
  Logger.log('All ' + cases.length + ' deadline tests passed.');
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (header, i) { if (header) map[String(header)] = i + 1; });
  return map;
}

function dataObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values.shift();
  return values.map(function (row) {
    const obj = {};
    headers.forEach(function (header, i) { obj[String(header)] = row[i]; });
    return obj;
  });
}

function rowObject_(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obj = {};
  headers.forEach(function (header, i) { obj[String(header)] = values[i]; });
  return obj;
}

function objectToRow_(headers, obj) {
  return headers.map(function (header) { return Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : ''; });
}

function appendRow_(sheet, values) {
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
}

function clean_(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (Array.isArray(value)) return value.join('; ').trim();
  return String(value).trim();
}

function normalize_(value) {
  return clean_(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function normalizeTeamCode_(value) {
  return normalize_(value).replace(/\s+/g, '-');
}

function dateKey_(date) {
  return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'yyyy-MM-dd HH:mm');
}

function formatDate_(date) {
  return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'MMM d, yyyy');
}

function formatDateTime_(date) {
  if (!date) return 'Not available';
  return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'EEE, MMM d, yyyy h:mm a') + ' PT';
}

function columnLetter_(column) {
  let result = '';
  while (column > 0) {
    const remainder = (column - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result;
}

// ============================================================================
// HYBRID ADJUDICATION BRIDGE (2026 POST-SEASON PLAYOFF VOLUNTEER AUDIT)
// ============================================================================

const ADJUDICATION_SHEET = Object.freeze({
  DOSSIERS: 'Gem_Dispute_Dossiers',
  AUDIT_SUBMISSIONS: 'Audit Submissions',
  FORM_RESPONSES_2: 'Form Responses 2',
  PLAYOFF_RESPONSES: 'Playoff_Audit_Responses',
  GAME_DAY_CHECKINS: 'Game Day Check-ins',
  FORM_RESPONSES_1: 'Form Responses 1',
  AWARDS: 'Team_Awards',
  LEDGER: 'Season_Master_Ledger'
});

/**
 * Resolves the audit spreadsheet containing the Audit Queue / Form Responses.
 */
function resolveAuditSpreadsheet_() {
  const activeSs = (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null;
  if (activeSs) {
    if (activeSs.getSheetByName(SHEET.QUEUE) || 
        activeSs.getSheetByName(ADJUDICATION_SHEET.AUDIT_SUBMISSIONS) ||
        activeSs.getSheetByName(ADJUDICATION_SHEET.FORM_RESPONSES_2) ||
        activeSs.getSheetByName(ADJUDICATION_SHEET.PLAYOFF_RESPONSES) ||
        activeSs.getSheetByName(SHEET.RESPONSES) ||
        activeSs.getSheetByName(SHEET.LEGACY_RESPONSES) ||
        activeSs.getSheetByName('Form Responses')) {
      return activeSs;
    }
  }

  try {
    const props = (typeof PropertiesService !== 'undefined') ? PropertiesService.getScriptProperties() : null;
    const id = props ? props.getProperty(PROP.SPREADSHEET_ID) : null;
    if (id && typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.openById(id);
    }
  } catch (e) {}

  try {
    if (typeof DriveApp !== 'undefined') {
      const files = DriveApp.getFilesByName(AUDIT.SPREADSHEET_NAME);
      if (files.hasNext() && typeof SpreadsheetApp !== 'undefined') {
        return SpreadsheetApp.openById(files.next().getId());
      }
    }
  } catch (e) {}

  return activeSs;
}

/**
 * Resolves the master spreadsheet containing Season_Master_Ledger and Team_Awards.
 */
function resolveMasterSpreadsheet_() {
  const activeSs = (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null;
  if (activeSs) {
    if (activeSs.getSheetByName(ADJUDICATION_SHEET.LEDGER) || activeSs.getSheetByName(ADJUDICATION_SHEET.AWARDS)) {
      return activeSs;
    }
  }

  try {
    const props = (typeof PropertiesService !== 'undefined') ? PropertiesService.getScriptProperties() : null;
    const masterId = props ? props.getProperty('MASTER_SPREADSHEET_ID') : null;
    if (masterId && typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.openById(masterId);
    }
  } catch (e) {}

  return activeSs;
}

/**
 * Pre-checks a team's status against Season_Master_Ledger.
 * Identifies current verified points, playoff goal, qualification status, and category caps.
 *
 * @param {string} teamCode The team identifier to check
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [masterSs] Optional master spreadsheet reference
 * @returns {Object} Structured pre-check audit status
 */
function getTeamLedgerPreCheck_(teamCode, masterSs) {
  const ss = masterSs || resolveMasterSpreadsheet_();
  if (!ss) {
    return {
      found: false,
      teamCode: teamCode,
      warnings: ['Master spreadsheet not accessible for ledger pre-check.']
    };
  }

  const sheet = ss.getSheetByName(ADJUDICATION_SHEET.LEDGER) || ss.getSheetByName('Season_Master_Ledger');
  if (!sheet || sheet.getLastRow() < 2) {
    return {
      found: false,
      teamCode: teamCode,
      warnings: ['Season_Master_Ledger tab not found or empty.']
    };
  }

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());

  // Find column indices
  const idxDiv = headers.indexOf('division') !== -1 ? headers.indexOf('division') : 0;
  const idxTeam = headers.indexOf('team code') !== -1 ? headers.indexOf('team code') : 1;
  const idxCoach = headers.indexOf('head coach') !== -1 ? headers.indexOf('head coach') : 2;
  const idxRef = headers.findIndex(h => h.includes('referee') && h.includes('points'));
  const idxFm = headers.findIndex(h => h.includes('marshal'));
  const idxSetup = headers.findIndex(h => h.includes('setup'));
  const idxPic = headers.findIndex(h => h.includes('picture'));
  const idxCert = headers.findIndex(h => h.includes('certified'));
  const idxMatch = headers.findIndex(h => h.includes('matchtrak'));
  const idxOther = headers.findIndex(h => h.includes('other') || h.includes('adjust'));
  const idxTotal = headers.findIndex(h => h.includes('total'));
  const idxGoal = headers.findIndex(h => h.includes('goal'));
  const idxStatus = headers.findIndex(h => h.includes('status'));

  const cleanTarget = String(teamCode || '').trim().toLowerCase();
  const normTarget = normalizeTeamCode_(teamCode);

  let matchRow = null;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowTeam = String(row[idxTeam] || '').trim();
    if (!rowTeam) continue;

    if (rowTeam.toLowerCase() === cleanTarget || normalizeTeamCode_(rowTeam) === normTarget) {
      matchRow = row;
      break;
    }
  }

  // Fallback: match coach name if not exact team code
  if (!matchRow) {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rowTeam = String(row[idxTeam] || '').trim();
      const rowCoach = String(row[idxCoach !== -1 ? idxCoach : 2] || '').trim().toLowerCase();
      if (cleanTarget.includes(rowCoach) && rowCoach.length > 3) {
        matchRow = row;
        break;
      }
    }
  }

  if (!matchRow) {
    return {
      found: false,
      teamCode: teamCode,
      warnings: [`Team '${teamCode}' was not found in Season_Master_Ledger.`]
    };
  }

  const division = String(matchRow[idxDiv] || '').trim();
  const canonicalTeam = String(matchRow[idxTeam] || '').trim();
  const headCoach = String(matchRow[idxCoach !== -1 ? idxCoach : 2] || '').trim();

  const refPts = idxRef !== -1 ? Number(matchRow[idxRef]) || 0 : 0;
  const fmPts = idxFm !== -1 ? Number(matchRow[idxFm]) || 0 : 0;
  const setupPts = idxSetup !== -1 ? Number(matchRow[idxSetup]) || 0 : 0;
  const picPts = idxPic !== -1 ? Number(matchRow[idxPic]) || 0 : 0;
  const certRefPts = idxCert !== -1 ? Number(matchRow[idxCert]) || 0 : 0;
  const matchtrakPts = idxMatch !== -1 ? Number(matchRow[idxMatch]) || 0 : 0;
  const otherPts = idxOther !== -1 ? Number(matchRow[idxOther]) || 0 : 0;
  const totalPts = idxTotal !== -1 ? Number(matchRow[idxTotal]) || 0 : (refPts + fmPts + setupPts + picPts + certRefPts + matchtrakPts + otherPts);
  const playoffGoal = idxGoal !== -1 ? Number(matchRow[idxGoal]) || 17 : 17;
  const playoffStatus = idxStatus !== -1 ? String(matchRow[idxStatus] || '').trim() : (totalPts >= playoffGoal ? 'Qualified' : `${playoffGoal - totalPts} pts needed`);

  const isAlreadyQualified = totalPts >= playoffGoal;
  const pointsNeeded = Math.max(0, playoffGoal - totalPts);

  const caps = {
    refCapMet: refPts >= 10,
    fmCapMet: fmPts >= 2,
    setupCapMet: setupPts >= 5,
    picCapMet: picPts >= 2,
    certRefCapMet: certRefPts >= 5,
    matchtrakCapMet: matchtrakPts >= 2
  };

  const warnings = [];
  if (isAlreadyQualified) {
    warnings.push(`⚠️ ALREADY QUALIFIED: Team currently has ${totalPts} verified points (Goal: ${playoffGoal}). Per board policy, surplus points beyond ${playoffGoal} are not audited or banked.`);
  }
  if (caps.refCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Referee points at 10/10. Additional referee shifts cannot earn points under the category cap.`);
  }
  if (caps.fmCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Field Marshal points at 2/2 cap.`);
  }
  if (caps.picCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Picture Day points at 2/2 cap.`);
  }
  if (caps.setupCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Field Setup points at 5/5 cap.`);
  }

  return {
    found: true,
    division: division,
    teamCode: canonicalTeam,
    headCoach: headCoach,
    totalPts: totalPts,
    playoffGoal: playoffGoal,
    playoffStatus: playoffStatus,
    isAlreadyQualified: isAlreadyQualified,
    pointsNeeded: pointsNeeded,
    breakdown: {
      refPts: refPts,
      fmPts: fmPts,
      setupPts: setupPts,
      picPts: picPts,
      certRefPts: certRefPts,
      matchtrakPts: matchtrakPts,
      otherPts: otherPts
    },
    caps: caps,
    warnings: warnings
  };
}

/**
 * Scans for unadjudicated dispute tickets across Audit Queue or response sheets.
 *
 * @param {Object} [options] Optional filter criteria
 * @returns {Array<Object>} List of unadjudicated ticket objects with ledger pre-checks
 */
function getUnadjudicatedDisputes(options = {}) {
  const auditSs = (options && options.auditSs) || resolveAuditSpreadsheet_();
  const masterSs = (options && options.masterSs) || resolveMasterSpreadsheet_();

  if (!auditSs) return [];

  const unadjudicated = [];

  // Strategy 1: Check Audit Queue + Shift Details (from AYSO154_Playoff_Audit.js)
  const queueSheet = auditSs.getSheetByName(SHEET.QUEUE);
  const shiftsSheet = auditSs.getSheetByName(SHEET.SHIFTS);

  if (queueSheet && queueSheet.getLastRow() > 1) {
    const queueRows = dataObjects_(queueSheet);
    const shiftsRows = (shiftsSheet && shiftsSheet.getLastRow() > 1) ? dataObjects_(shiftsSheet) : [];

    queueRows.forEach(row => {
      const ticketId = String(row['Ticket ID'] || '').trim();
      const decision = String(row['Decision'] || '').trim();
      const workflow = String(row['Workflow Status'] || '').trim();

      // Check if ticket is unadjudicated
      const isUnadjudicated = (decision === 'Pending' || !decision) &&
                              workflow !== 'Closed' &&
                              workflow !== 'Duplicate';

      if (isUnadjudicated) {
        // Collect shifts for this ticket
        const ticketShifts = shiftsRows.filter(s => String(s['Ticket ID'] || '').trim() === ticketId).map(s => ({
          shiftNumber: s['Shift Number'] || 1,
          shiftStart: s['Shift Start'] instanceof Date ? formatDateTimeSafe_(s['Shift Start']) : String(s['Shift Start'] || ''),
          venue: s['Venue'] || '',
          fieldLocation: s['Field / Location'] || '',
          volunteerName: s['Volunteer Full Name'] || '',
          category: s['Category'] || '',
          expectedPoints: Number(s['Expected Points']) || 1,
          teamCreditedAtCheckIn: s['Team Credited at Check-In'] || '',
          evidence: s['Evidence / Identifying Details'] || '',
          supportingLink: s['Supporting Link'] || '',
          classification: s['Shift Classification'] || '',
          timely: s['Timely?'] || 'Yes',
          postingWindowComplete: s['48-Hour Posting Window Complete?'] || 'Yes'
        }));

        const teamCode = clean_(row['Team Code']);
        const ledgerPreCheck = getTeamLedgerPreCheck_(teamCode, masterSs);

        unadjudicated.push({
          ticketId: ticketId,
          received: row['Received Timestamp'] instanceof Date ? formatDateTimeSafe_(row['Received Timestamp']) : String(row['Received Timestamp'] || ''),
          submitter: {
            name: clean_(row['Submitter Name']),
            role: clean_(row['Submitter Role']),
            email: clean_(row['Email']),
            phone: clean_(row['Cell Phone'])
          },
          team: {
            teamCode: teamCode,
            division: clean_(row['Division']),
            headCoach: clean_(row['Head Coach'])
          },
          requestType: clean_(row['Request Type']),
          workflowStatus: workflow,
          priority: clean_(row['Priority']),
          timely: clean_(row['Timely?']),
          deadline: row['Applicable Deadline'] instanceof Date ? formatDateTimeSafe_(row['Applicable Deadline']) : String(row['Applicable Deadline'] || ''),
          siblingInfo: {
            hasSibling: clean_(row['Sibling / Multi-Team?']),
            details: clean_(row['Sibling Details'])
          },
          shifts: ticketShifts,
          ledgerPreCheck: ledgerPreCheck
        });
      }
    });
  }

  // Strategy 2: Check Audit Submissions, Form Responses 2, Playoff_Audit_Responses, or Form Responses if queue has no entries
  if (unadjudicated.length === 0) {
    const rawSheet = auditSs.getSheetByName(ADJUDICATION_SHEET.AUDIT_SUBMISSIONS) ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.FORM_RESPONSES_2) ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.PLAYOFF_RESPONSES) ||
                     auditSs.getSheetByName(SHEET.RESPONSES) ||
                     auditSs.getSheetByName(SHEET.LEGACY_RESPONSES) ||
                     auditSs.getSheetByName('Form Responses') ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.GAME_DAY_CHECKINS) ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.FORM_RESPONSES_1);

    if (rawSheet && rawSheet.getLastRow() > 1) {
      const data = rawSheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h || '').trim().toLowerCase());

      const idxStatus = headers.findIndex(h => h.includes('audit status') || h.includes('workflow status'));
      const idxRole = headers.findIndex(h => h.includes('role'));
      const idxEmail = headers.findIndex(h => h.includes('email'));
      const idxName = headers.findIndex(h => h.includes('submitter') && h.includes('name'));
      const idxPhone = headers.findIndex(h => h.includes('phone'));
      const idxDiv = headers.indexOf('division');
      const idxCoach = headers.findIndex(h => h.includes('coach'));
      const idxTeam = headers.findIndex(h => h.includes('team'));
      const idxDate = headers.findIndex(h => h.includes('date'));
      const idxCat = headers.findIndex(h => h.includes('category'));
      const idxVol = headers.findIndex(h => h.includes('volunteer'));
      const idxField = headers.findIndex(h => h.includes('field') || h.includes('location'));
      const idxTime = headers.findIndex(h => h.includes('time'));
      const idxSibling = headers.findIndex(h => h.includes('sibling') && h.includes('does'));
      const idxSiblingDetails = headers.findIndex(h => h.includes('sibling') && (h.includes('name') || h.includes('detail')));
      const idxLink = headers.findIndex(h => h.includes('link') || h.includes('photo'));

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const status = idxStatus !== -1 ? String(row[idxStatus] || '').trim() : '';

        // If status is Pending or empty, it's unadjudicated
        if (!status || status.toLowerCase() === 'pending') {
          const teamCode = clean_(row[idxTeam !== -1 ? idxTeam : 9]);
          if (!teamCode) continue;

          const ledgerPreCheck = getTeamLedgerPreCheck_(teamCode, masterSs);
          const ticketId = `TICKET-ROW-${i + 1}`;

          unadjudicated.push({
            ticketId: ticketId,
            received: row[0] instanceof Date ? formatDateTimeSafe_(row[0]) : String(row[0] || ''),
            submitter: {
              name: clean_(row[idxName !== -1 ? idxName : 4]),
              role: clean_(row[idxRole !== -1 ? idxRole : 1]),
              email: clean_(row[idxEmail !== -1 ? idxEmail : 6]),
              phone: clean_(row[idxPhone !== -1 ? idxPhone : 5])
            },
            team: {
              teamCode: teamCode,
              division: clean_(row[idxDiv !== -1 ? idxDiv : 7]),
              headCoach: clean_(row[idxCoach !== -1 ? idxCoach : 8])
            },
            requestType: 'Standard Review',
            workflowStatus: status || 'Pending',
            priority: 'Normal',
            timely: 'Yes',
            deadline: 'Sun, Nov 8, 2026',
            siblingInfo: {
              hasSibling: clean_(row[idxSibling !== -1 ? idxSibling : 15]),
              details: clean_(row[idxSiblingDetails !== -1 ? idxSiblingDetails : 16])
            },
            shifts: [{
              shiftNumber: 1,
              shiftStart: `${clean_(row[idxDate !== -1 ? idxDate : 10])} ${clean_(row[idxTime !== -1 ? idxTime : 14])}`.trim(),
              venue: 'Venue',
              fieldLocation: clean_(row[idxField !== -1 ? idxField : 13]),
              volunteerName: clean_(row[idxVol !== -1 ? idxVol : 12]),
              category: clean_(row[idxCat !== -1 ? idxCat : 11]),
              expectedPoints: 1,
              teamCreditedAtCheckIn: teamCode,
              evidence: 'Submitted via Playoff Volunteer Audit Form',
              supportingLink: clean_(row[idxLink !== -1 ? idxLink : 19]),
              classification: 'Standard Review',
              timely: 'Yes',
              postingWindowComplete: 'Yes'
            }],
            ledgerPreCheck: ledgerPreCheck
          });
        }
      }
    }
  }

  return unadjudicated;
}

/**
 * Formats a single ticket into a clean, structured Markdown dispute dossier.
 *
 * @param {Object} ticket The ticket data object with ledgerPreCheck
 * @returns {string} Formatted markdown dossier
 */
function formatDisputeDossier(ticket) {
  const t = ticket;
  const l = t.ledgerPreCheck || {};
  const b = l.breakdown || {};

  const lines = [
    `### 🎫 Ticket Dossier: ${t.ticketId}`,
    `- **Submitter:** ${t.submitter.name} (${t.submitter.role})`,
    `- **Contact:** 📧 ${t.submitter.email || 'N/A'} | 📱 ${t.submitter.phone || 'N/A'}`,
    `- **Team Code:** \`${t.team.teamCode}\` | **Division:** ${t.team.division} | **Head Coach:** ${t.team.headCoach}`,
    `- **Received:** ${t.received} | **Priority:** ${t.priority} | **Timely:** ${t.timely}`,
    '',
    `#### 📊 Season Master Ledger Pre-Check`,
    `- **Verified Points:** **${l.totalPts !== undefined ? l.totalPts : 'N/A'}** / ${l.playoffGoal || 17} pts (${l.playoffStatus || 'Unknown'})`,
    `- **Current Breakdown:** Ref: ${b.refPts || 0}/10 | FM: ${b.fmPts || 0}/2 | Setup: ${b.setupPts || 0}/5 | Pic: ${b.picPts || 0}/2 | CertRef: ${b.certRefPts || 0}/5 | MatchTrak: ${b.matchtrakPts || 0}/2 | Other: ${b.otherPts || 0}`,
    `- **Qualification Status:** ${l.isAlreadyQualified ? '🏆 **ALREADY QUALIFIED**' : `⏳ **${l.pointsNeeded || 0} pts needed**`}`
  ];

  if (l.warnings && l.warnings.length > 0) {
    lines.push(`- **Pre-Check Alerts:**`);
    l.warnings.forEach(w => lines.push(`  - ${w}`));
  }

  lines.push('', `#### ⚽ Disputed Shift(s) (${t.shifts.length} shift${t.shifts.length === 1 ? '' : 's'})`);
  t.shifts.forEach((s, idx) => {
    lines.push(
      `**Shift #${s.shiftNumber || idx + 1}:**`,
      `- **Volunteer:** ${s.volunteerName}`,
      `- **Category:** ${s.category} | **Expected Points:** +${s.expectedPoints}`,
      `- **Date / Time:** ${s.shiftStart}`,
      `- **Venue / Field:** ${s.venue} - ${s.fieldLocation}`,
      `- **Check-In Team:** ${s.teamCreditedAtCheckIn || 'None specified'}`,
      `- **Evidence Notes:** ${s.evidence || 'None provided'}`,
      `- **Supporting Link:** ${s.supportingLink ? `[View Evidence Link](${s.supportingLink})` : 'None attached'}`
    );
  });

  lines.push(
    '',
    `#### 👨‍👩‍👧‍👦 Sibling / Cross-Team Leakage Check`,
    `- **Has Siblings in Region 154:** ${t.siblingInfo.hasSibling || 'No'}`,
    `- **Sibling Details:** ${t.siblingInfo.details || 'None'}`
  );

  lines.push(
    '',
    `#### 🤖 Suggested Gem Adjudication Prompt`,
    `> "Please evaluate ticket \`${t.ticketId}\` for team \`${t.team.teamCode}\`. Volunteer \`${t.shifts.map(s => s.volunteerName).join(', ')}\` claimed shift(s) in \`${t.shifts.map(s => s.category).join(', ')}\`. The team has ${l.totalPts !== undefined ? l.totalPts : 'N/A'}/${l.playoffGoal || 17} pts. Cross-reference against physical tent records/match cards. If verified, approve points into target column ('pictureDay' or 'adjustment'). If cap is exceeded or unverified, deny with reason."`
  );

  return lines.join('\n');
}

/**
 * Compiles all unadjudicated dossiers into Markdown and JSON packages ready for Gem ingestion.
 *
 * @param {Object} [options] Filter options
 * @returns {Object} { count, markdown, json, tickets }
 */
function exportDisputeDossiersForGem(options = {}) {
  const tickets = getUnadjudicatedDisputes(options);

  const header = [
    `# 📋 AYSO REGION 154 — 2026 PLAYOFF VOLUNTEER AUDIT DOSSIERS`,
    `**Export Timestamp:** ${formatDateTimeSafe_(new Date())}`,
    `**Unadjudicated Dispute Tickets:** ${tickets.length}`,
    `--------------------------------------------------------------------------------`,
    ''
  ].join('\n');

  let markdown = '';
  if (tickets.length === 0) {
    markdown = header + '\n✅ *No unadjudicated dispute tickets found. All submissions have been processed.*';
  } else {
    markdown = header + tickets.map(t => formatDisputeDossier(t)).join('\n\n---\n\n');
  }

  const jsonString = JSON.stringify(tickets, null, 2);

  // Write to a dedicated sheet tab 'Gem_Dispute_Dossiers' if spreadsheet is available
  try {
    const ss = resolveMasterSpreadsheet_() || resolveAuditSpreadsheet_();
    if (ss && typeof ss.getSheetByName === 'function') {
      let sheet = ss.getSheetByName(ADJUDICATION_SHEET.DOSSIERS);
      if (!sheet) {
        sheet = ss.insertSheet(ADJUDICATION_SHEET.DOSSIERS);
      }
      sheet.clear();
      sheet.getRange(1, 1).setValue('AYSO 154 GEM DISPUTE DOSSIERS EXPORT (COPY / FEED INTO GEM)');
      sheet.getRange(1, 1).setFontWeight('bold').setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontSize(12);
      sheet.getRange(2, 1).setValue(markdown);
      sheet.getRange(2, 1).setFontFamily('Courier New').setFontSize(10).setWrap(true);
      sheet.setColumnWidth(1, 900);
      sheet.setRowHeight(1, 30);
    }
  } catch (e) {
    Logger.log('Could not write to Gem_Dispute_Dossiers tab: ' + e.message);
  }

  return {
    count: tickets.length,
    markdown: markdown,
    json: jsonString,
    tickets: tickets
  };
}

/**
 * Applies an approved Gem decision directly into the Team_Awards matrix
 * and triggers synchronization of the Season Master Ledger.
 *
 * @param {string} teamCode Target team code (e.g. '10U - Boys - Faheem Armanyous')
 * @param {string} targetColumn Target matrix column: 'pictureDay' or 'adjustment'
 * @param {number} points Point adjustment (positive or negative)
 * @param {string} reason Reason / audit finding for the decision
 * @param {string} [reviewerName] Name of the reviewing board member
 * @param {string} [ticketId] Optional associated Ticket ID
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [targetSs] Optional master spreadsheet reference
 * @returns {Object} Result object with updated team totals
 */
function applyGemDecisionToTeamAwards(teamCode, targetColumn, points, reason, reviewerName, ticketId, targetSs) {
  if (!teamCode || !teamCode.trim()) {
    throw new Error('teamCode is required to apply an adjudication decision.');
  }

  const normTarget = String(targetColumn || '').trim().toLowerCase();
  const isPic = normTarget.includes('pic');
  const isAdj = normTarget.includes('adj') || normTarget.includes('oth');

  if (!isPic && !isAdj) {
    throw new Error("Invalid targetColumn: must be 'pictureDay' or 'adjustment'.");
  }

  const pts = Number(points);
  if (isNaN(pts)) {
    throw new Error('points must be a valid number.');
  }

  const masterSs = targetSs || resolveMasterSpreadsheet_();
  if (!masterSs) {
    throw new Error('Master spreadsheet not found.');
  }

  let awardsSheet = masterSs.getSheetByName(ADJUDICATION_SHEET.AWARDS);
  const awardHeaders = [
    'Team Code',
    'Pre-Season Referees',
    'MatchTrak Bonus',
    'Picture Day',
    'Adjustment',
    'Reason / Audit Notes',
    'Reviewer',
    'Last Updated'
  ];

  if (!awardsSheet) {
    awardsSheet = masterSs.insertSheet(ADJUDICATION_SHEET.AWARDS);
    awardsSheet.getRange(1, 1, 1, awardHeaders.length).setValues([awardHeaders]);
    awardsSheet.getRange(1, 1, 1, awardHeaders.length)
      .setFontWeight('bold')
      .setBackground(AUDIT.BRAND_NAVY)
      .setFontColor('#FFFFFF');
  }

  const data = awardsSheet.getDataRange().getValues();
  const cleanTeam = String(teamCode).trim();
  const normTeam = normalizeTeamCode_(cleanTeam);

  let targetRowIdx = -1; // 1-based sheet row index
  let currentPic = 0;
  let currentAdj = 0;
  let currentCert = 0;
  let currentMatch = 0;

  for (let r = 1; r < data.length; r++) {
    const rowTeam = String(data[r][0] || '').trim();
    if (!rowTeam) continue;
    if (rowTeam.toLowerCase() === cleanTeam.toLowerCase() || normalizeTeamCode_(rowTeam) === normTeam) {
      targetRowIdx = r + 1; // 1-indexed row
      currentCert = Number(data[r][1]) || 0;
      currentMatch = Number(data[r][2]) || 0;
      currentPic = Number(data[r][3]) || 0;
      currentAdj = Number(data[r][4]) || 0;
      break;
    }
  }

  const author = reviewerName || (typeof Session !== 'undefined' && Session.getActiveUser().getEmail()) || 'Board Admin';
  const decisionReason = reason || 'Approved Gem Playoff Adjudication';
  const now = new Date();

  let newPic = currentPic;
  let newAdj = currentAdj;

  if (isPic) {
    newPic = Math.max(0, Math.min(2, currentPic + pts));
  } else {
    newAdj = currentAdj + pts;
  }

  if (targetRowIdx > 0) {
    // Update existing row in Team_Awards (Columns: D=4 Pic, E=5 Adj, F=6 Reason, G=7 Reviewer, H=8 Date)
    awardsSheet.getRange(targetRowIdx, 4).setValue(newPic);
    awardsSheet.getRange(targetRowIdx, 5).setValue(newAdj);
    awardsSheet.getRange(targetRowIdx, 6).setValue(decisionReason);
    awardsSheet.getRange(targetRowIdx, 7).setValue(author);
    awardsSheet.getRange(targetRowIdx, 8).setValue(now);
  } else {
    // Append new row for team
    const newRow = [
      cleanTeam,
      currentCert,
      currentMatch,
      newPic,
      newAdj,
      decisionReason,
      author,
      now
    ];
    awardsSheet.appendRow(newRow);
  }

  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
    SpreadsheetApp.flush();
  }

  // If associated with a ticket, update the Audit Queue
  if (ticketId) {
    try {
      const auditSs = resolveAuditSpreadsheet_();
      const queueSheet = auditSs ? auditSs.getSheetByName(SHEET.QUEUE) : null;
      if (queueSheet && queueSheet.getLastRow() > 1) {
        const qData = queueSheet.getDataRange().getValues();
        for (let q = 1; q < qData.length; q++) {
          if (String(qData[q][0] || '').trim() === String(ticketId).trim()) {
            const rowNum = q + 1;
            const hMap = headerMap_(queueSheet);
            if (hMap['Decision']) queueSheet.getRange(rowNum, hMap['Decision']).setValue('Approved');
            if (hMap['Net Point Adjustment']) queueSheet.getRange(rowNum, hMap['Net Point Adjustment']).setValue(pts);
            if (hMap['Auditor Assigned']) queueSheet.getRange(rowNum, hMap['Auditor Assigned']).setValue(author);
            if (hMap['Auditor Notes']) queueSheet.getRange(rowNum, hMap['Auditor Notes']).setValue(decisionReason);
            if (hMap['Decision Date']) queueSheet.getRange(rowNum, hMap['Decision Date']).setValue(now);
            if (hMap['Workflow Status']) queueSheet.getRange(rowNum, hMap['Workflow Status']).setValue('Closed');
            break;
          }
        }
      }
    } catch (err) {
      Logger.log('Could not update queue ticket ' + ticketId + ': ' + err.message);
    }
  }

  // Trigger synchronization of Season_Master_Ledger
  let syncResult = null;
  try {
    if (typeof runAuditAndSyncLedger === 'function') {
      syncResult = runAuditAndSyncLedger();
    } else if (typeof syncSeasonMasterLedger === 'function') {
      const auditSummary = (typeof auditFormResponses === 'function') ? auditFormResponses(masterSs) : { teamPoints: {} };
      syncResult = syncSeasonMasterLedger(masterSs, auditSummary.teamPoints);
    }
  } catch (err) {
    Logger.log('Warning during syncSeasonMasterLedger trigger: ' + err.message);
  }

  // Fetch updated ledger status
  const updatedLedger = getTeamLedgerPreCheck_(cleanTeam, masterSs);

  return {
    success: true,
    teamCode: cleanTeam,
    targetColumn: isPic ? 'pictureDay' : 'adjustment',
    pointsApplied: pts,
    previousPic: currentPic,
    newPic: newPic,
    previousAdj: currentAdj,
    newAdj: newAdj,
    reason: decisionReason,
    reviewer: author,
    ticketId: ticketId || null,
    revisedLedger: updatedLedger,
    message: `Applied ${pts >= 0 ? '+' : ''}${pts} pt(s) to ${cleanTeam} [${isPic ? 'pictureDay' : 'adjustment'}]. Total verified points: ${updatedLedger.totalPts !== undefined ? updatedLedger.totalPts : 'N/A'}. Status: ${updatedLedger.playoffStatus || 'Updated'}.`
  };
}

/**
 * UI Menu Action: Export dispute dossiers and display them in an interactive modal dialog.
 */
function menuExportDisputeDossiers() {
  const ui = SpreadsheetApp.getUi();
  const exportResult = exportDisputeDossiersForGem();

  if (exportResult.count === 0) {
    ui.alert(
      'AYSO 154 Playoff Audit',
      '✅ No unadjudicated dispute tickets found!\n\nAll tickets in the queue have been reviewed and closed.',
      ui.ButtonSet.OK
    );
    return;
  }

  const escapedMarkdown = exportResult.markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; color: #0F172A; background: #F8FAFC; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #002D62; padding-bottom: 12px; margin-bottom: 16px; }
          .title { font-size: 18px; font-weight: bold; color: #002D62; }
          .badge { background: #C8102E; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
          .btn-bar { display: flex; gap: 10px; margin-bottom: 14px; }
          .btn { background: #002D62; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
          .btn:hover { background: #001A38; }
          .btn-secondary { background: #64748B; }
          .btn-secondary:hover { background: #475569; }
          .status { font-size: 12px; color: #15803D; font-weight: bold; margin-left: 8px; display: none; }
          textarea { width: 100%; height: 420px; font-family: "SFMono-Regular", Consolas, Menlo, monospace; font-size: 12px; padding: 12px; border: 1px solid #CBD5E1; border-radius: 6px; background: #FFFFFF; resize: vertical; box-sizing: border-box; }
          .footer { font-size: 11px; color: #64748B; margin-top: 10px; text-align: right; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">📋 Playoff Dispute Dossiers (${exportResult.count} Pending)</div>
          <div class="badge">${exportResult.count} Tickets</div>
        </div>
        <div class="btn-bar">
          <button class="btn" onclick="copyDossier()">📋 Copy Markdown Dossier</button>
          <button class="btn btn-secondary" onclick="copyJson()">📦 Copy Structured JSON</button>
          <span id="copyStatus" class="status">✓ Copied to clipboard!</span>
        </div>
        <textarea id="dossierText" readonly>${escapedMarkdown}</textarea>
        <div class="footer">Feed this dossier into the custom Gem for adjudication recommendations. Tab 'Gem_Dispute_Dossiers' has also been refreshed.</div>

        <script>
          const rawJson = ${JSON.stringify(exportResult.json)};
          function copyDossier() {
            const ta = document.getElementById('dossierText');
            ta.select();
            document.execCommand('copy');
            showStatus('Markdown copied!');
          }
          function copyJson() {
            navigator.clipboard.writeText(rawJson).then(() => {
              showStatus('JSON copied!');
            });
          }
          function showStatus(msg) {
            const el = document.getElementById('copyStatus');
            el.innerText = '✓ ' + msg;
            el.style.display = 'inline';
            setTimeout(() => { el.style.display = 'none'; }, 3000);
          }
        </script>
      </body>
    </html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(720)
    .setHeight(560);

  ui.showModalDialog(htmlOutput, 'AYSO 154 - Gem Adjudication Dossiers');
}

/**
 * UI Menu Action: Prompt board member step-by-step to apply a Gem decision directly into Team_Awards.
 */
function menuApplyGemDecision() {
  const ui = SpreadsheetApp.getUi();

  // 1. Team Code
  const teamPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 1 of 5: Enter the Team Code (e.g., "10U - Boys - Faheem Armanyous"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (teamPrompt.getSelectedButton() !== ui.Button.OK) return;
  const teamCode = teamPrompt.getResponseText().trim();
  if (!teamCode) {
    ui.alert('Team code cannot be blank.');
    return;
  }

  // 2. Target Column
  const colPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 2 of 5: Target Column in Team_Awards?\nEnter "pictureDay" or "adjustment":',
    ui.ButtonSet.OK_CANCEL
  );
  if (colPrompt.getSelectedButton() !== ui.Button.OK) return;
  const targetCol = colPrompt.getResponseText().trim();

  // 3. Points
  const ptsPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 3 of 5: Number of points to add (e.g., 1 or 2):',
    ui.ButtonSet.OK_CANCEL
  );
  if (ptsPrompt.getSelectedButton() !== ui.Button.OK) return;
  const points = Number(ptsPrompt.getResponseText().trim());
  if (isNaN(points)) {
    ui.alert('Points must be a valid number.');
    return;
  }

  // 4. Reason
  const reasonPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 4 of 5: Reason / Audit Finding (e.g., "Approved Gem review - missing shift 10/24 verified on match card"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (reasonPrompt.getSelectedButton() !== ui.Button.OK) return;
  const reason = reasonPrompt.getResponseText().trim();

  // 5. Reviewer / Ticket ID
  const reviewerPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 5 of 5: Reviewer Name / Ticket ID (e.g., "Board Admin - R154-2026-0001"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (reviewerPrompt.getSelectedButton() !== ui.Button.OK) return;
  const reviewer = reviewerPrompt.getResponseText().trim();

  try {
    const res = applyGemDecisionToTeamAwards(teamCode, targetCol, points, reason, reviewer);
    ui.alert(
      '✅ Decision Applied Successfully',
      `${res.message}\n\nSeason_Master_Ledger has been re-synchronized.`,
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('❌ Error Applying Decision', err.message, ui.ButtonSet.OK);
  }
}

/**
 * Creates the dedicated Playoff Audit Bridge menu.
 */
function createPlayoffAuditMenu(ui) {
  const menuUi = ui || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getUi() : null);
  if (!menuUi) return;
  try {
    menuUi.createMenu('⚖️ Playoff Audit Bridge')
      .addItem('📋 Export Playoff Dispute Dossiers (for Gem)', 'menuExportDisputeDossiers')
      .addItem('⚖️ Apply Gem Adjudication Decision', 'menuApplyGemDecision')
      .addToUi();
  } catch (e) {
    Logger.log('Could not create Playoff Audit Bridge menu: ' + e.message);
  }
}

/**
 * Safe date formatter compatible with non-Apps-Script (Node.js) test environments.
 */
function formatDateTimeSafe_(date) {
  if (!date) return 'Not available';
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'EEE, MMM d, yyyy h:mm a') + ' PT';
  }
  return new Date(date).toISOString();
}

// getGameDayCheckinsSheet(ss) is declared once in Code.js (shared global scope).



if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    exportDisputeDossiersForGem,
    applyGemDecisionToTeamAwards,
    getTeamLedgerPreCheck_,
    getUnadjudicatedDisputes,
    formatDisputeDossier,
    menuExportDisputeDossiers,
    menuApplyGemDecision,
    createPlayoffAuditMenu,
    getAuditSubmissionsSheet,
    ADJUDICATION_SHEET,
    AUDIT,
    SHEET,
    QUEUE_HEADERS,
    SHIFT_HEADERS
  };
}
```

---

## AdminConfig.js
```javascript
/**
 * AYSO Region 154 - Admin Configuration Engine
 * Generates and reads the unified Admin_Config control tab.
 */

const ADMIN_CONFIG_SHEET = "Admin_Config";
var PRODUCTION_SHEET_ID = (typeof PRODUCTION_SHEET_ID !== 'undefined') ? PRODUCTION_SHEET_ID : "1RWPNUjVeRRcHiI18b8_IzLn1RzKHG3hLJvIbZjWq6Bc";
var PRODUCTION_FORM_ID = (typeof PRODUCTION_FORM_ID !== 'undefined') ? PRODUCTION_FORM_ID : "1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI";

/**
 * Run this function once from the Apps Script editor to build and format the sheet.
 */
function setupAdminConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(ADMIN_CONFIG_SHEET);
  }

  // Clear existing content and formatting
  sheet.clear();
  sheet.clearFormats();

  // Set visual column widths
  sheet.setColumnWidth(1, 240); // A: Allowlist Email
  sheet.setColumnWidth(2, 170); // B: Name / Role
  sheet.setColumnWidth(3, 35);  // C: Spacer
  sheet.setColumnWidth(4, 180); // D: Setting Key
  sheet.setColumnWidth(5, 120); // E: Setting Value
  sheet.setColumnWidth(6, 35);  // F: Spacer
  sheet.setColumnWidth(7, 140); // G: Supplemental Division
  sheet.setColumnWidth(8, 170); // H: Supplemental Coach
  sheet.setColumnWidth(9, 240); // I: Calculated Team Code

  // Card Category Headers (Row 1)
  sheet.getRange("A1:B1").merge().setValue("BOARD ACCESS ALLOWLIST");
  sheet.getRange("D1:E1").merge().setValue("GLOBAL DASHBOARD SETTINGS");
  sheet.getRange("G1:I1").merge().setValue("SUPPLEMENTAL ROSTER (LATE TEAMS)");

  // Column Sub-headers (Row 2)
  const headers = [
    ["Email Address", "Name / Role", "", "Setting Key", "Current Value", "", "Division", "Coach Name", "Full Team Code (Auto)"]
  ];
  sheet.getRange("A2:I2").setValues(headers);

  // Default Global Settings Data (Starting Row 3)
  const defaultSettings = [
    ["PlayoffThreshold", 17],
    ["RefMaxCap", 10],
    ["FieldMarshalCap", 2],
    ["FieldSetupCap", 1],
    ["PictureDayCap", 2],
    ["StandingsFrozen", false]
  ];
  sheet.getRange("D3:E8").setValues(defaultSettings);

  // Set Checkbox Data Validation for "StandingsFrozen" (Cell E8)
  const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange("E8").setDataValidation(checkboxRule);

  // Pre-seed the Calculated Team Code formula down the Supplemental Roster column (Row 3 to 50)
  sheet.getRange("I3:I50").setFormulaR1C1('=IF(RC[-2]="","", RC[-2] & " - " & RC[-1])');

  // Styling: Category Headers (Row 1)
  const categoryRanges = ["A1:B1", "D1:E1", "G1:I1"];
  categoryRanges.forEach(ref => {
    sheet.getRange(ref)
      .setBackground("#0F2537") // Navy
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
  });

  // Styling: Column Headers (Row 2)
  const headerRanges = ["A2:B2", "D2:E2", "G2:I2"];
  headerRanges.forEach(ref => {
    sheet.getRange(ref)
      .setBackground("#E2E8F0") // Slate light
      .setFontColor("#1E293B")
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
  });

  // Alignments & Clean Borders
  sheet.getRange("A1:I50").setFontFamily("Arial").setFontSize(10);
  sheet.getRange("A1:I2").setFontSize(10);
  sheet.getRange("D3:D8").setFontWeight("bold").setFontColor("#334155");
  sheet.getRange("E3:E7").setHorizontalAlignment("center");
  sheet.getRange("I3:I50").setFontColor("#64748B"); // Gray tone for auto-generated codes

  // Set row heights
  sheet.setRowHeight(1, 28);
  sheet.setRowHeight(2, 24);

  SpreadsheetApp.flush();
  Logger.log("✅ Admin_Config sheet initialized and styled successfully.");
}

/**
 * Reads all authorized emails from Column A.
 */
function getAuthorizedBoardEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return [];

  const values = sheet.getRange(3, 1, sheet.getLastRow() - 2, 1).getValues();
  return values
    .map(row => String(row[0] || "").trim().toLowerCase())
    .filter(email => email.length > 0 && email.indexOf("@") !== -1);
}

/**
 * Reads global key-value settings from Columns D and E.
 */
function getAdminConfigSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  const defaults = {
    PlayoffThreshold: 17,
    RefMaxCap: 10,
    FieldMarshalCap: 2,
    FieldSetupCap: 1,
    PictureDayCap: 2,
    StandingsFrozen: false
  };

  if (!sheet || sheet.getLastRow() < 3) return defaults;

  const data = sheet.getRange(3, 4, 6, 2).getValues();
  const settings = {};

  data.forEach(row => {
    const key = String(row[0]).trim();
    if (key) {
      settings[key] = row[1];
    }
  });

  return Object.assign(defaults, settings);
}

/**
 * Writes a single Global Dashboard Setting (Columns D/E) by key. Used to keep
 * control-panel writes and the Admin_Config sheet as one source of truth
 * instead of forking a second copy in the legacy Settings sheet.
 */
function setAdminConfigSetting(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  if (!sheet) return false;

  const lastRow = Math.max(sheet.getLastRow(), 8);
  const keys = sheet.getRange(3, 4, lastRow - 2, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0] || '').trim() === key) {
      sheet.getRange(3 + i, 5).setValue(value);
      return true;
    }
  }
  sheet.getRange(lastRow + 1, 4, 1, 2).setValues([[key, value]]);
  return true;
}

/**
 * Reads late-added coaches from Columns G through I.
 */
function getSupplementalTeams() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return [];

  const values = sheet.getRange(3, 7, sheet.getLastRow() - 2, 3).getValues();
  const teams = [];

  values.forEach(row => {
    const division = String(row[0] || "").trim();
    const coach = String(row[1] || "").trim();
    const fullCode = String(row[2] || "").trim();

    if (division && coach) {
      teams.push({
        division: division,
        coach: coach,
        teamCode: fullCode || (division + " - " + coach)
      });
    }
  });

  return teams;
}
```

---

## BoardApp.js
```javascript
/**
 * ============================================================================
 * AYSO REGION 154 - BOARD PORTAL SERVER BACKEND
 * ============================================================================
 * File: BoardApp.gs
 * Description: Enforces board authentication, compiles division aggregates,
 *              scans for submission anomalies, and processes award/uniform overrides.
 * 
 * VERSION & CHANGE HISTORY:
 * - v1.0 (Aug 2026): Initial secure board authentication and rollup engine.
 * - v2.0 (Sep 8, 2026): Added direct HTML rendering routing in doGet.
 * - v3.0 (Sep 9, 2026): Calibrated to support Dual ARs per home match, exclude paid 
 *                      NOCRA refs, enforce individual slot deduplication, and support 
 *                      same-day Field Marshal shifts.
 * - v3.1 (Sep 9, 2026): Updated anomaly engine to label NOCRA assignments with
 *                      neutral status "NOCRA - No Points".
 * ============================================================================
 */

function renderBoardApp() {
  return HtmlService.createHtmlOutputFromFile('BoardPortal')
    .setTitle('AYSO Region 154 - Board Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getBoardUserSession() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
  const authorizedEmails = (typeof getAuthorizedBoardEmails === 'function') 
    ? getAuthorizedBoardEmails() 
    : [];

  const isDraftMode = (authorizedEmails.length === 0);
  const isAuthorized = isDraftMode || authorizedEmails.includes(userEmail);

  return {
    email: userEmail || "Draft Mode Reviewer",
    isAuthorized: isAuthorized,
    isDraftMode: isDraftMode
  };
}

function getBoardDashboardData() {
  const session = getBoardUserSession();
  if (!session.isAuthorized) {
    return {
      session: session,
      error: "Access Denied: Account (" + session.email + ") is not authorized on the Admin_Config allowlist."
    };
  }

  const settings = (typeof getAdminConfigSettings === 'function') 
    ? getAdminConfigSettings() 
    : { PlayoffThreshold: 17, RefMaxCap: 10, FieldMarshalCap: 2, FieldSetupCap: 1, PictureDayCap: 2 };

  const playoffThreshold = Number(settings.PlayoffThreshold) || 17;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const allTeams = [...MASTER_TEAMS];
  if (typeof getSupplementalTeams === 'function') {
    const supp = getSupplementalTeams();
    supp.forEach(st => {
      if (!allTeams.includes(st.teamCode)) allTeams.push(st.teamCode);
    });
  }

  const respSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  const respRows = (respSheet && respSheet.getLastRow() > 1) ? respSheet.getDataRange().getValues() : [];
  
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const awardRows = (awardsSheet && awardsSheet.getLastRow() > 1) ? awardsSheet.getDataRange().getValues() : [];

  const teamAggregates = {};
  allTeams.forEach(code => {
    teamAggregates[code] = { ref: 0, fm: 0, setup: 0, pic: 0, certRef: 0, matchtrak: 0, awards: 0, total: 0 };
  });

  const seenVolunteerSlots = new Set();

  for (let i = 1; i < respRows.length; i++) {
    const row = respRows[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    const dateStr = (timestamp instanceof Date)
      ? Utilities.formatDate(timestamp, 'America/Los_Angeles', 'MMM d, yyyy')
      : String(timestamp).split(' ')[0];

    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const volId = email || (firstName + ' ' + lastName).trim().toLowerCase();

    const dutyRaw = String(row[4] || '').trim();
    const refPos = String(row[5] || '').trim();
    const rRef = String(row[6] || '').trim();
    const refTime = String(row[7] || '').trim();

    const rFm = String(row[9] || '').trim();
    const fmTime = String(row[11] || '').trim();

    const rSetup = String(row[12] || '').trim();

    allTeams.forEach(code => {
      const agg = teamAggregates[code];
      let matchedRole = '';
      let slotTime = '';
      let isNocra = false;

      if (rRef === code || (/ref/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        matchedRole = 'ref';
        slotTime = refTime || 'GameTime';
        if (/nocra|ussf/i.test(refPos)) isNocra = true;
      } else if (rFm === code || (/marshal/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        matchedRole = 'fm';
        slotTime = fmTime || 'ShiftTime';
      } else if (rSetup === code || (/set\s*up/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        matchedRole = 'setup';
        slotTime = 'FridayNight';
      } else if (/picture/i.test(dutyRaw) && row.indexOf(code) !== -1) {
        matchedRole = 'pic';
        slotTime = 'PicShift';
      }

      if (matchedRole && !isNocra) {
        const slotKey = volId + '_' + dateStr + '_' + normalizeTimeSlot(slotTime) + '_' + matchedRole;
        if (!seenVolunteerSlots.has(slotKey)) {
          seenVolunteerSlots.add(slotKey);
          if (matchedRole === 'ref' && agg.ref < settings.RefMaxCap) agg.ref++;
          else if (matchedRole === 'fm' && agg.fm < settings.FieldMarshalCap) agg.fm++;
          else if (matchedRole === 'setup' && agg.setup < settings.FieldSetupCap) agg.setup++;
          else if (matchedRole === 'pic' && agg.pic < settings.PictureDayCap) agg.pic++;
        }
      }
    });
  }

  for (let j = 1; j < awardRows.length; j++) {
    const aRow = awardRows[j];
    const aCode = String(aRow[1] || '').trim();
    const aType = String(aRow[2] || '').trim();
    const aPts = Number(aRow[3]) || 0;

    if (teamAggregates[aCode]) {
      if (aType.includes('Uniform') || aType.includes('Disqualification')) {
        teamAggregates[aCode].ref = Math.max(0, teamAggregates[aCode].ref + aPts);
      } else if (aType === 'Certified Team Referees') {
        teamAggregates[aCode].certRef = Math.min(CAP_CERTIFIED_REF, teamAggregates[aCode].certRef + aPts);
      } else if (aType === 'MatchTrak Filled by Sep 26') {
        teamAggregates[aCode].matchtrak = Math.min(CAP_MATCHTRAK_BONUS, teamAggregates[aCode].matchtrak + aPts);
      } else {
        teamAggregates[aCode].awards += aPts;
      }
    }
  }

  const teamList = allTeams.map(code => {
    const agg = teamAggregates[code] || { ref: 0, fm: 0, setup: 0, pic: 0, certRef: 0, matchtrak: 0, awards: 0 };
    const maxPossible = Number(settings.RefMaxCap) + Number(settings.FieldMarshalCap) +
      Number(settings.FieldSetupCap) + Number(settings.PictureDayCap) + CAP_CERTIFIED_REF + CAP_MATCHTRAK_BONUS;
    const total = Math.max(0, Math.min(maxPossible, agg.ref + agg.fm + agg.setup + agg.pic + agg.certRef + agg.matchtrak + agg.awards));
    const parts = code.split(' - ');
    const division = parts.length >= 3 ? parts[0] + ' - ' + parts[1] : parts[0];
    const coach = parts.length >= 3 ? parts.slice(2).join(' - ') : code;

    return {
      teamCode: code,
      division: division,
      coach: coach,
      totalPoints: total,
      qualified: total >= playoffThreshold,
      categories: agg
    };
  });

  const anomalies = scanSubmissionsForAnomalies();

  return {
    session: session,
    settings: settings,
    teams: teamList,
    anomalyCount: anomalies.length,
    syncTimestamp: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a')
  };
}

/**
 * Scan Submissions for Anomalies (NOCRA alerts, rapid double-clicks, and same-person collisions)
 */
function scanSubmissionsForAnomalies() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const respSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  if (!respSheet || respSheet.getLastRow() < 2) return [];

  const rows = respSheet.getDataRange().getValues();
  const anomalies = [];

  const submissionsByVolunteer = {};
  const refCenterSlots = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const rowNum = i + 1;
    const rawTimestamp = row[0];
    const parsedTime = (rawTimestamp instanceof Date) ? rawTimestamp.getTime() : new Date(rawTimestamp).getTime();
    const dateStr = (rawTimestamp instanceof Date) 
      ? Utilities.formatDate(rawTimestamp, 'America/Los_Angeles', 'MMM d, yyyy')
      : String(rawTimestamp).split(' ')[0];

    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const fullName = (firstName + ' ' + lastName).trim() || email;
    const role = String(row[4] || '').trim();
    const refPos = String(row[5] || '').trim();
    const refTeam = String(row[6] || '').trim();
    const gameTime = String(row[7] || '').trim();
    const refField = String(row[8] || '').trim();
    const fmTeam = String(row[9] || '').trim();
    const fmField = String(row[10] || '').trim();
    const fmTime = String(row[11] || '').trim();
    const setupTeam = String(row[12] || '').trim();
    const setupField = String(row[13] || '').trim();

    const teamCode = refTeam || fmTeam || setupTeam || 'Unknown Team';
    const field = refField || fmField || setupField || 'N/A';
    const time = gameTime || fmTime || 'N/A';

    // Normalized purely for slot/duplicate comparisons; entry.time keeps the raw
    // display value so "8:00 AM" and "8:00am" still resolve to one slot without
    // mangling what the board actually sees.
    const normTime = normalizeTimeSlot(time);

    const entry = {
      row: rowNum,
      date: dateStr,
      timestamp: parsedTime,
      fullName: fullName,
      email: email,
      role: role,
      refPos: refPos,
      teamCode: teamCode,
      field: field,
      time: time,
      normTime: normTime,
      flags: []
    };

    // 1. NOCRA Paid Referee Check
    if (/nocra|ussf/i.test(refPos)) {
      entry.flags.push({
        type: 'NOCRA_PAID',
        severity: 'info',
        message: `NOCRA / USSF Assignment (${refPos}): Logged as 'NOCRA - No Points' (0 pts).`
      });
    }

    // 2. Rapid Duplicate Check (<15 min from same person)
    const volKey = email || fullName.toLowerCase();
    if (volKey) {
      if (!submissionsByVolunteer[volKey]) submissionsByVolunteer[volKey] = [];
      const priorEntries = submissionsByVolunteer[volKey];
      for (const p of priorEntries) {
        const diffMinutes = Math.abs(parsedTime - p.timestamp) / 60000;
        if (diffMinutes < 15 && p.role === role && p.normTime === normTime) {
          entry.flags.push({
            type: 'RAPID_DUPLICATE',
            severity: 'warning',
            message: `Submitted within ${Math.round(diffMinutes)} mins of Row #${p.row} by ${fullName}`
          });
          break;
        }
      }
      submissionsByVolunteer[volKey].push(entry);
    }

    // 3. Conflicting Center Referee Check
    if (/ref/i.test(role) && field !== 'N/A' && time !== 'N/A') {
      // Assistant Referees (Dual ARs) must never be treated as Center Referees, even
      // though "Assistant Referee (AYSO)" contains the substring "Referee (AYSO)".
      const isAssistant = /assistant/i.test(refPos);
      const isCenter = !isAssistant &&
        (refPos.trim().toLowerCase() === 'referee (ayso)' || /center|head/i.test(refPos));
      if (isCenter) {
        const slotKey = dateStr + '_' + field.toLowerCase() + '_' + normalizeTimeSlot(time);
        if (refCenterSlots[slotKey]) {
          entry.flags.push({
            type: 'SLOT_COLLISION',
            severity: 'danger',
            message: `Conflicting Center Ref: Row #${refCenterSlots[slotKey].row} also claimed ${field} at ${time}`
          });
        } else {
          refCenterSlots[slotKey] = entry;
        }
      }
    }

    if (entry.flags.length > 0) {
      anomalies.push(entry);
    }
  }

  return anomalies.reverse();
}

function getBoardTeamDetails(teamCode) {
  const session = getBoardUserSession();
  if (!session.isAuthorized) throw new Error("Unauthorized");
  return getTeamStatsData(teamCode);
}

function applyBoardAwardOverride(teamCode, awardType, points, note) {
  const session = getBoardUserSession();
  if (!session.isAuthorized) throw new Error("Unauthorized");

  const pts = Number(points);
  if (isNaN(pts)) throw new Error("Points value must be a valid number");

  const fullNote = (note ? note + " " : "") + "[Authorized by: " + session.email + "]";

  if (typeof setTeamAward === 'function') {
    setTeamAward(teamCode, awardType, pts, fullNote);
  } else {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Team_Awards');
    if (!sheet) {
      sheet = ss.insertSheet('Team_Awards');
      sheet.appendRow(['Timestamp', 'TeamCode', 'AwardType', 'Points', 'Note', 'Author']);
    }
    sheet.appendRow([new Date(), teamCode, awardType, pts, fullNote, session.email]);
  }

  return {
    success: true,
    updatedStats: getBoardTeamDetails(teamCode)
  };
}
```

---

## BoardPortal.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AYSO Region 154 - Board Portal</title>
  <style>
    :root {
      --primary: #0F2537;
      --primary-light: #1E3A52;
      --accent: #C8102E;
      --bg: #F8FAFC;
      --card-bg: #FFFFFF;
      --text: #0F172A;
      --text-muted: #64748B;
      --border: #E2E8F0;
      --success: #16A34A;
      --success-bg: #DCFCE7;
      --warning: #D97706;
      --warning-bg: #FEF3C7;
      --danger: #DC2626;
      --danger-bg: #FEE2E2;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding-bottom: 60px; }

    header {
      background: var(--primary);
      color: #FFFFFF;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header-title { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .user-pill {
      background: var(--primary-light);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid rgba(255,255,255,0.15);
    }

    .banner {
      background: var(--primary-light);
      color: #FFFFFF;
      padding: 14px 24px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      border-bottom: 3px solid var(--accent);
    }
    .draft-badge {
      background: var(--warning-bg);
      color: var(--warning);
      padding: 10px 24px;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
      border-bottom: 1px solid var(--border);
    }

    .container { max-width: 1200px; margin: 24px auto; padding: 0 16px; }

    /* Tab Switcher */
    .tab-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      border-bottom: 2px solid var(--border);
      padding-bottom: 8px;
    }
    .tab-btn {
      background: none;
      border: none;
      font-size: 15px;
      font-weight: 700;
      color: var(--text-muted);
      cursor: pointer;
      padding: 8px 16px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tab-btn.active {
      color: var(--primary);
      background: #E2E8F0;
    }
    .tab-counter {
      background: var(--danger);
      color: #FFF;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 10px;
    }

    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      padding: 18px;
      border-radius: 8px;
      border: 1px solid var(--border);
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .stat-label { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
    .stat-value { font-size: 26px; font-weight: 700; margin-top: 4px; }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 20px;
    }
    .input-control {
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      background: #FFFFFF;
      flex: 1;
      min-width: 200px;
    }

    .team-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
    }
    .team-card {
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px solid var(--border);
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.15s ease;
    }
    .team-card:hover { transform: translateY(-2px); }
    .team-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .team-division { font-size: 12px; font-weight: 700; color: var(--accent); }
    .team-coach { font-size: 16px; font-weight: 700; margin-top: 2px; }

    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; }
    .badge-qualified { background: var(--success-bg); color: var(--success); }
    .badge-pending { background: var(--warning-bg); color: var(--warning); }
    .badge-danger { background: var(--danger-bg); color: var(--danger); }

    .progress-bar-bg { background: #E2E8F0; border-radius: 6px; height: 8px; overflow: hidden; margin: 12px 0; }
    .progress-bar-fill { background: var(--success); height: 100%; }

    .btn {
      background: var(--primary);
      color: #FFFFFF;
      border: none;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      text-align: center;
      margin-top: 12px;
    }
    .btn:hover { background: var(--primary-light); }
    .btn-sm { padding: 6px 12px; font-size: 12px; width: auto; margin-top: 0; }
    .btn-danger { background: var(--danger); }
    .btn-danger:hover { background: #B91C1C; }

    /* Anomaly Table Styling */
    .anomaly-card {
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px solid var(--border);
      padding: 16px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .anomaly-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .anomaly-flag-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-block;
    }
    .flag-warning { background: var(--warning-bg); color: var(--warning); border: 1px solid #FDE68A; }
    .flag-danger { background: var(--danger-bg); color: var(--danger); border: 1px solid #FECACA; }
    .flag-info { background: #E0F2FE; color: #0284C7; border: 1px solid #BAE6FD; }

    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.6);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 100;
    }
    .modal {
      background: #FFFFFF;
      border-radius: 10px;
      max-width: 650px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      padding: 24px;
      position: relative;
    }
    .modal-close { position: absolute; top: 18px; right: 18px; font-size: 20px; font-weight: 700; cursor: pointer; color: var(--text-muted); }
    .modal-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .audit-list { margin-top: 16px; max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
    .audit-row { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
    .audit-row:last-child { border-bottom: none; }

    .override-box { margin-top: 20px; padding: 16px; background: #F1F5F9; border-radius: 8px; }
  </style>
</head>
<body>

  <header>
    <div class="header-title">⚽ AYSO Region 154 | Board Control Portal</div>
    <div class="user-pill" id="userEmailBadge">Authenticating...</div>
  </header>

  <div class="banner">
    ⚽ POST-SEASON ELIGIBILITY: Each team is required to have a minimum of 17 points to be eligible for post-season play (Cypress Cup & Playoffs)!
  </div>

  <div id="draftBanner" class="draft-badge" style="display: none;">
    ⚠️ DRAFT MODE: Allowlist is currently empty in Admin_Config. Open for preview and verification.
  </div>

  <div class="container">
    <div class="tab-bar">
      <button class="tab-btn active" id="tabTeams" onclick="switchTab('teams')">
        👥 Teams & Standings
      </button>
      <button class="tab-btn" id="tabAnomalies" onclick="switchTab('anomalies')">
        🚨 Integrity & Audit Queue <span class="tab-counter" id="anomalyCounterBadge" style="display:none;">0</span>
      </button>
    </div>

    <!-- VIEW 1: TEAMS & STANDINGS -->
    <div id="viewTeams">
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Total Teams</div>
          <div class="stat-value" id="statTotalTeams">--</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Playoff Qualified</div>
          <div class="stat-value" id="statQualified" style="color: var(--success);">--</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Playoff Threshold</div>
          <div class="stat-value" id="statThreshold">17 pts</div>
        </div>
      </div>

      <div class="controls">
        <input type="text" id="searchInput" class="input-control" placeholder="🔍 Search coach or division..." oninput="filterTeams()">
        <select id="divisionFilter" class="input-control" onchange="filterTeams()">
          <option value="">All Divisions</option>
        </select>
        <select id="statusFilter" class="input-control" onchange="filterTeams()">
          <option value="">All Statuses</option>
          <option value="qualified">Qualified (17+)</option>
          <option value="pending">In Progress (&lt;17)</option>
        </select>
      </div>

      <div class="team-grid" id="teamsContainer">
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
          Loading team standings and point audits...
        </div>
      </div>
    </div>

    <!-- VIEW 2: ANOMALY / AUDIT QUEUE -->
    <div id="viewAnomalies" style="display: none;">
      <div style="margin-bottom: 16px; color: var(--text-muted); font-size: 14px;">
        Automated scan detecting rapid double-clicks (&lt;15 min), same-day duplicates, and referee field slot collisions.
      </div>
      <div id="anomaliesList">
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          Scanning form submissions for anomalies...
        </div>
      </div>
    </div>
  </div>

  <!-- Detail & Point Override Modal -->
  <div class="modal-overlay" id="detailModal">
    <div class="modal">
      <span class="modal-close" onclick="closeModal()">&times;</span>
      <div class="team-division" id="modalDivision"></div>
      <div class="modal-title" id="modalTeamName"></div>
      <div id="modalScoreSummary" style="font-weight: 700; font-size: 16px; margin-top: 4px;"></div>

      <h4 style="margin-top: 16px; font-size: 14px;">Audit History & Submissions</h4>
      <div class="audit-list" id="modalAuditList">
        <div style="padding: 12px; color: var(--text-muted);">Fetching audit records...</div>
      </div>

      <div class="override-box">
        <h4 style="font-size: 14px; margin-bottom: 8px;">Board Point Override & Rule Adjustments</h4>
        <label style="font-size: 12px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px;">Adjustment / Award Type</label>
        <select id="overrideType" class="input-control" style="width: 100%; margin-bottom: 8px;" onchange="handleOverrideTypeChange()">
          <option value="Uniform Non-Compliance Deduction">Uniform Non-Compliance Deduction (-1 pt)</option>
          <option value="Referee Assignment Disqualification">Referee Disqualification (-1 pt)</option>
          <option value="Certified Team Referees">Certified Team Referees (+1 pt, max 5)</option>
          <option value="MatchTrak Filled by Sep 26">MatchTrak Filled by Sep 26 (+2 pts)</option>
          <option value="Discretionary Board Credit">Discretionary Board Credit (+1 pt)</option>
          <option value="Discretionary Board Deduction">Discretionary Board Deduction (-1 pt)</option>
        </select>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="number" id="overridePts" class="input-control" placeholder="Points (+/-)" value="-1" style="max-width: 120px;">
          <input type="text" id="overrideNote" class="input-control" placeholder="Reason (e.g., referee not in full uniform at LJHS #4)">
        </div>
        <button class="btn" onclick="submitOverride()">Apply Adjustment</button>
      </div>
    </div>
  </div>

  <script>
    let globalData = null;
    let currentTeamCode = null;

    window.onload = function() {
      google.script.run
        .withSuccessHandler(renderDashboard)
        .withFailureHandler(handleError)
        .getBoardDashboardData();
    };

    function renderDashboard(data) {
      if (data.error) {
        document.body.innerHTML = '<div style="padding: 40px; text-align: center; color: red;">' + data.error + '</div>';
        return;
      }

      globalData = data;
      document.getElementById('userEmailBadge').innerText = data.session.email;
      if (data.session.isDraftMode) {
        document.getElementById('draftBanner').style.display = 'block';
      }

      if (data.anomalyCount > 0) {
        const badge = document.getElementById('anomalyCounterBadge');
        badge.innerText = data.anomalyCount;
        badge.style.display = 'inline-block';
      }

      document.getElementById('statThreshold').innerText = (data.settings.PlayoffThreshold || 17) + " pts";
      document.getElementById('statTotalTeams').innerText = data.teams.length;
      document.getElementById('statQualified').innerText = data.teams.filter(t => t.qualified).length;

      const divisions = [...new Set(data.teams.map(t => t.division))].sort();
      const divSelect = document.getElementById('divisionFilter');
      divSelect.innerHTML = '<option value="">All Divisions</option>';
      divisions.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.innerText = d;
        divSelect.appendChild(opt);
      });

      renderTeamCards(data.teams);
    }

    function switchTab(tab) {
      if (tab === 'teams') {
        document.getElementById('tabTeams').className = 'tab-btn active';
        document.getElementById('tabAnomalies').className = 'tab-btn';
        document.getElementById('viewTeams').style.display = 'block';
        document.getElementById('viewAnomalies').style.display = 'none';
      } else {
        document.getElementById('tabTeams').className = 'tab-btn';
        document.getElementById('tabAnomalies').className = 'tab-btn active';
        document.getElementById('viewTeams').style.display = 'none';
        document.getElementById('viewAnomalies').style.display = 'block';
        loadAnomalies();
      }
    }

    function loadAnomalies() {
      const container = document.getElementById('anomaliesList');
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">Running real-time audit scanner...</div>';

      google.script.run
        .withSuccessHandler(renderAnomalies)
        .withFailureHandler(handleError)
        .scanSubmissionsForAnomalies();
    }

    function renderAnomalies(anomalies) {
      const container = document.getElementById('anomaliesList');
      container.innerHTML = '';

      if (!anomalies || anomalies.length === 0) {
        container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--success); font-weight: 700;">✅ Clean Sheet! No duplicates, collisions, or rapid submissions detected.</div>';
        return;
      }

      anomalies.forEach(a => {
        const card = document.createElement('div');
        card.className = 'anomaly-card';

        let flagsHtml = '';
        a.flags.forEach(f => {
          const pillClass = f.severity === 'danger' ? 'flag-danger' : (f.severity === 'warning' ? 'flag-warning' : 'flag-info');
          flagsHtml += `<div class="anomaly-flag-pill ${pillClass}">⚠️ ${f.message}</div>`;
        });

        card.innerHTML = `
          <div class="anomaly-header">
            <div>
              <strong style="font-size: 15px;">${a.teamCode}</strong>
              <div style="font-size: 13px; color: var(--text-muted);">
                Volunteer: <strong>${a.fullName}</strong> (${a.email || 'No email'}) • ${a.date}
              </div>
            </div>
            <div style="text-align: right; font-size: 12px; color: var(--text-muted);">
              Row #${a.row} • ${a.role} (${a.field} @ ${a.time})
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${flagsHtml}
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px;">
            <button class="btn btn-sm btn-danger" onclick="triggerUniformDeduction('${encodeURIComponent(a.teamCode)}', '${encodeURIComponent(a.fullName)}', '${encodeURIComponent(a.field)}')">
              Apply Uniform Violation (-1)
            </button>
            <button class="btn btn-sm" onclick="openModal('${encodeURIComponent(a.teamCode)}')">
              Inspect Team Standings
            </button>
          </div>
        `;
        container.appendChild(card);
      });
    }

    function triggerUniformDeduction(teamCode, volunteer, field) {
      const code = decodeURIComponent(teamCode);
      const vol = decodeURIComponent(volunteer);
      const fld = decodeURIComponent(field);

      if (confirm(`Apply a -1 Point Non-Uniform Deduction to ${code} for volunteer ${vol} at ${fld}?`)) {
        google.script.run
          .withSuccessHandler(() => {
            alert("Uniform deduction applied and logged to audit.");
            location.reload();
          })
          .withFailureHandler(handleError)
          .applyBoardAwardOverride(code, "Uniform Non-Compliance Deduction", -1, `Referee not in full uniform: ${vol} at ${fld}`);
      }
    }

    function renderTeamCards(teams) {
      const container = document.getElementById('teamsContainer');
      container.innerHTML = '';

      if (teams.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No teams match the current filters.</div>';
        return;
      }

      const threshold = globalData.settings.PlayoffThreshold || 17;

      teams.forEach(t => {
        const pct = Math.min(100, Math.round((t.totalPoints / threshold) * 100));
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML = `
          <div>
            <div class="team-card-header">
              <div>
                <div class="team-division">${t.division}</div>
                <div class="team-coach">${t.coach}</div>
              </div>
              <span class="badge ${t.qualified ? 'badge-qualified' : 'badge-pending'}">
                ${t.qualified ? '🏆 QUALIFIED' : t.totalPoints + ' / ' + threshold + ' pts'}
              </span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${pct}%;"></div>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between;">
              <span>Ref: ${t.categories.ref} | FM: ${t.categories.fm} | Set: ${t.categories.setup}</span>
              <span>Awards: ${t.categories.awards + t.categories.certRef + t.categories.matchtrak}</span>
            </div>
          </div>
          <button class="btn" onclick="openModal('${encodeURIComponent(t.teamCode)}')">Inspect & Overrides</button>
        `;
        container.appendChild(card);
      });
    }

    function filterTeams() {
      if (!globalData) return;
      const search = document.getElementById('searchInput').value.toLowerCase();
      const division = document.getElementById('divisionFilter').value;
      const status = document.getElementById('statusFilter').value;

      const filtered = globalData.teams.filter(t => {
        const matchSearch = t.teamCode.toLowerCase().includes(search);
        const matchDiv = !division || t.division === division;
        const matchStatus = !status || (status === 'qualified' ? t.qualified : !t.qualified);
        return matchSearch && matchDiv && matchStatus;
      });

      renderTeamCards(filtered);
    }

    function handleOverrideTypeChange() {
      const type = document.getElementById('overrideType').value;
      const ptsInput = document.getElementById('overridePts');
      if (type.includes('Deduction') || type.includes('Disqualification')) {
        ptsInput.value = -1;
      } else if (type === 'MatchTrak Filled by Sep 26') {
        ptsInput.value = 2;
      } else {
        ptsInput.value = 1;
      }
    }

    function openModal(encodedTeam) {
      currentTeamCode = decodeURIComponent(encodedTeam);
      const team = globalData.teams.find(t => t.teamCode === currentTeamCode);
      if (!team) return;

      document.getElementById('modalDivision').innerText = team.division;
      document.getElementById('modalTeamName').innerText = team.coach;
      document.getElementById('modalScoreSummary').innerText = 'Total Points: ' + team.totalPoints + ' (Playoff Goal: ' + (globalData.settings.PlayoffThreshold || 17) + ' pts)';
      document.getElementById('modalAuditList').innerHTML = '<div style="padding: 12px; color: var(--text-muted);">Fetching detailed audit records...</div>';
      handleOverrideTypeChange();
      document.getElementById('detailModal').style.display = 'flex';

      google.script.run
        .withSuccessHandler(renderAuditList)
        .withFailureHandler(handleError)
        .getBoardTeamDetails(currentTeamCode);
    }

    function renderAuditList(stats) {
      const list = document.getElementById('modalAuditList');
      list.innerHTML = '';
      if (!stats.audit || stats.audit.length === 0) {
        list.innerHTML = '<div style="padding: 12px; color: var(--text-muted);">No submissions or audit records found.</div>';
        return;
      }
      stats.audit.forEach(a => {
        const row = document.createElement('div');
        row.className = 'audit-row';
        const isDeduction = a.points < 0;
        row.innerHTML = `
          <div>
            <strong>${a.duty}</strong> (${a.date})
            ${a.note ? '<div style="font-size: 11px; color: var(--text-muted);">' + a.note + '</div>' : ''}
          </div>
          <div>
            <span style="font-weight: 700; color: ${isDeduction ? 'var(--danger)' : (a.points > 0 ? 'var(--success)' : 'var(--text-muted)')};">
              ${a.points > 0 ? '+' : ''}${a.points} pt
            </span> [${a.status}]
          </div>
        `;
        list.appendChild(row);
      });
    }

    function submitOverride() {
      const type = document.getElementById('overrideType').value;
      const pts = document.getElementById('overridePts').value;
      const note = document.getElementById('overrideNote').value;

      if (!pts || isNaN(pts)) {
        alert("Please enter a valid point quantity.");
        return;
      }

      google.script.run
        .withSuccessHandler(() => {
          alert("Adjustment applied successfully!");
          closeModal();
          location.reload();
        })
        .withFailureHandler(handleError)
        .applyBoardAwardOverride(currentTeamCode, type, pts, note);
    }

    function closeModal() {
      document.getElementById('detailModal').style.display = 'none';
      currentTeamCode = null;
    }

    function handleError(err) {
      alert("Error: " + err.message);
    }
  </script>
</body>
</html>
```

---

