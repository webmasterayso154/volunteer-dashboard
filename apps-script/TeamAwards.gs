/**
 * AYSO Region 154 — administrative point awards.
 *
 * The 2026 flyer grants points no QR check-in can produce: 5 for certified
 * team referees communicated pre-season, 2 for having every MatchTrak spot
 * filled before Sep 26, and 2 for Picture Picnic Day (its own form and
 * volunteer tent). Those are granted per team here, with the granting board
 * member and timestamp recorded so a coach's challenge can be audited.
 *
 * This file is additive. Code.gs needs exactly one line changed — in doGet,
 * `getTeamStatsData(...)` becomes `getTeamStatsWithAwards(...)`.
 */

const TEAM_AWARDS_SHEET = 'Team_Awards';

const TEAM_AWARDS_HEADERS = [
  'teamCode',
  'preSeasonRefs',
  'matchTrakBonus',
  'pictureDay',
  'adjustment',
  'reason',
  'grantedBy',
  'lastUpdated'
];

/**
 * The full 2026 flyer model: 17 referee + 9 volunteer = 26 possible.
 *
 * NOTE: onFieldReferee / fieldMarshal / fridaySetup duplicate the CAP_*
 * constants inside getTeamStatsData. That duplication is deliberate for now so
 * this change stays one line in Code.gs; the follow-up is to delete those four
 * local constants and read POINT_CAPS instead, leaving one source of truth.
 */
const POINT_CAPS = {
  preSeasonRefs: 5,
  matchTrakBonus: 2,
  onFieldReferee: 10,
  fieldMarshal: 2,
  fridaySetup: 5,
  pictureDay: 2
};

let __teamAwardsCache = null;

/**
 * Entry point for doGet. Wraps the untouched check-in scoring with the
 * administrative awards.
 */
function getTeamStatsWithAwards(teamCode) {
  return applyTeamAwards(getTeamStatsData(teamCode), teamCode);
}

function applyTeamAwards(stats, teamCode) {
  const base = (stats && typeof stats === 'object') ? stats : {};
  const cats = (base.categories && typeof base.categories === 'object') ? base.categories : {};
  const checkInAudit = Array.isArray(base.audit) ? base.audit : [];

  const code = String(teamCode || '').trim();
  const awards = getTeamAwards(code);
  const competitive = isCompetitiveDivision(getDivisionFromTeamCode(code));

  // Playground / U5 / U6 have no referee program, so those two buckets are
  // withheld even if a row was filled in by mistake.
  const preSeasonRefs = competitive ? awards.preSeasonRefs : 0;
  const matchTrakBonus = competitive ? awards.matchTrakBonus : 0;
  const pictureDay = awards.pictureDay;
  const adjustment = awards.adjustment;

  const grantDate = formatAwardDate(awards.lastUpdated);
  const attribution = awards.grantedBy ? ' · ' + awards.grantedBy : '';
  const granted = [];

  if (preSeasonRefs) {
    granted.push(awardRow('Certified Team Referees (pre-season)', grantDate, preSeasonRefs, attribution));
  }
  if (matchTrakBonus) {
    granted.push(awardRow('MatchTrak Spots Filled by Sep 26', grantDate, matchTrakBonus, attribution));
  }
  if (pictureDay) {
    granted.push(awardRow('Picture Picnic Day Volunteer Shift', grantDate, pictureDay, attribution));
  }
  if (adjustment) {
    const label = 'Board Adjustment' + (awards.reason ? ' — ' + awards.reason : '');
    granted.push(awardRow(label, grantDate, adjustment, attribution));
  }

  const checkInTotal = Number(base.totalPoints) || 0;

  return {
    totalPoints: checkInTotal + preSeasonRefs + matchTrakBonus + pictureDay + adjustment,
    categories: {
      'Referee Assignment': Number(cats['Referee Assignment']) || 0,
      'Field Marshal Shift': Number(cats['Field Marshal Shift']) || 0,
      'Friday Night Field Setup': Number(cats['Friday Night Field Setup']) || 0,
      'Picture Day': pictureDay,
      'Pre-Season Referees': preSeasonRefs,
      'MatchTrak Roster Bonus': matchTrakBonus
    },
    audit: granted.concat(checkInAudit),
    syncTimestamp: base.syncTimestamp ||
      Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a')
  };
}

/**
 * "Rejected by Board" is worded to match the substring the dashboard already
 * scans for when it picks a red badge — a revocation must not render green.
 */
function awardRow(duty, date, points, attribution) {
  return {
    duty: duty + attribution,
    date: date,
    status: points < 0 ? 'Rejected by Board' : 'Board Verified',
    points: points
  };
}

function formatAwardDate(raw) {
  if (!raw) return 'Season';
  try {
    const d = (raw instanceof Date) ? raw : new Date(raw);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'America/Los_Angeles', 'MMM d, yyyy');
    }
  } catch (err) {}
  return 'Season';
}

function getTeamAwards(teamCode) {
  const hit = loadTeamAwards()[String(teamCode || '').trim()];
  if (hit) return hit;
  return {
    preSeasonRefs: 0,
    matchTrakBonus: 0,
    pictureDay: 0,
    adjustment: 0,
    reason: '',
    grantedBy: '',
    lastUpdated: ''
  };
}

function loadTeamAwards() {
  if (__teamAwardsCache) return __teamAwardsCache;

  const map = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TEAM_AWARDS_SHEET);

  if (sheet && sheet.getLastRow() > 1) {
    const rows = sheet.getDataRange().getValues();
    const idx = {};
    rows[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

    for (let i = 1; i < rows.length; i++) {
      const code = String(rows[i][idx.teamCode] || '').trim();
      if (!code) continue;
      map[code] = {
        preSeasonRefs: clampAward(rows[i][idx.preSeasonRefs], POINT_CAPS.preSeasonRefs),
        matchTrakBonus: clampAward(rows[i][idx.matchTrakBonus], POINT_CAPS.matchTrakBonus),
        pictureDay: clampAward(rows[i][idx.pictureDay], POINT_CAPS.pictureDay),
        adjustment: Number(rows[i][idx.adjustment]) || 0,
        reason: String(rows[i][idx.reason] || '').trim(),
        grantedBy: String(rows[i][idx.grantedBy] || '').trim(),
        lastUpdated: rows[i][idx.lastUpdated] || ''
      };
    }
  }

  __teamAwardsCache = map;
  return map;
}

/** Awards are capped; `adjustment` is intentionally not, so it can go negative. */
function clampAward(raw, cap) {
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), cap);
}

function getDivisionFromTeamCode(teamCode) {
  const parts = String(teamCode || '').split(' - ');
  if (parts.length >= 3) return parts[0].trim() + ' - ' + parts[1].trim();
  return parts[0] ? parts[0].trim() : '';
}

function isCompetitiveDivision(division) {
  const d = String(division || '');
  if (!d || d.indexOf('Playground') === 0) return false;
  return d.indexOf('05U') !== 0 && d.indexOf('06U') !== 0;
}

/**
 * Creates the Team_Awards tab and back-fills a zeroed row for every team in
 * MASTER_TEAMS. Safe to re-run — existing rows are never overwritten, so it
 * doubles as the way to add rows after the roster changes.
 */
function setupTeamAwardsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TEAM_AWARDS_SHEET);
  if (!sheet) sheet = ss.insertSheet(TEAM_AWARDS_SHEET);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(TEAM_AWARDS_HEADERS);
    sheet.getRange(1, 1, 1, TEAM_AWARDS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
      const c = String(r[0] || '').trim();
      if (c) existing[c] = true;
    });
  }

  const missing = MASTER_TEAMS.filter(function (t) { return !existing[t]; });
  if (missing.length) {
    const rows = missing.map(function (t) { return [t, 0, 0, 0, 0, '', '', '']; });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, TEAM_AWARDS_HEADERS.length).setValues(rows);
  }

  __teamAwardsCache = null;
  Logger.log('Team_Awards ready — ' + MASTER_TEAMS.length + ' teams tracked, ' + missing.length + ' row(s) added.');
  return missing.length;
}

/**
 * Records one award change with the approver's Google identity attached. This
 * is the write path the Board web app will call.
 */
function setTeamAward(teamCode, field, value, reason) {
  if (TEAM_AWARDS_HEADERS.indexOf(field) === -1) {
    throw new Error('Unknown award field: ' + field);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TEAM_AWARDS_SHEET);
  if (!sheet) throw new Error("No '" + TEAM_AWARDS_SHEET + "' tab — run setupTeamAwardsSheet() first.");

  const rows = sheet.getDataRange().getValues();
  const idx = {};
  rows[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

  let targetRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.teamCode] || '').trim() === String(teamCode).trim()) {
      targetRow = i + 1;
      break;
    }
  }
  if (targetRow === -1) throw new Error('Team not present in Team_Awards: ' + teamCode);

  let approver = '';
  try { approver = Session.getActiveUser().getEmail() || ''; } catch (err) {}

  sheet.getRange(targetRow, idx[field] + 1).setValue(value);
  sheet.getRange(targetRow, idx.reason + 1).setValue(reason || '');
  sheet.getRange(targetRow, idx.grantedBy + 1).setValue(approver);
  sheet.getRange(targetRow, idx.lastUpdated + 1).setValue(new Date());

  __teamAwardsCache = null;
  return { teamCode: teamCode, field: field, value: value, grantedBy: approver };
}
