/**
 * ============================================================================
 * AYSO REGION 154 — SANDBOX SCHEDULE DROPDOWN SYNC ENGINE
 * ============================================================================
 * File: Sandbox_ScheduleDropdownSync.js
 * Description: Isolated sandbox utility for testing conversion of volunteer
 *              check-in "Game Time" and "Field" questions into multi-venue,
 *              schedule-driven dropdown choice menus in a sandbox Google Form.
 * 
 * PROPOSAL REFERENCE: RFC-007 (docs/BOARD_PROPOSALS_REGISTRY.md)
 * 
 * MATCHTRAK CSV STRUCTURE & FORMAT:
 * - Expected headers: Date, Time, Game #, Division, Field, Home Team, Away Team
 * - Match Choice Format: "🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}"
 * - Game # is omitted from the display string.
 * - Divisions normalized (BU12 -> 12U-B, GU10 -> 10U-G, etc.).
 * - Fields normalized (Lexington JHS -> LJHS Field, Park Lexington ARTIFICIAL TURF -> Park Lex Turf).
 * 
 * MULTI-VENUE SEPARATION:
 * 1. "Select Match - 🌲 Park Lexington (Denni & Cerritos)"
 * 2. "Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary"
 * Both lists append: "⚠️ Other / Rescheduled / Unlisted Match"
 * 
 * SAFETY GUARDRAILS:
 * - Restrict all operations strictly to the sandbox environment.
 * - Production Form/Sheet IDs are hard-blocked by the safety validator.
 * ============================================================================
 */

// ============================================================================
// SANDBOX CONFIGURATION CONSTANTS
// ============================================================================
const SANDBOX_SPREADSHEET_ID = '177ciFgTmQiuPiEtHytjXbHP8GZa3ge7nRXwqbYJ4NAA';
const SANDBOX_FORM_ID = '1ib_QRcmucRqrJ4CujTA8Lt4Yreg9tPpz1AOIzcYlsal';
const DROP_FOLDER_ID = '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv';
const ARCHIVE_FOLDER_ID = '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m';

// Venue Dropdown Titles
const VENUE_TITLES = {
  PARK_LEX: 'Select Match - 🌲 Park Lexington (Denni & Cerritos)',
  LJHS_ARNOLD: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary'
};

const OTHER_UNLISTED_OPTION = '⚠️ Other / Rescheduled / Unlisted Match';

// Hard-coded production form/sheet ID blocklist to prevent accidental modification
const PRODUCTION_FORM_ID_BLOCKLIST = [
  '1FAIpQLSdDPW8Bs7T1v7xYBIzVmHwi7rpx6rrLcqYk83vvVUJo_j5WSQ', // Production check-in form ID
  '1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g'             // Production master sheet ID
];

// ============================================================================
// FORMATTING & NORMALIZATION HELPERS
// ============================================================================

/**
 * Normalizes date / day string to short day format (e.g. 'Sat', 'Sun').
 * 
 * @param {string|Date} raw Raw date value
 * @returns {string} Short day name (e.g. 'Sat')
 */
function formatDay(raw) {
  if (!raw) return 'Sat';
  if (raw instanceof Date) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[raw.getDay()];
  }
  const str = String(raw).trim();
  if (/^sat/i.test(str)) return 'Sat';
  if (/^sun/i.test(str)) return 'Sun';
  if (/^fri/i.test(str)) return 'Fri';
  if (/^mon/i.test(str)) return 'Mon';
  if (/^tue/i.test(str)) return 'Tue';
  if (/^wed/i.test(str)) return 'Wed';
  if (/^thu/i.test(str)) return 'Thu';

  // Parse ISO / standard date string e.g. '2026-09-12'
  const parsed = new Date(str.includes('T') ? str : `${str}T12:00:00Z`);
  if (!isNaN(parsed.getTime())) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[parsed.getUTCDay()];
  }
  return str;
}

/**
 * Normalizes time strings by stripping trailing seconds and standardizing spacing.
 * Example: '5:30:00 PM' -> '5:30 PM', '8:00:00 AM' -> '8:00 AM', '12:00:00 PM' -> '12:00 PM'
 * 
 * @param {string} raw Raw time string
 * @returns {string} Formatted time string
 */
function formatTime(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  // Strip trailing :00 (or :SS) seconds before AM/PM: e.g. "5:30:00 PM" -> "5:30 PM"
  str = str.replace(/:(\d{2}):\d{2}(\s*[AP]M)/i, ':$1 $2');
  // If AM/PM has extra or no spaces, standardize e.g. "5:30PM" -> "5:30 PM"
  str = str.replace(/(\d{1,2}:\d{2})\s*([AP]M)/i, '$1 $2');
  // Strip :00 seconds without AM/PM: e.g. "17:30:00" -> "17:30"
  str = str.replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes field strings into standard short names:
 * e.g., 'Lexington JHS Field 4' -> 'LJHS Field 4'
 * e.g., 'E154-Lexington JHS U12 Field 9 Fall 2026' -> 'LJHS Field 9'
 * e.g., 'Park Lexington ARTIFICIAL TURF' -> 'Park Lex Turf'
 * e.g., 'Arnold - Field #10' -> 'Arnold Field 10'
 * 
 * @param {string} raw Raw field string
 * @returns {string} Formatted field name
 */
function formatField(raw) {
  if (!raw) return '';
  let str = String(raw).trim();

  // 1. Check for Park Lexington (Denni & Cerritos / Turf)
  if (/Park\s*Lex/i.test(str) || /Denni\s*&\s*Cerritos/i.test(str) || /Turf/i.test(str)) {
    if (/turf|artificial/i.test(str)) {
      return 'Park Lex Turf';
    }
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `Park Lex Field ${numMatch[1]}`;
    return 'Park Lex';
  }

  // 2. Check for Lexington Junior High (LJHS)
  const isLexington = /(?:Lexington|LJHS)/i.test(str);
  if (isLexington) {
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `LJHS Field ${numMatch[1]}`;
    return 'LJHS Field';
  }

  // 3. Check for Arnold Elementary / Arnold Park
  const isArnold = /Arnold/i.test(str);
  if (isArnold) {
    const numMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) || str.match(/#\s*(\d+)/);
    if (numMatch) return `Arnold Field ${numMatch[1]}`;
    return 'Arnold Field';
  }

  // General cleanup fallback: remove E154-, Fall 202X, Spring 202X
  str = str.replace(/^E\d+[-_]?/i, '');
  str = str.replace(/\bFall\s*\d{4}\b/i, '');
  str = str.replace(/\bSpring\s*\d{4}\b/i, '');
  str = str.replace(/\s*-\s*/g, ' ');
  str = str.replace(/#/g, '');
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes division codes into standard format:
 * e.g., 'BU12' -> '12U-B', 'GU10' -> '10U-G', 'BU08' -> '08U-B', 'BU8' -> '08U-B'
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
 * Determines venue classification for a given field string.
 * 
 * @param {string} rawField Raw or formatted field string
 * @returns {'PARK_LEX'|'LJHS_ARNOLD'} Venue key
 */
function getVenueCategory(rawField) {
  const str = String(rawField || '').trim();
  if (/Park\s*Lex/i.test(str) || /Denni\s*&\s*Cerritos/i.test(str) || /Turf/i.test(str)) {
    return 'PARK_LEX';
  }
  return 'LJHS_ARNOLD';
}

// ============================================================================
// SCHEDULE PARSER & CHOICE BUILDER
// ============================================================================

/**
 * Parses raw MatchTrak schedule rows into separated venue choice lists:
 * Format: "🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}"
 * 
 * @param {Array<Array<any>>} scheduleRows 2D array of rows from 'Master Schedule' or CSV
 * @returns {{parkLexChoices: string[], ljhsArnoldChoices: string[], allChoices: string[]}}
 */
function buildScheduleDropdownOptionsByVenue(scheduleRows) {
  if (!scheduleRows || scheduleRows.length < 2) {
    if (typeof Logger !== 'undefined') Logger.log('[SANDBOX SYNC] No schedule rows found.');
    return {
      parkLexChoices: [OTHER_UNLISTED_OPTION],
      ljhsArnoldChoices: [OTHER_UNLISTED_OPTION],
      allChoices: [OTHER_UNLISTED_OPTION]
    };
  }

  // Header indexing - support MatchTrak standard headers
  const headers = scheduleRows[0].map(h => String(h || '').trim().toLowerCase());
  const colDate = headers.findIndex(h => h.includes('date') || h.includes('day'));
  const colTime = headers.findIndex(h => h === 'time' || h === 'game time' || (h.includes('time') && !h.includes('date')));
  const colDiv = headers.findIndex(h => h.includes('div'));
  const colField = headers.findIndex(h => h.includes('field'));
  const colHome = headers.findIndex(h => h.includes('home'));
  const colAway = headers.findIndex(h => h.includes('away'));

  const seenParkLex = new Set();
  const seenLjhsArnold = new Set();
  const parkLexOptions = [];
  const ljhsArnoldOptions = [];
  const allOptions = [];

  for (let i = 1; i < scheduleRows.length; i++) {
    const row = scheduleRows[i];
    if (!row || row.length === 0) continue;

    const dateRaw = colDate !== -1 ? row[colDate] : '';
    const timeRaw = colTime !== -1 ? String(row[colTime] || '').trim() : '';
    const fieldRaw = colField !== -1 ? String(row[colField] || '').trim() : '';
    const divRaw = colDiv !== -1 ? String(row[colDiv] || '').trim() : '';
    const homeRaw = colHome !== -1 ? String(row[colHome] || '').trim() : '';
    const awayRaw = colAway !== -1 ? String(row[colAway] || '').trim() : '';

    // Sanitize: Skip if essential game time or field is empty
    if (!timeRaw || !fieldRaw) continue;

    const formattedDay = formatDay(dateRaw);
    const formattedTime = formatTime(timeRaw);
    const formattedField = formatField(fieldRaw);
    const formattedDiv = formatDivision(divRaw);

    // Build matchup segment
    let matchup = '';
    if (homeRaw && awayRaw) {
      matchup = `${homeRaw} vs ${awayRaw}`;
    } else if (homeRaw || awayRaw) {
      matchup = `${homeRaw || awayRaw}`;
    }

    // Build unified RFC-007 match string:
    // 🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}
    const divSegment = formattedDiv ? `${formattedDiv}: ` : '';
    const choiceString = `🗓️ ${formattedDay} • ⏰ ${formattedTime} • 📍 ${formattedField} • ⚽ ${divSegment}${matchup}`.trim();

    const venue = getVenueCategory(fieldRaw);

    if (venue === 'PARK_LEX') {
      if (!seenParkLex.has(choiceString)) {
        seenParkLex.add(choiceString);
        parkLexOptions.push(choiceString);
        allOptions.push(choiceString);
      }
    } else {
      if (!seenLjhsArnold.has(choiceString)) {
        seenLjhsArnold.add(choiceString);
        ljhsArnoldOptions.push(choiceString);
        allOptions.push(choiceString);
      }
    }
  }

  // Always append Unlisted Match option to both venue lists
  const parkLexChoices = [...parkLexOptions, OTHER_UNLISTED_OPTION];
  const ljhsArnoldChoices = [...ljhsArnoldOptions, OTHER_UNLISTED_OPTION];

  return {
    parkLexChoices,
    ljhsArnoldChoices,
    allChoices: allOptions
  };
}

/**
 * Legacy wrapper function returning all formatted choice options for backward compatibility.
 * 
 * @param {Array<Array<any>>} scheduleRows 2D array of schedule rows
 * @returns {Array<string>} Combined list of formatted choice strings
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
    const errorMsg = 'SAFETY BLOCK: SANDBOX_FORM_ID is set to placeholder. Configure a valid test form ID.';
    if (typeof Logger !== 'undefined') Logger.log('❌ ' + errorMsg);
    throw new Error(errorMsg);
  }

  if (PRODUCTION_FORM_ID_BLOCKLIST.some(blocked => SANDBOX_FORM_ID.includes(blocked))) {
    const errorMsg = 'CRITICAL SAFETY BLOCK: SANDBOX_FORM_ID matches a protected production form/sheet!';
    if (typeof Logger !== 'undefined') Logger.log('🚨 ' + errorMsg);
    throw new Error(errorMsg);
  }

  if (SANDBOX_SPREADSHEET_ID && PRODUCTION_FORM_ID_BLOCKLIST.some(blocked => SANDBOX_SPREADSHEET_ID.includes(blocked))) {
    const errorMsg = 'CRITICAL SAFETY BLOCK: SANDBOX_SPREADSHEET_ID matches a protected production sheet!';
    if (typeof Logger !== 'undefined') Logger.log('🚨 ' + errorMsg);
    throw new Error(errorMsg);
  }
}

// ============================================================================
// FORM SYNC & DRIVE AUTO-INGEST FUNCTIONS
// ============================================================================

/**
 * Syncs the 'Master Schedule' (or 'Master_Schedule') sheet tab rows to the sandbox form
 * separated into Park Lexington and LJHS / Arnold dropdown lists.
 */
function syncSandboxScheduleDropdown() {
  if (typeof Logger !== 'undefined') {
    Logger.log('====================================================');
    Logger.log('🧪 AYSO 154 SANDBOX: MULTI-VENUE SCHEDULE DROPDOWN SYNC');
    Logger.log('====================================================');
  }

  validateSandboxSafety();

  let ss;
  try {
    ss = SpreadsheetApp.openById(SANDBOX_SPREADSHEET_ID);
  } catch (e) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  if (!ss) {
    throw new Error(`Could not open Sandbox Spreadsheet (${SANDBOX_SPREADSHEET_ID}).`);
  }

  const scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');
  if (!scheduleSheet) {
    throw new Error('Sheet tab "Master Schedule" (or "Master_Schedule") not found in sandbox sheet.');
  }

  const scheduleData = scheduleSheet.getDataRange().getValues();
  const venueOptions = buildScheduleDropdownOptionsByVenue(scheduleData);

  if (typeof Logger !== 'undefined') {
    Logger.log(`Generated ${venueOptions.parkLexChoices.length} Park Lexington choices.`);
    Logger.log(`Generated ${venueOptions.ljhsArnoldChoices.length} LJHS / Arnold choices.`);
  }

  // Open target sandbox form
  const form = FormApp.openById(SANDBOX_FORM_ID);
  const items = form.getItems();

  let parkLexItem = null;
  let ljhsArnoldItem = null;
  let genericItem = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = item.getTitle().trim();
    const type = item.getType();

    if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.MULTIPLE_CHOICE) {
      if (title.includes('Park Lexington') || title === VENUE_TITLES.PARK_LEX) {
        parkLexItem = item;
      } else if (title.includes('Lexington Junior High') || title.includes('Arnold') || title === VENUE_TITLES.LJHS_ARNOLD) {
        ljhsArnoldItem = item;
      } else if (title === 'Game Time' || title === 'Match Slot' || title.includes('Game Time / Field') || title.includes('Match Schedule')) {
        genericItem = item;
      }
    }
  }

  // 1. Update Park Lexington dropdown
  if (parkLexItem) {
    if (parkLexItem.getType() === FormApp.ItemType.LIST) {
      parkLexItem.asListItem().setChoiceValues(venueOptions.parkLexChoices);
    } else {
      parkLexItem.asMultipleChoiceItem().setChoiceValues(venueOptions.parkLexChoices);
    }
    if (typeof Logger !== 'undefined') {
      Logger.log(`✅ Updated "${parkLexItem.getTitle()}" with ${venueOptions.parkLexChoices.length} choices.`);
    }
  }

  // 2. Update LJHS / Arnold dropdown
  if (ljhsArnoldItem) {
    if (ljhsArnoldItem.getType() === FormApp.ItemType.LIST) {
      ljhsArnoldItem.asListItem().setChoiceValues(venueOptions.ljhsArnoldChoices);
    } else {
      ljhsArnoldItem.asMultipleChoiceItem().setChoiceValues(venueOptions.ljhsArnoldChoices);
    }
    if (typeof Logger !== 'undefined') {
      Logger.log(`✅ Updated "${ljhsArnoldItem.getTitle()}" with ${venueOptions.ljhsArnoldChoices.length} choices.`);
    }
  }

  // 3. Fallback: Update generic single dropdown if multi-venue items are not present
  if (genericItem && !parkLexItem && !ljhsArnoldItem) {
    const combined = [...venueOptions.allChoices, OTHER_UNLISTED_OPTION];
    if (genericItem.getType() === FormApp.ItemType.LIST) {
      genericItem.asListItem().setChoiceValues(combined);
    } else {
      genericItem.asMultipleChoiceItem().setChoiceValues(combined);
    }
    if (typeof Logger !== 'undefined') {
      Logger.log(`✅ Updated fallback "${genericItem.getTitle()}" with ${combined.length} choices.`);
    }
  }

  if (!parkLexItem && !ljhsArnoldItem && !genericItem) {
    if (typeof Logger !== 'undefined') {
      Logger.log('⚠️ Could not find matching dropdown questions in the sandbox form.');
    }
  }
}

/**
 * Automatically ingests weekly MatchTrak schedule CSV files from the Google Drive
 * drop folder, writes data to 'Master Schedule' in the sandbox sheet, triggers
 * the form dropdown sync, and archives the ingested CSV file.
 */
function autoIngestWeeklySchedule() {
  if (typeof Logger !== 'undefined') {
    Logger.log('====================================================');
    Logger.log('📥 AYSO 154 SANDBOX: AUTO-INGEST WEEKLY SCHEDULE');
    Logger.log('====================================================');
  }

  validateSandboxSafety();

  const dropFolder = DriveApp.getFolderById(DROP_FOLDER_ID);
  const archiveFolder = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);

  if (!dropFolder || !archiveFolder) {
    throw new Error('Could not access Drop or Archive folder. Verify Folder IDs and permissions.');
  }

  const files = dropFolder.getFiles();
  let ingestedCount = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // Only process CSV files
    if (!fileName.toLowerCase().endsWith('.csv') && file.getMimeType() !== MimeType.CSV) {
      if (typeof Logger !== 'undefined') Logger.log(`Skipping non-CSV file: ${fileName}`);
      continue;
    }

    if (typeof Logger !== 'undefined') Logger.log(`Processing schedule file: ${fileName}`);

    const csvContent = file.getBlob().getDataAsString();
    const csvData = Utilities.parseCsv(csvContent);

    if (!csvData || csvData.length === 0) {
      if (typeof Logger !== 'undefined') Logger.log(`File ${fileName} is empty. Skipping.`);
      continue;
    }

    // Open Sandbox Spreadsheet
    const ss = SpreadsheetApp.openById(SANDBOX_SPREADSHEET_ID);
    let scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');

    if (!scheduleSheet) {
      scheduleSheet = ss.insertSheet('Master Schedule');
    }

    // Clear existing data and write new CSV data
    scheduleSheet.clearContents();
    scheduleSheet.getRange(1, 1, csvData.length, csvData[0].length).setValues(csvData);

    if (typeof Logger !== 'undefined') {
      Logger.log(`Successfully wrote ${csvData.length} rows to "Master Schedule" in Sandbox Sheet (${SANDBOX_SPREADSHEET_ID}).`);
    }

    // Trigger Form Dropdown Sync
    syncSandboxScheduleDropdown();

    // Move file to archive folder
    file.moveTo(archiveFolder);
    if (typeof Logger !== 'undefined') {
      Logger.log(`Moved ${fileName} to Archive Folder (${ARCHIVE_FOLDER_ID}).`);
    }

    ingestedCount++;
  }

  if (ingestedCount === 0) {
    if (typeof Logger !== 'undefined') Logger.log('No CSV files found in Drop Folder.');
  } else {
    if (typeof Logger !== 'undefined') Logger.log(`🎉 Completed ingestion of ${ingestedCount} schedule file(s).`);
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
    getVenueCategory,
    validateSandboxSafety,
    autoIngestWeeklySchedule,
    syncSandboxScheduleDropdown,
    SANDBOX_SPREADSHEET_ID,
    SANDBOX_FORM_ID,
    DROP_FOLDER_ID,
    ARCHIVE_FOLDER_ID,
    VENUE_TITLES,
    OTHER_UNLISTED_OPTION,
    PRODUCTION_FORM_ID_BLOCKLIST
  };
}
