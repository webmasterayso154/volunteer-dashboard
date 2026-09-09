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