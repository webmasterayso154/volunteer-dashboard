/**
 * ============================================================================
 * AYSO REGION 154 - CORE BACKEND & WEBAPP API
 * ============================================================================
 * File: Code.js
 * Version: 5.0.0-CONFIG-CENTRALIZED
 * Author: AYSO 154 Webmaster
 *
 * CHANGELOG:
 * - Dynamic division thresholds resolved via getPlayoffGoalForTeam() in AdminConfig.js.
 * - Added ?action=policy API endpoint so frontend dashboards dynamically load rules.
 * - Cleaned trailing closures in getBoardLedgerData to prevent syntax errors.
 * - Preserved check-in routing, board portal APIs, and volunteer point rollups.
 * ============================================================================
 */

function getGameDayCheckinsSheet(ss) {
  const targetSs = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheets = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS
    : {
      CHECKINS: 'Game Day Check-ins',
      FALLBACK_CHECKINS: 'Form Responses 1',
      LEGACY_CHECKINS: 'Game Day Check-ins (Responses)'
    };

  return targetSs.getSheetByName(sheets.CHECKINS) ||
    targetSs.getSheetByName(sheets.FALLBACK_CHECKINS) ||
    targetSs.getSheetByName(sheets.LEGACY_CHECKINS);
}

function isLegacyTeamAwardLogRow(row) {
  const a = row ? row[0] : '';
  if (Object.prototype.toString.call(a) === '[object Date]') return true;
  return /^\d{4}-\d{2}-\d{2}/.test(String(a || '').trim());
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚽ AYSO 154 Board Tools')
    .addItem('🔄 Run Full Audit & Sync Ledger', 'runAuditAndSyncLedger')
    .addItem('⚙️ Repair Ledger Roster & Lock Legacy Backfill', 'repairLedgerAndLockBackfill')
    .addSeparator()
    .addItem('📅 Sync Form Schedule Dropdowns', 'forceSyncFormDropdownsDirect')
    .addItem('📥 Enable Automated Hourly Audit Trigger', 'installAutomatedAuditTriggers')
    .addItem('📝 Migrate Legacy Team Awards Log Rows', 'migrateLegacyTeamAwardLogRows')
    .addToUi();

  if (typeof addDiagnosticsMenu_ === 'function') {
    addDiagnosticsMenu_();
  }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = String(params.action || 'dashboard').toLowerCase();

    // Board Portal endpoint
    if (action === 'board' || params.view === 'board') {
      if (typeof renderBoardApp === 'function') {
        return renderBoardApp(e);
      }
    }

    // Dynamic Policy SSOT endpoint for web clients
    if (action === 'policy' || action === 'config') {
      const policyData = (typeof VOLUNTEER_POLICY !== 'undefined') ? VOLUNTEER_POLICY : {};
      return ContentService.createTextOutput(JSON.stringify(policyData))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Single team stats lookup
    if (action === 'teamstats') {
      const teamCode = params.teamCode || '';
      const stats = getTeamStatsData(teamCode);
      return ContentService.createTextOutput(JSON.stringify(stats))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // League-wide standings payload
    if (action === 'allstandings') {
      const standings = getAllStandingsData();
      return ContentService.createTextOutput(JSON.stringify(standings))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Board ledger data payload
    if (action === 'boardledger') {
      const boardData = getBoardLedgerData();
      return ContentService.createTextOutput(JSON.stringify(boardData))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'active',
      season: (typeof VOLUNTEER_POLICY !== 'undefined') ? VOLUNTEER_POLICY.SEASON : 'Fall 2026',
      version: '5.0.0-CONFIG-CENTRALIZED'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getTeamStatsData(teamCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheetName = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS.LEDGER
    : 'Season_Master_Ledger';

  const ledgerSheet = ss.getSheetByName(ledgerSheetName);
  if (!ledgerSheet) return { error: 'Ledger sheet not found' };

  const data = ledgerSheet.getDataRange().getValues();
  const idxCode = 0; // Col A

  let targetRow = null;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idxCode]).trim().toUpperCase() === String(teamCode).trim().toUpperCase()) {
      targetRow = data[r];
      break;
    }
  }

  const policyGoal = (typeof getPlayoffGoalForTeam === 'function')
    ? getPlayoffGoalForTeam(teamCode)
    : 17;

  const playoffGoal = targetRow && targetRow[11] ? (Number(targetRow[11]) || policyGoal) : policyGoal;
  const verifiedPoints = targetRow && targetRow[14] ? (Number(targetRow[14]) || 0) : 0;
  const pointsNeeded = Math.max(0, playoffGoal - verifiedPoints);
  const isClinched = verifiedPoints >= playoffGoal;

  return {
    teamCode: teamCode,
    playoffGoal: playoffGoal,
    totalPoints: verifiedPoints,
    pointsNeeded: pointsNeeded,
    isClinched: isClinched,
    statusText: isClinched ? '🟢 CLINCHED' : `${pointsNeeded} points needed`
  };
}

function getAllStandingsData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheetName = (typeof VOLUNTEER_POLICY !== 'undefined' && VOLUNTEER_POLICY.SHEETS)
    ? VOLUNTEER_POLICY.SHEETS.LEDGER
    : 'Season_Master_Ledger';

  const ledgerSheet = ss.getSheetByName(ledgerSheetName);
  if (!ledgerSheet) return [];

  const data = ledgerSheet.getDataRange().getValues();
  const standings = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const teamCode = String(row[0] || '').trim();
    if (!teamCode) continue;

    const policyGoal = (typeof getPlayoffGoalForTeam === 'function')
      ? getPlayoffGoalForTeam(teamCode)
      : 17;

    const playoffGoal = Number(row[11]) || policyGoal;
    const verifiedPoints = Number(row[14]) || 0;
    const pointsNeeded = Math.max(0, playoffGoal - verifiedPoints);

    standings.push({
      teamCode: teamCode,
      coachName: row[1] || '',
      division: row[2] || '',
      refPoints: Number(row[4]) || 0,
      setupPoints: Number(row[5]) || 0,
      fmPoints: Number(row[6]) || 0,
      adjustments: Number(row[9]) || 0,
      totalPoints: verifiedPoints,
      playoffGoal: playoffGoal,
      pointsNeeded: pointsNeeded,
      isClinched: verifiedPoints >= playoffGoal
    });
  }

  return standings;
}

function getBoardLedgerData() {
  const full = (typeof getFullStandingsData === 'function')
    ? getFullStandingsData()
    : { teams: {}, syncTimestamp: new Date().toISOString() };

  const teams = [];

  if (full && full.teams) {
    Object.keys(full.teams).forEach(key => {
      const t = full.teams[key];
      const verifiedPoints = Number(t.verifiedPoints || t.totalPoints || 0);

      const policyGoal = (typeof getPlayoffGoalForTeam === 'function')
        ? getPlayoffGoalForTeam(t.teamCode || t.division)
        : (Number(t.playoffGoal) || 17);

      const playoffGoal = Number(t.playoffGoal) || policyGoal;
      const pointsNeeded = Math.max(0, playoffGoal - verifiedPoints);
      const isClinched = verifiedPoints >= playoffGoal;

      let status = 'Pending';
      if (isClinched) {
        status = 'Qualified';
      } else if (/(CRITICAL|ACTION REQUIRED)/i.test(t.eligibilityStatus || '') || pointsNeeded <= 3) {
        status = 'At-Risk';
      }

      teams.push({
        division: t.division || '',
        teamCode: t.teamCode || key,
        headCoach: t.headCoach || '',
        verifiedPoints: verifiedPoints,
        playoffGoal: playoffGoal,
        pointsNeeded: pointsNeeded,
        isClinched: isClinched,
        refPoints: (t.categories && t.categories['Referee Assignment']) || t.refPoints || 0,
        fmPoints: (t.categories && t.categories['Field Marshal Shift']) || t.fmPoints || 0,
        status: status,
        isCompetitive: playoffGoal >= 17,
        lastAudited: t.lastAudited || ''
      });
    });
  }

  return {
    status: 'ok',
    syncTimestamp: full.syncTimestamp || new Date().toISOString(),
    teams: teams
  };
}

function getTeamAwardsLogEntries_(awardObj, picPts, certRefPts, matchTrakPts, otherAdjPts) {
  const logs = [];
  const teamCode = awardObj.teamCode || '';
  const grantedBy = awardObj.grantedBy || 'Board Admin';
  const lastUpdated = awardObj.lastUpdated || 'Season Award';
  const customReason = awardObj.reason || 'Board Verified Credit';

  if (picPts > 0) {
    logs.push({
      date: lastUpdated,
      category: 'Picture Day / Event',
      points: picPts,
      volunteer: grantedBy,
      notes: customReason
    });
  }

  if (certRefPts > 0) {
    logs.push({
      date: lastUpdated,
      category: 'Referee Assignment',
      points: certRefPts,
      volunteer: grantedBy,
      notes: 'Certified Referee Credit: ' + customReason
    });
  }

  if (matchTrakPts > 0) {
    logs.push({
      date: lastUpdated,
      category: 'Referee Assignment',
      points: matchTrakPts,
      volunteer: grantedBy,
      notes: 'MatchTrak Sync: ' + customReason
    });
  }

  if (otherAdjPts > 0) {
    logs.push({
      date: lastUpdated,
      category: 'Other Board Assignment',
      points: otherAdjPts,
      volunteer: grantedBy,
      notes: customReason
    });
  }

  return logs;
}