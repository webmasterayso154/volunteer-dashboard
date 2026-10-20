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

  // Same source of truth as the public dashboard: Season_Master_Ledger + Team_Awards
  const payload = buildFullDashboardPayload_('');
  const seen = new Set();
  const teamList = [];

  Object.keys(payload.teams).forEach(key => {
    const t = payload.teams[key];
    if (seen.has(t.teamCode)) return; // skip the no-leading-zero alias keys
    seen.add(t.teamCode);
    const c = t.categories;
    teamList.push({
      teamCode: t.teamCode,
      division: t.division,
      coach: t.coach,
      totalPoints: t.totalPoints,
      playoffGoal: t.playoffGoal,
      qualified: t.totalPoints >= t.playoffGoal,
      categories: {
        ref: c['Referee Assignment'],
        fm: c['Field Marshal Shift'],
        setup: c['Friday Night Field Setup'],
        pic: c['Picture Day'],
        certRef: c['Certified Team Referees'],
        matchtrak: c['Early Ref Scheduling Incentive'],
        awards: c['Other Adjustments'],
        total: t.totalPoints
      }
    });
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
  const respSheet = getGameDayCheckinsSheet(ss);
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

    // Same column map as Code.js / AuditEngine.js (live tab: A Timestamp, B First, C Last, D Role, E Ref Position)
    const email = '';
    const firstName = String(row[1] || '').trim();
    const lastName = String(row[2] || '').trim();
    const fullName = (firstName + ' ' + lastName).trim();
    const role = String(row[3] || '').trim();
    const refPos = String(row[4] || '').trim();
    const matchStr = String(row[6] || row[7] || row[8] || '').trim(); // Cols G-I: venue match dropdowns
    const shiftTime = (typeof formatTimeSafe_ === 'function') ? formatTimeSafe_(row[10]) : String(row[10] || '').trim(); // Col K
    const fieldName = String(row[11] || row[9] || row[5] || '').trim(); // Col L field, else J/F venue

    let dropdownTeam = '';
    for (let c = 13; c <= 21; c++) { // Cols N-V: division team dropdowns
      if (String(row[c] || '').trim() !== '') { dropdownTeam = String(row[c]).trim(); break; }
    }
    const teamCode = String(row[26] || '').trim() || String(row[27] || '').trim() || dropdownTeam || 'Unknown Team'; // AA credited, AB backfill

    const field = fieldName || matchStr || 'N/A';
    const time = shiftTime || matchStr || 'N/A';

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

/**
 * Normalizes time strings for slot comparisons ("8:00 AM" == "8:00am").
 */
function normalizeTimeSlot(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
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

  // Writes into the team's single Team_Awards row (see TeamAwards.js)
  const award = setTeamAward(teamCode, awardType, pts, fullNote);

  return {
    success: true,
    award: award,
    updatedStats: getBoardTeamDetails(teamCode)
  };
}