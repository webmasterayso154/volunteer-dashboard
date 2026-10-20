/**
 * AYSO Region 154 - Team Awards & Point Overrides Engine
 * Connects manual board adjustments to the public dashboard and audit log.
 *
 * Team_Awards uses ONE ROW PER TEAM (the layout read by Code.js,
 * AuditEngine.js roster rebuild, and the Season_Master_Ledger SUMIF formulas):
 *   A Team Code | B Pre-Season Certified Refs | C MatchTrak Bonus | D Picture Day |
 *   E Other Adjustment | F Reason | G Granted By | H Last Updated
 *
 * Board overrides add points into the matching column of the team's row; they
 * never append rows. Older code appended log rows
 * [Timestamp, TeamCode, AwardType, Points, Note, Author] — those rows are
 * skipped by readers (isLegacyTeamAwardLogRow_) and can be folded in with
 * migrateLegacyTeamAwardLogRows().
 */

const TEAM_AWARDS_SHEET = 'Team_Awards';
const TEAM_AWARDS_LEGACY_LOG_SHEET = 'Team_Awards_Legacy_Log';

const TEAM_AWARDS_COL = {
  TEAM: 0,
  CERT_REFS: 1,
  MATCHTRAK: 2,
  PICTURE_DAY: 3,
  ADJUSTMENT: 4,
  REASON: 5,
  GRANTED_BY: 6,
  LAST_UPDATED: 7
};

const TEAM_AWARDS_COLUMN_LABELS = {
  1: 'Certified Team Referees',
  2: 'MatchTrak Bonus',
  3: 'Picture Day',
  4: 'Other Adjustment'
};

/**
 * True for rows written in the old append-log layout (Timestamp in Col A).
 */
function isLegacyTeamAwardLogRow_(row) {
  const a = row ? row[0] : '';
  if (Object.prototype.toString.call(a) === '[object Date]') return true;
  return /^\d{4}-\d{2}-\d{2}/.test(String(a || '').trim());
}

/**
 * Maps a Board Portal award type to its Team_Awards column index.
 */
function teamAwardColumnForType_(awardType) {
  const t = String(awardType || '');
  if (/certified/i.test(t)) return TEAM_AWARDS_COL.CERT_REFS;
  if (/matchtrak/i.test(t)) return TEAM_AWARDS_COL.MATCHTRAK;
  if (/picture/i.test(t)) return TEAM_AWARDS_COL.PICTURE_DAY;
  // Uniform deductions, ref disqualifications, discretionary credits/deductions
  return TEAM_AWARDS_COL.ADJUSTMENT;
}

/**
 * Finds the 1-based sheet row for a team in Team_Awards, or -1.
 */
function findTeamAwardsRow_(data, teamCode) {
  const target = canonicalComparisonKey_(teamCode);
  for (let i = 1; i < data.length; i++) {
    if (isLegacyTeamAwardLogRow_(data[i])) continue;
    const code = String(data[i][TEAM_AWARDS_COL.TEAM] || '').trim();
    if (code && canonicalComparisonKey_(code) === target) return i + 1;
  }
  return -1;
}

/**
 * Adds points to the team's existing Team_Awards row. Caller holds any lock.
 */
function applyTeamAwardToSheet_(sheet, data, teamCode, awardType, pts, note, author, when) {
  const rowNum = findTeamAwardsRow_(data, teamCode);
  if (rowNum === -1) {
    throw new Error(`Team '${teamCode}' not found in Team_Awards roster.`);
  }

  const row = data[rowNum - 1];
  const col = teamAwardColumnForType_(awardType);
  const previous = Number(row[col]) || 0;
  let value = previous + pts;
  if (col !== TEAM_AWARDS_COL.ADJUSTMENT) value = Math.max(0, value);

  const entry = `${awardType} (${pts > 0 ? '+' : ''}${pts})${note ? ': ' + note : ''}`;
  const oldReason = String(row[TEAM_AWARDS_COL.REASON] || '').trim();
  const reason = oldReason ? `${oldReason} | ${entry}` : entry;

  sheet.getRange(rowNum, col + 1).setValue(value);
  sheet.getRange(rowNum, TEAM_AWARDS_COL.REASON + 1, 1, 3).setValues([[reason, author, when]]);

  // Keep the in-memory copy current for callers applying several awards
  row[col] = value;
  row[TEAM_AWARDS_COL.REASON] = reason;
  row[TEAM_AWARDS_COL.GRANTED_BY] = author;
  row[TEAM_AWARDS_COL.LAST_UPDATED] = when;

  return {
    teamCode: String(row[TEAM_AWARDS_COL.TEAM]).trim(),
    column: TEAM_AWARDS_COLUMN_LABELS[col],
    previous: previous,
    value: value
  };
}

function getTeamStatsWithAwards(targetTeam) {
  return getTeamStatsData(targetTeam);
}

function setTeamAward(teamCode, awardType, points, note) {
  const pts = Number(points);
  if (isNaN(pts)) throw new Error('Points value must be a valid number');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TEAM_AWARDS_SHEET);
  if (!sheet) throw new Error('Team_Awards sheet not found.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const author = Session.getActiveUser().getEmail() || 'Board Admin';
    const data = sheet.getDataRange().getValues();
    const result = applyTeamAwardToSheet_(sheet, data, teamCode, awardType, pts, note, author, new Date());
    SpreadsheetApp.flush();
    return Object.assign({ success: true }, result);
  } finally {
    lock.releaseLock();
  }
}

function getAllTeamAwards(targetTeam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TEAM_AWARDS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const rowNum = findTeamAwardsRow_(data, targetTeam);
  if (rowNum === -1) return [];

  const row = data[rowNum - 1];
  const results = [];
  [TEAM_AWARDS_COL.CERT_REFS, TEAM_AWARDS_COL.MATCHTRAK, TEAM_AWARDS_COL.PICTURE_DAY, TEAM_AWARDS_COL.ADJUSTMENT].forEach(col => {
    const pts = Number(row[col]) || 0;
    if (pts === 0) return;
    results.push({
      timestamp: row[TEAM_AWARDS_COL.LAST_UPDATED],
      teamCode: row[TEAM_AWARDS_COL.TEAM],
      awardType: TEAM_AWARDS_COLUMN_LABELS[col],
      points: pts,
      note: row[TEAM_AWARDS_COL.REASON],
      author: row[TEAM_AWARDS_COL.GRANTED_BY]
    });
  });
  return results;
}

/**
 * One-time cleanup (run from the Board Tools menu): folds legacy append-log rows
 * into each team's Team_Awards row. Every legacy row is first copied to
 * Team_Awards_Legacy_Log; only rows that were folded in are removed from
 * Team_Awards. Rows whose team can't be matched are left in place and reported.
 */
function migrateLegacyTeamAwardLogRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TEAM_AWARDS_SHEET);
  if (!sheet) throw new Error('Team_Awards sheet not found.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheet.getDataRange().getValues();
    const legacy = [];
    for (let i = 1; i < data.length; i++) {
      if (isLegacyTeamAwardLogRow_(data[i])) legacy.push({ rowNum: i + 1, row: data[i] });
    }
    if (legacy.length === 0) return { migrated: 0, unmatched: [] };

    let backup = ss.getSheetByName(TEAM_AWARDS_LEGACY_LOG_SHEET);
    if (!backup) {
      backup = ss.insertSheet(TEAM_AWARDS_LEGACY_LOG_SHEET);
      backup.appendRow(['Timestamp', 'TeamCode', 'AwardType', 'Points', 'Note', 'Author', 'Migrated On', 'Migration Result']);
    }

    const migratedOn = new Date();
    const migratedRows = [];
    const unmatched = [];
    const backupRows = [];

    legacy.forEach(item => {
      const r = item.row;
      const teamCode = String(r[1] || '').trim();
      const awardType = String(r[2] || '').trim();
      const pts = Number(r[3]) || 0;
      let result = 'Folded into Team_Awards';
      try {
        applyTeamAwardToSheet_(sheet, data, teamCode, awardType, pts, String(r[4] || '').trim(),
          String(r[5] || 'Board Admin').trim(), r[0] || migratedOn);
        migratedRows.push(item.rowNum);
      } catch (e) {
        result = 'NOT MIGRATED: ' + e.message;
        unmatched.push(`Row ${item.rowNum}: ${teamCode || '(blank team)'}`);
      }
      backupRows.push([r[0], teamCode, awardType, pts, r[4], r[5], migratedOn, result]);
    });

    backup.getRange(backup.getLastRow() + 1, 1, backupRows.length, 8).setValues(backupRows);

    // Delete bottom-up so earlier row numbers stay valid
    migratedRows.sort((a, b) => b - a).forEach(rowNum => sheet.deleteRow(rowNum));
    SpreadsheetApp.flush();

    const summary = { migrated: migratedRows.length, unmatched: unmatched };
    try {
      SpreadsheetApp.getUi().alert('Team_Awards migration',
        `Folded ${summary.migrated} legacy row(s) into team rows. Backup copy: ${TEAM_AWARDS_LEGACY_LOG_SHEET}.` +
        (unmatched.length ? `\n\nLeft in place (team not found):\n${unmatched.join('\n')}` : ''),
        SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      Logger.log(JSON.stringify(summary));
    }
    return summary;
  } finally {
    lock.releaseLock();
  }
}
