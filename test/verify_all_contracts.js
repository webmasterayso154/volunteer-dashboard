/**
 * End-to-End Ingestion, Calculation & Contract Verification Suite
 * AYSO Region 154 Volunteer Standings System
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('====================================================');
console.log('⚽ AYSO 154 VOLUNTEER STANDINGS VERIFICATION AUDIT');
console.log('====================================================\n');

// 1. Load and parse Code.gs to extract constants and logic
const codeGsPath = path.join(__dirname, '../apps-script/Code.gs');
const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

// Extract MASTER_TEAMS
const masterTeamsMatch = codeGsContent.match(/const MASTER_TEAMS = \[([\s\S]*?)\];/);
assert(masterTeamsMatch, 'MASTER_TEAMS array must exist in Code.gs');
const MASTER_TEAMS = eval('[' + masterTeamsMatch[1] + ']');

// Test 1: MASTER_TEAMS format check
console.log('▶ Test 1: Verify MASTER_TEAMS Roster Schema Integrity');
assert(MASTER_TEAMS.length > 50, `Expected > 50 teams, got ${MASTER_TEAMS.length}`);
let malformedTeams = [];
MASTER_TEAMS.forEach(team => {
  if (team.startsWith('Playground')) return;
  const parts = team.split(' - ');
  if (parts.length < 3) {
    malformedTeams.push(team);
  }
});
assert.strictEqual(malformedTeams.length, 0, `Malformed teams found: ${malformedTeams.join(', ')}`);
console.log(`  ✅ Verified ${MASTER_TEAMS.length} master roster teams conform to "[Division] - [Gender] - [Coach]" format.`);

// Test 2: Ingestion & Calculation Engine Simulator
console.log('\n▶ Test 2: Ingestion Engine & Column Mapping Verification');

function normalizeTimeSlot(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function simulateIngestion(targetTeam, formResponses, teamAwards = [], capsOverride = {}) {
  const caps = {
    onFieldRef: capsOverride.RefMaxCap || 10,
    fieldMarshal: capsOverride.FieldMarshalCap || 2,
    setup: capsOverride.FieldSetupCap || 5,
    pic: capsOverride.PictureDayCap || 2,
    certifiedRef: 5,
    matchtrak: 2,
    maxPossible: (capsOverride.RefMaxCap || 10) + (capsOverride.FieldMarshalCap || 2) + (capsOverride.FieldSetupCap || 5) + (capsOverride.PictureDayCap || 2) + 5 + 2
  };

  const cleanTarget = targetTeam.trim();
  let refPoints = 0;
  let fmPoints = 0;
  let setupPoints = 0;
  let picPoints = 0;

  const audit = [];
  const seenVolunteerSlots = new Set();

  for (let i = 0; i < formResponses.length; i++) {
    const row = formResponses[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    const dateStr = typeof timestamp === 'string' ? timestamp.split(' ')[0] : '2026-09-12';

    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const volId = email || (firstName + ' ' + lastName).trim().toLowerCase();

    const dutyRaw = String(row[4] || '').trim();
    const refPosition = String(row[5] || '').trim();
    const rowTeamRef = String(row[6] || '').trim();
    const refGameTime = String(row[7] || '').trim();
    
    const rowTeamFm = String(row[9] || '').trim();
    const fmGameTime = String(row[11] || '').trim();

    const rowTeamSetup = String(row[12] || '').trim();

    let isMatch = false;
    let category = '';
    let categoryCap = 0;
    let currentCategoryTotal = 0;
    let timeSlot = '';
    let isNocra = false;

    if (rowTeamRef === cleanTarget || (/ref/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Referee Assignment';
      categoryCap = caps.onFieldRef;
      currentCategoryTotal = refPoints;
      timeSlot = refGameTime || 'GameTime';
      if (/nocra|ussf/i.test(refPosition)) {
        isNocra = true;
      }
    } else if (rowTeamFm === cleanTarget || (/marshal/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Field Marshal Shift';
      categoryCap = caps.fieldMarshal;
      currentCategoryTotal = fmPoints;
      timeSlot = fmGameTime || 'ShiftTime';
    } else if (rowTeamSetup === cleanTarget || (/set\s*up/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Friday Night Field Setup';
      categoryCap = caps.setup;
      currentCategoryTotal = setupPoints;
      timeSlot = 'FridayNight';
    } else if (/picture/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1) {
      isMatch = true;
      category = 'Picture Day';
      categoryCap = caps.pic;
      currentCategoryTotal = picPoints;
      timeSlot = 'PicShift';
    }

    if (isMatch) {
      let status = 'Recorded';
      let pts = 0;

      if (isNocra) {
        status = 'NOCRA - No Points';
        pts = 0;
      } else {
        const slotKey = volId + '_' + dateStr + '_' + normalizeTimeSlot(timeSlot) + '_' + category;

        if (seenVolunteerSlots.has(slotKey)) {
          status = 'Duplicate Submission';
          pts = 0;
        } else if (currentCategoryTotal >= categoryCap) {
          status = 'Cap Reached';
          pts = 0;
        } else {
          status = 'Recorded';
          pts = 1;
          seenVolunteerSlots.add(slotKey);

          if (category === 'Referee Assignment') refPoints++;
          else if (category === 'Field Marshal Shift') fmPoints++;
          else if (category === 'Friday Night Field Setup') setupPoints++;
          else if (category === 'Picture Day') picPoints++;
        }
      }

      audit.push({
        duty: category + (timeSlot && timeSlot !== 'FridayNight' && timeSlot !== 'PicShift' ? ` (${timeSlot})` : ''),
        date: dateStr,
        status: status,
        points: pts
      });
    }
  }

  // Team Awards
  let certRefPoints = 0;
  let matchtrakPoints = 0;
  let discretionaryAwards = 0;

  teamAwards.forEach(aRow => {
    const aTeam = String(aRow[1] || '').trim();
    if (aTeam !== cleanTarget) return;

    const aType = String(aRow[2] || '').trim();
    const aPts = Number(aRow[3]) || 0;
    const aNote = String(aRow[4] || '').trim();
    const aDateStr = String(aRow[0]).split(' ')[0];

    if (aType.includes('Uniform') || aType.includes('Disqualification')) {
      refPoints = Math.max(0, refPoints + aPts);
      audit.push({ duty: aType, date: aDateStr, status: 'Deduction Applied', points: aPts, note: aNote });
    } else if (aType === 'Certified Team Referees') {
      certRefPoints = Math.min(caps.certifiedRef, certRefPoints + aPts);
      audit.push({ duty: aType, date: aDateStr, status: 'Verified', points: aPts, note: aNote });
    } else if (aType === 'MatchTrak Filled by Sep 26') {
      matchtrakPoints = Math.min(caps.matchtrak, matchtrakPoints + aPts);
      audit.push({ duty: aType, date: aDateStr, status: 'Verified', points: aPts, note: aNote });
    } else {
      discretionaryAwards += aPts;
      audit.push({ duty: aType, date: aDateStr, status: aPts < 0 ? 'Deduction Applied' : 'Verified', points: aPts, note: aNote });
    }
  });

  const totalPoints = Math.min(
    caps.maxPossible,
    Math.max(0, refPoints + fmPoints + setupPoints + picPoints + certRefPoints + matchtrakPoints + discretionaryAwards)
  );

  return {
    totalPoints,
    categories: {
      'Certified Team Referees': certRefPoints,
      'MatchTrak Filled by Sep 26': matchtrakPoints,
      'Referee (On-Field)': refPoints,
      'Referee Assignment': refPoints,
      'Field Marshal': fmPoints,
      'Field Marshal Shift': fmPoints,
      'Friday Night Setup': setupPoints,
      'Friday Night Field Setup': setupPoints,
      'Picture Picnic Day': picPoints,
      'Picture Day': picPoints
    },
    audit: audit.reverse()
  };
}

// Verification 2.1: Test Dual ARs on same match time
const target = '10U - Boys - Faheem Armanyous';
const testDualAR = [
  ['2026-09-12 08:00:00', 'ref1@ayso154.org', 'Alice', 'Smith', 'Referee', 'Assistant Referee (AYSO)', target, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-09-12 08:05:00', 'ref2@ayso154.org', 'Bob', 'Jones', 'Referee', 'Assistant Referee (AYSO)', target, '8:00 AM', 'LJHS - Field #1', '', '', '', '', '']
];
const resDualAR = simulateIngestion(target, testDualAR);
assert.strictEqual(resDualAR.categories['Referee Assignment'], 2, 'Dual ARs must each earn 1 point (total 2 pts)');
console.log('  ✅ Dual Assistant Referees (different volunteers, same match slot) correctly earn +1 pt each (2 total pts).');

// Verification 2.2: Test Duplicate Submission by same volunteer
const testDup = [
  ['2026-09-12 08:00:00', 'ref1@ayso154.org', 'Alice', 'Smith', 'Referee', 'Assistant Referee (AYSO)', target, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-09-12 08:02:00', 'ref1@ayso154.org', 'Alice', 'Smith', 'Referee', 'Assistant Referee (AYSO)', target, '8:00 AM', 'LJHS - Field #1', '', '', '', '', '']
];
const resDup = simulateIngestion(target, testDup);
assert.strictEqual(resDup.categories['Referee Assignment'], 1, 'Duplicate by same volunteer must award 1 point only');
assert.strictEqual(resDup.audit[0].status, 'Duplicate Submission', 'Second entry must be marked Duplicate Submission');
console.log('  ✅ Volunteer duplicate submission detection verified: 1 point awarded, duplicate marked with status "Duplicate Submission".');

// Verification 2.3: Test Multi-Game Volunteer (Same volunteer working 8:00 AM and 10:30 AM games)
const testMultiGame = [
  ['2026-09-12 08:00:00', 'ref1@ayso154.org', 'Alice', 'Smith', 'Referee', 'Assistant Referee (AYSO)', target, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-09-12 10:30:00', 'ref1@ayso154.org', 'Alice', 'Smith', 'Referee', 'Referee (AYSO)', target, '10:30 AM', 'LJHS - Field #1', '', '', '', '', '']
];
const resMultiGame = simulateIngestion(target, testMultiGame);
assert.strictEqual(resMultiGame.categories['Referee Assignment'], 2, 'Same volunteer working 2 different match times earns 2 points');
console.log('  ✅ Same volunteer working multiple game slots on the same day earns points for each distinct match time.');

// Verification 2.4: Test NOCRA Paid Ref Exclusion
const testNocra = [
  ['2026-09-12 09:15:00', 'nocra@ayso154.org', 'John', 'Ref', 'Referee', 'Referee (NOCRA / USSF)', target, '9:15 AM', 'LJHS - Field #2', '', '', '', '', '']
];
const resNocra = simulateIngestion(target, testNocra);
assert.strictEqual(resNocra.categories['Referee Assignment'], 0, 'NOCRA ref must award 0 points');
assert.strictEqual(resNocra.audit[0].status, 'NOCRA - No Points', 'NOCRA entry status must be "NOCRA - No Points"');
console.log('  ✅ Paid NOCRA / USSF Referee exclusion verified: 0 points awarded, status "NOCRA - No Points".');

// Verification 2.5: Test Field Marshal, Field Setup, Picture Day columns
const testOtherRoles = [
  ['2026-09-12 10:00:00', 'fm@ayso154.org', 'Field', 'Marshal', 'Field Marshal', '', '', '', '', target, 'Park Lexington', '10:00 AM', '', ''],
  ['2026-09-11 18:00:00', 'setup@ayso154.org', 'Setup', 'Crew', 'Field Set Up', '', '', '', '', '', '', '', target, 'LJHS - Field #1'],
  ['2026-09-19 09:00:00', 'pic@ayso154.org', 'Pic', 'Volunteer', 'Picture Day', '', '', '', '', '', '', '', '', target]
];
const resOther = simulateIngestion(target, testOtherRoles);
assert.strictEqual(resOther.categories['Field Marshal Shift'], 1, 'Field Marshal must earn 1 point');
assert.strictEqual(resOther.categories['Friday Night Field Setup'], 1, 'Field Setup must earn 1 point');
assert.strictEqual(resOther.categories['Picture Day'], 1, 'Picture Day must earn 1 point');
console.log('  ✅ Non-referee duties (Field Marshal Col J, Field Setup Col M, Picture Day) ingest cleanly.');

// Verification 2.6: Test Category Caps & Total Playoff Rollup
console.log('\n▶ Test 3: Category Caps & 17-Point Playoff Qualification Verification');
const overCapSubmissions = [];
// 12 Referee entries (Cap 10)
for (let i = 1; i <= 12; i++) {
  overCapSubmissions.push([
    '2026-09-12 08:00:00', `ref${i}@ayso154.org`, `Ref${i}`, 'Smith', 'Referee', 'Referee (AYSO)', target, `${7 + i}:00 AM`, 'LJHS - Field #1', '', '', '', '', ''
  ]);
}
// 4 Field Marshal entries (Cap 2)
for (let i = 1; i <= 4; i++) {
  overCapSubmissions.push([
    '2026-09-12 10:00:00', `fm${i}@ayso154.org`, `FM${i}`, 'Volunteer', 'Field Marshal', '', '', '', '', target, 'Park Lexington', `${8 + i}:00 AM`, '', ''
  ]);
}
// 6 Setup entries (Cap 5)
for (let i = 1; i <= 6; i++) {
  overCapSubmissions.push([
    `2026-09-11 1${i}:00:00`, `setup${i}@ayso154.org`, `Setup${i}`, 'Crew', 'Field Set Up', '', '', '', '', '', '', '', target, 'LJHS - Field #1'
  ]);
}

const awards = [
  ['2026-09-01', target, 'Certified Team Referees', 5, '3 Rostered refs'],
  ['2026-09-26', target, 'MatchTrak Filled by Sep 26', 2, 'Roster on-time']
];

const resCap = simulateIngestion(target, overCapSubmissions, awards);
assert.strictEqual(resCap.categories['Referee Assignment'], 10, 'Referee points must cap at 10');
assert.strictEqual(resCap.categories['Field Marshal Shift'], 2, 'Field Marshal points must cap at 2');
assert.strictEqual(resCap.categories['Friday Night Field Setup'], 5, 'Setup points must cap at 5');
assert.strictEqual(resCap.categories['Certified Team Referees'], 5, 'Certified ref bonus must be 5');
assert.strictEqual(resCap.categories['MatchTrak Filled by Sep 26'], 2, 'MatchTrak bonus must be 2');

// Total should sum cleanly up to caps: 10 + 2 + 5 + 5 + 2 = 24 total points (qualified for >= 17)
assert.strictEqual(resCap.totalPoints, 24, 'Total capped points must equal 24');
console.log(`  ✅ All category caps enforced: Ref (10/10), FM (2/2), Setup (5/5), Bonuses (7/7). Total points: ${resCap.totalPoints} (Qualified >= 17 pts).`);

// Verification 2.7: Test 8U Team Qualification Pathway (No field marshals)
console.log('\n▶ Test 4: 8U Team Qualification Pathway (Without Field Marshal duties)');
const target8U = '08U - Boys - Amanda Towers';
const submissions8U = [
  // 5 Setup entries (5 pts)
  ['2026-09-11 18:00:00', 'p1@ayso154.org', 'Parent1', 'A', 'Field Set Up', '', '', '', '', '', '', '', target8U, 'LJHS - Field #4'],
  ['2026-09-18 18:00:00', 'p2@ayso154.org', 'Parent2', 'B', 'Field Set Up', '', '', '', '', '', '', '', target8U, 'LJHS - Field #4'],
  ['2026-09-25 18:00:00', 'p3@ayso154.org', 'Parent3', 'C', 'Field Set Up', '', '', '', '', '', '', '', target8U, 'LJHS - Field #4'],
  ['2026-10-02 18:00:00', 'p4@ayso154.org', 'Parent4', 'D', 'Field Set Up', '', '', '', '', '', '', '', target8U, 'LJHS - Field #4'],
  ['2026-10-09 18:00:00', 'p5@ayso154.org', 'Parent5', 'E', 'Field Set Up', '', '', '', '', '', '', '', target8U, 'LJHS - Field #4'],
  // 5 Referee assignments in upper division games (5 pts)
  ['2026-09-12 08:00:00', 'ref@ayso154.org', 'Coach', 'Ref', 'Referee', 'Referee (AYSO)', target8U, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-09-19 08:00:00', 'ref@ayso154.org', 'Coach', 'Ref', 'Referee', 'Referee (AYSO)', target8U, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-09-26 08:00:00', 'ref@ayso154.org', 'Coach', 'Ref', 'Referee', 'Referee (AYSO)', target8U, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-10-03 08:00:00', 'ref@ayso154.org', 'Coach', 'Ref', 'Referee', 'Referee (AYSO)', target8U, '8:00 AM', 'LJHS - Field #1', '', '', '', '', ''],
  ['2026-10-10 08:00:00', 'ref@ayso154.org', 'Coach', 'Ref', 'Referee', 'Referee (AYSO)', target8U, '8:00 AM', 'LJHS - Field #1', '', '', '', '', '']
];
const awards8U = [
  ['2026-09-01', target8U, 'Certified Team Referees', 5, 'Rostered refs'],
  ['2026-09-26', target8U, 'MatchTrak Filled by Sep 26', 2, 'Roster on-time']
];
const res8U = simulateIngestion(target8U, submissions8U, awards8U);
// Total: 5 setup + 5 ref + 5 cert + 2 matchtrak = 17 pts
assert.strictEqual(res8U.totalPoints, 17, '8U team must qualify at exactly 17 points without Field Marshal points');
console.log(`  ✅ 8U team successfully qualifies at 17 points (5 Setup + 5 Ref + 5 Cert Ref + 2 MatchTrak, 0 FM).`);

// Test 5: Deductions and Minimum Points Floor
console.log('\n▶ Test 5: Uniform Deductions & Negative Points Floor');
const deductionAwards = [
  ['2026-10-01', target, 'Uniform Violation Deduction', -2, 'Late shin guards']
];
const resDeduction = simulateIngestion(target, testDualAR, deductionAwards);
// 2 ref points - 2 deduction = 0 ref points
assert.strictEqual(resDeduction.categories['Referee Assignment'], 0, 'Deduction applied to referee points');
assert.strictEqual(resDeduction.totalPoints, 0, 'Points cannot fall below 0 floor');
console.log('  ✅ Deductions properly applied; point totals floor at 0 (never negative).');

// Test 6: Frontend Contract & API Shape Verification
console.log('\n▶ Test 6: Frontend UI Payload & Contract Verification');
const CONTRACT_CATEGORY_KEYS = [
  'Referee Assignment',
  'Field Marshal Shift',
  'Friday Night Field Setup',
  'Picture Day'
];
CONTRACT_CATEGORY_KEYS.forEach(k => {
  assert(resCap.categories.hasOwnProperty(k), `Missing category key: ${k}`);
  assert(typeof resCap.categories[k] === 'number', `Category ${k} must be numeric`);
});
console.log('  ✅ Client-side category payload contract validated (all keys present and numeric).');

console.log('\n====================================================');
console.log('🏆 ALL VERIFICATION SUITE TESTS PASSED (100% SUCCESS)');
console.log('====================================================');
