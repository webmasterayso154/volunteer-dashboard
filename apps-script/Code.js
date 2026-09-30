/**
 * ============================================================================
 * AYSO REGION 154 - VOLUNTEER STANDINGS & CALCULATION BACKEND
 * ============================================================================
 * File: Code.gs / Code.js
 * Description: Production backend for AYSO Region 154 volunteer standings,
 *              point calculations, category capping, NOCRA filtering, and
 *              dashboard API endpoints (doGet / doPost).
 * 
 * Features:
 *   - Resilient tab name fallbacks ('Game Day Check-ins' and 'Form Responses 1')
 *   - normalizeTeamKey() for canonical team keys across middle dots ('·'),
 *     hyphens ('-'), and 'Coach' prefixes
 *   - Direct ingestion of verified points and category caps from Season_Master_Ledger
 *   - Itemized volunteer shift history extraction from check-ins sheet
 * 
 * NOTE: Schedule ingestion and multi-venue form dropdown synchronization are
 *       maintained exclusively in ScheduleSyncEngine.gs.
 * ============================================================================
 */

var MASTER_TEAMS = (typeof MASTER_TEAMS !== 'undefined') ? MASTER_TEAMS : [
  "Playground - Playground",
  "05U - Boys - Stefan Colvey", "05U - Boys - Casey Harpham", "05U - Boys - Ryan Loza", "05U - Boys - Ankit Vasa", "05U - Boys - Greg Weber",
  "05U - Girls - Priscilla Alvardo", "05U - Girls - Tim Bouahom", "05U - Girls - Ramzi Nasr", "05U - Girls - Saul Ruiz",
  "06U - Boys - Jessica Campuzano", "06U - Boys - Alber Eskander", "06U - Boys - James Fahrny", "06U - Boys - Ryan Fox", "06U - Boys - Chris Gshweng", "06U - Boys - Deanna Hartman", "06U - Boys - Jessica Matal", "06U - Boys - Amira Medina", "06U - Boys - Brennen Portalski",
  "06U - Girls - Diana Baik", "06U - Girls - Suresh Dangeti", "06U - Girls - Cobi Ferriro", "06U - Girls - Joseph Frontino", "06U - Girls - Kendall Klein", "06U - Girls - Andrea Lopez", "06U - Girls - Matt Olsen", "06U - Girls - Breanna Pena", "06U - Girls - Jeremy Vreeland",
  "08U - Boys - Raushanah Ali", "08U - Boys - Raumin Benjamin", "08U - Boys - Bryce Burnett", "08U - Boys - Dan Carmichael", "08U - Boys - Natasha Dressler", "08U - Boys - Arielle Garcia", "08U - Boys - Casey Harpham", "08U - Boys - Jeffrey Hosler", "08U - Boys - Matthew Kamada", "08U - Boys - Christina Kinne", "08U - Boys - Jorge Marquez", "08U - Boys - Victor Perez", "08U - Boys - Juan Rodriguez", "08U - Boys - Roberto Rojas", "08U - Boys - Veronica Ruiz", "08U - Boys - Amanda Towers", "08U - Boys - Fernando Vega",
  "08U - Girls - Samuel Alvarez", "08U - Girls - Krissy Barone", "08U - Girls - Michael Burke", "08U - Girls - Meghan Codipilly", "08U - Girls - Anukool Gandhi", "08U - Girls - Abraham Gomez", "08U - Girls - Mark Hernandez", "08U - Girls - Nathan Silva", "08U - Girls - Crystal Van Maanen", "08U - Girls - Adrian Yeung",
  "9UX - Boys - Chris Franco", "9UX - Girls - Kevin Yonemoto",
  "10U - Boys - Faheem Armanyous", "10U - Boys - Dustin Brieger", "10U - Boys - Ryan Bulatao", "10U - Boys - Andrew Evango", "10U - Boys - Harold Huang", "10U - Boys - Jeff Klaus", "10U - Boys - Jace Leicht", "10U - Boys - Michael Lewis", "10U - Boys - Leonardo Limon", "10U - Boys - Ryan Loza", "10U - Boys - Mark Mancilla", "10U - Boys - Long Nguyen", "10U - Boys - Stephanie Orozco", "10U - Boys - Trevor Richardson", "10U - Boys - Javier Zambrano", "10U - Boys - Tariq Zidan",
  "10UX - Boys - Paul Cuthbert",
  "10U - Girls - Dawn Caires", "10U - Girls - David Corado", "10U - Girls - Josie Cotton", "10U - Girls - Fekadu Debebe", "10U - Girls - Alexander Olmos", "10U - Girls - Matt Olsen", "10U - Girls - Tomer Otor", "10U - Girls - Brennen Poralski", "10U - Girls - Andrew Yeung",
  "10UX - Girls - Sam Humphery",
  "11UX - Girls - Jon Tarian",
  "12U - Boys - Mina Abader", "12U - Boys - Jonathan Flores", "12U - Boys - Isaiah Hicks", "12U - Boys - Terri Mackay", "12U - Boys - Jorge Marquez", "12U - Boys - Allegra Martin", "12U - Boys - Amira Medina", "12U - Boys - Chris Munoz", "12U - Boys - Lucky Relator", "12U - Boys - Lawrence Tam", "12U - Boys - Hector Vargas",
  "12UX - Boys - Ignacio Brache",
  "12U - Girls - Saul Alvarez", "12U - Girls - David Corado", "12U - Girls - Carlos Cruz", "12U - Girls - Fernando Huerta", "12U - Girls - Justin Rast",
  "12UX - Girls - Jessica Ortega",
  "13UX - Boys - Jessica Husami",
  "14U - Boys - Mina Abader", "14U - Boys - Allegra Martin", "14U - Boys - Ernie Solano", "14U - Boys - Jodie Thomas",
  "14UX - Boys - Christian Villalobos",
  "14U - Girls - Jeff Dronkers", "14U - Girls - Pablo Peregrina",
  "14UX - Girls - Ben Wysocki",
  "16U - Boys - Bruce Conze", "16U - Girls - Miguel Hernandez",
  "19U - Boys - Jennifer Deselm", "19U - Girls - Josh Palafox"
];

var LJHS_FIELDS = (typeof LJHS_FIELDS !== 'undefined') ? LJHS_FIELDS : [
  "LJHS - Field #1", "LJHS - Field #2", "LJHS - Field #3",
  "LJHS - Field #4", "LJHS - Field #5", "LJHS - Field #6",
  "LJHS - Field #7", "LJHS - Field #8",
  "LJHS - Field #9", "LJHS - Field #10"
];

// Official 2026 Season Point Caps
var CAP_CERTIFIED_REF = 5;
var CAP_MATCHTRAK_BONUS = 2;
var CAP_ONFIELD_REF = 10;
var CAP_FIELD_MARSHAL = 2;
var CAP_SETUP = 1;
var CAP_PIC = 2;
var MAX_POSSIBLE_POINTS = 22;

var POINT_CAPS = (typeof POINT_CAPS !== 'undefined') ? POINT_CAPS : {
  preSeasonRefs: CAP_CERTIFIED_REF,
  matchTrakBonus: CAP_MATCHTRAK_BONUS,
  onFieldReferee: CAP_ONFIELD_REF,
  fieldMarshal: CAP_FIELD_MARSHAL,
  fridaySetup: CAP_SETUP,
  pictureDay: CAP_PIC
};

/**
 * Normalizes a raw form time-slot string into a single canonical form for deduplication.
 */
function normalizeTimeSlot(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Normalizes team codes/keys to a canonical representation for resilient matching.
 * Handles middle dots ('·', '•'), hyphens ('-'), and 'Coach' prefixes.
 *
 * Examples:
 *   "10U · Boys · Coach Faheem Armanyous" -> "10u - boys - faheem armanyous"
 *   "10U - Boys - Coach Faheem Armanyous" -> "10u - boys - faheem armanyous"
 *   "Coach Faheem Armanyous"             -> "faheem armanyous"
 *   "Faheem Armanyous"                   -> "faheem armanyous"
 */
function normalizeTeamKey(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/[·•⋅\u00B7\u2022\u22C5\u2013\u2014\u2012\u2212]/g, '-')
    .replace(/\bcoach\b[:\s-]*/gi, '')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Checks whether a candidate cell or string matches the target team.
 */
function isTeamMatch(cellValue, targetTeam, targetNorm) {
  if (!cellValue) return false;
  const rawStr = String(cellValue).trim();
  if (!rawStr) return false;
  if (targetTeam && rawStr === targetTeam) return true;

  const cellNorm = normalizeTeamKey(rawStr);
  if (!cellNorm) return false;
  if (targetNorm && cellNorm === targetNorm) return true;

  if (targetNorm && cellNorm) {
    if (cellNorm.endsWith(' - ' + targetNorm) || targetNorm.endsWith(' - ' + cellNorm)) {
      return true;
    }
    if (targetNorm.length >= 4 && (cellNorm.includes(targetNorm) || targetNorm.includes(cellNorm))) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves active point caps for calculations.
 */
function getActiveCaps() {
  const settings = (typeof getAdminConfigSettings === 'function') ? getAdminConfigSettings() : {};
  const onFieldRef = Number(settings.RefMaxCap) || CAP_ONFIELD_REF;
  const fieldMarshal = Number(settings.FieldMarshalCap) || CAP_FIELD_MARSHAL;
  const setup = Number(settings.FieldSetupCap) || CAP_SETUP;
  const pic = Number(settings.PictureDayCap) || CAP_PIC;
  return {
    onFieldRef: onFieldRef,
    fieldMarshal: fieldMarshal,
    setup: setup,
    pic: pic,
    certifiedRef: CAP_CERTIFIED_REF,
    matchtrak: CAP_MATCHTRAK_BONUS,
    maxPossible: CAP_CERTIFIED_REF + CAP_MATCHTRAK_BONUS + onFieldRef + fieldMarshal + setup + pic
  };
}

// ============================================================================
// WEB APP ENDPOINTS (doGet / doPost)
// ============================================================================

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action;
  const callback = params.callback;

  if (!action || action === 'board') {
    if (typeof renderBoardApp === 'function') {
      return renderBoardApp();
    }
  }

  let result = null;
  if (action === 'getDirectory') {
    result = getDirectoryData();
  } else if (action === 'getTeamStats') {
    const teamCode = params.teamCode;
    if (typeof getTeamStatsWithAwards === 'function') {
      result = getTeamStatsWithAwards(teamCode);
    } else {
      result = getTeamStatsData(teamCode);
    }
  } else if (action === 'getSettings') {
    result = getSettingsData();
  } else {
    result = { error: 'Invalid action parameter' };
  }

  const jsonStr = JSON.stringify(result);

  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonStr + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    return ContentService.createTextOutput(jsonStr)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Settings');
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
      sheet.appendRow(['Key', 'Value']);
    }
    const payload = JSON.parse(e.postData.contents);
    const data = sheet.getDataRange().getValues();
    const existingKeys = {};
    for (let i = 1; i < data.length; i++) {
      existingKeys[data[i][0]] = i + 1;
    }

    const ADMIN_CONFIG_OWNED_KEYS = ['RefMaxCap', 'PlayoffThreshold'];

    for (const [k, v] of Object.entries(payload)) {
      if (ADMIN_CONFIG_OWNED_KEYS.indexOf(k) !== -1 && typeof setAdminConfigSetting === 'function') {
        setAdminConfigSetting(k, v);
        continue;
      }
      if (existingKeys[k]) {
        sheet.getRange(existingKeys[k], 2).setValue(v);
      } else {
        sheet.appendRow([k, v]);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getDirectoryData() {
  const dir = {};
  const tz = (typeof CONFIG !== 'undefined' && CONFIG.TIMEZONE) ? CONFIG.TIMEZONE : 'America/Los_Angeles';
  MASTER_TEAMS.forEach(rawTeam => {
    const parts = rawTeam.split(' - ');
    if (parts.length >= 3) {
      const division = parts[0].trim() + ' - ' + parts[1].trim();
      const coach = parts.slice(2).join(' - ').trim();
      if (!dir[division]) dir[division] = [];
      dir[division].push({ teamCode: rawTeam, coach: coach });
    } else {
      const division = parts[0].trim();
      if (!dir[division]) dir[division] = [];
      dir[division].push({ teamCode: rawTeam, coach: rawTeam });
    }
  });
  return {
    directory: dir,
    syncTimestamp: Utilities.formatDate(new Date(), tz, 'MMM d, yyyy, h:mm a')
  };
}

/**
 * Returns complete team stats, verified points, category caps, and itemized shift history.
 * - Reads verified points and category caps directly from Season_Master_Ledger when available.
 * - Extracts itemized volunteer shift history from 'Game Day Check-ins' (or fallback 'Form Responses 1').
 * - Incorporates Team_Awards adjustments and bonuses.
 */
function getTeamStatsData(targetTeam) {
  const tz = (typeof CONFIG !== 'undefined' && CONFIG.TIMEZONE) ? CONFIG.TIMEZONE : 'America/Los_Angeles';
  const nowStr = Utilities.formatDate(new Date(), tz, 'MMM d, yyyy, h:mm a');

  const baseResult = {
    totalPoints: 0,
    categories: {
      'Certified Team Referees': 0,
      'MatchTrak Filled by Sep 26': 0,
      'Early Ref Scheduling Incentive': 0,
      'Referee (On-Field)': 0,
      'Referee Assignment': 0,
      'Field Marshal': 0,
      'Field Marshal Shift': 0,
      'Friday Night Setup': 0,
      'Friday Night Field Setup': 0,
      'Saturday Field Setup': 0,
      'Picture Picnic Day': 0,
      'Picture Day': 0,
      'Other Adjustments': 0
    },
    audit: [],
    syncTimestamp: nowStr
  };

  if (!targetTeam || typeof targetTeam !== 'string' || !targetTeam.trim()) {
    return baseResult;
  }

  const cleanTarget = targetTeam.trim();
  const targetNorm = normalizeTeamKey(cleanTarget);
  if (!targetNorm) {
    return baseResult;
  }

  const ss = (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null;
  if (!ss) {
    return baseResult;
  }

  // --------------------------------------------------------------------------
  // 1. Read verified points and category caps directly from Season_Master_Ledger
  // --------------------------------------------------------------------------
  let ledgerFound = false;
  let ledgerCaps = getActiveCaps();
  let ledgerGoal = 17;
  let ledgerStatus = '';

  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  if (ledgerSheet && ledgerSheet.getLastRow() >= 2) {
    const ledgerRows = ledgerSheet.getDataRange().getValues();
    const headers = ledgerRows[0].map(h => String(h || '').trim().toLowerCase());

    // Dynamically parse category caps from header text, e.g. "Referee Points (Max 10)"
    headers.forEach(h => {
      const maxMatch = h.match(/\(max\s*(\d+)\)/i);
      const capVal = maxMatch ? Number(maxMatch[1]) : null;
      if (capVal !== null) {
        if (/referee/i.test(h)) ledgerCaps.onFieldRef = capVal;
        else if (/marshal/i.test(h)) ledgerCaps.fieldMarshal = capVal;
        else if (/setup/i.test(h)) ledgerCaps.setup = capVal;
        else if (/picture/i.test(h)) ledgerCaps.pic = capVal;
        else if (/cert/i.test(h)) ledgerCaps.certifiedRef = capVal;
        else if (/matchtrak/i.test(h)) ledgerCaps.matchtrak = capVal;
      }
    });

    const idxDiv = headers.indexOf('division') !== -1 ? headers.indexOf('division') : 0;
    const idxTeam = headers.indexOf('team code') !== -1 ? headers.indexOf('team code') : 1;
    const idxCoach = headers.indexOf('head coach') !== -1 ? headers.indexOf('head coach') : 2;
    const idxRef = headers.findIndex(h => /referee.*point/i.test(h) || /ref.*point/i.test(h));
    const idxFm = headers.findIndex(h => /marshal/i.test(h));
    const idxSetup = headers.findIndex(h => /setup/i.test(h));
    const idxPic = headers.findIndex(h => /picture/i.test(h));
    const idxCert = headers.findIndex(h => /certified/i.test(h));
    const idxMatch = headers.findIndex(h => /matchtrak/i.test(h));
    const idxOther = headers.findIndex(h => /other|adjust/i.test(h));
    const idxTotal = headers.findIndex(h => /total/i.test(h));
    const idxGoal = headers.findIndex(h => /goal/i.test(h));
    const idxStatus = headers.findIndex(h => /status/i.test(h));

    for (let r = 1; r < ledgerRows.length; r++) {
      const row = ledgerRows[r];
      const rowTeam = String(row[idxTeam !== -1 ? idxTeam : 1] || '').trim();
      const rowCoach = String(row[idxCoach !== -1 ? idxCoach : 2] || '').trim();

      if (isTeamMatch(rowTeam, cleanTarget, targetNorm) || isTeamMatch(rowCoach, cleanTarget, targetNorm)) {
        ledgerFound = true;

        const refPts = idxRef !== -1 ? (Number(row[idxRef]) || 0) : (Number(row[3]) || 0);
        const fmPts = idxFm !== -1 ? (Number(row[idxFm]) || 0) : (Number(row[4]) || 0);
        const setupPts = idxSetup !== -1 ? (Number(row[idxSetup]) || 0) : (Number(row[5]) || 0);
        const picPts = idxPic !== -1 ? (Number(row[idxPic]) || 0) : (Number(row[6]) || 0);
        const certRefPts = idxCert !== -1 ? (Number(row[idxCert]) || 0) : (Number(row[7]) || 0);
        const matchtrakPts = idxMatch !== -1 ? (Number(row[idxMatch]) || 0) : (Number(row[8]) || 0);
        const otherPts = idxOther !== -1 ? (Number(row[idxOther]) || 0) : (Number(row[9]) || 0);
        const totalPts = idxTotal !== -1 ? (Number(row[idxTotal]) || 0) : (Number(row[10]) || (refPts + fmPts + setupPts + picPts + certRefPts + matchtrakPts + otherPts));
        ledgerGoal = idxGoal !== -1 ? (Number(row[idxGoal]) || 17) : (Number(row[11]) || 17);
        ledgerStatus = idxStatus !== -1 ? String(row[idxStatus] || '').trim() : String(row[12] || '').trim();

        baseResult.totalPoints = totalPts;
        baseResult.goal = ledgerGoal;
        baseResult.playoffGoal = ledgerGoal;
        baseResult.status = ledgerStatus || (totalPts >= ledgerGoal ? 'Qualified' : `${ledgerGoal - totalPts} pts needed`);
        baseResult.playoffStatus = baseResult.status;

        baseResult.categories['Certified Team Referees'] = certRefPts;
        baseResult.categories['MatchTrak Filled by Sep 26'] = matchtrakPts;
        baseResult.categories['Early Ref Scheduling Incentive'] = matchtrakPts;
        baseResult.categories['Referee (On-Field)'] = refPts;
        baseResult.categories['Referee Assignment'] = refPts;
        baseResult.categories['Field Marshal'] = fmPts;
        baseResult.categories['Field Marshal Shift'] = fmPts;
        baseResult.categories['Friday Night Setup'] = setupPts;
        baseResult.categories['Friday Night Field Setup'] = setupPts;
        baseResult.categories['Saturday Field Setup'] = setupPts;
        baseResult.categories['Picture Picnic Day'] = picPts;
        baseResult.categories['Picture Day'] = picPts;
        baseResult.categories['Other Adjustments'] = otherPts;
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. Extract itemized volunteer shift history from the check-ins sheet
  //    (Handles tab name fallbacks: 'Game Day Check-ins' and 'Form Responses 1')
  // --------------------------------------------------------------------------
  const checkinSheet = ss.getSheetByName('Game Day Check-ins') || ss.getSheetByName('Form Responses 1');
  const audit = [];
  const dynamicCounts = { ref: 0, fm: 0, setup: 0, pic: 0 };
  const seenVolunteerSlots = new Set();

  if (checkinSheet && checkinSheet.getLastRow() >= 2) {
    const rows = checkinSheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;

      const timestamp = row[0];
      let dateStr = '';
      if (timestamp instanceof Date) {
        dateStr = Utilities.formatDate(timestamp, tz, 'MMM d, yyyy');
      } else {
        const parsedDate = new Date(timestamp);
        dateStr = !isNaN(parsedDate.getTime())
          ? Utilities.formatDate(parsedDate, tz, 'MMM d, yyyy')
          : String(timestamp).split(' ')[0];
      }

      const email = String(row[1] || '').trim().toLowerCase();
      const firstName = String(row[2] || '').trim();
      const lastName = String(row[3] || '').trim();
      const volName = (firstName + ' ' + lastName).trim();
      const volId = volName.toLowerCase() || email;

      const dutyRaw = String(row[4] || '').trim();
      const refPosition = String(row[5] || '').trim();
      const rowTeamRef = String(row[6] || '').trim();
      const refGameTime = String(row[7] || '').trim();
      const refField = String(row[8] || '').trim();

      const rowTeamFm = String(row[9] || '').trim();
      const fmField = String(row[10] || '').trim();
      const fmGameTime = String(row[11] || '').trim();

      const rowTeamSetup = String(row[12] || '').trim();
      const setupField = String(row[13] || '').trim();

      const auditColStatus = String(row[14] || '').trim();
      const auditColPts = (row[15] !== '' && row[15] !== undefined) ? Number(row[15]) : null;
      const auditColReason = String(row[16] || '').trim();

      let isMatch = false;
      let category = '';
      let categoryCap = 0;
      let timeSlot = '';
      let field = '';
      let isNocra = false;

      const hasTeamInRow = row.some(cell => isTeamMatch(cell, cleanTarget, targetNorm));

      if (isTeamMatch(rowTeamRef, cleanTarget, targetNorm) || (/ref/i.test(dutyRaw) && hasTeamInRow)) {
        isMatch = true;
        category = 'Referee Assignment';
        categoryCap = ledgerCaps.onFieldRef;
        timeSlot = refGameTime || 'GameTime';
        field = refField || 'Field';
        if (/nocra|ussf/i.test(refPosition)) {
          isNocra = true;
        }
      } else if (isTeamMatch(rowTeamFm, cleanTarget, targetNorm) || (/marshal/i.test(dutyRaw) && hasTeamInRow)) {
        isMatch = true;
        category = 'Field Marshal Shift';
        categoryCap = ledgerCaps.fieldMarshal;
        timeSlot = fmGameTime || 'ShiftTime';
        field = fmField || 'Field';
      } else if (isTeamMatch(rowTeamSetup, cleanTarget, targetNorm) || (/set\s*up/i.test(dutyRaw) && hasTeamInRow)) {
        isMatch = true;
        category = 'Friday Night Field Setup';
        categoryCap = ledgerCaps.setup;
        timeSlot = 'FridayNight';
        field = setupField || 'Field';
      } else if (/picture/i.test(dutyRaw) && hasTeamInRow) {
        isMatch = true;
        category = 'Picture Day';
        categoryCap = ledgerCaps.pic;
        timeSlot = 'PicShift';
        field = 'Picture Tent';
      }

      if (isMatch) {
        let status = 'Recorded';
        let pts = 0;

        if (auditColStatus) {
          // If already audited by AuditEngine in Columns O/P/Q, honor verified values
          status = auditColStatus;
          pts = (auditColPts !== null && !isNaN(auditColPts)) ? auditColPts : (/recorded|verified/i.test(status) ? 1 : 0);
          if (pts > 0) {
            if (category === 'Referee Assignment') dynamicCounts.ref += pts;
            else if (category === 'Field Marshal Shift') dynamicCounts.fm += pts;
            else if (category === 'Friday Night Field Setup') dynamicCounts.setup += pts;
            else if (category === 'Picture Day') dynamicCounts.pic += pts;
          }
        } else {
          // Dynamic evaluation if row is not yet audited
          if (isNocra) {
            status = 'NOCRA - No Points';
            pts = 0;
          } else {
            const normTime = normalizeTimeSlot(timeSlot);
            const normPos = String(refPosition || '').replace(/\s+/g, '').toLowerCase();
            const slotKey = `${volId}_${dateStr}_${normTime}_${category}_${normPos}`;

            let currentTotal = 0;
            if (category === 'Referee Assignment') currentTotal = dynamicCounts.ref;
            else if (category === 'Field Marshal Shift') currentTotal = dynamicCounts.fm;
            else if (category === 'Friday Night Field Setup') currentTotal = dynamicCounts.setup;
            else if (category === 'Picture Day') currentTotal = dynamicCounts.pic;

            if (seenVolunteerSlots.has(slotKey)) {
              status = 'Duplicate Submission';
              pts = 0;
            } else if (currentTotal >= categoryCap) {
              status = 'Cap Reached';
              pts = 0;
            } else {
              status = 'Recorded';
              pts = 1;
              seenVolunteerSlots.add(slotKey);

              if (category === 'Referee Assignment') dynamicCounts.ref++;
              else if (category === 'Field Marshal Shift') dynamicCounts.fm++;
              else if (category === 'Friday Night Field Setup') dynamicCounts.setup++;
              else if (category === 'Picture Day') dynamicCounts.pic++;
            }
          }
        }

        audit.push({
          duty: category + (timeSlot && timeSlot !== 'FridayNight' && timeSlot !== 'PicShift' ? ` (${timeSlot})` : ''),
          date: dateStr,
          status: status,
          points: pts,
          volunteer: volName || email,
          note: auditColReason || ''
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // 3. Read Team_Awards (manual board adjustments, bonuses, uniform deductions)
  // --------------------------------------------------------------------------
  const awardsSheet = ss.getSheetByName('Team_Awards');
  let certRefAwards = 0;
  let matchtrakAwards = 0;
  let picAwards = 0;
  let discretionaryAwards = 0;
  let refDeductions = 0;

  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    const awardRows = awardsSheet.getDataRange().getValues();
    const firstHeader = String(awardRows[0][0] || '').trim().toLowerCase();

    // Check if wide summary schema (Col A = teamCode, Col D = pictureDay)
    if (firstHeader === 'teamcode' || awardRows[0].some(h => String(h || '').trim().toLowerCase() === 'pictureday')) {
      const headerMap = {};
      awardRows[0].forEach((h, idx) => {
        headerMap[String(h || '').trim().toLowerCase()] = idx;
      });

      const idxTeam = headerMap['teamcode'] !== undefined ? headerMap['teamcode'] : 0;
      const idxRefs = headerMap['preseasonrefs'] !== undefined ? headerMap['preseasonrefs'] : 1;
      const idxMatch = headerMap['matchtrakbonus'] !== undefined ? headerMap['matchtrakbonus'] : 2;
      const idxPic = headerMap['pictureday'] !== undefined ? headerMap['pictureday'] : 3;
      const idxAdj = headerMap['adjustment'] !== undefined ? headerMap['adjustment'] : 4;
      const idxReason = headerMap['reason'] !== undefined ? headerMap['reason'] : 5;

      for (let j = 1; j < awardRows.length; j++) {
        const aRow = awardRows[j];
        const aTeam = String(aRow[idxTeam] || '').trim();
        if (!isTeamMatch(aTeam, cleanTarget, targetNorm)) continue;

        const pRefs  = Number(aRow[idxRefs]) || 0;
        const pMatch = Number(aRow[idxMatch]) || 0;
        const pPic   = Number(aRow[idxPic]) || 0;
        const pAdj   = Number(aRow[idxAdj]) || 0;
        const note   = String(aRow[idxReason] || '').trim();

        if (pPic > 0) {
          picAwards = Math.min(ledgerCaps.pic, picAwards + pPic);
          audit.push({
            duty: 'Picture Picnic Day',
            date: 'Sep 20, 2026',
            status: 'Verified',
            points: pPic,
            note: note || 'Picture Day volunteer shift'
          });
        }
        if (pRefs > 0) {
          certRefAwards = Math.min(ledgerCaps.certifiedRef, certRefAwards + pRefs);
          audit.push({
            duty: 'Certified Team Referees',
            date: 'Sep 20, 2026',
            status: 'Verified',
            points: pRefs,
            note: note || 'Certified team referees'
          });
        }
        if (pMatch > 0) {
          matchtrakAwards = Math.min(ledgerCaps.matchtrak, matchtrakAwards + pMatch);
          audit.push({
            duty: 'MatchTrak Filled by Sep 26',
            date: 'Sep 20, 2026',
            status: 'Verified',
            points: pMatch,
            note: note || 'MatchTrak slots filled'
          });
        }
        if (pAdj !== 0) {
          discretionaryAwards += pAdj;
          audit.push({
            duty: 'Administrative Adjustment',
            date: 'Sep 20, 2026',
            status: pAdj < 0 ? 'Deduction Applied' : 'Verified',
            points: pAdj,
            note: note
          });
        }
        break;
      }
    } else {
      // Legacy transactional format fallback
      for (let j = 1; j < awardRows.length; j++) {
        const aRow = awardRows[j];
        const aTeam = String(aRow[1] || '').trim();
        if (!isTeamMatch(aTeam, cleanTarget, targetNorm)) continue;

        const aType = String(aRow[2] || '').trim();
        const aPts = Number(aRow[3]) || 0;
        const aNote = String(aRow[4] || '').trim();
        const aTime = aRow[0];
        let aDateStr = '';
        if (aTime instanceof Date) {
          aDateStr = Utilities.formatDate(aTime, tz, 'MMM d, yyyy');
        } else {
          aDateStr = String(aTime).split(' ')[0];
        }

        if (aType.includes('Uniform') || aType.includes('Disqualification')) {
          refDeductions += aPts;
          audit.push({
            duty: aType,
            date: aDateStr,
            status: 'Deduction Applied',
            points: aPts,
            note: aNote
          });
        } else if (aType === 'Certified Team Referees') {
          certRefAwards = Math.min(ledgerCaps.certifiedRef, certRefAwards + aPts);
          audit.push({
            duty: aType,
            date: aDateStr,
            status: 'Verified',
            points: aPts,
            note: aNote
          });
        } else if (aType === 'MatchTrak Filled by Sep 26') {
          matchtrakAwards = Math.min(ledgerCaps.matchtrak, matchtrakAwards + aPts);
          audit.push({
            duty: aType,
            date: aDateStr,
            status: 'Verified',
            points: aPts,
            note: aNote
          });
        } else {
          discretionaryAwards += aPts;
          audit.push({
            duty: aType,
            date: aDateStr,
            status: aPts < 0 ? 'Deduction Applied' : 'Verified',
            points: aPts,
            note: aNote
          });
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. If Season_Master_Ledger was not found, roll up fallback calculations
  // --------------------------------------------------------------------------
  if (!ledgerFound) {
    const finalPic = Math.min(ledgerCaps.pic, dynamicCounts.pic + picAwards);
    const finalRef = Math.max(0, Math.min(ledgerCaps.onFieldRef, dynamicCounts.ref) + refDeductions);
    const finalFm = Math.min(ledgerCaps.fieldMarshal, dynamicCounts.fm);
    const finalSetup = Math.min(ledgerCaps.setup, dynamicCounts.setup);

    baseResult.totalPoints = Math.min(
      ledgerCaps.maxPossible,
      Math.max(0, finalRef + finalFm + finalSetup + finalPic + certRefAwards + matchtrakAwards + discretionaryAwards)
    );

    baseResult.categories['Certified Team Referees'] = certRefAwards;
    baseResult.categories['MatchTrak Filled by Sep 26'] = matchtrakAwards;
    baseResult.categories['Early Ref Scheduling Incentive'] = matchtrakAwards;
    baseResult.categories['Referee (On-Field)'] = finalRef;
    baseResult.categories['Referee Assignment'] = finalRef;
    baseResult.categories['Field Marshal'] = finalFm;
    baseResult.categories['Field Marshal Shift'] = finalFm;
    baseResult.categories['Friday Night Setup'] = finalSetup;
    baseResult.categories['Friday Night Field Setup'] = finalSetup;
    baseResult.categories['Saturday Field Setup'] = finalSetup;
    baseResult.categories['Picture Picnic Day'] = finalPic;
    baseResult.categories['Picture Day'] = finalPic;
    baseResult.categories['Other Adjustments'] = discretionaryAwards;
  }

  // Order audit newest first
  baseResult.audit = audit.reverse();
  return baseResult;
}

function getSettingsData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Settings');
  const result = { BoardEmail: '', RCEmail: '', RefMaxCap: 10, PlayoffThreshold: 17 };

  if (sheet && sheet.getLastRow() >= 2) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        result[data[i][0]] = data[i][1];
      }
    }
  }

  if (typeof getAdminConfigSettings === 'function') {
    const adminSettings = getAdminConfigSettings();
    if (adminSettings.RefMaxCap !== undefined) result.RefMaxCap = adminSettings.RefMaxCap;
    if (adminSettings.PlayoffThreshold !== undefined) result.PlayoffThreshold = adminSettings.PlayoffThreshold;
  }

  return result;
}

// ============================================================================
// NODE.JS TEST EXPORTS
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MASTER_TEAMS,
    LJHS_FIELDS,
    POINT_CAPS,
    CAP_CERTIFIED_REF,
    CAP_MATCHTRAK_BONUS,
    CAP_ONFIELD_REF,
    CAP_FIELD_MARSHAL,
    CAP_SETUP,
    CAP_PIC,
    MAX_POSSIBLE_POINTS,
    getActiveCaps,
    normalizeTimeSlot,
    normalizeTeamKey,
    isTeamMatch,
    getDirectoryData,
    getTeamStatsData,
    getSettingsData
  };
}