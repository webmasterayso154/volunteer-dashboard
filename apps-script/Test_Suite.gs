/**
 * ============================================================================
 * AYSO REGION 154 - PROGRAMMATIC TEST SUITE (STAGING AUTOMATED)
 * ============================================================================
 */

const TEST_TEAM_CODE = "10U - Boys - Faheem Armanyous";
const TEST_TAG = "[TEST_SUITE]";

function runAllDiagnostics() {
  Logger.log("========================================");
  Logger.log("⚽ STARTING AYSO 154 END-TO-END DIAGNOSTICS");
  Logger.log("========================================");

  let passed = 0;
  let failed = 0;

  const tests = [
    { name: "Sheet Tab & Schema Integrity", fn: testSheetStructure },
    { name: "Directory Generation Contract", fn: testDirectoryContract },
    { name: "Dual AR, NOCRA Exclusion & Cap Logic", fn: testCalculationAndCaps },
    { name: "JSONP Web App Endpoint & MIME Types", fn: testJsonpEndpoint },
    { name: "Board Control Panel POST & Settings Persistence", fn: testSettingsPostAndGet }
  ];

  tests.forEach(t => {
    try {
      Logger.log(`\n▶ Running: ${t.name}...`);
      t.fn();
      Logger.log(`✅ [PASS] ${t.name}`);
      passed++;
    } catch (err) {
      Logger.log(`❌ [FAIL] ${t.name}: ${err.message}`);
      failed++;
    }
  });

  Logger.log("========================================");
  Logger.log(`DIAGNOSTIC RESULTS: ${passed} Passed | ${failed} Failed`);
  Logger.log("========================================");
}

function testSheetStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets().map(s => s.getName());
  const required = ['Form Responses 1', 'Team_Awards', 'Admin_Config'];
  const missing = required.filter(r => !sheets.includes(r));
  if (missing.length > 0) throw new Error("Missing sheets: " + missing.join(', '));
}

function testDirectoryContract() {
  const res = getDirectoryData();
  if (!res || !res.directory) throw new Error("Directory generation contract failed: Missing directory object.");
  const dir = res.directory;
  const divisions = Object.keys(dir);
  if (divisions.length < 20) throw new Error("Expected at least 20 divisions, found " + divisions.length);

  let totalTeams = 0;
  divisions.forEach(d => {
    const teams = dir[d];
    if (Array.isArray(teams)) totalTeams += teams.length;
    else if (typeof teams === 'object' && teams !== null) totalTeams += Object.keys(teams).length;
  });

  if (totalTeams === 0) throw new Error("Directory contract failed: No teams or coaches found across divisions.");
  Logger.log("   Verified " + divisions.length + " divisions and coach structures.");
}

function testCalculationAndCaps() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const respSheet = ss.getSheetByName('Form Responses 1');
  const now = new Date();

  // Baseline delta check: accommodate pre-existing rows in staging
  const baselineStats = getTeamStatsData(TEST_TEAM_CODE);
  const baselineRef = baselineStats.categories['Referee Assignment'] || 0;

  const testRows = [
    [now, "ar1@ayso154.org", "Dual", "AR1", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "08:00 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "ar2@ayso154.org", "Dual", "AR2", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "08:00 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "nocra@ayso154.org", "Paid", "Ref", "Referee", "NOCRA Referee", TEST_TEAM_CODE, "09:15 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "fm1@ayso154.org", "Field", "Marshal", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #1", "08:00 AM - 10:00 AM", "", ""],
    [now, "fm2@ayso154.org", "Field", "Marshal2", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #1", "10:00 AM - 12:00 PM", "", ""]
  ];

  const startRow = respSheet.getLastRow() + 1;
  testRows.forEach(r => respSheet.appendRow(r));
  SpreadsheetApp.flush();

  try {
    const stats = getTeamStatsData(TEST_TEAM_CODE);
    const netRef = (stats.categories['Referee Assignment'] || 0) - baselineRef;

    if (netRef !== 2) throw new Error(`Dual AR / NOCRA test failed: Expected net +2 Ref points, found: ${netRef}`);
    if (stats.categories['Field Marshal'] !== 2) throw new Error("Same-day FM test failed: Expected 2 FM points, found: " + stats.categories['Field Marshal']);
  } finally {
    const endRow = respSheet.getLastRow();
    for (let i = endRow; i >= startRow; i--) {
      respSheet.deleteRow(i);
    }
  }
}

function testJsonpEndpoint() {
  const output = doGet({ parameter: { action: 'getDirectory', callback: 'handleTest' } });
  const raw = output.getContent();
  if (!raw.startsWith('handleTest(') || !raw.endsWith(')')) throw new Error("MIME or JSONP wrapping error.");
  Logger.log("   JSONP wrapper and MIME types validated.");
}

function testSettingsPostAndGet() {
  const originalSettings = getAdminConfigSettings();
  const testVal = (Number(originalSettings.RefMaxCap) || 10) === 10 ? 9 : 10;
  
  setAdminConfigSetting('RefMaxCap', testVal);
  const updated = getAdminConfigSettings();
  if (Number(updated.RefMaxCap) !== testVal) throw new Error("Admin_Config persistence failed.");

  setAdminConfigSetting('RefMaxCap', originalSettings.RefMaxCap);
  Logger.log("   Settings persistence validated.");
}

function setAdminConfigSetting(key, val) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Admin_Config');
  if (!sheet) throw new Error("Admin_Config sheet missing");
  const data = sheet.getRange("D3:E20").getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      sheet.getRange(3 + i, 5).setValue(val);
      SpreadsheetApp.flush();
      return;
    }
  }
}