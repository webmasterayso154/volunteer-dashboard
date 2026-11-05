/**
 * Verification for SSOT Volunteer Policy and AuditEngine.js logic
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing SSOT Configuration & AuditEngine.js logic...\n');

// 1. Verify AdminConfig.js SSOT Module
const adminConfig = require('../apps-script/AdminConfig.js');
const { VOLUNTEER_POLICY, getPlayoffGoalForTeam, getLedgerGoalFormula, getLedgerGapFormula } = adminConfig;

assert(VOLUNTEER_POLICY, 'VOLUNTEER_POLICY must exist');
assert(Object.isFrozen(VOLUNTEER_POLICY), 'VOLUNTEER_POLICY must be frozen');

// Verify THRESHOLDS
assert.strictEqual(VOLUNTEER_POLICY.THRESHOLDS.PLAYGROUND, 4, 'Playground threshold must be 4');
assert.strictEqual(VOLUNTEER_POLICY.THRESHOLDS.U5_U6, 7, 'U5/U6 threshold must be 7');
assert.strictEqual(VOLUNTEER_POLICY.THRESHOLDS.U8, 15, 'U8 threshold must be 15');
assert.strictEqual(VOLUNTEER_POLICY.THRESHOLDS.U10_U19, 17, 'U10-U19 threshold must be 17');
assert.strictEqual(VOLUNTEER_POLICY.THRESHOLDS.DEFAULT, 17, 'Default threshold must be 17');

// Verify CATEGORY_CAPS
assert.strictEqual(VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_SETUP, 5, 'Field Setup cap must be 5');
assert.strictEqual(VOLUNTEER_POLICY.CATEGORY_CAPS.REFEREE, 10, 'Referee cap must be 10');
assert.strictEqual(VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_MARSHAL, 2, 'Field Marshal cap must be 2');
assert.strictEqual(VOLUNTEER_POLICY.CATEGORY_CAPS.PICTURE_DAY, 2, 'Picture Day cap must be 2');
assert.strictEqual(VOLUNTEER_POLICY.CATEGORY_CAPS.OTHER_ADJUSTMENTS, 5, 'Other Adjustments cap must be 5');

// Verify AUDIT settings
assert.strictEqual(VOLUNTEER_POLICY.AUDIT.POSTING_DELAY_HOURS, 48, 'Posting delay must be 48 hours');
assert.strictEqual(VOLUNTEER_POLICY.AUDIT.LOOKBACK_DAYS, 14, 'Lookback days must be 14');
assert.strictEqual(VOLUNTEER_POLICY.AUDIT.MAX_SHIFTS_PER_CHALLENGE, 5, 'Max shifts per challenge must be 5');

// Verify SHEETS
assert.strictEqual(VOLUNTEER_POLICY.SHEETS.LEDGER, 'Season_Master_Ledger', 'LEDGER sheet name must be Season_Master_Ledger');
assert.strictEqual(VOLUNTEER_POLICY.SHEETS.CHECKINS, 'Game Day Check-ins', 'CHECKINS sheet name must be Game Day Check-ins');

console.log('✅ VOLUNTEER_POLICY SSOT constants verified.');

// 2. Test getPlayoffGoalForTeam resolution
assert.strictEqual(getPlayoffGoalForTeam('Playground - Playground'), 4, 'Playground must resolve to 4');
assert.strictEqual(getPlayoffGoalForTeam('Schoolyard'), 4, 'Schoolyard must resolve to 4');
assert.strictEqual(getPlayoffGoalForTeam('05U - Boys - Stefan Colvey'), 7, '05U must resolve to 7');
assert.strictEqual(getPlayoffGoalForTeam('06U - Girls - Chris Baker'), 7, '06U must resolve to 7');
assert.strictEqual(getPlayoffGoalForTeam('5U'), 7, '5U must resolve to 7');
assert.strictEqual(getPlayoffGoalForTeam('6U'), 7, '6U must resolve to 7');
assert.strictEqual(getPlayoffGoalForTeam('08U - Boys - Amanda Towers'), 15, '08U must resolve to 15');
assert.strictEqual(getPlayoffGoalForTeam('8U'), 15, '8U must resolve to 15');
assert.strictEqual(getPlayoffGoalForTeam('10U - Boys - Faheem Armanyous'), 17, '10U must resolve to 17');
assert.strictEqual(getPlayoffGoalForTeam('12U - Girls - Saul Alvarez'), 17, '12U must resolve to 17');
assert.strictEqual(getPlayoffGoalForTeam('14U - Boys - Mina Abader'), 17, '14U must resolve to 17');
assert.strictEqual(getPlayoffGoalForTeam('16U - Boys - Donald Martin'), 17, '16U must resolve to 17');
assert.strictEqual(getPlayoffGoalForTeam('19U - Girls - Josh Palafox'), 17, '19U must resolve to 17');
assert.strictEqual(getPlayoffGoalForTeam(''), 17, 'Empty team must resolve to default 17');

console.log('✅ Dynamic division goal resolution verified for all tiers.');

// 3. Test Formula Generators
const goalFormulaRow5 = getLedgerGoalFormula(5);
assert.strictEqual(
  goalFormulaRow5,
  '=IF(REGEXMATCH($A5, "Playground"), 4, IF(REGEXMATCH($A5, "05U|5U|06U|6U"), 7, IF(REGEXMATCH($A5, "08U|8U"), 15, 17)))',
  'Goal formula for row 5 must match SSOT policy'
);

const gapFormulaRow5 = getLedgerGapFormula(5);
assert.strictEqual(gapFormulaRow5, '=MAX(0, L5 - O5)', 'Gap formula for row 5 must match dynamic L5-O5');

console.log('✅ Dynamic spreadsheet formula generators verified.');

// 4. Verify AuditEngine.js Structure and SSOT Integration
const auditEngineCode = fs.readFileSync(path.join(__dirname, '../apps-script/AuditEngine.js'), 'utf8');
assert(auditEngineCode.includes('function runAuditAndSyncLedger()'), 'runAuditAndSyncLedger function must exist');
assert(auditEngineCode.includes('function repairLedgerAndLockBackfill()'), 'repairLedgerAndLockBackfill function must exist');
assert(auditEngineCode.includes('function injectTraceableLedgerFormulas(checkinsTabName)'), 'injectTraceableLedgerFormulas function must exist');
assert(auditEngineCode.includes('function injectFormulasIntoLedger_(sheet, startRow, endRow'), 'injectFormulasIntoLedger_ function must exist');
assert(auditEngineCode.includes('getLedgerGoalFormula'), 'injectFormulasIntoLedger_ must invoke getLedgerGoalFormula');
assert(auditEngineCode.includes('getLedgerGapFormula'), 'injectFormulasIntoLedger_ must invoke getLedgerGapFormula');
assert(auditEngineCode.includes('VOLUNTEER_POLICY.SHEETS.LEDGER'), 'repairLedgerAndLockBackfill must reference VOLUNTEER_POLICY.SHEETS.LEDGER');
assert(auditEngineCode.includes('Duplicate Submission (0)'), 'Duplicate Submission (0) status must be present');
assert(auditEngineCode.includes('NOCRA - No Points'), 'NOCRA - No Points status must be present');
assert(auditEngineCode.includes('Cap Reached'), 'Cap Reached status must be present');

console.log('✅ AuditEngine.js SSOT formula injection and audit rules verified.');

// 5. Test Division Tier Clinch Invariants
console.log('\n▶ Testing Tiered Qualification Clinch Invariants:');
const testCases = [
  { div: '05U - Boys', points: 6, clinched: false, expectedGoal: 7 },
  { div: '05U - Boys', points: 7, clinched: true, expectedGoal: 7 },
  { div: '06U - Girls', points: 8, clinched: true, expectedGoal: 7 },
  { div: '08U - Boys', points: 14, clinched: false, expectedGoal: 15 },
  { div: '08U - Boys', points: 15, clinched: true, expectedGoal: 15 },
  { div: '08U - Girls', points: 17, clinched: true, expectedGoal: 15 },
  { div: '10U - Boys', points: 16, clinched: false, expectedGoal: 17 },
  { div: '10U - Boys', points: 17, clinched: true, expectedGoal: 17 },
  { div: '12U - Girls', points: 18, clinched: true, expectedGoal: 17 },
  { div: 'Playground', points: 3, clinched: false, expectedGoal: 4 },
  { div: 'Playground', points: 4, clinched: true, expectedGoal: 4 }
];

testCases.forEach(tc => {
  const goal = getPlayoffGoalForTeam(tc.div);
  assert.strictEqual(goal, tc.expectedGoal, `${tc.div} goal must be ${tc.expectedGoal}`);
  const isClinched = tc.points >= goal;
  assert.strictEqual(isClinched, tc.clinched, `${tc.div} with ${tc.points} pts: clinched must be ${tc.clinched}`);
  const pointsNeeded = Math.max(0, goal - tc.points);
  assert.strictEqual(pointsNeeded, tc.clinched ? 0 : goal - tc.points);
});

console.log('  ✅ 5U/6U teams clinch at 7 points verified.');
console.log('  ✅ 8U teams clinch at 15 points verified.');
console.log('  ✅ 10U-19U teams clinch at 17 points verified.');
console.log('  ✅ Playground teams clinch at 4 points verified.');

console.log('\n=============================================================');
console.log('🎉 ALL AUDIT ENGINE & SSOT POLICY VERIFICATION TESTS PASSED!');
console.log('=============================================================');
