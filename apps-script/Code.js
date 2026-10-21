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
        lastUpdated: r[7] ? formatDateSafe_(r[7]) : 'Season Award',
        firstGameSetupBonus: Number(r[8]) || 0 // Col I: First Game Setup Bonus (Board enters 5)
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
      lastUpdated: 'Season Award',
      firstGameSetupBonus: 0
    };

    // Ledger Col J = Team_Awards Col E + First Game Setup Bonus top-up (5 - setup points).
    // Split it back out so the Check-In Log shows the bonus as its own line and still sums to the total.
    const setupBonusTopUp = awardObj.firstGameSetupBonus >= 5
      ? Math.max(0, Math.min(5, otherAdjPts - (Number(awardObj.adjustment) || 0)))
      : 0;
    const manualAdjPts = otherAdjPts - setupBonusTopUp;

    const awardLogEntries = getTeamAwardsLogEntries_(awardObj, picPts, certRefPts, matchTrakPts, manualAdjPts, setupBonusTopUp);
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
      'Admin Bonus / Adjustments (Cert Refs + Adj)': certRefPts + otherAdjPts,
      'First Game Setup Bonus': setupBonusTopUp
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
function getTeamAwardsLogEntries_(awardObj, picPts, certRefPts, matchTrakPts, otherAdjPts, setupBonusTopUp) {
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

  if (setupBonusTopUp > 0) {
    logs.push({
      timestamp: lastUpdated,
      date: lastUpdated,
      volunteer: grantedBy,
      role: 'First Game Setup Bonus',
      duty: 'First Game Setup Bonus (Board end-of-season review)',
      points: setupBonusTopUp,
      status: 'Recorded',
      reason: `Field Setup credit brought to 5 pts for first-game-of-weekend setup (+${setupBonusTopUp} pt${setupBonusTopUp > 1 ? 's' : ''})`,
      note: `Field Setup credit brought to 5 pts for first-game-of-weekend setup (+${setupBonusTopUp} pt${setupBonusTopUp > 1 ? 's' : ''})`,
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