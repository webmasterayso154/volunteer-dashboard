/**
 * Unit & Integration Test Suite for Sandbox Schedule Dropdown Sync
 * AYSO Region 154 Volunteer Standings System
 * 
 * Tests MatchTrak Schedule Multi-Venue parsing, normalization, and choice formatting:
 * 1. Expected headers: Date, Time, Game #, Division, Field, Home Team, Away Team
 * 2. Match string format: "🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}"
 * 3. Game # omitted, divisions normalized (BU12 -> 12U-B), fields normalized (Lexington JHS -> LJHS Field, Park Lexington ARTIFICIAL TURF -> Park Lex Turf)
 * 4. Two venue lists:
 *    - "Select Match - 🌲 Park Lexington (Denni & Cerritos)"
 *    - "Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary"
 * 5. Appends "⚠️ Other / Rescheduled / Unlisted Match" to both lists.
 * 6. Validates sandbox configuration IDs and safety guardrails.
 */

const assert = require('assert');
const {
  buildScheduleDropdownOptions,
  buildScheduleDropdownOptionsByVenue,
  formatDay,
  formatTime,
  formatField,
  formatDivision,
  getVenueCategory,
  validateSandboxSafety,
  SANDBOX_SPREADSHEET_ID,
  SANDBOX_FORM_ID,
  DROP_FOLDER_ID,
  ARCHIVE_FOLDER_ID,
  VENUE_TITLES,
  OTHER_UNLISTED_OPTION,
  PRODUCTION_FORM_ID_BLOCKLIST
} = require('../apps-script/Sandbox_ScheduleDropdownSync.js');

console.log('====================================================');
console.log('🧪 TEST: RFC-007 MULTI-VENUE SCHEDULE SYNC ENGINE');
console.log('====================================================\n');

// 1. Mock MatchTrak Schedule CSV Data (With Park Lex, LJHS, and Arnold fields)
const sampleMatchTrakCsv = `Date,Time,Game #,Division,Field,Home Team,Away Team
2026-09-12,5:30:00 PM,101,BU12,E154-Lexington JHS U12 Field 9 Fall 2026,Michael Lewis,Faheem Armanyous
2026-09-12,8:00:00 AM,102,GU10,Park Lexington ARTIFICIAL TURF,Ryan Bulatao,Dustin Brieger
2026-09-12,9:15:00 AM,103,BU10,Lexington JHS Field 1,Andrew Evango,Harold Huang
2026-09-12,8:00:00 AM,104,12U Girls,Lexington JHS Field 2,Saul Alvarez,David Corado
2026-09-12,9:30:00 AM,105,GU12,Park Lexington (Denni & Cerritos),Carlos Cruz,Fernando Huerta
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
// Unit Tests: Individual Normalization Helpers
// ----------------------------------------------------

console.log('▶ Test 1: Day & Time Formatting Unit Tests');
assert.strictEqual(formatDay('2026-09-12'), 'Sat', '2026-09-12 must format to Sat');
assert.strictEqual(formatDay('Saturday'), 'Sat', 'Saturday must format to Sat');
assert.strictEqual(formatDay('Sunday'), 'Sun', 'Sunday must format to Sun');
assert.strictEqual(formatTime('5:30:00 PM'), '5:30 PM', 'Must strip :00 seconds from 5:30:00 PM');
assert.strictEqual(formatTime('8:00:00 AM'), '8:00 AM', 'Must strip :00 seconds from 8:00:00 AM');
assert.strictEqual(formatTime('12:00:00 PM'), '12:00 PM', 'Must strip :00 seconds from 12:00:00 PM');
console.log('  ✅ Day and Time formatting verified.');

console.log('\n▶ Test 2: Field Formatting & Venue Classification Unit Tests');
assert.strictEqual(
  formatField('Lexington JHS Field 4'),
  'LJHS Field 4',
  'Lexington JHS -> LJHS Field'
);
assert.strictEqual(
  formatField('E154-Lexington JHS U12 Field 9 Fall 2026'),
  'LJHS Field 9',
  'MatchTrak Lexington string -> LJHS Field 9'
);
assert.strictEqual(
  formatField('Park Lexington ARTIFICIAL TURF'),
  'Park Lex Turf',
  'Park Lexington ARTIFICIAL TURF -> Park Lex Turf'
);
assert.strictEqual(
  formatField('Park Lexington (Denni & Cerritos)'),
  'Park Lex',
  'Park Lexington venue -> Park Lex'
);
assert.strictEqual(
  formatField('Arnold - Field #10'),
  'Arnold Field 10',
  'Arnold with dash and # -> Arnold Field 10'
);
assert.strictEqual(
  formatField('E154-Arnold Park U08 Field 10 Fall 2026'),
  'Arnold Field 10',
  'MatchTrak Arnold string -> Arnold Field 10'
);

// Venue categories
assert.strictEqual(getVenueCategory('Park Lexington ARTIFICIAL TURF'), 'PARK_LEX');
assert.strictEqual(getVenueCategory('Lexington JHS Field 4'), 'LJHS_ARNOLD');
assert.strictEqual(getVenueCategory('Arnold - Field #10'), 'LJHS_ARNOLD');
console.log('  ✅ Field normalization & venue classification verified.');

console.log('\n▶ Test 3: Division Code Formatting Unit Tests');
assert.strictEqual(formatDivision('BU12'), '12U-B', 'BU12 -> 12U-B');
assert.strictEqual(formatDivision('GU10'), '10U-G', 'GU10 -> 10U-G');
assert.strictEqual(formatDivision('BU08'), '08U-B', 'BU08 -> 08U-B');
assert.strictEqual(formatDivision('14UX Boys'), '14UX-B', '14UX Boys -> 14UX-B');
console.log('  ✅ Division code normalization verified.');

// ----------------------------------------------------
// Integration Tests: Multi-Venue Dropdown Generation
// ----------------------------------------------------

console.log('\n▶ Test 4: Multi-Venue Dropdown Choice Generation');
const parsedSchedule = parseCsv(sampleMatchTrakCsv);
const venueResult = buildScheduleDropdownOptionsByVenue(parsedSchedule);

console.log(`  🌲 Park Lexington Choices (${venueResult.parkLexChoices.length}):`);
venueResult.parkLexChoices.forEach(opt => console.log(`     • ${opt}`));

console.log(`  🏫 LJHS / Arnold Choices (${venueResult.ljhsArnoldChoices.length}):`);
venueResult.ljhsArnoldChoices.forEach(opt => console.log(`     • ${opt}`));

// Verify Park Lexington options:
assert(venueResult.parkLexChoices.length >= 2, 'Park Lex must have matches plus unlisted option');
assert(
  venueResult.parkLexChoices.includes('🗓️ Sat • ⏰ 8:00 AM • 📍 Park Lex Turf • ⚽ 10U-G: Ryan Bulatao vs Dustin Brieger'),
  'Park Lex Turf match must be present in Park Lex list'
);
assert(
  venueResult.parkLexChoices.includes('🗓️ Sat • ⏰ 9:30 AM • 📍 Park Lex • ⚽ 12U-G: Carlos Cruz vs Fernando Huerta'),
  'Park Lex match must be present in Park Lex list'
);
assert.strictEqual(
  venueResult.parkLexChoices[venueResult.parkLexChoices.length - 1],
  OTHER_UNLISTED_OPTION,
  'Last option in Park Lex list must be "⚠️ Other / Rescheduled / Unlisted Match"'
);
console.log('  ✅ Park Lexington dropdown choices conform to RFC-007 specification.');

// Verify LJHS / Arnold options:
assert(venueResult.ljhsArnoldChoices.length >= 4, 'LJHS/Arnold must have matches plus unlisted option');
assert(
  venueResult.ljhsArnoldChoices.includes('🗓️ Sat • ⏰ 5:30 PM • 📍 LJHS Field 9 • ⚽ 12U-B: Michael Lewis vs Faheem Armanyous'),
  'LJHS Field 9 match must be present with Game # omitted'
);
assert(
  venueResult.ljhsArnoldChoices.includes('🗓️ Sat • ⏰ 8:00 AM • 📍 Arnold Field 10 • ⚽ 08U-B: Amanda Towers vs Casey Harpham'),
  'Arnold Field 10 match must be present'
);
assert(
  venueResult.ljhsArnoldChoices.includes('🗓️ Sat • ⏰ 1:00 PM • 📍 LJHS Field 4 • ⚽ 14UX-B: Christian Villalobos'),
  'Single team match must format cleanly without "vs"'
);
assert.strictEqual(
  venueResult.ljhsArnoldChoices[venueResult.ljhsArnoldChoices.length - 1],
  OTHER_UNLISTED_OPTION,
  'Last option in LJHS/Arnold list must be "⚠️ Other / Rescheduled / Unlisted Match"'
);
console.log('  ✅ LJHS & Arnold dropdown choices conform to RFC-007 specification.');

console.log('\n▶ Test 5: Incomplete Row Sanitization & Deduplication');
const hasEmptyTime = venueResult.allChoices.some(opt => opt.includes('Dawn Caires'));
const hasEmptyField = venueResult.allChoices.some(opt => opt.includes('Mina Abader'));
assert.strictEqual(hasEmptyTime, false, 'Missing Game Time rows must be skipped');
assert.strictEqual(hasEmptyField, false, 'Missing Field rows must be skipped');

const duplicateChoices = venueResult.ljhsArnoldChoices.filter(opt =>
  opt === '🗓️ Sat • ⏰ 5:30 PM • 📍 LJHS Field 9 • ⚽ 12U-B: Michael Lewis vs Faheem Armanyous'
);
assert.strictEqual(duplicateChoices.length, 1, 'Exact duplicate matches must be deduplicated to 1 entry');
console.log('  ✅ Sanitization and deduplication verified.');

console.log('\n▶ Test 6: Sandbox Configuration & Safety Guardrails');
assert.strictEqual(SANDBOX_SPREADSHEET_ID, '177ciFgTmQiuPiEtHytjXbHP8GZa3ge7nRXwqbYJ4NAA');
assert.strictEqual(SANDBOX_FORM_ID, '1ib_QRcmucRqrJ4CujTA8Lt4Yreg9tPpz1AOIzcYlsal');
assert.strictEqual(DROP_FOLDER_ID, '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv');
assert.strictEqual(ARCHIVE_FOLDER_ID, '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m');
assert.strictEqual(VENUE_TITLES.PARK_LEX, 'Select Match - 🌲 Park Lexington (Denni & Cerritos)');
assert.strictEqual(VENUE_TITLES.LJHS_ARNOLD, 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary');
assert.strictEqual(OTHER_UNLISTED_OPTION, '⚠️ Other / Rescheduled / Unlisted Match');

// Verify safety validator executes without error on configured sandbox IDs
assert.doesNotThrow(() => validateSandboxSafety(), 'Sandbox safety validator should pass on valid sandbox IDs');
console.log('  ✅ All Sandbox IDs and safety guardrails validated.');

console.log('\n====================================================');
console.log('🏆 ALL RFC-007 MULTI-VENUE SYNC TESTS PASSED (100%)');
console.log('====================================================');

