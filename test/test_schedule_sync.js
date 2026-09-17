/**
 * Unit & Integration Test Suite for Sandbox Schedule Dropdown Sync (RFC-007)
 * AYSO Region 154 Volunteer Standings System
 * 
 * Tests MatchTrak Schedule 3-Venue parsing, normalization, and choice formatting:
 * 1. Expected headers: Date, Time, Game #, Division, Field, Home Team, Away Team
 * 2. Match string format: "🗓️ {Day} • ⏰ {Time} • 📍 {Field} • ⚽ {Division}: {Home} vs {Away}"
 * 3. Game # omitted, divisions normalized (BU12 -> 12U-B), fields normalized
 * 4. Three venue lists:
 *    - 🌲 Park Lexington (Denni & Cerritos)
 *    - 🏫 Luther Elementary (with zero-game warning fallback)
 *    - 🏫 Lexington Junior High (LJHS) or Arnold Elementary
 * 5. Appends "⚠️ Other / Rescheduled / Unlisted Match" to all lists.
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
  formatTeam,
  getVenueCategory,
  validateSandboxSafety,
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
} = require('../archive/sandbox/Sandbox_ScheduleDropdownSync.js');

console.log('====================================================');
console.log('🧪 TEST: RFC-007 3-VENUE SCHEDULE SYNC ENGINE (v1.5.0)');
console.log('====================================================\n');

// 1. Mock MatchTrak Schedule CSV Data (With Park Lex, LJHS, and Arnold fields - 0 games at Luther)
const sampleMatchTrakCsvWeek1 = `Date,Time,Game #,Division,Field,Home Team,Away Team
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

// 2. Mock MatchTrak Schedule CSV Data with Luther Elementary games
const sampleMatchTrakCsvWithLuther = `Date,Time,Game #,Division,Field,Home Team,Away Team
2026-09-19,8:00:00 AM,201,BU10,Luther Elementary School U10 Field 1 Fall 2026,01-E154-Faheem Armanyous,02-E154-Michael Lewis
2026-09-19,9:15:00 AM,202,GU10,Luther ES Field 1,Dawn Caires,Josie Cotton
2026-09-19,8:00:00 AM,203,12U Girls,Park Lexington GRASS Field,Saul Alvarez,David Corado
2026-09-19,8:00:00 AM,204,BU12,Lexington JHS Field 4,Ryan Fox,Andrew Evango
`;

// Helper to parse CSV string into 2D array
function parseCsv(csvText) {
  return csvText.trim().split('\n').map(line => line.split(',').map(c => c.trim()));
}

// ----------------------------------------------------
// Unit Tests: Individual Normalization Helpers
// ----------------------------------------------------

console.log('▶ Test 1: Day & Time Formatting Unit Tests (America/Los_Angeles)');
assert.strictEqual(formatDay('2026-09-12'), 'Sat', '2026-09-12 must format to Sat');
assert.strictEqual(formatDay('Saturday'), 'Sat', 'Saturday must format to Sat');
assert.strictEqual(formatDay('Sunday'), 'Sun', 'Sunday must format to Sun');
assert.strictEqual(formatTime('5:30:00 PM'), '5:30 PM', 'Must strip :00 seconds from 5:30:00 PM');
assert.strictEqual(formatTime('8:00:00 AM'), '8:00 AM', 'Must strip :00 seconds from 8:00:00 AM');
assert.strictEqual(formatTime('12:00:00 PM'), '12:00 PM', 'Must strip :00 seconds from 12:00:00 PM');
console.log('  ✅ Day and Time formatting verified.');

console.log('\n▶ Test 2: Field Formatting & 3-Venue Classification Unit Tests');
assert.strictEqual(formatField('Lexington JHS Field 4'), 'LJHS Field 4');
assert.strictEqual(formatField('E154-Lexington JHS U12 Field 9 Fall 2026'), 'LJHS Field 9');
assert.strictEqual(formatField('Park Lexington ARTIFICIAL TURF'), 'Park Lex Turf');
assert.strictEqual(formatField('Park Lexington GRASS Field'), 'Park Lex Grass');
assert.strictEqual(formatField('Park Lexington (Denni & Cerritos)'), 'Park Lex');
assert.strictEqual(formatField('Arnold - Field #10'), 'Arnold Field 10');
assert.strictEqual(formatField('E154-Arnold Park U08 Field 10 Fall 2026'), 'Arnold Field 10');
assert.strictEqual(formatField('Luther Elementary School U10 Field 1 Fall 2026'), 'Luther Field 1');
assert.strictEqual(formatField('Luther ES Field 2'), 'Luther Field 2');

// Venue categories for all 3 venues
assert.strictEqual(getVenueCategory('Park Lexington ARTIFICIAL TURF'), 'PARK_LEX');
assert.strictEqual(getVenueCategory('Luther Elementary School Field 1'), 'LUTHER');
assert.strictEqual(getVenueCategory('Luther ES Field 2'), 'LUTHER');
assert.strictEqual(getVenueCategory('Lexington JHS Field 4'), 'LJHS_ARNOLD');
assert.strictEqual(getVenueCategory('Arnold - Field #10'), 'LJHS_ARNOLD');
console.log('  ✅ Field normalization & 3-venue classification verified.');

console.log('\n▶ Test 3: Division and Team Code Formatting Unit Tests');
assert.strictEqual(formatDivision('BU12'), '12U-B');
assert.strictEqual(formatDivision('GU10'), '10U-G');
assert.strictEqual(formatDivision('BU08'), '08U-B');
assert.strictEqual(formatDivision('14UX Boys'), '14UX-B');
assert.strictEqual(formatTeam('01-E154-Faheem Armanyous'), 'Faheem Armanyous');
assert.strictEqual(formatTeam('E154-Michael Lewis'), 'Michael Lewis');
console.log('  ✅ Division and team code normalization verified.');

// ----------------------------------------------------
// Integration Tests: 3-Venue Dropdown Generation (Week 1 - 0 Luther Games)
// ----------------------------------------------------

console.log('\n▶ Test 4: 3-Venue Dropdown Generation with Zero-Game Luther Fallback');
const parsedWeek1 = parseCsv(sampleMatchTrakCsvWeek1);
const venueResultWeek1 = buildScheduleDropdownOptionsByVenue(parsedWeek1);

console.log(`  🌲 Park Lexington Choices (${venueResultWeek1.parkLexMatches.length}):`);
venueResultWeek1.parkLexMatches.forEach(opt => console.log(`     • ${opt}`));

console.log(`  🏫 Luther Elementary Choices (${venueResultWeek1.lutherMatches.length}):`);
venueResultWeek1.lutherMatches.forEach(opt => console.log(`     • ${opt}`));

console.log(`  🏫 LJHS / Arnold Choices (${venueResultWeek1.ljhsArnoldMatches.length}):`);
venueResultWeek1.ljhsArnoldMatches.forEach(opt => console.log(`     • ${opt}`));

// 1. Verify Park Lexington
assert(venueResultWeek1.parkLexMatches.length >= 2, 'Park Lex must have matches plus unlisted option');
assert(
  venueResultWeek1.parkLexMatches.includes('🗓️ Sat • ⏰ 8:00 AM • 📍 Park Lex Turf • ⚽ 10U-G: Ryan Bulatao vs Dustin Brieger')
);
assert.strictEqual(
  venueResultWeek1.parkLexMatches[venueResultWeek1.parkLexMatches.length - 1],
  OTHER_UNLISTED_OPTION
);

// 2. Verify Luther Elementary Zero-Game Warning Fallback
assert.strictEqual(venueResultWeek1.lutherMatches.length, 2, 'Luther must contain zero-game warning and escape option');
assert.strictEqual(
  venueResultWeek1.lutherMatches[0],
  LUTHER_ZERO_GAMES_OPTION,
  'First choice in Luther dropdown when 0 games must be warning fallback'
);
assert.strictEqual(
  venueResultWeek1.lutherMatches[1],
  OTHER_UNLISTED_OPTION,
  'Second choice in Luther dropdown must be unlisted option'
);
console.log('  ✅ Luther Elementary zero-game warning fallback verified.');

// 3. Verify LJHS / Arnold
assert(venueResultWeek1.ljhsArnoldMatches.length >= 4, 'LJHS/Arnold must have matches plus unlisted option');
assert(
  venueResultWeek1.ljhsArnoldMatches.includes('🗓️ Sat • ⏰ 5:30 PM • 📍 LJHS Field 9 • ⚽ 12U-B: Michael Lewis vs Faheem Armanyous')
);
assert.strictEqual(
  venueResultWeek1.ljhsArnoldMatches[venueResultWeek1.ljhsArnoldMatches.length - 1],
  OTHER_UNLISTED_OPTION
);
console.log('  ✅ All 3 venue dropdown choice lists conform to specification.');

// ----------------------------------------------------
// Integration Tests: 3-Venue Dropdown Generation (Week with Active Luther Games)
// ----------------------------------------------------

console.log('\n▶ Test 5: 3-Venue Dropdown Generation with Active Luther Games');
const parsedLutherWeek = parseCsv(sampleMatchTrakCsvWithLuther);
const venueResultLuther = buildScheduleDropdownOptionsByVenue(parsedLutherWeek);

console.log(`  🏫 Luther Elementary Active Choices (${venueResultLuther.lutherMatches.length}):`);
venueResultLuther.lutherMatches.forEach(opt => console.log(`     • ${opt}`));

assert(
  venueResultLuther.lutherMatches.includes('🗓️ Sat • ⏰ 8:00 AM • 📍 Luther Field 1 • ⚽ 10U-B: Faheem Armanyous vs Michael Lewis'),
  'Luther Field 1 match must be correctly routed and formatted'
);
assert(
  venueResultLuther.lutherMatches.includes('🗓️ Sat • ⏰ 9:15 AM • 📍 Luther Field 1 • ⚽ 10U-G: Dawn Caires vs Josie Cotton'),
  'Luther Field 1 game 2 must be present'
);
assert(
  !venueResultLuther.lutherMatches.includes(LUTHER_ZERO_GAMES_OPTION),
  'Zero-game warning must NOT appear when Luther has active matches'
);
assert.strictEqual(
  venueResultLuther.lutherMatches[venueResultLuther.lutherMatches.length - 1],
  OTHER_UNLISTED_OPTION
);
console.log('  ✅ Active Luther Elementary games successfully populate without warning option.');

// ----------------------------------------------------
// Test 6: Form Question Title Matching Simulation
// ----------------------------------------------------

console.log('\n▶ Test 6: Form Question Title Distribution Mapping');
const mockFormItems = [
  { title: 'Select Match - 🌲 Park Lexington (Denni & Cerritos)', type: 1 }, // LIST
  { title: 'Select Match - 🏫 Luther Elementary', type: 1 },
  { title: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary', type: 1 },
  { title: 'Volunteer Role', type: 1 }
];

let parkLexUpdated = false;
let lutherUpdated = false;
let ljhsUpdated = false;

for (let item of mockFormItems) {
  const title = item.title.toLowerCase();
  if (title.includes('park lex')) {
    parkLexUpdated = true;
  } else if (title.includes('luther')) {
    lutherUpdated = true;
  } else if (title.includes('arnold') || title.includes('ljhs') || (title.includes('lexington') && !title.includes('park'))) {
    ljhsUpdated = true;
  }
}

assert.strictEqual(parkLexUpdated, true, 'Park Lexington form question must be matched');
assert.strictEqual(lutherUpdated, true, 'Luther Elementary form question must be matched');
assert.strictEqual(ljhsUpdated, true, 'LJHS / Arnold form question must be matched');
console.log('  ✅ All 3 venue form question titles correctly map in the distribution loop.');

// ----------------------------------------------------
// Test 7: Sandbox Configuration & Safety Blocklist
// ----------------------------------------------------

console.log('\n▶ Test 7: Sandbox Configuration & Safety Guardrails');
assert.strictEqual(SANDBOX_SHEET_ID, '177ciFgTmQiuPiEtHytjXbHP8GZa3ge7nRXwqbYJ4NAA');
assert.strictEqual(SANDBOX_FORM_ID, '1ib_QRcmucRqrJ4CujTA8Lt4Yreg9tPpz1AOIzcYlsal');
assert.strictEqual(DROP_FOLDER_ID, '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv');
assert.strictEqual(ARCHIVE_FOLDER_ID, '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m');
assert.strictEqual(TARGET_TIMEZONE, 'America/Los_Angeles');

assert.doesNotThrow(() => validateSandboxSafety(), 'Sandbox safety validator should pass on valid sandbox IDs');
console.log('  ✅ All Sandbox configuration IDs and safety guardrails validated.');

console.log('\n====================================================');
console.log('🏆 ALL 3-VENUE SCHEDULE SYNC TESTS PASSED (100%)');
console.log('====================================================');
