/**
 * AYSO Region 154 - Board Portal Server Backend
 * Enforces authentication, compiles division rollups, and executes point overrides.
 */

function renderBoardApp() {
  return HtmlService.createHtmlOutputFromFile('BoardPortal')
    .setTitle('AYSO Region 154 - Board Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Validates the caller against Column A of the Admin_Config sheet.
 */
function getBoardUserSession() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
  const authorizedEmails = (typeof getAuthorizedBoardEmails === 'function') 
    ? getAuthorizedBoardEmails() 
    : [];

  // Draft mode is active when the sheet allowlist has no emails configured
  const isDraftMode = (authorizedEmails.length === 0);
  const isAuthorized = isDraftMode || authorizedEmails.includes(userEmail);

  return {
    email: userEmail || "Draft Mode Reviewer",
    isAuthorized: isAuthorized,
    isDraftMode: isDraftMode
  };
}

/**
 * Fast aggregate loader for the division rollup view.
 */
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
    : { PlayoffThreshold: 17, RefMaxCap: 10, FieldMarshalCap: 2, FieldSetupCap: 5, PictureDayCap: 2 };

  const playoffThreshold = Number(settings.PlayoffThreshold) || 17;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Combine Master Teams + Supplemental Teams
  const allTeams = [...MASTER_TEAMS];
  if (typeof getSupplementalTeams === 'function') {
    const supp = getSupplementalTeams();
    supp.forEach(st => {
      if (!allTeams.includes(st.teamCode)) allTeams.push(st.teamCode);
    });
  }

  // Pre-aggregate Form Responses in one pass
  const respSheet = ss.getSheetByName('Form Responses 1');
  const respRows = (respSheet && respSheet.getLastRow() > 1) ? respSheet.getDataRange().getValues() : [];
  
  // Pre-aggregate Manual Awards
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const awardRows = (awardsSheet && awardsSheet.getLastRow() > 1) ? awardsSheet.getDataRange().getValues() : [];

  const teamAggregates = {};
  allTeams.forEach(code => {
    teamAggregates[code] = { ref: 0, fm: 0, setup: 0, pic: 0, awards: 0, total: 0 };
  });

  // Calculate raw points from Form Responses
  for (let i = 1; i < respRows.length; i++) {
    const row = respRows[i];
    if (!row || !row[0]) continue;

    const dutyRaw = String(row[3] || '').trim();
    const rRef = String(row[5] || '').trim();
    const rFm = String(row[8] || '').trim();
    const rSetup = String(row[11] || '').trim();

    allTeams.forEach(code => {
      const agg = teamAggregates[code];
      if (rRef === code || (/ref/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        if (agg.ref < settings.RefMaxCap) agg.ref++;
      } else if (rFm === code || (/marshal/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        if (agg.fm < settings.FieldMarshalCap) agg.fm++;
      } else if (rSetup === code || (/set\s*up/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        if (agg.setup < settings.FieldSetupCap) agg.setup++;
      } else if (/picture/i.test(dutyRaw) && row.indexOf(code) !== -1) {
        if (agg.pic < settings.PictureDayCap) agg.pic++;
      }
    });
  }

  // Aggregate Team Awards
  for (let j = 1; j < awardRows.length; j++) {
    const aRow = awardRows[j];
    const aCode = String(aRow[1] || '').trim();
    const aPts = Number(aRow[3]) || 0;
    if (teamAggregates[aCode]) {
      teamAggregates[aCode].awards += aPts;
    }
  }

  // Build the unified team cards
  const teamList = allTeams.map(code => {
    const agg = teamAggregates[code] || { ref: 0, fm: 0, setup: 0, pic: 0, awards: 0 };
    const total = agg.ref + agg.fm + agg.setup + agg.pic + agg.awards;
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

  return {
    session: session,
    settings: settings,
    teams: teamList,
    syncTimestamp: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a')
  };
}

/**
 * Retrieves full audit details for an individual team drilldown.
 */
function getBoardTeamDetails(teamCode) {
  const session = getBoardUserSession();
  if (!session.isAuthorized) throw new Error("Unauthorized");
  if (typeof getTeamStatsWithAwards === 'function') {
    return getTeamStatsWithAwards(teamCode);
  }
  return getTeamStatsData(teamCode);
}

/**
 * Executes a point override or discretionary bonus and writes to Team_Awards.
 */
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