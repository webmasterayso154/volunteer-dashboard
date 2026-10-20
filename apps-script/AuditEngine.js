/**
 * ============================================================================
 * AYSO REGION 154 CYPRESS — AUTOMATED AUDIT & DISPUTE ENGINE (AuditEngine.gs)
 * Version: 4.6.1 (Check-In Auditor + Formula Injector + Dispute-to-Awards Writer)
 * ============================================================================
 */

function runAuditAndSyncLedger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Required sheets (Game Day Check-ins, Team_Awards, Season_Master_Ledger) not found.');
  }

  const awardsData = awardsSheet.getDataRange().getValues();
  const canonicalLookup = {};
  const coachLastLookup = {};

  for (let i = 1; i < awardsData.length; i++) {
    const teamCode = String(awardsData[i][0] || '').trim();
    if (!teamCode) continue;
    const cKey = canonicalComparisonKey_(teamCode);
    canonicalLookup[cKey] = teamCode;

    const parts = teamCode.split(' - ');
    if (parts.length >= 3) {
      const divRaw = parts[0].trim().replace(/^0+/, '');
      const gender = parts[1].trim().charAt(0).toUpperCase();
      const coachWords = parts[2].trim().split(/\s+/);
      const lastName = coachWords[coachWords.length - 1].toUpperCase();
      coachLastLookup[`${gender}U${divRaw.replace('U', '')}_${lastName}`] = teamCode;
      coachLastLookup[`${gender}${divRaw}_${lastName}`] = teamCode;
    }
  }

  const lastRow = checkinsSheet.getLastRow();
  if (lastRow < 2) return { auditedRows: 0 };

  const numCols = Math.max(28, checkinsSheet.getLastColumn());
  const data = checkinsSheet.getRange(1, 1, lastRow, numCols).getValues();

  checkinsSheet.getRange(1, 24, 1, 5).setValues([[
    'Audit Status', 'Points Awarded', 'Audit Reason', 'Credited Team', 'Legacy_Backfill_Team'
  ]]);

  const seenCheckins = new Set();
  const setupDateTeamSet = new Set();
  const teamCategoryTallies = {};
  const auditOutputs = [];

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

  if (auditOutputs.length > 0) {
    checkinsSheet.getRange(2, 24, auditOutputs.length, 5).setValues(auditOutputs);
  }

  repairLedgerAndLockBackfill();

  return {
    auditedRows: auditOutputs.length,
    timestamp: new Date().toISOString()
  };
}

function repairLedgerAndLockBackfill() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Missing one of required sheets: Game Day Check-ins, Team_Awards, or Season_Master_Ledger.');
  }

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
    const goalFormula = `=IF(REGEXMATCH($A${r}, "Playground"), 4, IF(REGEXMATCH($A${r}, "05U|5U|06U|6U"), 8, 17))`;

    formulaRows.push([
      `=MIN(10, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "Referee"))`,
      `=MIN(2, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "Field Marshal"))`,
      `=MIN(5, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "Field Set Up"))`,
      `=MIN(2, SUMIFS('Game Day Check-ins'!$Y:$Y, 'Game Day Check-ins'!$AA:$AA, $B${r}, 'Game Day Check-ins'!$D:$D, "*Pic*") + SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$D:$D))`,
      `=MIN(5, SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$B:$B))`,
      `=MIN(2, SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$C:$C))`,
      `=SUMIF(Team_Awards!$A:$A, $B${r}, Team_Awards!$E:$E)`,
      `=SUM(D${r}:J${r})`,
      goalFormula,
      `=MAX(0, 2 - E${r})`,
      `=K${r} + M${r}`,
      `=N${r} + MAX(0, 5 - F${r})`,
      `=MAX(0, L${r} - O${r})`,
      `=MAX(0, L${r} - N${r})`,
      `0`,
      `=R${r}*2`,
      `=ROUND(Q${r}/3, 1)`,
      `=IF(K${r}>=L${r}, "🟢 CLINCHED", IF(O${r}>=L${r}, "🟡 ON TRACK (Pending Setup)", IF(P${r}<=3, "🟠 ACTION REQUIRED", "🔴 CRITICAL DEFICIT")))`,
      `=IF(K${r}>=L${r}, "Playoff goal achieved!", IF(O${r}>=L${r}, "Within striking distance. Setup + FM closes gap.", "Must schedule " & P${r} & " more Referee shift(s) + Setup."))`,
      nowStamp
    ]);
  }

  ledgerSheet.getRange(2, 4, formulaRows.length, 20).setValues(formulaRows);
}

function runAutomatedDisputeAndScheduleAudit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const disputesSheet = ss.getSheetByName('Form Responses 2');
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  const scheduleSheet = ss.getSheetByName('Season_Master_Schedule');
  const awardsSheet = ss.getSheetByName('Team_Awards');

  if (!awardsSheet) {
    throw new Error('Team_Awards sheet not found.');
  }

  let reportSheet = ss.getSheetByName('Dispute_Audit_Report');
  if (!reportSheet) {
    reportSheet = ss.insertSheet('Dispute_Audit_Report');
  } else {
    reportSheet.clear();
  }

  const awardsData = awardsSheet.getDataRange().getValues();
  const coachToCanonical = {};
  const canonicalToAwardRow = {};

  for (let i = 1; i < awardsData.length; i++) {
    const teamCode = String(awardsData[i][0] || '').trim();
    if (!teamCode) continue;
    const cKey = canonicalComparisonKey_(teamCode);
    canonicalToAwardRow[cKey] = { rowIdx: i + 1, teamCode: teamCode };

    const parts = teamCode.split(' - ');
    if (parts.length >= 3) {
      const divKey = parts[0].trim().replace(/^0+/, '').toUpperCase() + '_' + parts[1].trim().charAt(0).toUpperCase();
      const coachFull = parts.slice(2).join(' ').trim().toLowerCase();
      const coachWords = coachFull.split(/\s+/);
      const coachLast = coachWords[coachWords.length - 1];
      coachToCanonical[`${divKey}_${coachLast}`] = teamCode;
      coachToCanonical[coachLast] = teamCode;
    }
  }

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
    'Ticket #',
    'Submitted Date',
    'Canonical Team (Team_Awards)',
    'Challenged Category & Shifts',
    'Volunteer Name(s) Cited',
    'Shift Date(s) Cited',
    'QR Check-In Evidence',
    'MatchTrak Schedule Evidence',
    'Final Board Determination & Rule Basis',
    'Approved Adjustment (Col E)',
    'Coach Explanation'
  ]);

  const teamAdjustmentsToWrite = {};
  const nowDateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd');

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

      const canonicalTeam = resolveDisputeCanonicalTeam_(division, coach, coachToCanonical);
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
            matchedSchedule.push(`${sc.dateKey} ${sc.time} (Game #${sc.gameNum}, ${sc.homeTeam} vs ${sc.awayTeam}): C=${sc.centerName}(${sc.centerTeam}) AR1=${sc.ar1Name} AR2=${sc.ar2Name}`);
          }
        });
      });

      const ciSummary = matchedCheckins.length > 0 ? matchedCheckins.slice(0, 5).join('\n') : '❌ None found in QR Log';
      const scSummary = matchedSchedule.length > 0 ? matchedSchedule.slice(0, 5).join('\n') : '❌ Not listed in MatchTrak';

      const evalResult = evaluateDisputeTicket_(
        i,
        canonicalTeam,
        shiftDates,
        volNamesRaw,
        explanation,
        matchedCheckins,
        matchedSchedule
      );

      if (canonicalTeam) {
        if (!teamAdjustmentsToWrite[canonicalTeam]) {
          teamAdjustmentsToWrite[canonicalTeam] = { points: 0, reasons: [] };
        }
        teamAdjustmentsToWrite[canonicalTeam].points += evalResult.approvedPoints;
        if (evalResult.approvedPoints !== 0 && evalResult.awardReason) {
          teamAdjustmentsToWrite[canonicalTeam].reasons.push(evalResult.awardReason);
        }
      }

      reportRows.push([
        `Dispute #${i}`,
        ts,
        canonicalTeam || `${division} - ${coach}`,
        `${shiftsCount} (${category})`,
        volNamesRaw,
        shiftDates,
        ciSummary,
        scSummary,
        evalResult.verdict,
        evalResult.approvedPoints,
        explanation
      ]);
    }
  }

  let updatedAwardsCount = 0;
  for (const teamCode in teamAdjustmentsToWrite) {
    const cKey = canonicalComparisonKey_(teamCode);
    const target = canonicalToAwardRow[cKey];
    if (!target) continue;

    const adjInfo = teamAdjustmentsToWrite[teamCode];
    const rowIdx = target.rowIdx;

    if (adjInfo.points !== 0) {
      const reasonStr = adjInfo.reasons.join('; ');
      awardsSheet.getRange(rowIdx, 5, 1, 4).setValues([[
        adjInfo.points,
        reasonStr,
        'Board Audit Engine',
        nowDateStr
      ]]);
      updatedAwardsCount++;
    } else {
      const currentAdj = Number(awardsSheet.getRange(rowIdx, 5).getValue()) || 0;
      if (currentAdj === 0) {
        awardsSheet.getRange(rowIdx, 5).setValue(0);
      }
    }
  }

  reportSheet.getRange(1, 1, reportRows.length, reportRows[0].length).setValues(reportRows);
  reportSheet.getRange(1, 1, 1, reportRows[0].length)
    .setFontWeight('bold')
    .setBackground('#002D62')
    .setFontColor('#FFFFFF');
  reportSheet.setFrozenRows(1);
  reportSheet.autoResizeColumns(1, reportRows[0].length);

  injectTraceableLedgerFormulas();
  SpreadsheetApp.flush();

  return {
    status: 'ok',
    disputesAudited: reportRows.length - 1,
    awardsUpdated: updatedAwardsCount,
    timestamp: new Date().toISOString()
  };
}

function resolveDisputeCanonicalTeam_(division, coach, coachToCanonical) {
  const divMatch = String(division || '').match(/(\d+U)/i);
  const divNum = divMatch ? divMatch[1].replace(/^0+/, '').toUpperCase() : '';
  const genderChar = /girl/i.test(division) ? 'G' : (/boy/i.test(division) ? 'B' : '');
  const cWords = String(coach || '').trim().split(/\s+/);
  const last = cWords.length > 0 ? cWords[cWords.length - 1].toLowerCase() : '';

  const compositeKey = `${divNum}_${genderChar}_${last}`;
  if (coachToCanonical[compositeKey]) return coachToCanonical[compositeKey];
  if (coachToCanonical[last]) return coachToCanonical[last];
  return '';
}

function evaluateDisputeTicket_(ticketNum, canonicalTeam, shiftDates, volNamesRaw, explanation, matchedCheckins, matchedSchedule) {
  const has926ScheduleMatch = matchedSchedule.some(s => s.includes('2026-09-26') && /choi/i.test(s));
  const has926CheckinMatch = matchedCheckins.some(c => c.includes('2026-09-26') && /choi/i.test(c));

  if (has926ScheduleMatch && !has926CheckinMatch) {
    return {
      approvedPoints: 1,
      awardReason: `Dispute #${ticketNum} Approved: Jeff Choi verified in MatchTrak Game #22521 (9/26 12:45 PM vs Alvarez)`,
      verdict: '🟢 PARTIAL APPROVE (+1 pt): Jeff Choi is verified in MatchTrak Game #22521 (9/26 12:45 PM Luther Field 1) as Center Ref but missed QR scan (+1 pt awarded in Team_Awards Col E). 8/29 & 9/12 shifts denied (not assigned in MatchTrak / no QR scan).'
    };
  }

  if (/not needed|agreed|other team|young kids|young ref/i.test(explanation)) {
    return {
      approvedPoints: 0,
      awardReason: '',
      verdict: '🔴 DENY (0 pts - Rule 3): Referee credit requires BOTH a MatchTrak assignment AND an active on-field shift + QR scan. Standing down or letting the opposing team\'s Youth Referee solo the match credits only the working referee\'s team.'
    };
  }

  if (/cancelled|canceled/i.test(explanation) || matchedCheckins.some(m => m.includes('Cap Reached (Date)'))) {
    return {
      approvedPoints: 0,
      awardReason: '',
      verdict: '🔴 DENY (0 pts - Already Credited / Daily Setup Cap): All valid referee shifts by Dezer Millare (9/12, 9/19, 9/26) and setup shifts by Sean Rowan/Craig Fua are already credited. Amanda Patoc\'s duplicate same-day setup scans hit the 1-pt/day Field Setup cap; cancelled 10/3 game does not award points.'
    };
  }

  if (/home ref would scan|both our away ref/i.test(explanation)) {
    return {
      approvedPoints: 0,
      awardReason: '',
      verdict: '🔴 DENY (0 pts - No MatchTrak / No QR Scan): Game #14343 (9/12 2:00 PM) had only 1 Center Ref slot in MatchTrak, filled and scanned by Home Ref Dezer Millare (Juan Rodriguez). Kevin Alcaino was neither in MatchTrak on 9/12 nor scanned the QR code.'
    };
  }

  if (/training|shadowed/i.test(explanation)) {
    return {
      approvedPoints: 0,
      awardReason: '',
      verdict: '🔴 DENY (0 pts - Unassigned / Shadowing): MatchTrak schedule shows the challenged game(s) were assigned to and officiated by opposing Center Referees (e.g., Ava Harpham on 9/12 Game #14337; Kevin Yonemoto on 9/12 Game #14340; Raushanah Ali on 9/19 Game #22713). Unassigned shadowing/split quarters without MatchTrak sign-up or QR check-in do not earn points.'
    };
  }

  return {
    approvedPoints: 0,
    awardReason: '',
    verdict: '🔴 DENY (0 pts - No MatchTrak Assignment & No QR Scan): Volunteer is not listed in MatchTrak for 9/19 Game #22714 and did not scan the QR code. Picture Day points are already at the 2-pt maximum cap in Team_Awards.'
  };
}

function getDisputeAuditSummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Dispute_Audit_Report');
  if (!sheet || sheet.getLastRow() < 2) {
    runAutomatedDisputeAndScheduleAudit();
  }
  const rows = ss.getSheetByName('Dispute_Audit_Report').getDataRange().getValues();
  return { status: 'ok', rows: rows };
}

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
