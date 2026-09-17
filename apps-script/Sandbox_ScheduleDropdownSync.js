/**
 * ============================================================================
 * AYSO REGION 154 - UNIVERSAL SANDBOX SCHEDULE & DRIVE INGEST ENGINE (RFC-007)
 * ============================================================================
 * File: Sandbox_ScheduleDropdownSync.js
 * Version: v1.5.0-RFC007
 * Description: Fully hardened schedule ingestion engine with strict timezone
 *              locking (America/Los_Angeles), 3-venue distribution (Park Lex,
 *              Luther Elementary with 0-game fallback, and LJHS/Arnold),
 *              header validation, and automated Drive CSV ingestion pipeline.
 * 
 * THREE VENUES SUPPORTED:
 * 1. 🌲 Park Lexington (Denni & Cerritos)
 * 2. 🏫 Luther Elementary (with zero-game warning fallback)
 * 3. 🏫 Lexington Junior High (LJHS) or Arnold Elementary
 * 
 * SAFETY GUARDRAILS:
 * - Operates exclusively within sandbox IDs. Never touches production.
 * ============================================================================
 */

const SANDBOX_SHEET_ID = '177ciFgTmQiuPiEtHytjXbHP8GZa3ge7nRXwqbYJ4NAA';
const SANDBOX_SPREADSHEET_ID = SANDBOX_SHEET_ID; // alias
const SANDBOX_FORM_ID = '1ib_QRcmucRqrJ4CujTA8Lt4Yreg9tPpz1AOIzcYlsal';
const DROP_FOLDER_ID = '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv';
const ARCHIVE_FOLDER_ID = '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m';
const TARGET_TIMEZONE = 'America/Los_Angeles';

// Venue Form Question Titles & Constants
const VENUE_TITLES = {
  PARK_LEX: 'Select Match - 🌲 Park Lexington (Denni & Cerritos)',
  LUTHER: 'Select Match - 🏫 Luther Elementary',
  LJHS_ARNOLD: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary'
};

const LUTHER_ZERO_GAMES_OPTION = '⚠️ No games scheduled at Luther this week';
const OTHER_UNLISTED_OPTION = '⚠️ Other / Rescheduled / Unlisted Match';

// Production Blocklist for safety checks
const PRODUCTION_FORM_ID_BLOCKLIST = [
  '1FAIpQLSdDPW8Bs7T1v7xYBIzVmHwi7rpx6rrLcqYk83vvVUJo_j5WSQ',
  '1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g'
];

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
      return Utilities.formatDate(rawDate, TARGET_TIMEZONE, 'EEE');
    }
    const parsedDate = new Date(String(rawDate));
    if (!isNaN(parsedDate.getTime())) {
      return Utilities.formatDate(parsedDate, TARGET_TIMEZONE, 'EEE');
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
    return Utilities.formatDate(rawTime, TARGET_TIMEZONE, 'h:mm a');
  }

  let timeStr = String(rawTime || '')
    .replace(/:(\d{2}):\d{2}\s*([AP]M)/i, ':$1 $2')
    .replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1')
    .replace(/(\d{1,2}:\d{2})\s*([AP]M)/i, '$1 $2')
    .trim();
  return timeStr;
}

/**
 * Normalizes field strings into standard short names:
 * e.g., 'Lexington JHS Field 4' -> 'LJHS Field 4'
 * e.g., 'E154-Lexington JHS U12 Field 9 Fall 2026' -> 'LJHS Field 9'
 * e.g., 'Park Lexington ARTIFICIAL TURF' -> 'Park Lex Turf'
 * e.g., 'Arnold - Field #10' -> 'Arnold Field 10'
 * e.g., 'Luther Elementary School U10 Field 1 Fall 2026' -> 'Luther Field 1'
 * 
 * @param {string} rawField Raw field string
 * @returns {string} Formatted field name
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

  // 2. Check for Luther Elementary
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
 * 
 * @param {string} raw Raw division string or code
 * @returns {string} Formatted division code
 */
function formatDivision(raw) {
  if (!raw) return '';
  let str = String(raw).trim();

  // Pattern: BU12, BU10, BU08, BU8 -> 12U-B, 10U-B, 08U-B
  let match = str.match(/^BU(\d+)$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    return `${num}U-B`;
  }

  // Pattern: GU12, GU10, GU08, GU8 -> 12U-G, 10U-G, 08U-G
  match = str.match(/^GU(\d+)$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    return `${num}U-G`;
  }

  // Pattern: 12UB -> 12U-B, 10UG -> 10U-G
  match = str.match(/^(\d+)\s*U\s*([BG])$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    return `${num}U-${match[2].toUpperCase()}`;
  }

  // Pattern: 10U Boys -> 10U-B, 12U Girls -> 12U-G
  match = str.match(/^(\d+)\s*U\s*(?:-\s*)?(Boys|Girls)$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    const gender = match[2].toUpperCase().startsWith('B') ? 'B' : 'G';
    return `${num}U-${gender}`;
  }

  // Pattern: 14UX Boys -> 14UX-B, 10UX Girls -> 10UX-G, 14UXB -> 14UX-B
  match = str.match(/^(\d+)\s*UX\s*(?:-\s*)?(?:(Boys|Girls)|([BG]))$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    const gender = (match[2] || match[3]).toUpperCase().startsWith('B') ? 'B' : 'G';
    return `${num}UX-${gender}`;
  }

  // Pattern: 12U-B, 10U-G, 08U-B (already formatted)
  match = str.match(/^(\d+)U(?:X)?-([BG])$/i);
  if (match) {
    const num = match[1].length === 1 ? '0' + match[1] : match[1];
    const isX = str.toUpperCase().includes('UX');
    return `${num}U${isX ? 'X' : ''}-${match[2].toUpperCase()}`;
  }

  return str;
}

/**
 * Normalizes team name by stripping regional prefixes (e.g. '01-E154-' or 'E154-').
 * 
 * @param {string} rawTeam Raw coach or team string
 * @returns {string} Clean team string
 */
function formatTeam(rawTeam) {
  if (!rawTeam) return '';
  return String(rawTeam).replace(/^(\d+-)?E\d+-/, '').trim();
}

/**
 * Determines venue classification for a given field string.
 * 
 * @param {string} rawField Raw or formatted field string
 * @returns {'PARK_LEX'|'LUTHER'|'LJHS_ARNOLD'} Venue category
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
 * - Luther Elementary (with 0-game warning fallback)
 * - LJHS / Arnold
 * 
 * Format: "🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}"
 * 
 * @param {Array<Array<any>>} scheduleData 2D array of rows from 'Master Schedule' or CSV
 * @returns {{parkLexMatches: string[], lutherMatches: string[], ljhsArnoldMatches: string[], allChoices: string[]}}
 */
function buildScheduleDropdownOptionsByVenue(scheduleData) {
  if (!scheduleData || scheduleData.length <= 1) {
    return {
      parkLexMatches: [OTHER_UNLISTED_OPTION],
      lutherMatches: [LUTHER_ZERO_GAMES_OPTION, OTHER_UNLISTED_OPTION],
      ljhsArnoldMatches: [OTHER_UNLISTED_OPTION],
      allChoices: [OTHER_UNLISTED_OPTION]
    };
  }

  const headers = scheduleData[0].map(h => String(h || '').trim());
  const dateIdx = headers.findIndex(h => /date|day/i.test(h));
  const timeIdx = headers.findIndex(h => /^time$/i.test(h) || /game time/i.test(h) || (/time/i.test(h) && !/date/i.test(h)));
  const fieldIdx = headers.findIndex(h => /field/i.test(h));
  const divIdx = headers.findIndex(h => /div/i.test(h));
  const homeIdx = headers.findIndex(h => /home/i.test(h));
  const awayIdx = headers.findIndex(h => /away/i.test(h));

  const parkLexMatches = [];
  const lutherMatches = [];
  const ljhsArnoldMatches = [];
  const allChoices = [];

  const seenParkLex = new Set();
  const seenLuther = new Set();
  const seenLjhsArnold = new Set();

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
      if (!seenParkLex.has(matchString)) {
        seenParkLex.add(matchString);
        parkLexMatches.push(matchString);
        allChoices.push(matchString);
      }
    } else if (venue === 'LUTHER') {
      if (!seenLuther.has(matchString)) {
        seenLuther.add(matchString);
        lutherMatches.push(matchString);
        allChoices.push(matchString);
      }
    } else {
      if (!seenLjhsArnold.has(matchString)) {
        seenLjhsArnold.add(matchString);
        ljhsArnoldMatches.push(matchString);
        allChoices.push(matchString);
      }
    }
  }

  // Zero-game warning fallback for Luther Elementary
  if (lutherMatches.length === 0) {
    lutherMatches.push(LUTHER_ZERO_GAMES_OPTION);
  }

  // Safety escape hatch for all 3 venue dropdowns
  parkLexMatches.push(OTHER_UNLISTED_OPTION);
  lutherMatches.push(OTHER_UNLISTED_OPTION);
  ljhsArnoldMatches.push(OTHER_UNLISTED_OPTION);

  return {
    parkLexMatches,
    lutherMatches,
    ljhsArnoldMatches,
    allChoices
  };
}

/**
 * Legacy wrapper returning all choices for backward compatibility.
 * 
 * @param {Array<Array<any>>} scheduleRows 2D array of schedule data
 * @returns {Array<string>} Combined list of formatted match strings
 */
function buildScheduleDropdownOptions(scheduleRows) {
  const result = buildScheduleDropdownOptionsByVenue(scheduleRows);
  return result.allChoices;
}

// ============================================================================
// SAFETY VALIDATOR
// ============================================================================

/**
 * Validates that IDs configured in the script do not point to production assets.
 */
function validateSandboxSafety() {
  if (!SANDBOX_FORM_ID || SANDBOX_FORM_ID.includes('PASTE_')) {
    throw new Error('SAFETY BLOCK: SANDBOX_FORM_ID is set to placeholder.');
  }

  if (PRODUCTION_FORM_ID_BLOCKLIST.some(blocked => SANDBOX_FORM_ID.includes(blocked))) {
    throw new Error('CRITICAL SAFETY BLOCK: SANDBOX_FORM_ID matches a protected production form/sheet!');
  }

  if (SANDBOX_SPREADSHEET_ID && PRODUCTION_FORM_ID_BLOCKLIST.some(blocked => SANDBOX_SPREADSHEET_ID.includes(blocked))) {
    throw new Error('CRITICAL SAFETY BLOCK: SANDBOX_SPREADSHEET_ID matches a protected production sheet!');
  }
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
  validateSandboxSafety();

  let form;
  if (typeof FormApp !== 'undefined') {
    try {
      form = FormApp.getActiveForm() || FormApp.openById(SANDBOX_FORM_ID);
    } catch (e) {
      form = FormApp.openById(SANDBOX_FORM_ID);
    }
  }

  const ss = SpreadsheetApp.openById(SANDBOX_SHEET_ID);
  const scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');
  if (!scheduleSheet) throw new Error("Could not find 'Master Schedule' tab.");

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
        target.setChoiceValues(parkLexMatches);
        parkLexUpdated = true;
      } else if (title.includes('luther')) {
        target.setChoiceValues(lutherMatches);
        lutherUpdated = true;
      } else if (title.includes('arnold') || title.includes('ljhs') || (title.includes('lexington') && !title.includes('park'))) {
        target.setChoiceValues(ljhsArnoldMatches);
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
 * Automatically finds the newest CSV drop, validates headers, updates Master Schedule,
 * and executes syncContainerFormSchedule() to update all 3 venue dropdowns.
 */
function autoIngestWeeklySchedule() {
  validateSandboxSafety();

  const dropFolder = DriveApp.getFolderById(DROP_FOLDER_ID);
  const archiveFolder = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
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

  // Safeguard: Ensure file has headers + meaningful data rows (> 5 rows)
  if (!parsedData || parsedData.length < 5) {
    throw new Error(`Ingest aborted: File ${latestFile.getName()} contains insufficient data rows (${parsedData ? parsedData.length : 0}).`);
  }

  // Validate required headers exist before touching the active sheet
  const headers = parsedData[0].map(h => String(h).trim());
  const requiredHeaders = ['Date', 'Time', 'Field', 'Division', 'Home Team', 'Away Team'];
  for (let req of requiredHeaders) {
    if (!headers.includes(req)) {
      throw new Error(`Ingest aborted: Missing required MatchTrak column header -> '${req}'. Check export format.`);
    }
  }

  const ss = SpreadsheetApp.openById(SANDBOX_SHEET_ID);
  const sheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');
  if (!sheet) throw new Error("Target tab 'Master Schedule' not found in sandbox sheet.");

  // Safe overwrite: Clear old data and write fresh parsed rows
  sheet.clearContents();
  sheet.getRange(1, 1, parsedData.length, parsedData[0].length).setValues(parsedData);
  if (typeof Logger !== 'undefined') {
    Logger.log(`Successfully wrote ${parsedData.length - 1} match rows to Master Schedule.`);
  }

  // Execute form venue synchronization
  syncContainerFormSchedule();
  if (typeof Logger !== 'undefined') {
    Logger.log("Sandbox form venue dropdowns synchronized successfully.");
  }

  // Archive processed file to prevent duplicate processing
  latestFile.moveTo(archiveFolder);
  if (typeof Logger !== 'undefined') {
    Logger.log(`Archived ${latestFile.getName()} to processed archive.`);
  }
}

// ============================================================================
// NODE.JS TEST EXPORTS
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildScheduleDropdownOptions,
    buildScheduleDropdownOptionsByVenue,
    formatDay,
    formatTime,
    formatField,
    formatDivision,
    formatTeam,
    getVenueCategory,
    validateSandboxSafety,
    autoIngestWeeklySchedule,
    syncContainerFormSchedule,
    SANDBOX_SHEET_ID,
    SANDBOX_SPREADSHEET_ID,
    SANDBOX_FORM_ID,
    DROP_FOLDER_ID,
    ARCHIVE_FOLDER_ID,
    TARGET_TIMEZONE,
    VENUE_TITLES,
    LUTHER_ZERO_GAMES_OPTION,
    OTHER_UNLISTED_OPTION,
    PRODUCTION_FORM_ID_BLOCKLIST
  };
}