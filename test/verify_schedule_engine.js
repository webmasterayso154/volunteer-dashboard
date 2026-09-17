/**
 * Production Verification Suite for ScheduleSyncEngine (v1.6.0-RFC007)
 * AYSO Region 154 Volunteer Standings & Schedule Automation System
 */

const assert = require('assert');
require.extensions['.gs'] = require.extensions['.js'];

const {
  CONFIG,
  buildScheduleDropdownOptionsByVenue,
  validateScheduleHeaders,
  formatDay,
  formatTime,
  formatField,
  formatDivision,
  formatTeam,
  getVenueCategory
} = require('../apps-script/ScheduleSyncEngine.gs');

console.log('================================================================');
console.log('🚀 PRODUCTION VERIFICATION: SCHEDULE SYNC ENGINE (v1.6.0-RFC007)');
console.log('================================================================\n');

// ----------------------------------------------------
// Test 1: Production Configuration Constants
// ----------------------------------------------------
console.log('▶ Test 1: Production Configuration Verification');
assert.strictEqual(CONFIG.VERSION, 'v1.6.0-RFC007', 'Version must be v1.6.0-RFC007');
assert.strictEqual(CONFIG.TIMEZONE, 'America/Los_Angeles', 'Timezone must be locked to Pacific');
assert.strictEqual(CONFIG.PRODUCTION_SHEET_ID, '1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g', 'Production Sheet ID mismatch');
assert.strictEqual(CONFIG.PRODUCTION_FORM_ID, '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI', 'Production Form ID mismatch');
assert.strictEqual(CONFIG.DROP_FOLDER_ID, '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv', 'Drop Folder ID mismatch');
assert.strictEqual(CONFIG.ARCHIVE_FOLDER_ID, '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m', 'Archive Folder ID mismatch');
assert.strictEqual(CONFIG.VENUE_TITLES.PARK_LEX, 'Select Match - 🌲 Park Lexington (Denni & Cerritos)');
assert.strictEqual(CONFIG.VENUE_TITLES.LUTHER, 'Select Match - 🏫 Luther Elementary');
assert.strictEqual(CONFIG.VENUE_TITLES.LJHS_ARNOLD, 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary');
assert.strictEqual(CONFIG.DASHBOARD_URL, 'https://webmasterayso154.github.io/volunteer-dashboard/', 'Dashboard URL mismatch');
assert(CONFIG.FORM_DESCRIPTION_BANNER.includes('https://webmasterayso154.github.io/volunteer-dashboard/'), 'Form description banner must contain Dashboard URL');
assert(CONFIG.CONFIRMATION_MESSAGE.includes('https://webmasterayso154.github.io/volunteer-dashboard/'), 'Form confirmation message must contain Dashboard URL');
console.log('  ✅ Production configuration constants verified.');

// ----------------------------------------------------
// Test 2: Header Validation Safeguards
// ----------------------------------------------------
console.log('\n▶ Test 2: MatchTrak Header Validation Safeguards');
const validHeaderData = [
  ['Date', 'Time', 'Game #', 'Division', 'Field', 'Home Team', 'Away Team'],
  ['2026-09-12', '8:00 AM', '101', '10U Boys', 'Park Lexington Turf', 'Home', 'Away']
];
assert.doesNotThrow(() => validateScheduleHeaders(validHeaderData), 'Valid headers must pass validation');

const missingHeaderData = [
  ['Date', 'Time', 'Game #', 'Division', 'Field'], // Missing Home Team, Away Team
  ['2026-09-12', '8:00 AM', '101', '10U Boys', 'Park Lexington Turf']
];
assert.throws(
  () => validateScheduleHeaders(missingHeaderData),
  /Missing required MatchTrak column header/,
  'Missing headers must throw descriptive error'
);
console.log('  ✅ Header validation safeguard verified.');

// ----------------------------------------------------
// Test 3: Normalization Helpers
// ----------------------------------------------------
console.log('\n▶ Test 3: Normalization & Pacific Time Helpers');
assert.strictEqual(formatDay('2026-09-12'), 'Sat');
assert.strictEqual(formatTime('5:30:00 PM'), '5:30 PM');
assert.strictEqual(formatTime('8:00:00 AM'), '8:00 AM');
assert.strictEqual(formatDivision('BU12'), '12U-B');
assert.strictEqual(formatDivision('GU10'), '10U-G');
assert.strictEqual(formatDivision('BU08'), '08U-B');
assert.strictEqual(formatTeam('01-E154-Faheem Armanyous'), 'Faheem Armanyous');

// Luther & U8 Field mappings
assert.strictEqual(formatField('Luther Elementary School U10 Field 1 Fall 2026'), 'Luther Field 1');
assert.strictEqual(formatField('Luther Elementary School U8 Field 1'), 'Luther Field 1');
assert.strictEqual(formatField('Luther ES Field 2'), 'Luther Field 2');
assert.strictEqual(formatField('Park Lexington ARTIFICIAL TURF'), 'Park Lex Turf');
assert.strictEqual(formatField('Park Lexington GRASS Field'), 'Park Lex Grass');
assert.strictEqual(formatField('Lexington JHS Field 4'), 'LJHS Field 4');
assert.strictEqual(formatField('Arnold - Field #10'), 'Arnold Field 10');
console.log('  ✅ Normalization helpers and U8/Luther field mapping verified.');

// ----------------------------------------------------
// Test 4: 3-Venue Routing & Deduplication ([...new Set(...)])
// ----------------------------------------------------
console.log('\n▶ Test 4: 3-Venue Routing & JavaScript Set Deduplication');
const scheduleWithDuplicates = [
  ['Date', 'Time', 'Game #', 'Division', 'Field', 'Home Team', 'Away Team'],
  ['2026-09-12', '8:00:00 AM', '101', 'BU10', 'Park Lexington ARTIFICIAL TURF', 'Michael Lewis', 'Faheem Armanyous'],
  ['2026-09-12', '8:00:00 AM', '101', 'BU10', 'Park Lexington ARTIFICIAL TURF', 'Michael Lewis', 'Faheem Armanyous'], // Duplicate
  ['2026-09-12', '9:15:00 AM', '102', 'GU10', 'Lexington JHS Field 1', 'Andrew Evango', 'Harold Huang'],
  ['2026-09-12', '9:15:00 AM', '102', 'GU10', 'Lexington JHS Field 1', 'Andrew Evango', 'Harold Huang'] // Duplicate
];

const result = buildScheduleDropdownOptionsByVenue(scheduleWithDuplicates);

// Verify Park Lex deduplication
const parkLexMatches = result.parkLexMatches.filter(m => m.includes('Michael Lewis'));
assert.strictEqual(parkLexMatches.length, 1, 'Duplicate Park Lex match rows must be deduplicated to 1');

// Verify LJHS deduplication
const ljhsMatches = result.ljhsArnoldMatches.filter(m => m.includes('Andrew Evango'));
assert.strictEqual(ljhsMatches.length, 1, 'Duplicate LJHS match rows must be deduplicated to 1');

// Verify Luther zero-game fallback
assert.strictEqual(result.lutherMatches.length, 2, 'Luther must contain fallback + escape option');
assert.strictEqual(result.lutherMatches[0], CONFIG.LUTHER_ZERO_GAMES_OPTION);
assert.strictEqual(result.lutherMatches[1], CONFIG.OTHER_UNLISTED_OPTION);

// Verify no duplicate choices within any single array (to prevent Form choice exceptions)
for (let venueKey of ['parkLexMatches', 'lutherMatches', 'ljhsArnoldMatches']) {
  const arr = result[venueKey];
  const uniqueCount = new Set(arr).size;
  assert.strictEqual(arr.length, uniqueCount, `No duplicate choices permitted in ${venueKey}`);
}
console.log('  ✅ Set-based deduplication and zero-game Luther fallback verified.');

// ----------------------------------------------------
// Test 5: Active Luther Matches Population
// ----------------------------------------------------
console.log('\n▶ Test 5: Active Luther Matches Population');
const scheduleWithLuther = [
  ['Date', 'Time', 'Game #', 'Division', 'Field', 'Home Team', 'Away Team'],
  ['2026-09-19', '8:00:00 AM', '201', 'BU08', 'Luther Elementary School U8 Field 1', 'Amanda Towers', 'Casey Harpham']
];
const lutherResult = buildScheduleDropdownOptionsByVenue(scheduleWithLuther);
assert(
  lutherResult.lutherMatches.includes('🗓️ Sat • ⏰ 8:00 AM • 📍 Luther Field 1 • ⚽ 08U-B: Amanda Towers vs Casey Harpham'),
  'Luther U8 match must be correctly routed and formatted'
);
assert.strictEqual(
  lutherResult.lutherMatches.includes(CONFIG.LUTHER_ZERO_GAMES_OPTION),
  false,
  'Zero-game warning must NOT appear when active games are scheduled at Luther'
);
console.log('  ✅ Active Luther match routing verified.');
// ----------------------------------------------------
// Test 6: Executive Summary Sheet Generation & Formulas
// ----------------------------------------------------
console.log('\n▶ Test 6: Executive Summary Sheet Generation & Formulas');
const { setupExecutiveSummarySheet, EXECUTIVE_SUMMARY_SHEET } = require('../apps-script/ExecutiveSummary.gs');
assert.strictEqual(EXECUTIVE_SUMMARY_SHEET, 'Executive_Summary');

// Mock SpreadsheetApp / Spreadsheet
const mockRanges = {};
const mockSheet = {
  clear: () => {},
  clearFormats: () => {},
  setColumnWidth: () => {},
  setRowHeight: () => {},
  setFrozenRows: () => {},
  getRange: (rangeStr) => {
    if (!mockRanges[rangeStr]) {
      mockRanges[rangeStr] = {
        rangeStr,
        values: null,
        merge: function() { return this; },
        setValue: function(v) { this.values = v; return this; },
        setValues: function(vals) { this.values = vals; return this; },
        setBackground: function() { return this; },
        setFontColor: function() { return this; },
        setFontWeight: function() { return this; },
        setFontSize: function() { return this; },
        setFontStyle: function() { return this; },
        setFontFamily: function() { return this; },
        setHorizontalAlignment: function() { return this; },
        setVerticalAlignment: function() { return this; },
        setNumberFormat: function() { return this; },
        setBorder: function() { return this; }
      };
    }
    return mockRanges[rangeStr];
  }
};

const mockSpreadsheet = {
  getSheetByName: (name) => null,
  insertSheet: (name) => mockSheet
};

// Execute setup
const resSheet = setupExecutiveSummarySheet(mockSpreadsheet);
assert(resSheet, 'setupExecutiveSummarySheet must return sheet instance');
assert(mockRanges['A1:D1'].values.includes('EXECUTIVE BOARD VOLUNTEER SUMMARY'), 'Title banner check');
assert(mockRanges['A2:D2'].values.includes('https://webmasterayso154.github.io/volunteer-dashboard/'), 'Dashboard link check');

// Check KPI formulas
const kpiValues = mockRanges['A6:D10'].values;
assert.strictEqual(kpiValues[0][0], 'Total Volunteer Check-In Submissions');
assert.strictEqual(kpiValues[0][1], "=MAX(0, COUNTA('Form Responses 1'!A2:A))");
assert.strictEqual(kpiValues[1][1], "=COUNTIF('Form Responses 1'!O2:O, \"Verified\")");
assert.strictEqual(kpiValues[4][1], "=SUM('Form Responses 1'!P2:P)");

// Check Role breakdown
const roleValues = mockRanges['A14:D17'].values;
assert(roleValues[0][0].includes('Referee'));
assert.strictEqual(roleValues[0][2], "=SUMIFS('Form Responses 1'!P2:P, 'Form Responses 1'!E2:E, \"*Referee*\")");

// Check Venue breakdown
const venueValues = mockRanges['A21:D23'].values;
assert(venueValues[0][0].includes('Park Lexington'));
assert(venueValues[1][0].includes('Luther Elementary'));
assert(venueValues[2][0].includes('Lexington Junior High'));

console.log('  ✅ Executive Summary sheet generator and formulas verified.');

console.log('\n================================================================');
console.log('🏆 PRODUCTION ENGINES & EXECUTIVE SUMMARY VERIFIED (100% SUCCESS)');
console.log('================================================================');

