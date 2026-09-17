/**
 * ============================================================================
 * AYSO REGION 154 - VOLUNTEER STANDINGS & SCHEDULE SYNC BACKEND (v1.6.0-RFC007)
 * ============================================================================
 * File: Code.gs
 * Description: Unified production backend for AYSO Region 154 volunteer standings,
 *              point calculations, category capping, NOCRA filtering, and automated
 *              MatchTrak schedule ingestion with 3-venue form dropdown synchronization.
 * 
 * VERSION & CHANGE HISTORY:
 * - v1.0 - v4.1: Standings backend, cap enforcement, and dual AR support.
 * - v1.6.0-RFC007: Integrated production schedule ingestion & multi-venue form sync:
 *                  • 3-Venue routing (Park Lexington, Luther Elementary, LJHS/Arnold).
 *                  • Zero-game warning fallback for Luther Elementary.
 *                  • Set-based deduplication ([...new Set(...)]) preventing Form exceptions.
 *                  • Pacific Timezone ('America/Los_Angeles') locking.
 *                  • Automated Drive CSV ingest, backup snapshots, and sync logging.
 * ============================================================================
 */

// ============================================================================
// PRODUCTION CONFIGURATION CONSTANTS
// ============================================================================
const CONFIG = {
  VERSION: 'v1.6.0-RFC007',
  TIMEZONE: 'America/Los_Angeles',
  PRODUCTION_SHEET_ID: '1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g',
  PRODUCTION_FORM_ID: '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI',
  DROP_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  ARCHIVE_FOLDER_ID: '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m',
  VENUE_TITLES: {
    PARK_LEX: 'Select Match - 🌲 Park Lexington (Denni & Cerritos)',
    LUTHER: 'Select Match - 🏫 Luther Elementary',
    LJHS_ARNOLD: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary'
  },
  LUTHER_ZERO_GAMES_OPTION: '⚠️ No games currently scheduled at Luther Elementary',
  OTHER_UNLISTED_OPTION: '⚠️ Other / Rescheduled / Unlisted Match',
  REQUIRED_HEADERS: ['Date', 'Time', 'Field', 'Division', 'Home Team', 'Away Team']
};

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
const CAP_SETUP = 1;
const CAP_PIC = 2;
const MAX_POSSIBLE_POINTS = 22;

const POINT_CAPS = {
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
    syncTimestamp: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'MMM d, yyyy, h:mm a')
  };
}

function getTeamStatsData(targetTeam) {
  const nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'MMM d, yyyy, h:mm a');

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
  const seenVolunteerSlots = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    let dateStr = '';
    if (timestamp instanceof Date) {
      dateStr = Utilities.formatDate(timestamp, CONFIG.TIMEZONE, 'MMM d, yyyy');
    } else {
      const parsedDate = new Date(timestamp);
      dateStr = !isNaN(parsedDate.getTime()) 
        ? Utilities.formatDate(parsedDate, CONFIG.TIMEZONE, 'MMM d, yyyy')
        : String(timestamp).split(' ')[0];
    }

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

      if (isNocra) {
        status = 'NOCRA - No Points';
        pts = 0;
      } else {
        const slotKey = volId + '_' + dateStr + '_' + normalizeTimeSlot(timeSlot) + '_' + category;

        if (seenVolunteerSlots.has(slotKey)) {
          status = 'Duplicate Submission';
          pts = 0;
        } else if (currentCategoryTotal >= categoryCap) {
          status = 'Cap Reached';
          pts = 0;
        } else {
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

  // Aggregate Team_Awards
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
        ? Utilities.formatDate(aTime, CONFIG.TIMEZONE, 'MMM d, yyyy')
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

  if (typeof getAdminConfigSettings === 'function') {
    const adminSettings = getAdminConfigSettings();
    if (adminSettings.RefMaxCap !== undefined) result.RefMaxCap = adminSettings.RefMaxCap;
    if (adminSettings.PlayoffThreshold !== undefined) result.PlayoffThreshold = adminSettings.PlayoffThreshold;
  }

  return result;
}

// ============================================================================
// SCHEDULE NORMALIZATION & ROUTING HELPERS (v1.6.0-RFC007)
// ============================================================================

/**
 * Normalizes date / day string to short day format (e.g. 'Sat') locked to Pacific Time.
 */
function formatDay(rawDate) {
  if (!rawDate) return '';
  if (typeof Utilities !== 'undefined') {
    if (rawDate instanceof Date) {
      return Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'EEE');
    }
    const parsedDate = new Date(String(rawDate));
    if (!isNaN(parsedDate.getTime())) {
      return Utilities.formatDate(parsedDate, CONFIG.TIMEZONE, 'EEE');
    }
  }

  if (rawDate instanceof Date) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[rawDate.getDay()];
  }
  const str = String(rawDate).trim();
  if (/^sat/i.test(str)) return 'Sat';
  if (/^sun/i.test(str)) return 'Sun';
  if (/^fri/i.test(str)) return 'Fri';
  if (/^mon/i.test(str)) return 'Mon';
  if (/^tue/i.test(str)) return 'Tue';
  if (/^wed/i.test(str)) return 'Wed';
  if (/^thu/i.test(str)) return 'Thu';

  const parsed = new Date(str.includes('T') ? str : `${str}T12:00:00Z`);
  if (!isNaN(parsed.getTime())) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[parsed.getUTCDay()];
  }
  return str;
}

/**
 * Normalizes time strings by stripping trailing seconds and standardizing spacing.
 */
function formatTime(rawTime) {
  if (!rawTime) return '';
  if (typeof Utilities !== 'undefined' && rawTime instanceof Date) {
    return Utilities.formatDate(rawTime, CONFIG.TIMEZONE, 'h:mm a');
  }

  let timeStr = String(rawTime || '')
    .replace(/:(\d{2}):\d{2}\s*([AP]M)/i, ':$1 $2')
    .replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1')
    .replace(/(\d{1,2}:\d{2})\s*([AP]M)/i, '$1 $2')
    .trim();
  return timeStr;
}

/**
 * Normalizes field strings into standard short names (Park Lex, Luther, LJHS, Arnold).
 */
function formatField(rawField) {
  if (!rawField) return '';
  let str = String(rawField).trim();

  // 1. Check for Park Lexington (Denni & Cerritos / Turf / Grass)
  if (/Park\s*Lex/i.test(str) || /Denni\s*&\s*Cerritos/i.test(str) || /Turf/i.test(str)) {
    if (/turf|artificial/i.test(str)) return 'Park Lex Turf';
    if (/grass/i.test(str)) return 'Park Lex Grass';
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `Park Lex Field ${numMatch[1]}`;
    return 'Park Lex';
  }

  // 2. Check for Luther Elementary (U8 / U10 / ES)
  if (/Luther/i.test(str)) {
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `Luther Field ${numMatch[1]}`;
    return 'Luther Field';
  }

  // 3. Check for Lexington Junior High (LJHS)
  if (/(?:Lexington|LJHS)/i.test(str)) {
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `LJHS Field ${numMatch[1]}`;
    return 'LJHS Field';
  }

  // 4. Check for Arnold Elementary / Arnold Park
  if (/Arnold/i.test(str)) {
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `Arnold Field ${numMatch[1]}`;
    return 'Arnold Field';
  }

  // Fallback cleanup
  str = str.replace(/^E\d+[-_]?/i, '');
  str = str.replace(/\bFall\s*\d{4}\b/i, '');
  str = str.replace(/\bSpring\s*\d{4}\b/i, '');
  str = str.replace(/\s*-\s*/g, ' ');
  str = str.replace(/#/g, '');
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes division codes into standard format (e.g. 'BU12' -> '12U-B', 'GU10' -> '10U-G').
 */
function formatDivision(raw) {
  if (!raw) return '';
  let str = String(raw).trim();

  let match = str.match(/^BU(\d+)$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    return `${num}U-B`;
  }

  match = str.match(/^GU(\d+)$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    return `${num}U-G`;
  }

  match = str.match(/^(\d+)\s*U\s*([BG])$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    return `${num}U-${match[2].toUpperCase()}`;
  }

  match = str.match(/^(\d+)\s*U\s*(?:-\s*)?(Boys|Girls)$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    const gender = match[2].toUpperCase().startsWith('B') ? 'B' : 'G';
    return `${num}U-${gender}`;
  }

  match = str.match(/^(\d+)\s*UX\s*(?:-\s*)?(?:(Boys|Girls)|([BG]))$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    const gender = (match[2] || match[3]).toUpperCase().startsWith('B') ? 'B' : 'G';
    return `${num}UX-${gender}`;
  }

  match = str.match(/^(\d+)U(?:X)?-([BG])$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    const isX = str.toUpperCase().includes('UX');
    return `${num}U${isX ? 'X' : ''}-${match[2].toUpperCase()}`;
  }

  return str;
}

/**
 * Normalizes team name by stripping regional prefixes.
 */
function formatTeam(rawTeam) {
  if (!rawTeam) return '';
  return String(rawTeam).replace(/^(\d+-)?E\d+-/, '').trim();
}

/**
 * Determines venue classification for a given field string.
 */
function getVenueCategory(rawField) {
  const str = String(rawField || '').toLowerCase();
  if (str.includes('park lexington') || str.includes('park lex') || str.includes('turf') || str.includes('denni & cerritos')) {
    return 'PARK_LEX';
  }
  if (str.includes('luther')) {
    return 'LUTHER';
  }
  return 'LJHS_ARNOLD';
}

// ============================================================================
// 3-VENUE SCHEDULE PARSER & CHOICE BUILDER
// ============================================================================

/**
 * Parses raw MatchTrak schedule rows into 3 separated venue choice lists:
 * - Park Lexington
 * - Luther Elementary (with zero-game warning fallback)
 * - LJHS / Arnold
 * 
 * Uses JavaScript Set-based deduplication ([...new Set(...)]) to strictly prevent duplicate choice exceptions.
 */
function buildScheduleDropdownOptionsByVenue(scheduleData) {
  if (!scheduleData || scheduleData.length <= 1) {
    return {
      parkLexMatches: [CONFIG.OTHER_UNLISTED_OPTION],
      lutherMatches: [CONFIG.LUTHER_ZERO_GAMES_OPTION, CONFIG.OTHER_UNLISTED_OPTION],
      ljhsArnoldMatches: [CONFIG.OTHER_UNLISTED_OPTION],
      allChoices: [CONFIG.OTHER_UNLISTED_OPTION]
    };
  }

  const headers = scheduleData[0].map(h => String(h || '').trim());
  const dateIdx = headers.findIndex(h => /date|day/i.test(h));
  const timeIdx = headers.findIndex(h => /^time$/i.test(h) || /game time/i.test(h) || (/time/i.test(h) && !/date/i.test(h)));
  const fieldIdx = headers.findIndex(h => /field/i.test(h));
  const divIdx = headers.findIndex(h => /div/i.test(h));
  const homeIdx = headers.findIndex(h => /home/i.test(h));
  const awayIdx = headers.findIndex(h => /away/i.test(h));

  const parkLexRaw = [];
  const lutherRaw = [];
  const ljhsArnoldRaw = [];
  const allChoicesRaw = [];

  for (let i = 1; i < scheduleData.length; i++) {
    const row = scheduleData[i];
    if (!row || row.length === 0) continue;

    const rawDate = dateIdx !== -1 ? row[dateIdx] : '';
    const rawTime = timeIdx !== -1 ? row[timeIdx] : '';
    const rawField = fieldIdx !== -1 ? row[fieldIdx] : '';
    const rawDiv = divIdx !== -1 ? row[divIdx] : '';
    const rawHome = homeIdx !== -1 ? row[homeIdx] : '';
    const rawAway = awayIdx !== -1 ? row[awayIdx] : '';

    const timeStr = formatTime(rawTime);
    if (!timeStr || timeStr.includes('###')) continue;

    const fieldStr = formatField(rawField);
    if (!fieldStr) continue;

    const dayStr = formatDay(rawDate);
    const divStr = formatDivision(rawDiv);
    const homeStr = formatTeam(rawHome);
    const awayStr = formatTeam(rawAway);

    let matchup = '';
    if (homeStr && awayStr) {
      matchup = `${homeStr} vs ${awayStr}`;
    } else {
      matchup = homeStr || awayStr;
    }

    const dayPrefix = dayStr ? `🗓️ ${dayStr} • ` : '';
    const divPrefix = divStr ? ` • ⚽ ${divStr}: ` : ' • ⚽ ';
    const matchString = `${dayPrefix}⏰ ${timeStr} • 📍 ${fieldStr}${divPrefix}${matchup}`.trim();

    const venue = getVenueCategory(rawField);
    if (venue === 'PARK_LEX') {
      parkLexRaw.push(matchString);
    } else if (venue === 'LUTHER') {
      lutherRaw.push(matchString);
    } else {
      ljhsArnoldRaw.push(matchString);
    }
    allChoicesRaw.push(matchString);
  }

  // Deduplicate using JavaScript Sets to prevent duplicate choice exceptions in Google Forms
  let parkLexMatches = [...new Set(parkLexRaw)];
  let lutherMatches = [...new Set(lutherRaw)];
  let ljhsArnoldMatches = [...new Set(ljhsArnoldRaw)];
  let allChoices = [...new Set(allChoicesRaw)];

  // Zero-game warning fallback for Luther Elementary
  if (lutherMatches.length === 0) {
    lutherMatches.push(CONFIG.LUTHER_ZERO_GAMES_OPTION);
  }

  // Append escape hatch option to all venue lists
  parkLexMatches.push(CONFIG.OTHER_UNLISTED_OPTION);
  lutherMatches.push(CONFIG.OTHER_UNLISTED_OPTION);
  ljhsArnoldMatches.push(CONFIG.OTHER_UNLISTED_OPTION);

  // Final Set deduplication pass
  parkLexMatches = [...new Set(parkLexMatches)];
  lutherMatches = [...new Set(lutherMatches)];
  ljhsArnoldMatches = [...new Set(ljhsArnoldMatches)];
  allChoices = [...new Set(allChoices)];

  return {
    parkLexMatches,
    lutherMatches,
    ljhsArnoldMatches,
    allChoices
  };
}

/**
 * Validates that all required headers are present in the parsed CSV dataset.
 */
function validateScheduleHeaders(parsedData) {
  if (!parsedData || parsedData.length < 2) {
    throw new Error(`Ingest aborted: Schedule contains insufficient rows (${parsedData ? parsedData.length : 0}).`);
  }
  const headers = parsedData[0].map(h => String(h || '').trim());
  for (let req of CONFIG.REQUIRED_HEADERS) {
    const hasHeader = headers.some(h => h.toLowerCase() === req.toLowerCase());
    if (!hasHeader) {
      throw new Error(`Ingest aborted: Missing required MatchTrak column header -> '${req}'. Headers present: [${headers.join(', ')}]`);
    }
  }
  return true;
}

// ============================================================================
// FORM SYNC & DRIVE AUTO-INGEST PIPELINE
// ============================================================================

/**
 * Parses Master Schedule and populates all 3 multi-venue form questions:
 * 1. Park Lexington
 * 2. Luther Elementary (with zero-game warning fallback)
 * 3. LJHS / Arnold
 */
function syncContainerFormSchedule() {
  let form;
  if (typeof FormApp !== 'undefined') {
    try {
      form = FormApp.getActiveForm() || FormApp.openById(CONFIG.PRODUCTION_FORM_ID);
    } catch (e) {
      form = FormApp.openById(CONFIG.PRODUCTION_FORM_ID);
    }
  }

  const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION_SHEET_ID);
  const scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');
  if (!scheduleSheet) throw new Error("Could not find 'Master Schedule' tab in production sheet.");

  const data = scheduleSheet.getDataRange().getValues();
  if (data.length <= 1) {
    throw new Error("Master Schedule tab has no data rows to sync.");
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(data);

  if (typeof Logger !== 'undefined') {
    Logger.log(`🌲 Park Lexington Choices: ${parkLexMatches.length}`);
    Logger.log(`🏫 Luther Elementary Choices: ${lutherMatches.length}`);
    Logger.log(`🏫 LJHS / Arnold Choices: ${ljhsArnoldMatches.length}`);
  }

  if (!form) {
    if (typeof Logger !== 'undefined') Logger.log("Form instance not available in this execution context.");
    return;
  }

  // Distribute to all three venue form questions
  const items = form.getItems();
  let parkLexUpdated = false;
  let lutherUpdated = false;
  let ljhsUpdated = false;

  for (let item of items) {
    const title = item.getTitle().toLowerCase();

    if (item.getType() === FormApp.ItemType.LIST || item.getType() === FormApp.ItemType.CHECKBOX || item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      let target;
      if (item.getType() === FormApp.ItemType.LIST) target = item.asListItem();
      else if (item.getType() === FormApp.ItemType.CHECKBOX) target = item.asCheckboxItem();
      else if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) target = item.asMultipleChoiceItem();

      if (title.includes('park lex')) {
        target.setChoiceValues([...new Set(parkLexMatches)]);
        parkLexUpdated = true;
      } else if (title.includes('luther')) {
        target.setChoiceValues([...new Set(lutherMatches)]);
        lutherUpdated = true;
      } else if (title.includes('arnold') || title.includes('ljhs') || (title.includes('lexington') && !title.includes('park'))) {
        target.setChoiceValues([...new Set(ljhsArnoldMatches)]);
        ljhsUpdated = true;
      }
    }
  }

  if (!parkLexUpdated && typeof Logger !== 'undefined') Logger.log("Warning: Park Lexington form question not found.");
  if (!lutherUpdated && typeof Logger !== 'undefined') Logger.log("Warning: Luther Elementary form question not found.");
  if (!ljhsUpdated && typeof Logger !== 'undefined') Logger.log("Warning: LJHS / Arnold form question not found.");
}

/**
 * Universal watcher function triggered by time-driven timer.
 * Automatically finds the newest CSV drop, validates headers, creates backup snapshot,
 * updates Master Schedule, logs audit record, and syncs all 3 venue dropdowns.
 */
function autoIngestWeeklySchedule() {
  const dropFolder = DriveApp.getFolderById(CONFIG.DROP_FOLDER_ID);
  const archiveFolder = DriveApp.getFolderById(CONFIG.ARCHIVE_FOLDER_ID);
  const files = dropFolder.getFilesByType(MimeType.CSV);

  if (!files.hasNext()) {
    if (typeof Logger !== 'undefined') Logger.log("No CSV schedule files found in drop folder. Pipeline idle.");
    return;
  }

  // Gather all CSV files and sort by creation time (newest first)
  const fileList = [];
  while (files.hasNext()) {
    fileList.push(files.next());
  }
  fileList.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());

  const latestFile = fileList[0];
  if (typeof Logger !== 'undefined') {
    Logger.log(`Processing newest schedule drop: ${latestFile.getName()} (Created: ${latestFile.getDateCreated()})`);
  }

  const csvContent = latestFile.getBlob().getDataAsString();
  const parsedData = Utilities.parseCsv(csvContent);

  // Validate headers and rows
  validateScheduleHeaders(parsedData);

  const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION_SHEET_ID);
  let scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');

  // Backup snapshot generation before overwrite
  const timestampTag = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  if (scheduleSheet && scheduleSheet.getLastRow() > 1) {
    const backupSheetName = `Master_Schedule_Backup_${timestampTag}`;
    try {
      const backupSheet = scheduleSheet.copyTo(ss);
      backupSheet.setName(backupSheetName);
      if (typeof Logger !== 'undefined') Logger.log(`Created schedule backup sheet: ${backupSheetName}`);
    } catch (backupErr) {
      if (typeof Logger !== 'undefined') Logger.log(`Warning: Failed to create backup sheet (${backupErr.message})`);
    }
  } else if (!scheduleSheet) {
    scheduleSheet = ss.insertSheet('Master Schedule');
  }

  // Safe overwrite: Clear old data and write fresh parsed rows
  scheduleSheet.clearContents();
  scheduleSheet.getRange(1, 1, parsedData.length, parsedData[0].length).setValues(parsedData);
  if (typeof Logger !== 'undefined') {
    Logger.log(`Successfully wrote ${parsedData.length - 1} match rows to Master Schedule.`);
  }

  // Execute form venue synchronization
  syncContainerFormSchedule();
  if (typeof Logger !== 'undefined') {
    Logger.log("Production form venue dropdowns synchronized successfully.");
  }

  // Record audit log entry in Schedule_Sync_Log
  let logSheet = ss.getSheetByName('Schedule_Sync_Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('Schedule_Sync_Log');
    logSheet.appendRow(['Timestamp', 'Source File', 'Total Rows', 'Park Lex Games', 'Luther Games', 'LJHS/Arnold Games', 'Status']);
  }
  const logTimestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(parsedData);
  logSheet.appendRow([
    logTimestamp,
    latestFile.getName(),
    parsedData.length - 1,
    parkLexMatches.length - 1,
    lutherMatches.length - 1,
    ljhsArnoldMatches.length - 1,
    'SUCCESS'
  ]);

  // Archive processed file to prevent duplicate processing
  latestFile.moveTo(archiveFolder);
  if (typeof Logger !== 'undefined') {
    Logger.log(`Archived ${latestFile.getName()} to processed archive folder.`);
  }
}

// ============================================================================
// NODE.JS TEST EXPORTS
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG,
    MASTER_TEAMS,
    LJHS_FIELDS,
    POINT_CAPS,
    getActiveCaps,
    normalizeTimeSlot,
    getDirectoryData,
    getTeamStatsData,
    getSettingsData,
    formatDay,
    formatTime,
    formatField,
    formatDivision,
    formatTeam,
    getVenueCategory,
    buildScheduleDropdownOptionsByVenue,
    validateScheduleHeaders,
    syncContainerFormSchedule,
    autoIngestWeeklySchedule
  };
}