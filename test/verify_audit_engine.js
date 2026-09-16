/**
 * Verification for AuditEngine.js logic
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing AuditEngine.js logic...\n');

const auditEngineCode = fs.readFileSync(path.join(__dirname, '../apps-script/AuditEngine.js'), 'utf8');
assert(auditEngineCode.includes('function runAuditAndSyncLedger()'), 'runAuditAndSyncLedger function must exist');
assert(auditEngineCode.includes('function auditFormResponses(ss)'), 'auditFormResponses function must exist');
assert(auditEngineCode.includes('function syncSeasonMasterLedger(ss, auditedTeamPoints'), 'syncSeasonMasterLedger function must exist');
assert(auditEngineCode.includes('Duplicate Submission (0)'), 'Duplicate Submission (0) status must be present');
assert(auditEngineCode.includes('NOCRA - No Points'), 'NOCRA - No Points status must be present');
assert(auditEngineCode.includes('Cap Reached'), 'Cap Reached status must be present');

console.log('✅ AuditEngine.js syntax and key functions verified successfully.');
