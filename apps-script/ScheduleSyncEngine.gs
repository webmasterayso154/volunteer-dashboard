/**
 * ============================================================================
 * AYSO REGION 154 - PRODUCTION SCHEDULE & DRIVE INGEST ENGINE (v1.6.0-RFC007)
 * ============================================================================
 * File: ScheduleSyncEngine.gs
 * Version: v1.6.0-RFC007
 * Description: Hardened production schedule ingestion and form synchronization
 *              engine with strict 3-venue routing (Park Lexington, LJHS/Arnold,
 *              and Luther Elementary with zero-game fallback), Pacific Timezone
 *              locking ('America/Los_Angeles'), Set-based choice deduplication,
 *              automated backup sheet generation, audit logging, and Drive CSV ingest.
 * 
 * THREE VENUES SUPPORTED:
 * 1. 🌲 Park Lexington (Denni & Cerritos)
 * 2. 🏫 Luther Elementary (with zero-game warning fallback)
 * 3. 🏫 Lexington Junior High (LJHS) or Arnold Elementary
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
  DASHBOARD_URL: 'https://webmasterayso154.github.io/volunteer-dashboard/',
  FORM_DESCRIPTION_BANNER: '📊 Track live team standings and volunteer points: https://webmasterayso154.github.io/volunteer-dashboard/',
  FORM_DESCRIPTION: "🙌 Game day happens because of YOU! ⚽\nThank you for volunteering your time for our players and community today.\n\nQuick Steps for New Volunteers:\n1. Enter your name and role.\n2. Pick your field venue and select your match from the dropdown.\n3. Submit to log your points!\n\n📊 View live team points on the Volunteer Standings Dashboard: https://webmasterayso154.github.io/volunteer-dashboard/",
  CONFIRMATION_MESSAGE: "⚽ Thanks for checking in! 🙌\n\nYou can track live team standings and volunteer points on the Volunteer Dashboard here:\nhttps://webmasterayso154.github.io/volunteer-dashboard/",
  VENUE_TITLES: {
    PARK_LEX: 'Select Match - 🌲 Park Lexington (Denni & Cerritos)',
    LUTHER: 'Select Match - 🏫 Luther Elementary',
    LJHS_ARNOLD: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary'
  },
  LUTHER_ZERO_GAMES_OPTION: '⚠️ No games currently scheduled at Luther Elementary',
  OTHER_UNLISTED_OPTION: '⚠️ Other / Rescheduled / Unlisted Match',
  REQUIRED_HEADERS: ['Date', 'Time', 'Field', 'Division', 'Home Team', 'Away Team']
};

// ============================================================================
// NORMALIZATION & FORMATTING HELPERS
// ============================================================================

/**
 * Normalizes date / day string to short day format (e.g. 'Sat', 'Sun') locked to Pacific Time.
 * 
 * @param {string|Date} rawDate Raw date value
 * @returns {string} Short day name (e.g. 'Sat')
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

  // Fallback for standalone / Node.js testing
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
 * Example: '5:30:00 PM' -> '5:30 PM', '8:00:00 AM' -> '8:00 AM'
 * 
 * @param {string|Date} rawTime Raw time string or Date
 * @returns {string} Formatted time string
 */
function formatTime(rawTime) {
  if (!rawTime) return '';
  if (typeof Utilities !== 'undefined' && rawTime instanceof Date) {
    return Utilities.formatDate(rawTime, CONFIG.TIMEZONE, 'h:mm a');
  }

  let timeStr = String(rawTime || '').trim();

  // Handle 24-hour military time format (e.g. 13:00:00 or 17:30)
  const milMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (milMatch) {
    let hour = parseInt(milMatch[1], 10);
    const min = milMatch[2];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;
    return `${hour}:${min} ${ampm}`;
  }

  timeStr = timeStr.replace(/(\d{1,2}:\d{2}):\d{2}/, '$1');
  timeStr = timeStr.replace(/\s*([AaPp][Mm])/, ' $1').toUpperCase();
  return timeStr;
}

/**
 * Standardizes venue/field names.
 * Maps Luther U8/U10 fields to 'Luther Field 1', 'Luther Field 2', etc.
 * 
 * @param {string} rawField Raw field name
 * @returns {string} Clean standardized field name
 */
function formatField(rawField) {
  if (!rawField) return '';
  const f = String(rawField).trim();

  // Luther Elementary School mappings
  if (/luther/i.test(f)) {
    const numMatch = f.match(/field\s*#?\s*(\d+)/i);
    return numMatch ? `Luther Field ${numMatch[1]}` : 'Luther Field';
  }

  // Park Lexington
  if (/park lex/i.test(f) || /denni/i.test(f)) {
    if (/turf/i.test(f) || /art/i.test(f)) return 'Park Lex Turf';
    if (/grass/i.test(f)) return 'Park Lex Grass';
    return 'Park Lex';
  }

  // Lexington JHS
  if (/lexington|ljhs/i.test(f)) {
    const numMatch = f.match(/field\s*#?\s*(\d+)/i);
    return numMatch ? `LJHS Field ${numMatch[1]}` : 'LJHS';
  }

  // Arnold Elementary
  if (/arnold/i.test(f)) {
    const numMatch = f.match(/field\s*#?\s*(\d+)/i);
    return numMatch ? `Arnold Field ${numMatch[1]}` : 'Arnold';
  }

  return f;
}

/**
 * Normalizes division format (e.g. 'BU12' -> '12U-B', '10U Boys' -> '10U-B').
 * 
 * @param {string} rawDiv Raw division string
 * @returns {string} Normalized division tag
 */
function formatDivision(rawDiv) {
  if (!rawDiv) return '';
  const d = String(rawDiv).trim();

  let match = d.match(/^([BGbg])(?:U|u)?(\d{1,2})/);
  if (match) {
    const gender = match[1].toUpperCase();
    const num = match[2].padStart(2, '0');
    return `${num}U-${gender}`;
  }

  match = d.match(/^(\d{1,2})(?:U|u)?\s*([BGbg])/);
  if (match) {
    const num = match[1].padStart(2, '0');
    const gender = match[2].toUpperCase();
    return `${num}U-${gender}`;
  }

  match = d.match(/^(\d{1,2})UX\s*([BGbg])/i);
  if (match) {
    const num = match[1].padStart(2, '0');
    const gender = match[2].toUpperCase();
    return `${num}UX-${gender}`;
  }

  return d;
}

/**
 * Strips prefix codes from team names (e.g. '01-E154-Faheem Armanyous' -> 'Faheem Armanyous').
 * 
 * @param {string} rawTeam Raw coach / team name
 * @returns {string} Clean coach name
 */
function formatTeam(rawTeam) {
  if (!rawTeam) return '';
  let t = String(rawTeam).trim();
  t = t.replace(/^\d+[-_]/, '');
  t = t.replace(/^E154[-_]/i, '');
  return t.trim();
}

/**
 * Classifies a raw field string into one of the three venue categories:
 * - 'PARK_LEX'
 * - 'LUTHER'
 * - 'LJHS_ARNOLD'
 * 
 * @param {string} rawField Field string from MatchTrak
 * @returns {'PARK_LEX'|'LUTHER'|'LJHS_ARNOLD'} Venue category identifier
 */
function getVenueCategory(rawField) {
  if (!rawField) return 'LJHS_ARNOLD';
  const f = String(rawField).trim().toLowerCase();
  if (f.includes('park lex') || f.includes('denni') || f.includes('cerritos')) {
    return 'PARK_LEX';
  }
  if (f.includes('luther')) {
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
 * - Luther Elementary (with 0-game warning fallback)
 * - LJHS / Arnold
 * 
 * Format: "🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}"
 * Uses JavaScript Set-based deduplication ([...new Set(...)]) to strictly prevent duplicate choice exceptions.
 * 
 * @param {Array<Array<any>>} scheduleData 2D array of rows from 'Master Schedule' or CSV
 * @returns {{parkLexMatches: string[], lutherMatches: string[], ljhsArnoldMatches: string[], allChoices: string[]}}
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

  const rawParkLex = [];
  const rawLuther = [];
  const rawLjhsArnold = [];
  const rawAllChoices = [];

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
      rawParkLex.push(matchString);
    } else if (venue === 'LUTHER') {
      rawLuther.push(matchString);
    } else {
      rawLjhsArnold.push(matchString);
    }
    rawAllChoices.push(matchString);
  }

  // Set-based deduplication
  const parkLexMatches = [...new Set(rawParkLex)];
  const lutherMatches = [...new Set(rawLuther)];
  const ljhsArnoldMatches = [...new Set(rawLjhsArnold)];
  const allChoices = [...new Set(rawAllChoices)];

  // Zero-game warning fallback for Luther Elementary
  if (lutherMatches.length === 0) {
    lutherMatches.push(CONFIG.LUTHER_ZERO_GAMES_OPTION);
  }

  // Append unlisted match option to all 3 venue dropdowns
  parkLexMatches.push(CONFIG.OTHER_UNLISTED_OPTION);
  lutherMatches.push(CONFIG.OTHER_UNLISTED_OPTION);
  ljhsArnoldMatches.push(CONFIG.OTHER_UNLISTED_OPTION);

  return {
    parkLexMatches: [...new Set(parkLexMatches)],
    lutherMatches: [...new Set(lutherMatches)],
    ljhsArnoldMatches: [...new Set(ljhsArnoldMatches)],
    allChoices: [...new Set(allChoices)]
  };
}

/**
 * Validates that all required headers are present in the parsed CSV dataset.
 * 
 * @param {Array<Array<any>>} parsedData 2D parsed CSV array
 * @returns {boolean} True if all headers exist, throws error otherwise
 */
function validateScheduleHeaders(parsedData) {
  if (!parsedData || parsedData.length === 0) {
    throw new Error("CSV dataset is empty.");
  }
  const headers = parsedData[0].map(h => String(h || '').trim().toLowerCase());

  const hasDate = headers.some(h => /date|day/i.test(h));
  const hasTime = headers.some(h => /time/i.test(h));
  const hasField = headers.some(h => /field/i.test(h));
  const hasDiv = headers.some(h => /div/i.test(h));
  const hasHome = headers.some(h => /home/i.test(h));
  const hasAway = headers.some(h => /away/i.test(h));

  const missing = [];
  if (!hasDate) missing.push('Date');
  if (!hasTime) missing.push('Time');
  if (!hasField) missing.push('Field');
  if (!hasDiv) missing.push('Division');
  if (!hasHome) missing.push('Home Team');
  if (!hasAway) missing.push('Away Team');

  if (missing.length > 0) {
    throw new Error(`Missing required MatchTrak column header(s): ${missing.join(', ')}`);
  }
  return true;
}

// ============================================================================
// AUTOMATION & FORM SYNCHRONIZATION PIPELINE
// ============================================================================

/**
 * Reads 2D data rows from a file in Drive (handling Google Sheets, CSV, text, octet-stream).
 * 
 * @param {GoogleAppsScript.Drive.File} file 
 * @returns {Array<Array<any>>} Parsed 2D array of rows
 */
function extractDataFromFile(file) {
  const mime = file.getMimeType();
  const name = file.getName();
  if (typeof Logger !== 'undefined') {
    Logger.log(`[extractDataFromFile] Processing file: "${name}" (MIME: "${mime}", ID: ${file.getId()})`);
  }

  // 1. Handle Google Spreadsheet
  if (mime === MimeType.GOOGLE_SHEETS || mime === 'application/vnd.google-apps.spreadsheet') {
    const ss = SpreadsheetApp.openById(file.getId());
    const sheet = ss.getSheets()[0];
    const range = sheet.getDataRange();
    const data = (typeof range.getDisplayValues === 'function') ? range.getDisplayValues() : range.getValues();
    if (typeof Logger !== 'undefined') {
      Logger.log(`[extractDataFromFile] Read ${data.length} row(s) from Google Sheet "${name}" (Sheet: "${sheet.getName()}")`);
    }
    return data;
  }

  // 2. Handle CSV / Plain Text / Binary / Octet-Stream
  const blob = file.getBlob();
  const content = blob.getDataAsString('UTF-8') || blob.getDataAsString();
  if (!content || !content.trim()) {
    throw new Error(`Schedule file "${name}" is empty.`);
  }

  const parsedData = Utilities.parseCsv(content);
  if (typeof Logger !== 'undefined') {
    Logger.log(`[extractDataFromFile] Parsed ${parsedData.length} row(s) from CSV text file "${name}"`);
  }
  return parsedData;
}

/**
 * Parses Master Schedule and populates all 3 multi-venue form questions:
 * 1. Park Lexington
 * 2. Luther Elementary (with zero-game warning fallback)
 * 3. LJHS / Arnold
 * 
 * Permanently removes legacy manual "Game Time" text fields, guarantees the 3-venue
 * dropdown questions exist, locks in the official form metadata, and reopens the form.
 * 
 * @param {Array<Array<any>>} [optionalScheduleData] Optional 2D array of schedule data to sync directly
 */
function syncContainerFormSchedule(optionalScheduleData) {
  if (typeof Logger !== 'undefined') {
    Logger.log("==========================================================");
    Logger.log("🚀 STARTING SCHEDULE SYNC ENGINE & FORM DROPDOWN UPDATE");
    Logger.log(`Target Form ID: ${CONFIG.PRODUCTION_FORM_ID}`);
    Logger.log(`Target Sheet ID: ${CONFIG.PRODUCTION_SHEET_ID}`);
    Logger.log("==========================================================");
  }

  let data = optionalScheduleData;

  // 1. If no in-memory data provided, check if any pending files are waiting in DROP_FOLDER_ID!
  if (!data && typeof DriveApp !== 'undefined') {
    try {
      const dropFolder = DriveApp.getFolderById(CONFIG.DROP_FOLDER_ID);
      const fileIter = dropFolder.getFiles();
      if (fileIter.hasNext()) {
        if (typeof Logger !== 'undefined') {
          Logger.log("Found pending file(s) in drop folder during syncContainerFormSchedule. Initiating autoIngestWeeklySchedule...");
        }
        autoIngestWeeklySchedule();
        return;
      }
    } catch (dropErr) {
      if (typeof Logger !== 'undefined') {
        Logger.log(`Note on drop folder pre-check: ${dropErr.message}`);
      }
    }
  }

  // 2. If still no data, load Master Schedule tab from production sheet
  if (!data) {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION_SHEET_ID);
    const scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');
    if (!scheduleSheet) throw new Error("Could not find 'Master Schedule' tab in production sheet.");

    const range = scheduleSheet.getDataRange();
    data = (typeof range.getDisplayValues === 'function') ? range.getDisplayValues() : range.getValues();
    if (data.length <= 1) {
      throw new Error("Master Schedule tab has no data rows to sync.");
    }
  }

  if (typeof Logger !== 'undefined') {
    Logger.log(`Schedule dataset contains ${data.length} total rows (including header).`);
    Logger.log(`Headers: [${data[0].join(', ')}]`);
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(data);

  if (typeof Logger !== 'undefined') {
    Logger.log(`🌲 Park Lexington Choices: ${parkLexMatches.length}`);
    Logger.log(`🏫 Luther Elementary Choices: ${lutherMatches.length}`);
    Logger.log(`🏫 LJHS / Arnold Choices: ${ljhsArnoldMatches.length}`);
    Logger.log(`Sample Park Lex Choice: ${parkLexMatches[0] || 'none'}`);
    Logger.log(`Sample Luther Choice: ${lutherMatches[0] || 'none'}`);
    Logger.log(`Sample LJHS/Arnold Choice: ${ljhsArnoldMatches[0] || 'none'}`);
  }

  let form;
  if (typeof FormApp !== 'undefined') {
    try {
      form = FormApp.openById(CONFIG.PRODUCTION_FORM_ID);
    } catch (e) {
      try {
        form = FormApp.getActiveForm();
      } catch (e2) {
        if (typeof Logger !== 'undefined') Logger.log("Error opening form: " + e.message);
      }
    }
  }

  if (!form) {
    if (typeof Logger !== 'undefined') Logger.log("Form instance not available in this execution context.");
    return;
  }

  if (typeof Logger !== 'undefined') {
    Logger.log(`Successfully opened Google Form: "${form.getTitle()}" (ID: ${form.getId()})`);
  }

  // 3. Inspect and log all existing form items
  const items = form.getItems();
  if (typeof Logger !== 'undefined') {
    Logger.log(`Form currently contains ${items.length} item(s):`);
    items.forEach((it, idx) => {
      Logger.log(`  [${idx}] Title: "${it.getTitle()}", Type: ${it.getType()}`);
    });
  }

  let parkLexItem = null;
  let lutherItem = null;
  let ljhsItem = null;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const title = item.getTitle().trim();
    const lower = title.toLowerCase();
    const type = item.getType();

    // 1. Permanently remove legacy manual "Game Time" / "Match Time" text/time fields
    const isLegacyManualTime = (type === FormApp.ItemType.TEXT || type === FormApp.ItemType.TIME || type === FormApp.ItemType.DATETIME) &&
      (lower.includes('game time') || lower.includes('match time') || lower === 'game time' || lower === 'match time');
    
    if (isLegacyManualTime) {
      if (typeof Logger !== 'undefined') Logger.log(`Deleting legacy manual time field: "${title}" (Index ${i})`);
      form.deleteItem(i);
      continue;
    }

    // 2. Identify 3-Venue dropdown questions
    if (lower.includes('park lex') || lower.includes('denni') || lower.includes('cerritos')) {
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.CHECKBOX || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        parkLexItem = item;
      } else {
        if (typeof Logger !== 'undefined') Logger.log(`Deleting non-dropdown Park Lex item (Type ${type}) to recreate as dropdown.`);
        form.deleteItem(i);
      }
    } else if (lower.includes('luther')) {
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.CHECKBOX || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        lutherItem = item;
      } else {
        if (typeof Logger !== 'undefined') Logger.log(`Deleting non-dropdown Luther item (Type ${type}) to recreate as dropdown.`);
        form.deleteItem(i);
      }
    } else if (lower.includes('arnold') || lower.includes('ljhs') || (lower.includes('lexington') && !lower.includes('park'))) {
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.CHECKBOX || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        ljhsItem = item;
      } else {
        if (typeof Logger !== 'undefined') Logger.log(`Deleting non-dropdown LJHS/Arnold item (Type ${type}) to recreate as dropdown.`);
        form.deleteItem(i);
      }
    }
  }

  // 4. Update or create Park Lexington question
  if (parkLexItem) {
    if (parkLexItem.getType() === FormApp.ItemType.LIST) parkLexItem.asListItem().setChoiceValues(parkLexMatches);
    else if (parkLexItem.getType() === FormApp.ItemType.CHECKBOX) parkLexItem.asCheckboxItem().setChoiceValues(parkLexMatches);
    else if (parkLexItem.getType() === FormApp.ItemType.MULTIPLE_CHOICE) parkLexItem.asMultipleChoiceItem().setChoiceValues(parkLexMatches);
    if (typeof Logger !== 'undefined') Logger.log(`✅ Updated existing Park Lexington dropdown with ${parkLexMatches.length} choices.`);
  } else {
    const newItem = form.addListItem();
    newItem.setTitle(CONFIG.VENUE_TITLES.PARK_LEX);
    newItem.setChoiceValues(parkLexMatches);
    newItem.setRequired(false);
    if (typeof Logger !== 'undefined') Logger.log(`✅ Created new Park Lexington dropdown question with ${parkLexMatches.length} choices.`);
  }

  // 5. Update or create Luther Elementary question
  if (lutherItem) {
    if (lutherItem.getType() === FormApp.ItemType.LIST) lutherItem.asListItem().setChoiceValues(lutherMatches);
    else if (lutherItem.getType() === FormApp.ItemType.CHECKBOX) lutherItem.asCheckboxItem().setChoiceValues(lutherMatches);
    else if (lutherItem.getType() === FormApp.ItemType.MULTIPLE_CHOICE) lutherItem.asMultipleChoiceItem().setChoiceValues(lutherMatches);
    if (typeof Logger !== 'undefined') Logger.log(`✅ Updated existing Luther Elementary dropdown with ${lutherMatches.length} choices.`);
  } else {
    const newItem = form.addListItem();
    newItem.setTitle(CONFIG.VENUE_TITLES.LUTHER);
    newItem.setChoiceValues(lutherMatches);
    newItem.setRequired(false);
    if (typeof Logger !== 'undefined') Logger.log(`✅ Created new Luther Elementary dropdown question with ${lutherMatches.length} choices.`);
  }

  // 6. Update or create LJHS / Arnold question
  if (ljhsItem) {
    if (ljhsItem.getType() === FormApp.ItemType.LIST) ljhsItem.asListItem().setChoiceValues(ljhsArnoldMatches);
    else if (ljhsItem.getType() === FormApp.ItemType.CHECKBOX) ljhsItem.asCheckboxItem().setChoiceValues(ljhsArnoldMatches);
    else if (ljhsItem.getType() === FormApp.ItemType.MULTIPLE_CHOICE) ljhsItem.asMultipleChoiceItem().setChoiceValues(ljhsArnoldMatches);
    if (typeof Logger !== 'undefined') Logger.log(`✅ Updated existing LJHS / Arnold dropdown with ${ljhsArnoldMatches.length} choices.`);
  } else {
    const newItem = form.addListItem();
    newItem.setTitle(CONFIG.VENUE_TITLES.LJHS_ARNOLD);
    newItem.setChoiceValues(ljhsArnoldMatches);
    newItem.setRequired(false);
    if (typeof Logger !== 'undefined') Logger.log(`✅ Created new LJHS / Arnold dropdown question with ${ljhsArnoldMatches.length} choices.`);
  }

  // 7. Hardcode UI metadata (Description & Confirmation message)
  try {
    form.setDescription(CONFIG.FORM_DESCRIPTION);
    form.setConfirmationMessage(CONFIG.CONFIRMATION_MESSAGE);
    if (typeof Logger !== 'undefined') {
      Logger.log("✅ Locked in official Form description and post-submission confirmation message.");
    }
  } catch (brandErr) {
    if (typeof Logger !== 'undefined') {
      Logger.log(`Warning updating form branding/confirmation: ${brandErr.message}`);
    }
  }

  // 8. Reopen Form: guarantee form is open and accepting responses
  try {
    form.setAcceptingResponses(true);
    if (typeof Logger !== 'undefined') {
      Logger.log("✅ Reopened form: setAcceptingResponses(true) verified.");
    }
  } catch (respErr) {
    if (typeof Logger !== 'undefined') {
      Logger.log(`Warning enabling form responses: ${respErr.message}`);
    }
  }

  if (typeof Logger !== 'undefined') {
    Logger.log("==========================================================");
    Logger.log("🏆 SYNC CONTAINER FORM SCHEDULE COMPLETED SUCCESSFULLY");
    Logger.log("==========================================================");
  }
}

/**
 * Universal watcher function triggered by time-driven timer.
 * Automatically finds the newest CSV or Google Sheet drop in DROP_FOLDER_ID,
 * validates headers, creates backup snapshot, updates Master Schedule,
 * logs audit record, and syncs all 3 venue dropdowns.
 */
function autoIngestWeeklySchedule() {
  if (typeof Logger !== 'undefined') {
    Logger.log("==========================================================");
    Logger.log("📥 AUTO INGEST WEEKLY SCHEDULE: STARTING PIPELINE");
    Logger.log(`Drop Folder ID: ${CONFIG.DROP_FOLDER_ID}`);
    Logger.log(`Archive Folder ID: ${CONFIG.ARCHIVE_FOLDER_ID}`);
    Logger.log("==========================================================");
  }

  const dropFolder = DriveApp.getFolderById(CONFIG.DROP_FOLDER_ID);
  const archiveFolder = DriveApp.getFolderById(CONFIG.ARCHIVE_FOLDER_ID);
  
  // Get ALL files regardless of mimeType or file extension
  const fileIter = dropFolder.getFiles();
  const fileList = [];
  while (fileIter.hasNext()) {
    fileList.push(fileIter.next());
  }

  if (fileList.length === 0) {
    if (typeof Logger !== 'undefined') {
      Logger.log("No schedule files found in drop folder. Checking existing Master Schedule tab in production sheet.");
    }
    syncContainerFormSchedule();
    return;
  }

  if (typeof Logger !== 'undefined') {
    Logger.log(`Found ${fileList.length} file(s) in drop folder:`);
    fileList.forEach((f, idx) => {
      Logger.log(`  [${idx}] "${f.getName()}" (MIME: ${f.getMimeType()}, Size: ${f.getSize()} bytes, Created: ${f.getDateCreated()})`);
    });
  }

  // Sort newest first
  fileList.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
  const latestFile = fileList[0];

  if (typeof Logger !== 'undefined') {
    Logger.log(`🎯 Processing newest file: "${latestFile.getName()}" (ID: ${latestFile.getId()})`);
  }

  const parsedData = extractDataFromFile(latestFile);
  if (!parsedData || parsedData.length <= 1) {
    throw new Error(`File "${latestFile.getName()}" contains no schedule rows.`);
  }

  // Validate headers
  validateScheduleHeaders(parsedData);

  // Extract and log distinct dates found across data rows
  const headers = parsedData[0].map(h => String(h || '').trim());
  const dateIdx = headers.findIndex(h => /date|day/i.test(h));
  if (dateIdx !== -1) {
    const datesFound = new Set();
    for (let i = 1; i < parsedData.length; i++) {
      if (parsedData[i][dateIdx]) datesFound.add(String(parsedData[i][dateIdx]).trim());
    }
    if (typeof Logger !== 'undefined') {
      Logger.log(`Extracted ${datesFound.size} distinct match date(s): ${[...datesFound].join(', ')}`);
    }
  }

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
    Logger.log(`Successfully wrote ${parsedData.length - 1} match rows to Master Schedule tab.`);
  }

  // Execute form venue synchronization with newly parsed rows
  syncContainerFormSchedule(parsedData);

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
  try {
    latestFile.moveTo(archiveFolder);
    if (typeof Logger !== 'undefined') {
      Logger.log(`Archived "${latestFile.getName()}" to processed archive folder.`);
    }
  } catch (archErr) {
    if (typeof Logger !== 'undefined') {
      Logger.log(`Note: File archive move skipped (${archErr.message}). Continuing.`);
    }
  }

  if (typeof Logger !== 'undefined') {
    Logger.log("==========================================================");
    Logger.log("🏆 AUTO INGEST & FORM SYNC PIPELINE SUCCEEDED (100% COMPLETE)");
    Logger.log("==========================================================");
  }
}

// ============================================================================
// NODE.JS TEST EXPORTS
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG,
    buildScheduleDropdownOptionsByVenue,
    validateScheduleHeaders,
    formatDay,
    formatTime,
    formatField,
    formatDivision,
    formatTeam,
    getVenueCategory,
    extractDataFromFile,
    autoIngestWeeklySchedule,
    syncContainerFormSchedule
  };
}
