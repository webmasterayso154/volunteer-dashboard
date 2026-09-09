/**
 * AYSO Region 154 - Programmatic Test Suite
 * Run these functions directly from the Apps Script Run menu to verify backend health.
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
    { name: "Point Calculation, Daily Caps & Category Caps", fn: testCalculationAndCaps },
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

  Logger.log("\n========================================");
  Logger.log(`DIAGNOSTIC RESULTS: ${passed} Passed | ${failed} Failed`);
  Logger.log("========================================");
}

function testSheetStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet) throw new Error("Missing required sheet tab: 'Form Responses 1'");

  const lastCol = sheet.getLastColumn();
  if (lastCol < 13) {
    throw new Error(`Expected at least 13 columns for the live form schema, but found ${lastCol}`);
  }
  return true;
}

function testDirectoryContract() {
  const res = getDirectoryData();

  if (!res || typeof res !== 'object') throw new Error("Directory output is not a valid JSON object");
  if (!res.directory || typeof res.directory !== 'object') throw new Error("Missing 'directory' root object");
  if (!res.syncTimestamp) throw new Error("Missing 'syncTimestamp' string");

  const divisions = Object.keys(res.directory);
  if (divisions.length === 0) throw new Error("Directory returned 0 divisions");
  if (!res.directory["10U - Boys"]) throw new Error("Division '10U - Boys' missing from directory");

  const coaches = res.directory["10U - Boys"];
  const hasFaheem = coaches.some(c => c.teamCode === TEST_TEAM_CODE && c.coach === "Faheem Armanyous");
  if (!hasFaheem) throw new Error(`Target test coach Faheem Armanyous not found in '10U - Boys'`);

  Logger.log(`   Verified ${divisions.length} divisions and coach structures.`);
}

function testCalculationAndCaps() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  const now = new Date();

  const day1 = new Date(now.getTime() - 86400000 * 10);
  const day2 = new Date(now.getTime() - 86400000 * 9);
  const day3 = new Date(now.getTime() - 86400000 * 8);
  const day4 = new Date(now.getTime() - 86400000 * 7);
  const day5 = new Date(now.getTime() - 86400000 * 6);
  const day6 = new Date(now.getTime() - 86400000 * 5);
  const day7 = new Date(now.getTime() - 86400000 * 4);

  // Schema: Col E (Role), Col G (Ref), Col J (FM), Col M (Setup)
  // Rows 1 & 2 test daily duplicate capping (day1 twice = 1 pt)
  // Row 3 tests separate day referee (day2 = 1 pt, ref total = 2 pts)
  // Rows 4-7 test Field Marshal (4 separate days, capped at 2 pts)
  // Rows 8-13 test Setup (6 separate Fridays, capped at 5 pts)
  const mockData = [
    [day1, TEST_TAG, "RefTester1", "Tester", "Referee", "Referee (AYSO)", TEST_TEAM_CODE, "8:00 AM", "LJHS - Field #7", "", "", "", "", ""],
    [day1, TEST_TAG, "RefTester1_Dup", "Tester", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "10:00 AM", "LJHS - Field #7", "", "", "", "", ""],
    [day2, TEST_TAG, "RefTester2", "Tester", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "9:15 AM", "LJHS - Field #8", "", "", "", "", ""],
    [day1, TEST_TAG, "FMTester1", "Tester", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "8:00 AM", "", ""],
    [day2, TEST_TAG, "FMTester2", "Tester", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "10:30 AM", "", ""],
    [day3, TEST_TAG, "FMTester3", "Tester", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "1:00 PM", "", ""],
    [day4, TEST_TAG, "FMTester4", "Tester", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "3:30 PM", "", ""],
    [day1, TEST_TAG, "SetupTester1", "Tester", "Field Set Up", "", "", "", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #1"],
    [day2, TEST_TAG, "SetupTester2", "Tester", "Field Set Up", "", "", "", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #2"],
    [day3, TEST_TAG, "SetupTester3", "Tester", "Field Set Up", "", "", "", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #3"],
    [day4, TEST_TAG, "SetupTester4", "Tester", "Field Set Up", "", "", "", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #4"],
    [day5, TEST_TAG, "SetupTester5", "Tester", "Field Set Up", "", "", "", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #5"],
    [day6, TEST_TAG, "SetupTester6", "Tester", "Field Set Up", "", "", "", "", "", "", "", TEST_TEAM_CODE, "LJHS - Field #6"]
  ];

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, mockData.length, 14).setValues(mockData);
  SpreadsheetApp.flush();

  try {
    const stats = getTeamStatsData(TEST_TEAM_CODE);
    const cats = stats.categories || {};
    const refPoints = cats["Referee Assignment"] ?? 0;
    const fmPoints = cats["Field Marshal Shift"] ?? 0;
    const setupPoints = cats["Friday Night Field Setup"] ?? 0;

    if (refPoints !== 2) {
      throw new Error(`Daily duplicate or ref cap failed: Expected exactly 2 Ref points, found: ${refPoints}`);
    }
    if (fmPoints !== 2) {
      throw new Error(`Field Marshal Cap failed: Expected 2 points max, found: ${fmPoints}`);
    }
    if (setupPoints !== 5) {
      throw new Error(`Setup Cap failed: Expected 5 points max, found: ${setupPoints}`);
    }

    if (!Array.isArray(stats.audit) || stats.audit.length === 0) {
      throw new Error("Audit log array is empty or missing");
    }

    const hasDailyLimitRecord = stats.audit.some(a => a.status === 'Daily Limit Reached');
    if (!hasDailyLimitRecord) {
      throw new Error("Daily duplicate audit status 'Daily Limit Reached' was not logged for duplicate submission");
    }

    Logger.log(`   Daily caps & season caps verified: Ref=${refPoints}, FM=${fmPoints}, Setup=${setupPoints}`);
  } finally {
    sheet.deleteRows(startRow, mockData.length);
    SpreadsheetApp.flush();
    Logger.log("   Temporary test rows cleaned up.");
  }
}

function testJsonpEndpoint() {
  const mockEvent = {
    parameter: {
      action: "getDirectory",
      callback: "ayso_test_callback_123"
    }
  };

  const output = doGet(mockEvent);
  const content = output.getContent();

  if (!content.startsWith("ayso_test_callback_123(")) {
    throw new Error("JSONP response does not wrap payload with requested callback name");
  }
  if (!content.endsWith(")")) {
    throw new Error("JSONP response does not end with closing parenthesis");
  }
  if (output.getMimeType() !== ContentService.MimeType.JAVASCRIPT) {
    throw new Error(`Expected JAVASCRIPT MIME type for JSONP, got: ${output.getMimeType()}`);
  }
  Logger.log("   JSONP wrapper and MIME types validated.");
}

function testSettingsPostAndGet() {
  const testPayload = {
    BoardEmail: "boardtest@ayso154.org",
    RCEmail: "rctest@ayso154.org",
    RefMaxCap: "15",
    PlayoffThreshold: "17"
  };

  const postEvent = { postData: { contents: JSON.stringify(testPayload) } };
  const postRes = JSON.parse(doPost(postEvent).getContent());
  if (postRes.status !== "success") throw new Error(`doPost returned error: ${postRes.message}`);

  const getRes = getSettingsData();
  if (getRes.BoardEmail !== testPayload.BoardEmail || getRes.PlayoffThreshold != testPayload.PlayoffThreshold) {
    throw new Error("Settings retrieved do not match settings posted");
  }
  Logger.log("   Settings persistence validated.");
}