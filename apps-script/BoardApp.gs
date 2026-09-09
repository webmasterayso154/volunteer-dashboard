/**
 * AYSO Region 154 - Board Portal Server Backend
 * Enforces authentication, compiles division rollups, scans for anomalies/cheating,
 * and executes point overrides and uniform deductions.
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

/**
 * Fast aggregate loader for the division rollup view + anomaly count.
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

  const allTeams = [...MASTER_TEAMS];
  if (typeof getSupplementalTeams === 'function') {
    const supp = getSupplementalTeams();
    supp.forEach(st => {
      if (!allTeams.includes(st.teamCode)) allTeams.push(st.teamCode);
    });
  }

  const respSheet = ss.getSheetByName('Form Responses 1');
  const respRows = (respSheet && respSheet.getLastRow() > 1) ? respSheet.getDataRange().getValues() : [];
  
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const awardRows = (awardsSheet && awardsSheet.getLastRow() > 1) ? awardsSheet.getDataRange().getValues() : [];

  const teamAggregates = {};
  allTeams.forEach(code => {
    teamAggregates[code] = { ref: 0, fm: 0, setup: 0, pic: 0, certRef: 0, matchtrak: 0, awards: 0, total: 0 };
  });

  const seenTeamDayRole = new Set();

  for (let i = 1; i < respRows.length; i++) {
    const row = respRows[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    const dateStr = (timestamp instanceof Date)
      ? Utilities.formatDate(timestamp, 'America/Los_Angeles', 'MMM d, yyyy')
      : String(timestamp).split(' ')[0];

    const dutyRaw = String(row[4] || '').trim();
    const rRef = String(row[6] || '').trim();
    const rFm = String(row[9] || '').trim();
    const rSetup = String(row[12] || '').trim();

    allTeams.forEach(code => {
      const agg = teamAggregates[code];
      let matchedRole = '';

      if (rRef === code || (/ref/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        matchedRole = 'ref';
      } else if (rFm === code || (/marshal/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        matchedRole = 'fm';
      } else if (rSetup === code || (/set\s*up/i.test(dutyRaw) && row.indexOf(code) !== -1)) {
        matchedRole = 'setup';
      } else if (/picture/i.test(dutyRaw) && row.indexOf(code) !== -1) {
        matchedRole = 'pic';
      }

      if (matchedRole) {
        const dayKey = code + '_' + dateStr + '_' + matchedRole;
        if (!seenTeamDayRole.has(dayKey)) {
          seenTeamDayRole.add(dayKey);
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
        teamAggregates[aCode].certRef = Math.min(5, teamAggregates[aCode].certRef + aPts);
      } else if (aType === 'MatchTrak Filled by Sep 26') {
        teamAggregates[aCode].matchtrak = Math.min(2, teamAggregates[aCode].matchtrak + aPts);
      } else {
        teamAggregates[aCode].awards += aPts;
      }
    }
  }

  const teamList = allTeams.map(code => {
    const agg = teamAggregates[code] || { ref: 0, fm: 0, setup: 0, pic: 0, certRef: 0, matchtrak: 0, awards: 0 };
    const total = Math.max(0, Math.min(26, agg.ref + agg.fm + agg.setup + agg.pic + agg.certRef + agg.matchtrak + agg.awards));
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

  // Calculate flagged anomalies
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
 * Anomaly Detection Engine: Scans Form Responses for cheats, rapid double-clicks, and collisions.
 */
function scanSubmissionsForAnomalies() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const respSheet = ss.getSheetByName('Form Responses 1');
  if (!respSheet || respSheet.getLastRow() < 2) return [];

  const rows = respSheet.getDataRange().getValues();
  const anomalies = [];

  // Lookups to identify slot collisions & duplicates
  const submissionsByVolunteer = {};
  const refSlots = {};
  const teamDayRole = {};

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
      flags: []
    };

    // 1. Rapid Duplicate Check (<15 min from same person)
    const volKey = email || fullName.toLowerCase();
    if (volKey) {
      if (!submissionsByVolunteer[volKey]) submissionsByVolunteer[volKey] = [];
      const priorEntries = submissionsByVolunteer[volKey];
      for (const p of priorEntries) {
        const diffMinutes = Math.abs(parsedTime - p.timestamp) / 60000;
        if (diffMinutes < 15 && p.role === role) {
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

    // 2. Ref Slot Collision Check (Same Field, Same Time, Same Center Referee Role)
    if (/ref/i.test(role) && field !== 'N/A' && time !== 'N/A') {
      const isCenter = /referee\s*\(ayso\)|center|head/i.test(refPos);
      if (isCenter) {
        const slotKey = dateStr + '_' + field.toLowerCase() + '_' + time.toLowerCase();
        if (refSlots[slotKey]) {
          entry.flags.push({
            type: 'SLOT_COLLISION',
            severity: 'danger',
            message: `Conflicting Center Ref: Row #${refSlots[slotKey].row} also claimed ${field} at ${time}`
          });
        } else {
          refSlots[slotKey] = entry;
        }
      }
    }

    // 3. Same Day Over-Claim Check
    if (teamCode !== 'Unknown Team') {
      const dayTeamRoleKey = dateStr + '_' + teamCode + '_' + role;
      if (teamDayRole[dayTeamRoleKey]) {
        entry.flags.push({
          type: 'DAILY_LIMIT_EXCEEDED',
          severity: 'info',
          message: `Team already logged points for ${role} on ${dateStr} (Row #${teamDayRole[dayTeamRoleKey].row})`
        });
      } else {
        teamDayRole[dayTeamRoleKey] = entry;
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