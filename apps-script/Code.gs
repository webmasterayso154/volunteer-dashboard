/**
 * ============================================================================
 * AYSO REGION 154 - VOLUNTEER STANDINGS BACKEND
 * ============================================================================
 * File: Code.gs
 * Description: Core data processing engine for volunteer form responses, point 
 *              calculations, category capping, NOCRA filtering, and slot deduplication.
 * 
 * VERSION & CHANGE HISTORY:
 * - v1.0 (Jul 2026): Initial baseline release & schema setup.
 * - v2.0 (Aug 2026): Added automated cap enforcement for Ref, FM, Setup, & Pic Day.
 * - v3.0 (Sep 8, 2026): Fixed live 14-column sheet schema index alignment.
 * - v4.0 (Sep 9, 2026): Calibrated to support Dual ARs for out-of-region/upper division 
 *                      home matches (up to 2 pts/game), excluded paid NOCRA/USSF 
 *                      referees (0 pts), replaced blunt daily locks with individual 
 *                      volunteer slot deduplication, and removed single-day 
 *                      restrictions on Field Marshal shifts per Nikki/Vince clarifications.
 * - v4.1 (Sep 9, 2026): Calibrated status labeling and visual hierarchy:
 *                      - Replaced "Paid Referee (NOCRA)" with neutral "NOCRA - No Points".
 *                      - Set default submission status to "Recorded" instead of "Verified".
 *                      - Reserved "Verified" strictly for board-confirmed awards and audits.
 * ============================================================================
 */

const MASTER_TEAMS = [
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

const LJHS_FIELDS = [
  "LJHS - Field #1", "LJHS - Field #2", "LJHS - Field #3",
  "LJHS - Field #4", "LJHS - Field #5", "LJHS - Field #6",
  "LJHS - Field #7", "LJHS - Field #8",
  "LJHS - Field #9", "LJHS - Field #10"
];

// Official 2026 Season Point Caps
const CAP_CERTIFIED_REF = 5;
const CAP_MATCHTRAK_BONUS = 2;
const CAP_ONFIELD_REF = 10;
const CAP_FIELD_MARSHAL = 2;
const CAP_SETUP = 5;
const CAP_PIC = 2;
const MAX_POSSIBLE_POINTS = 26;

// Flyer point-bucket -> live cap constant map. Consumed by Contract_Tests.gs to
// verify every bucket promised on the season flyer actually reaches the payload
// and that the qualification threshold stays mathematically reachable.
const POINT_CAPS = {
  preSeasonRefs: CAP_CERTIFIED_REF,
  matchTrakBonus: CAP_MATCHTRAK_BONUS,
  onFieldReferee: CAP_ONFIELD_REF,
  fieldMarshal: CAP_FIELD_MARSHAL,
  fridaySetup: CAP_SETUP,
  pictureDay: CAP_PIC
};

/**
 * Normalizes a raw form time-slot string (e.g. "8:00 AM", "8:00am", "8:00 am")
 * into a single canonical form so dedup/collision keys built from it never
 * split an identical real-world slot into two different keys.
 */
function normalizeTimeSlot(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Resolves the live point caps for a team's calculation. Admin_Config is the
 * single source of truth when present (shared with the Board Portal); the
 * CAP_* constants are only a fallback for a fresh sheet with no Admin_Config
 * tab yet, so the public dashboard and Board Portal never disagree.
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

    // RefMaxCap / PlayoffThreshold are owned by Admin_Config (shared with the
    // Board Portal); route those writes there instead of forking a second copy
    // in the legacy Settings sheet.
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
    syncTimestamp: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a')
  };
}

function getTeamStatsData(targetTeam) {
  const nowStr = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a');

  const baseResult = {
    totalPoints: 0,
    categories: {
      'Certified Team Referees': 0,
      'MatchTrak Filled by Sep 26': 0,
      'Referee (On-Field)': 0,
      'Referee Assignment': 0,
      'Field Marshal': 0,
      'Field Marshal Shift': 0,
      'Friday Night Setup': 0,
      'Friday Night Field Setup': 0,
      'Picture Picnic Day': 0,
      'Picture Day': 0
    },
    audit: [],
    syncTimestamp: nowStr
  };

  if (!targetTeam || typeof targetTeam !== 'string' || !targetTeam.trim()) {
    return baseResult;
  }
  const cleanTarget = targetTeam.trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet || sheet.getLastRow() < 2) return baseResult;

  const rows = sheet.getDataRange().getValues();
  const caps = getActiveCaps();
  let refPoints = 0;
  let fmPoints = 0;
  let setupPoints = 0;
  let picPoints = 0;

  const audit = [];
  // Slot key: volunteerId + date + time + category to allow dual ARs per match while preventing double submits
  const seenVolunteerSlots = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    let dateStr = '';
    if (timestamp instanceof Date) {
      dateStr = Utilities.formatDate(timestamp, 'America/Los_Angeles', 'MMM d, yyyy');
    } else {
      const parsedDate = new Date(timestamp);
      dateStr = !isNaN(parsedDate.getTime()) 
        ? Utilities.formatDate(parsedDate, 'America/Los_Angeles', 'MMM d, yyyy')
        : String(timestamp).split(' ')[0];
    }

    // Schema: Col B: Email, Col C: First, Col D: Last, Col E: Role, Col F: RefPos, Col G: RefTeam, Col H: GameTime
    // Col I: RefField, Col J: FM Team, Col K: FM Field, Col L: FM Time, Col M: Setup Team, Col N: Setup Field
    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const volId = email || (firstName + ' ' + lastName).trim().toLowerCase();

    const dutyRaw = String(row[4] || '').trim();
    const refPosition = String(row[5] || '').trim();
    const rowTeamRef = String(row[6] || '').trim();
    const refGameTime = String(row[7] || '').trim();
    
    const rowTeamFm = String(row[9] || '').trim();
    const fmGameTime = String(row[11] || '').trim();

    const rowTeamSetup = String(row[12] || '').trim();

    let isMatch = false;
    let category = '';
    let categoryCap = 0;
    let currentCategoryTotal = 0;
    let timeSlot = '';
    let isNocra = false;

    if (rowTeamRef === cleanTarget || (/ref/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Referee Assignment';
      categoryCap = caps.onFieldRef;
      currentCategoryTotal = refPoints;
      timeSlot = refGameTime || 'GameTime';
      if (/nocra|ussf/i.test(refPosition)) {
        isNocra = true;
      }
    } else if (rowTeamFm === cleanTarget || (/marshal/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Field Marshal Shift';
      categoryCap = caps.fieldMarshal;
      currentCategoryTotal = fmPoints;
      timeSlot = fmGameTime || 'ShiftTime';
    } else if (rowTeamSetup === cleanTarget || (/set\s*up/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Friday Night Field Setup';
      categoryCap = caps.setup;
      currentCategoryTotal = setupPoints;
      timeSlot = 'FridayNight';
    } else if (/picture/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1) {
      isMatch = true;
      category = 'Picture Day';
      categoryCap = caps.pic;
      currentCategoryTotal = picPoints;
      timeSlot = 'PicShift';
    }

    if (isMatch) {
      let status = 'Recorded';
      let pts = 0;

      // Rule 1: Paid NOCRA / USSF Center Referees receive 0 volunteer points
      if (isNocra) {
        status = 'NOCRA - No Points';
        pts = 0;
      } else {
        const slotKey = volId + '_' + dateStr + '_' + normalizeTimeSlot(timeSlot) + '_' + category;

        // Rule 2: Prevent exact same volunteer from double-submitting for the same match slot
        if (seenVolunteerSlots.has(slotKey)) {
          status = 'Duplicate Submission';
          pts = 0;
        } else if (currentCategoryTotal >= categoryCap) {
          status = 'Cap Reached';
          pts = 0;
        } else {
          // Automated form submissions are labeled 'Recorded'
          status = 'Recorded';
          pts = 1;
          seenVolunteerSlots.add(slotKey);

          if (category === 'Referee Assignment') refPoints++;
          else if (category === 'Field Marshal Shift') fmPoints++;
          else if (category === 'Friday Night Field Setup') setupPoints++;
          else if (category === 'Picture Day') picPoints++;
        }
      }

      audit.push({
        duty: category + (timeSlot && timeSlot !== 'FridayNight' && timeSlot !== 'PicShift' ? ` (${timeSlot})` : ''),
        date: dateStr,
        status: status,
        points: pts
      });
    }
  }

  // Aggregate Team_Awards overrides (Marked as 'Verified' or 'Deduction Applied')
  const awardsSheet = ss.getSheetByName('Team_Awards');
  let certRefPoints = 0;
  let matchtrakPoints = 0;
  let discretionaryAwards = 0;

  if (awardsSheet && awardsSheet.getLastRow() > 1) {
    const awardRows = awardsSheet.getDataRange().getValues();
    for (let j = 1; j < awardRows.length; j++) {
      const aRow = awardRows[j];
      const aTeam = String(aRow[1] || '').trim();
      if (aTeam !== cleanTarget) continue;

      const aType = String(aRow[2] || '').trim();
      const aPts = Number(aRow[3]) || 0;
      const aNote = String(aRow[4] || '').trim();
      const aTime = aRow[0];
      const aDateStr = (aTime instanceof Date)
        ? Utilities.formatDate(aTime, 'America/Los_Angeles', 'MMM d, yyyy')
        : String(aTime).split(' ')[0];

      if (aType.includes('Uniform') || aType.includes('Disqualification')) {
        refPoints = Math.max(0, refPoints + aPts);
        audit.push({
          duty: aType,
          date: aDateStr,
          status: 'Deduction Applied',
          points: aPts,
          note: aNote
        });
      } else if (aType === 'Certified Team Referees') {
        certRefPoints = Math.min(caps.certifiedRef, certRefPoints + aPts);
        audit.push({
          duty: aType,
          date: aDateStr,
          status: 'Verified',
          points: aPts,
          note: aNote
        });
      } else if (aType === 'MatchTrak Filled by Sep 26') {
        matchtrakPoints = Math.min(caps.matchtrak, matchtrakPoints + aPts);
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

  baseResult.totalPoints = Math.min(
    caps.maxPossible,
    Math.max(0, refPoints + fmPoints + setupPoints + picPoints + certRefPoints + matchtrakPoints + discretionaryAwards)
  );

  baseResult.categories['Certified Team Referees'] = certRefPoints;
  baseResult.categories['MatchTrak Filled by Sep 26'] = matchtrakPoints;
  baseResult.categories['Referee (On-Field)'] = refPoints;
  baseResult.categories['Referee Assignment'] = refPoints;
  baseResult.categories['Field Marshal'] = fmPoints;
  baseResult.categories['Field Marshal Shift'] = fmPoints;
  baseResult.categories['Friday Night Setup'] = setupPoints;
  baseResult.categories['Friday Night Field Setup'] = setupPoints;
  baseResult.categories['Picture Picnic Day'] = picPoints;
  baseResult.categories['Picture Day'] = picPoints;

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

  // Admin_Config is the single source of truth for shared caps/thresholds (it's
  // also what the Board Portal reads), so it always overrides whatever value
  // happens to be sitting in the legacy Settings sheet/control-panel.
  if (typeof getAdminConfigSettings === 'function') {
    const adminSettings = getAdminConfigSettings();
    if (adminSettings.RefMaxCap !== undefined) result.RefMaxCap = adminSettings.RefMaxCap;
    if (adminSettings.PlayoffThreshold !== undefined) result.PlayoffThreshold = adminSettings.PlayoffThreshold;
  }

  return result;
}