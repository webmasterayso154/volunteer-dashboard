/**
 * ============================================================================
 * AYSO REGION 154 — SANDBOX SCHEDULE DROPDOWN SYNC ENGINE
 * ============================================================================
 * File: Sandbox_ScheduleDropdownSync.js
 * Description: Isolated sandbox utility for testing conversion of free-text
 *              "Game Time" and "Field" questions into a unified, schedule-driven
 *              dropdown choice menu in a test/sandbox Google Form.
 * 
 * PROPOSAL REFERENCE: RFC-007 (docs/BOARD_PROPOSALS_REGISTRY.md)
 * 
 * MATCHTRAK CSV STRUCTURE:
 * Expected headers: Date, Time, Game #, Division, Field, Home Team, Away Team
 * Choice Format: "[#<Game #>] <Time> - <Field> | <Division> (<Home> vs <Away>)"
 * 
 * SAFETY GUARDRAILS:
 * - This script must NEVER be pointed to the live production Google Form.
 * - Production Form ID is hard-blocked by the safety validator below.
 * ============================================================================
 */

// Placeholder Sandbox Google Form ID. Replace with your isolated test form ID.
const SANDBOX_FORM_ID = 'PASTE_SANDBOX_FORM_ID_HERE';

// Hard-coded production form ID blocklist to prevent accidental modification
const PRODUCTION_FORM_ID_BLOCKLIST = [
  '1FAIpQLSdDPW8Bs7T1v7xYBIzVmHwi7rpx6rrLcqYk83vvVUJo_j5WSQ', // Production check-in form ID
  '1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g'             // Production master sheet ID
];

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
 * e.g., 'E154-Lexington JHS U12 Field 9 Fall 2026' -> 'Lexington Field 9'
 * e.g., 'E154-Arnold Park U10 Field 10 Fall 2026' -> 'Arnold Field 10'
 * e.g., 'Arnold - Field #10' -> 'Arnold Field 10'
 * 
 * @param {string} raw Raw field string
 * @returns {string} Formatted field name
 */
function formatField(raw) {
  if (!raw) return '';
  let str = String(raw).trim();

  const isLexington = /(?:Lexington|LJHS)/i.test(str);
  const isArnold = /Arnold/i.test(str);

  // Look for "Field #9", "Field 9", "Fld 9", or "#9"
  const fieldNumMatch = str.match(/(?:Field|Fld)\s*#?\s*(\d+)/i) ||
                        str.match(/#\s*(\d+)/);

  if (isLexington) {
    if (fieldNumMatch) return `Lexington Field ${fieldNumMatch[1]}`;
    return 'Lexington';
  }

  if (isArnold) {
    if (fieldNumMatch) return `Arnold Field ${fieldNumMatch[1]}`;
    return 'Arnold Park';
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
 * Parses raw schedule rows into sanitized, formatted choice strings:
 * Format: "[#<Game #>] <Time> - <Field> | <Division> (<Home> vs <Away>)"
 * 
 * Expected headers: Date, Time, Game #, Division, Field, Home Team, Away Team
 * 
 * @param {Array<Array<any>>} scheduleRows 2D array of rows from 'Master_Schedule' tab or CSV
 * @returns {Array<string>} Unique, formatted choice strings
 */
function buildScheduleDropdownOptions(scheduleRows) {
  if (!scheduleRows || scheduleRows.length < 2) {
    if (typeof Logger !== 'undefined') Logger.log('[SANDBOX SYNC] No schedule rows found.');
    return [];
  }

  // Header indexing - support MatchTrak standard headers
  const headers = scheduleRows[0].map(h => String(h || '').trim().toLowerCase());
  const colGameNum = headers.findIndex(h => h.includes('game #') || h.includes('game#') || h.includes('match') || h === 'game' || h.includes('#'));
  const colTime = headers.findIndex(h => h === 'time' || h === 'game time' || (h.includes('time') && !h.includes('date')));
  const colDiv = headers.findIndex(h => h.includes('div'));
  const colField = headers.findIndex(h => h.includes('field'));
  const colHome = headers.findIndex(h => h.includes('home'));
  const colAway = headers.findIndex(h => h.includes('away'));

  const seenChoices = new Set();
  const options = [];

  for (let i = 1; i < scheduleRows.length; i++) {
    const row = scheduleRows[i];
    if (!row || row.length === 0) continue;

    const gameNumRaw = colGameNum !== -1 ? String(row[colGameNum] || '').trim() : '';
    const timeRaw = colTime !== -1 ? String(row[colTime] || '').trim() : '';
    const fieldRaw = colField !== -1 ? String(row[colField] || '').trim() : '';
    const divRaw = colDiv !== -1 ? String(row[colDiv] || '').trim() : '';
    const homeRaw = colHome !== -1 ? String(row[colHome] || '').trim() : '';
    const awayRaw = colAway !== -1 ? String(row[colAway] || '').trim() : '';

    // Sanitize: Skip if essential game time or field is empty
    if (!timeRaw || !fieldRaw) continue;

    const formattedTime = formatTime(timeRaw);
    const formattedField = formatField(fieldRaw);
    const formattedDiv = formatDivision(divRaw);

    // Build matchup segment
    let matchup = '';
    if (homeRaw && awayRaw) {
      matchup = ` (${homeRaw} vs ${awayRaw})`;
    } else if (homeRaw || awayRaw) {
      matchup = ` (${homeRaw || awayRaw})`;
    }

    const divSegment = formattedDiv ? ` | ${formattedDiv}` : '';
    const gameTag = gameNumRaw ? `[#${gameNumRaw.replace(/^#/, '')}] ` : '';
    const choiceString = `${gameTag}${formattedTime} - ${formattedField}${divSegment}${matchup}`.trim();

    // Deduplicate exact duplicate match entries
    if (!seenChoices.has(choiceString)) {
      seenChoices.add(choiceString);
      options.push(choiceString);
    }
  }

  return options;
}

/**
 * Main sandbox execution function to sync schedule dropdown choices to test form.
 */
function syncSandboxScheduleDropdown() {
  if (typeof Logger !== 'undefined') {
    Logger.log('====================================================');
    Logger.log('🧪 AYSO 154 SANDBOX: SCHEDULE DROPDOWN SYNC');
    Logger.log('====================================================');
  }

  // Safety Check 1: Check for placeholder ID
  if (!SANDBOX_FORM_ID || SANDBOX_FORM_ID === 'PASTE_SANDBOX_FORM_ID_HERE') {
    const errorMsg = 'SAFETY BLOCK: SANDBOX_FORM_ID is set to placeholder. Please set a valid test form ID before running.';
    if (typeof Logger !== 'undefined') Logger.log('❌ ' + errorMsg);
    throw new Error(errorMsg);
  }

  // Safety Check 2: Block production form IDs
  if (PRODUCTION_FORM_ID_BLOCKLIST.some(blocked => SANDBOX_FORM_ID.includes(blocked))) {
    const errorMsg = 'CRITICAL SAFETY BLOCK: Attempted to run sandbox sync against production form/sheet! Operation aborted.';
    if (typeof Logger !== 'undefined') Logger.log('🚨 ' + errorMsg);
    throw new Error(errorMsg);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Active spreadsheet required with a "Master_Schedule" tab.');
  }

  const scheduleSheet = ss.getSheetByName('Master_Schedule');
  if (!scheduleSheet) {
    throw new Error('Sheet tab "Master_Schedule" not found. Please create it with schedule data.');
  }

  const scheduleData = scheduleSheet.getDataRange().getValues();
  const choiceOptions = buildScheduleDropdownOptions(scheduleData);

  if (choiceOptions.length === 0) {
    if (typeof Logger !== 'undefined') Logger.log('⚠️ No valid schedule options generated. Check "Master_Schedule" contents.');
    return;
  }

  if (typeof Logger !== 'undefined') Logger.log(`Generated ${choiceOptions.length} unified schedule options.`);

  // Open the sandbox form
  const form = FormApp.openById(SANDBOX_FORM_ID);
  const items = form.getItems();
  let targetItem = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = item.getTitle().trim();
    if (title === 'Game Time' || title === 'Match Slot' || title.includes('Game Time / Field') || title.includes('Match Schedule')) {
      if (item.getType() === FormApp.ItemType.LIST || item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
        targetItem = item;
        break;
      }
    }
  }

  if (!targetItem) {
    throw new Error('Could not find a dropdown (List) item titled "Game Time" in the target sandbox form.');
  }

  if (targetItem.getType() === FormApp.ItemType.LIST) {
    targetItem.asListItem().setChoiceValues(choiceOptions);
  } else if (targetItem.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
    targetItem.asMultipleChoiceItem().setChoiceValues(choiceOptions);
  }

  if (typeof Logger !== 'undefined') {
    Logger.log(`✅ Successfully updated "${targetItem.getTitle()}" with ${choiceOptions.length} choices in Sandbox Form (${SANDBOX_FORM_ID}).`);
  }
}

// Export for Node.js unit testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildScheduleDropdownOptions,
    formatTime,
    formatField,
    formatDivision,
    SANDBOX_FORM_ID,
    PRODUCTION_FORM_ID_BLOCKLIST
  };
}
