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
 * Parses raw schedule rows into sanitized, formatted choice strings:
 * Format: "[Field] Time — Division (Home vs Away)"
 * 
 * @param {Array<Array<any>>} scheduleRows 2D array of rows from 'Master_Schedule' tab or CSV
 * @returns {Array<string>} Unique, formatted choice strings
 */
function buildScheduleDropdownOptions(scheduleRows) {
  if (!scheduleRows || scheduleRows.length < 2) {
    if (typeof Logger !== 'undefined') Logger.log('[SANDBOX SYNC] No schedule rows found.');
    return [];
  }

  // Header indexing
  const headers = scheduleRows[0].map(h => String(h || '').trim().toLowerCase());
  const colTime = headers.findIndex(h => h.includes('time'));
  const colField = headers.findIndex(h => h.includes('field'));
  const colDiv = headers.findIndex(h => h.includes('div'));
  const colHome = headers.findIndex(h => h.includes('home'));
  const colAway = headers.findIndex(h => h.includes('away'));

  const seenChoices = new Set();
  const options = [];

  for (let i = 1; i < scheduleRows.length; i++) {
    const row = scheduleRows[i];
    if (!row || row.length === 0) continue;

    const timeRaw = colTime !== -1 ? String(row[colTime] || '').trim() : '';
    const fieldRaw = colField !== -1 ? String(row[colField] || '').trim() : '';
    const divRaw = colDiv !== -1 ? String(row[colDiv] || '').trim() : '';
    const homeRaw = colHome !== -1 ? String(row[colHome] || '').trim() : '';
    const awayRaw = colAway !== -1 ? String(row[colAway] || '').trim() : '';

    // Sanitize: Skip if essential game time or field is empty
    if (!timeRaw || !fieldRaw) continue;

    // Build unified string
    let matchup = '';
    if (homeRaw && awayRaw) {
      matchup = ` (${homeRaw} vs ${awayRaw})`;
    } else if (homeRaw || awayRaw) {
      matchup = ` (${homeRaw || awayRaw})`;
    }

    const divSegment = divRaw ? ` — ${divRaw}` : '';
    const choiceString = `[${fieldRaw}] ${timeRaw}${divSegment}${matchup}`.trim();

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
    if (title === 'Game Time' || title === 'Match Slot' || title.includes('Game Time / Field')) {
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
    SANDBOX_FORM_ID,
    PRODUCTION_FORM_ID_BLOCKLIST
  };
}
