/**
 * Unit & Integration Test Suite for Sandbox Schedule Dropdown Sync
 * AYSO Region 154 Volunteer Standings System
 * 
 * Tests MatchTrak Schedule CSV parsing, normalization, and choice formatting:
 * 1. Expected headers: Date, Time, Game #, Division, Field, Home Team, Away Team
 * 2. Time formatting: Strips trailing seconds (e.g. '5:30:00 PM' -> '5:30 PM')
 * 3. Field formatting: Normalizes MatchTrak strings (e.g. 'E154-Lexington JHS U12 Field 9 Fall 2026' -> 'Lexington Field 9')
 * 4. Division formatting: Converts codes (e.g. 'BU12' -> '12U-B', 'GU10' -> '10U-G')
 * 5. Choice string format: "[#<Game #>] <Time> - <Field> | <Division> (<Home> vs <Away>)"
 */

const assert = require('assert');
const {
  buildScheduleDropdownOptions,
  formatTime,
  formatField,
  formatDivision,
  SANDBOX_FORM_ID,
  PRODUCTION_FORM_ID_BLOCKLIST
} = require('../apps-script/Sandbox_ScheduleDropdownSync.js');

console.log('====================================================');
console.log('🧪 TEST: MATCHTRAK SCHEDULE DROPDOWN SYNC ENGINE');
console.log('====================================================\n');

// 1. Mock MatchTrak Schedule CSV Data
const sampleMatchTrakCsv = `Date,Time,Game #,Division,Field,Home Team,Away Team
2026-09-12,5:30:00 PM,101,BU12,E154-Lexington JHS U12 Field 9 Fall 2026,Michael Lewis,Faheem Armanyous
2026-09-12,8:00:00 AM,102,GU10,E154-Lexington JHS Field 1,Ryan Bulatao,Dustin Brieger
2026-09-12,9:15:00 AM,103,BU10,Lexington JHS Field 1,Andrew Evango,Harold Huang
2026-09-12,8:00:00 AM,104,12U Girls,Lexington JHS Field 2,Saul Alvarez,David Corado
2026-09-12,9:30:00 AM,105,GU12,Lexington Field 2,Carlos Cruz,Fernando Huerta
2026-09-12,8:00:00 AM,106,BU08,Arnold - Field #10,Amanda Towers,Casey Harpham
2026-09-12,9:15:00 AM,107,BU08,E154-Arnold Park U08 Field 10 Fall 2026,Roberto Rojas,Juan Rodriguez
2026-09-12,5:30:00 PM,101,BU12,E154-Lexington JHS U12 Field 9 Fall 2026,Michael Lewis,Faheem Armanyous
2026-09-12,,109,GU10,Lexington Field 3,Dawn Caires,Josie Cotton
2026-09-12,11:00:00 AM,110,BU14,,Mina Abader,Ernie Solano
2026-09-12,1:00:00 PM,111,14UX Boys,Lexington JHS Field 4,Christian Villalobos,
`;

// Helper to parse CSV string into 2D array
function parseCsv(csvText) {
  return csvText.trim().split('\n').map(line => line.split(',').map(c => c.trim()));
}

// ----------------------------------------------------
// Unit Tests: Individual Formatting Functions
// ----------------------------------------------------

console.log('▶ Test 1: Time Formatting Unit Tests (Strip Trailing Seconds)');
assert.strictEqual(formatTime('5:30:00 PM'), '5:30 PM', 'Must strip :00 seconds from 5:30:00 PM');
assert.strictEqual(formatTime('8:00:00 AM'), '8:00 AM', 'Must strip :00 seconds from 8:00:00 AM');
assert.strictEqual(formatTime('12:00:00 PM'), '12:00 PM', 'Must strip :00 seconds from 12:00:00 PM');
assert.strictEqual(formatTime('5:30 PM'), '5:30 PM', 'Preserves time without seconds');
assert.strictEqual(formatTime('9:15:00AM'), '9:15 AM', 'Handles missing space before AM');
console.log('  ✅ Time formatting correctly strips trailing seconds (5:30:00 PM -> 5:30 PM).');

console.log('\n▶ Test 2: Field Formatting Unit Tests (Lexington & Arnold Park)');
assert.strictEqual(
  formatField('E154-Lexington JHS U12 Field 9 Fall 2026'),
  'Lexington Field 9',
  'Must normalize full MatchTrak Lexington field string'
);
assert.strictEqual(
  formatField('E154-Lexington JHS Field 1'),
  'Lexington Field 1',
  'Must normalize regional prefix with Lexington'
);
assert.strictEqual(
  formatField('Lexington JHS Field 4'),
  'Lexington Field 4',
  'Must clean Lexington JHS'
);
assert.strictEqual(
  formatField('E154-Arnold Park U08 Field 10 Fall 2026'),
  'Arnold Field 10',
  'Must normalize full MatchTrak Arnold field string'
);
assert.strictEqual(
  formatField('Arnold - Field #10'),
  'Arnold Field 10',
  'Must normalize Arnold with dash and #'
);
assert.strictEqual(
  formatField('Arnold Park'),
  'Arnold Park',
  'Preserves Arnold Park without field number'
);
console.log('  ✅ Field formatting cleans up Lexington strings and preserves Arnold Park fields.');

console.log('\n▶ Test 3: Division Code Formatting Unit Tests');
assert.strictEqual(formatDivision('BU12'), '12U-B', 'BU12 -> 12U-B');
assert.strictEqual(formatDivision('GU10'), '10U-G', 'GU10 -> 10U-G');
assert.strictEqual(formatDivision('BU08'), '08U-B', 'BU08 -> 08U-B');
assert.strictEqual(formatDivision('BU8'), '08U-B', 'BU8 -> 08U-B');
assert.strictEqual(formatDivision('GU12'), '12U-G', 'GU12 -> 12U-G');
assert.strictEqual(formatDivision('10U Boys'), '10U-B', '10U Boys -> 10U-B');
assert.strictEqual(formatDivision('12U Girls'), '12U-G', '12U Girls -> 12U-G');
assert.strictEqual(formatDivision('14UX Boys'), '14UX-B', '14UX Boys -> 14UX-B');
assert.strictEqual(formatDivision('12U-B'), '12U-B', 'Preserves already formatted 12U-B');
console.log('  ✅ Division formatting correctly converts BU12 -> 12U-B and GU10 -> 10U-G.');

// ----------------------------------------------------
// Integration Tests: End-to-End Choice List Generation
// ----------------------------------------------------

console.log('\n▶ Test 4: Dropdown Choice Generation Format');
const parsedSchedule = parseCsv(sampleMatchTrakCsv);
const options = buildScheduleDropdownOptions(parsedSchedule);

assert(options.length > 0, 'Options list should not be empty');
console.log(`  Generated ${options.length} dropdown options from ${parsedSchedule.length - 1} input rows:`);
options.forEach(opt => console.log(`   • ${opt}`));

// Verify format of first entry: "[#101] 5:30 PM - Lexington Field 9 | 12U-B (Michael Lewis vs Faheem Armanyous)"
assert.strictEqual(
  options[0],
  '[#101] 5:30 PM - Lexington Field 9 | 12U-B (Michael Lewis vs Faheem Armanyous)',
  'First choice format mismatch'
);
console.log('  ✅ Choice string format conforms to "[#<Game #>] <Time> - <Field> | <Division> (<Home> vs <Away>)".');

// Test Arnold entry: "[#106] 8:00 AM - Arnold Field 10 | 08U-B (Amanda Towers vs Casey Harpham)"
const arnoldOption = options.find(opt => opt.includes('#106'));
assert(arnoldOption, 'Arnold match #106 must be present');
assert.strictEqual(
  arnoldOption,
  '[#106] 8:00 AM - Arnold Field 10 | 08U-B (Amanda Towers vs Casey Harpham)',
  'Arnold choice format mismatch'
);
console.log('  ✅ Arnold Park option formatted accurately as "[#106] 8:00 AM - Arnold Field 10 | 08U-B (Amanda Towers vs Casey Harpham)".');

console.log('\n▶ Test 5: Sanitization of Incomplete Schedule Rows');
// Row 109 has empty time, Row 110 has empty field. Neither should appear.
const hasEmptyTime = options.some(opt => opt.includes('Dawn Caires'));
const hasEmptyField = options.some(opt => opt.includes('Mina Abader'));
assert.strictEqual(hasEmptyTime, false, 'Rows with missing Game Time must be sanitized/skipped');
assert.strictEqual(hasEmptyField, false, 'Rows with missing Field must be sanitized/skipped');
console.log('  ✅ Rows missing Game Time or Field are safely filtered out.');

console.log('\n▶ Test 6: Deduplication of Identical Match Entries');
// Game #101 is duplicated in row 2 and row 9
const duplicateMatches = options.filter(opt =>
  opt === '[#101] 5:30 PM - Lexington Field 9 | 12U-B (Michael Lewis vs Faheem Armanyous)'
);
assert.strictEqual(duplicateMatches.length, 1, 'Duplicate match rows must be deduplicated to a single choice');
console.log('  ✅ Exact duplicate matches are deduplicated to a single option.');

console.log('\n▶ Test 7: Single Team Matchup Handling (Game #111)');
const singleTeamChoice = options.find(opt => opt.includes('Christian Villalobos'));
assert(singleTeamChoice, 'Single team matchup should still generate a valid choice');
assert.strictEqual(
  singleTeamChoice,
  '[#111] 1:00 PM - Lexington Field 4 | 14UX-B (Christian Villalobos)',
  'Single team choice format mismatch'
);
console.log('  ✅ Single team/bye matchups format cleanly without trailing "vs".');

console.log('\n▶ Test 8: Production Guardrail & Safety Checks');
assert(PRODUCTION_FORM_ID_BLOCKLIST.length >= 2, 'Production blocklist must contain protected IDs');
assert(SANDBOX_FORM_ID.includes('PASTE_SANDBOX_FORM_ID_HERE'), 'SANDBOX_FORM_ID must remain a placeholder');
console.log('  ✅ Production form IDs are strictly protected by blocklist guardrails.');

console.log('\n====================================================');
console.log('🏆 ALL MATCHTRAK SCHEDULE SYNC TESTS PASSED (100%)');
console.log('====================================================');
