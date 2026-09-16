/**
 * Unit & Integration Test Suite for Sandbox Schedule Dropdown Sync
 * AYSO Region 154 Volunteer Standings System
 */

const assert = require('assert');
const { buildScheduleDropdownOptions, SANDBOX_FORM_ID, PRODUCTION_FORM_ID_BLOCKLIST } = require('../apps-script/Sandbox_ScheduleDropdownSync.js');

console.log('====================================================');
console.log('🧪 TEST: SANDBOX SCHEDULE DROPDOWN SYNC ENGINE');
console.log('====================================================\n');

// 1. Mock Schedule CSV Data (Simulating a Saturday match schedule)
const sampleScheduleCsv = `MatchID,Date,Game Time,Field,Division,Home,Away
M101,2026-09-12,8:00 AM,LJHS - Field #1,10U Boys,Michael Lewis,Faheem Armanyous
M102,2026-09-12,9:15 AM,LJHS - Field #1,10U Boys,Ryan Bulatao,Dustin Brieger
M103,2026-09-12,10:30 AM,LJHS - Field #1,10U Boys,Andrew Evango,Harold Huang
M104,2026-09-12,8:00 AM,LJHS - Field #2,12U Girls,Saul Alvarez,David Corado
M105,2026-09-12,9:30 AM,LJHS - Field #2,12U Girls,Carlos Cruz,Fernando Huerta
M106,2026-09-12,8:00 AM,Arnold - Field #10,08U Boys,Amanda Towers,Casey Harpham
M107,2026-09-12,9:15 AM,Arnold - Field #10,08U Boys,Roberto Rojas,Juan Rodriguez
M108,2026-09-12,8:00 AM,LJHS - Field #1,10U Boys,Michael Lewis,Faheem Armanyous
M109,2026-09-12,,LJHS - Field #3,10U Girls,Dawn Caires,Josie Cotton
M110,2026-09-12,11:00 AM,,14U Boys,Mina Abader,Ernie Solano
M111,2026-09-12,1:00 PM,LJHS - Field #4,14UX Boys,Christian Villalobos,
`;

// Helper to parse CSV string into 2D array
function parseCsv(csvText) {
  return csvText.trim().split('\n').map(line => line.split(',').map(c => c.trim()));
}

const parsedSchedule = parseCsv(sampleScheduleCsv);

// Test 1: Dropdown Option Generation and Format
console.log('▶ Test 1: Dropdown Choice Generation Format');
const options = buildScheduleDropdownOptions(parsedSchedule);

assert(options.length > 0, 'Options list should not be empty');
console.log(`  Generated ${options.length} dropdown options from ${parsedSchedule.length - 1} input rows:`);
options.forEach(opt => console.log(`   • ${opt}`));

// Verify format of first entry: "[LJHS - Field #1] 8:00 AM — 10U Boys (Michael Lewis vs Faheem Armanyous)"
assert.strictEqual(
  options[0],
  '[LJHS - Field #1] 8:00 AM — 10U Boys (Michael Lewis vs Faheem Armanyous)',
  'First choice format mismatch'
);
console.log('  ✅ Dropdown string format conforms to "[Field] Time — Division (Home vs Away)".');

// Test 2: Sanitization of Missing Time / Missing Field Rows
console.log('\n▶ Test 2: Sanitization of Incomplete Schedule Rows');
// M109 has empty time, M110 has empty field. Neither should appear in options.
const hasEmptyTime = options.some(opt => opt.includes('Dawn Caires'));
const hasEmptyField = options.some(opt => opt.includes('Mina Abader'));
assert.strictEqual(hasEmptyTime, false, 'Rows with missing Game Time must be sanitized/skipped');
assert.strictEqual(hasEmptyField, false, 'Rows with missing Field must be sanitized/skipped');
console.log('  ✅ Rows missing Game Time or Field are safely filtered out.');

// Test 3: Deduplication of Duplicate Matches
console.log('\n▶ Test 3: Deduplication of Identical Match Entries');
// M101 and M108 are exact duplicates: LJHS - Field #1 at 8:00 AM (Michael Lewis vs Faheem Armanyous)
const duplicateMatches = options.filter(opt =>
  opt === '[LJHS - Field #1] 8:00 AM — 10U Boys (Michael Lewis vs Faheem Armanyous)'
);
assert.strictEqual(duplicateMatches.length, 1, 'Duplicate match rows must be deduplicated to a single choice');
console.log('  ✅ Exact duplicate matches are deduplicated to a single option.');

// Test 4: Single Team Matchup (e.g. Away team missing or Bye)
console.log('\n▶ Test 4: Single Team Matchup Handling (M111)');
const singleTeamChoice = options.find(opt => opt.includes('Christian Villalobos'));
assert(singleTeamChoice, 'Single team matchup should still generate a valid choice');
assert.strictEqual(
  singleTeamChoice,
  '[LJHS - Field #4] 1:00 PM — 14UX Boys (Christian Villalobos)',
  'Single team choice format mismatch'
);
console.log('  ✅ Single team/bye matchups format cleanly without trailing "vs".');

// Test 5: Production Form Blocklist and Safety Guardrails
console.log('\n▶ Test 5: Production Guardrail & Safety Checks');
assert(PRODUCTION_FORM_ID_BLOCKLIST.length >= 2, 'Production blocklist must contain protected IDs');
assert(SANDBOX_FORM_ID.includes('PASTE_SANDBOX_FORM_ID_HERE'), 'SANDBOX_FORM_ID must remain a placeholder');
console.log('  ✅ Production form IDs are strictly protected by blocklist guardrails.');

console.log('\n====================================================');
console.log('🏆 ALL SCHEDULE DROPDOWN SYNC TESTS PASSED (100%)');
console.log('====================================================');
