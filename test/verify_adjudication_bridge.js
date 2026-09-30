/**
 * Verification test suite for Hybrid Adjudication Bridge
 * (AYSO154_Playoff_Audit.js)
 */

const assert = require('assert');
const path = require('path');

console.log('Testing Hybrid Adjudication Bridge (AYSO154_Playoff_Audit.js)...\n');

// Load module
const auditModule = require(path.join(__dirname, '../apps-script/AYSO154_Playoff_Audit.js'));

assert(typeof auditModule.exportDisputeDossiersForGem === 'function', 'exportDisputeDossiersForGem must be a function');
assert(typeof auditModule.applyGemDecisionToTeamAwards === 'function', 'applyGemDecisionToTeamAwards must be a function');
assert(typeof auditModule.getTeamLedgerPreCheck_ === 'function', 'getTeamLedgerPreCheck_ must be a function');
assert(typeof auditModule.getUnadjudicatedDisputes === 'function', 'getUnadjudicatedDisputes must be a function');
assert(typeof auditModule.formatDisputeDossier === 'function', 'formatDisputeDossier must be a function');
assert(typeof auditModule.menuExportDisputeDossiers === 'function', 'menuExportDisputeDossiers must be a function');
assert(typeof auditModule.menuApplyGemDecision === 'function', 'menuApplyGemDecision must be a function');

console.log('✅ Functions exported successfully.');

// Test 1: Ledger Pre-Check Logic
console.log('\nTesting getTeamLedgerPreCheck_ with mock Season_Master_Ledger...');

const mockLedgerData = [
  [
    'Division', 'Team Code', 'Head Coach', 'Referee Points (Max 10)', 'Field Marshal Points (Max 2)',
    'Field Setup Points (Max 5)', 'Picture Day Points (Max 2)', 'Certified Ref Bonus (Max 5)',
    'MatchTrak Bonus (Max 2)', 'Other Adjustments', 'Total Verified Points', 'Playoff Goal',
    'Playoff Status', 'Last Audited'
  ],
  [
    '10U - Boys', '10U - Boys - Faheem Armanyous', 'Faheem Armanyous',
    10, 2, 4, 1, 0, 0, 0, 17, 17, 'Qualified', '2026-09-30 08:00'
  ],
  [
    '10U - Girls', '10U - Girls - Dawn Caires', 'Dawn Caires',
    6, 1, 2, 0, 2, 2, 0, 13, 17, '4 pts needed', '2026-09-30 08:00'
  ]
];

const mockMasterSs = {
  getSheetByName: function(name) {
    if (name === 'Season_Master_Ledger') {
      return {
        getLastRow: () => mockLedgerData.length,
        getDataRange: () => ({
          getValues: () => mockLedgerData
        })
      };
    }
    return null;
  }
};

// Check qualified team
const qualifiedCheck = auditModule.getTeamLedgerPreCheck_('10U - Boys - Faheem Armanyous', mockMasterSs);
assert.strictEqual(qualifiedCheck.found, true, 'Team should be found');
assert.strictEqual(qualifiedCheck.isAlreadyQualified, true, 'Team with 17 pts should be qualified');
assert.strictEqual(qualifiedCheck.caps.refCapMet, true, 'Ref cap should be met at 10 pts');
assert.strictEqual(qualifiedCheck.caps.fmCapMet, true, 'FM cap should be met at 2 pts');
assert(qualifiedCheck.warnings.some(w => w.includes('ALREADY QUALIFIED')), 'Should include ALREADY QUALIFIED alert');
assert(qualifiedCheck.warnings.some(w => w.includes('Referee points at 10/10')), 'Should include Ref cap alert');

console.log('✅ Qualified team pre-check verified.');

// Check in-progress team
const inProgressCheck = auditModule.getTeamLedgerPreCheck_('10U - Girls - Dawn Caires', mockMasterSs);
assert.strictEqual(inProgressCheck.found, true, 'Team should be found');
assert.strictEqual(inProgressCheck.isAlreadyQualified, false, 'Team with 13 pts should not be qualified');
assert.strictEqual(inProgressCheck.pointsNeeded, 4, 'Points needed should be 4');
assert.strictEqual(inProgressCheck.caps.refCapMet, false, 'Ref cap should not be met at 6 pts');
assert.strictEqual(inProgressCheck.caps.picCapMet, false, 'Pic cap should not be met at 0 pts');

console.log('✅ In-progress team pre-check verified.');

// Test 2: formatDisputeDossier
console.log('\nTesting formatDisputeDossier markdown output...');

const mockTicket = {
  ticketId: 'R154-2026-0042',
  received: 'Wed, Oct 21, 2026 10:30 AM PT',
  submitter: {
    name: 'Jane Coach',
    role: 'Head Coach',
    email: 'jane.coach@example.org',
    phone: '(555) 987-6543'
  },
  team: {
    teamCode: '10U - Girls - Dawn Caires',
    division: '10U - Girls',
    headCoach: 'Dawn Caires'
  },
  requestType: 'Standard Review',
  workflowStatus: 'New',
  priority: 'High — Qualification Impact',
  timely: 'Yes',
  deadline: 'Sun, Nov 8, 2026 5:00 PM PT',
  siblingInfo: {
    hasSibling: 'Yes',
    details: 'Sibling in 08U - Girls - Crystal Van Maanen'
  },
  shifts: [
    {
      shiftNumber: 1,
      shiftStart: 'Sat, Oct 17, 2026 8:00 AM PT',
      venue: 'Park Lexington Fields',
      fieldLocation: 'Field #2',
      volunteerName: 'Alex Parent',
      category: 'Referee',
      expectedPoints: 1,
      teamCreditedAtCheckIn: '10U - Girls - Dawn Caires',
      evidence: 'Signed paper sheet at Denni table',
      supportingLink: 'https://example.org/photo-evidence.jpg',
      classification: 'Standard Review',
      timely: 'Yes',
      postingWindowComplete: 'Yes'
    }
  ],
  ledgerPreCheck: inProgressCheck
};

const dossierMarkdown = auditModule.formatDisputeDossier(mockTicket);
assert(dossierMarkdown.includes('R154-2026-0042'), 'Must include ticket ID');
assert(dossierMarkdown.includes('Jane Coach (Head Coach)'), 'Must include submitter and role');
assert(dossierMarkdown.includes('10U - Girls - Dawn Caires'), 'Must include team code');
assert(dossierMarkdown.includes('Alex Parent'), 'Must include volunteer name');
assert(dossierMarkdown.includes('Park Lexington Fields - Field #2'), 'Must include venue and field');
assert(dossierMarkdown.includes('https://example.org/photo-evidence.jpg'), 'Must include evidence link');
assert(dossierMarkdown.includes('Sibling in 08U - Girls - Crystal Van Maanen'), 'Must include sibling details');
assert(dossierMarkdown.includes('4 pts needed'), 'Must include ledger pre-check status');
assert(dossierMarkdown.includes('Suggested Gem Adjudication Prompt'), 'Must include Gem prompt suggestion');

console.log('✅ formatDisputeDossier output verified.');

// Test 3: applyGemDecisionToTeamAwards
console.log('\nTesting applyGemDecisionToTeamAwards into Team_Awards matrix...');

const mockAwardsRows = [
  ['Team Code', 'Pre-Season Referees', 'MatchTrak Bonus', 'Picture Day', 'Adjustment', 'Reason', 'Reviewer', 'Last Updated'],
  ['10U - Girls - Dawn Caires', 2, 2, 0, 0, 'Initial', 'Admin', new Date()]
];

let updatedValues = {};

const mockAwardsSheet = {
  getDataRange: () => ({
    getValues: () => mockAwardsRows
  }),
  getRange: (row, col) => ({
    setValue: (val) => {
      updatedValues[`${row},${col}`] = val;
      // Update in-memory array for realistic chaining
      if (mockAwardsRows[row - 1]) {
        mockAwardsRows[row - 1][col - 1] = val;
      }
    }
  }),
  appendRow: (row) => {
    mockAwardsRows.push(row);
  }
};

const mockAwardsMasterSs = {
  getSheetByName: (name) => {
    if (name === 'Team_Awards') return mockAwardsSheet;
    if (name === 'Season_Master_Ledger') {
      return {
        getLastRow: () => mockLedgerData.length,
        getDataRange: () => ({ getValues: () => mockLedgerData })
      };
    }
    return null;
  }
};

// Apply Picture Day award of 1 point
const picResult = auditModule.applyGemDecisionToTeamAwards(
  '10U - Girls - Dawn Caires',
  'pictureDay',
  1,
  'Approved missing picture tent shift on 10/17',
  'Commissioner Bob',
  'R154-2026-0042',
  mockAwardsMasterSs
);

assert.strictEqual(picResult.success, true, 'Decision should apply successfully');
assert.strictEqual(picResult.targetColumn, 'pictureDay', 'Target column should be pictureDay');
assert.strictEqual(picResult.newPic, 1, 'Picture Day should update from 0 to 1');
assert.strictEqual(picResult.reviewer, 'Commissioner Bob', 'Reviewer should be recorded');

// Apply adjustment award of 2 points
const adjResult = auditModule.applyGemDecisionToTeamAwards(
  '10U - Girls - Dawn Caires',
  'adjustment',
  2,
  'Approved verified referee shift credit',
  'Commissioner Bob',
  'R154-2026-0042',
  mockAwardsMasterSs
);

assert.strictEqual(adjResult.success, true, 'Adjustment should apply successfully');
assert.strictEqual(adjResult.targetColumn, 'adjustment', 'Target column should be adjustment');
assert.strictEqual(adjResult.newAdj, 2, 'Adjustment should update from 0 to 2');

console.log('✅ applyGemDecisionToTeamAwards verified.');

console.log('\n=============================================================');
console.log('🎉 ALL HYBRID ADJUDICATION BRIDGE TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================');
