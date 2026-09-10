/**
 * ============================================================================
 * AYSO REGION 154 - PROGRAMMATIC TEST SUITE (CALIBRATED)
 * ============================================================================
 * File: Test_Suite.gs
 * Description: Validates dual AR credit, NOCRA zero-point neutral status, 
 *              'Recorded' form submission tags, duplicate blocking, and caps.
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

  Logger.log("\n========================================");
  Logger.log(`DIAGNOSTIC RESULTS: ${passed} Passed | ${failed} Failed`);
  Logger.log("========================================");
}

function testSheetStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet) throw new Error("Missing required sheet tab: 'Form Responses 1'");

  const lastCol = sheet.getLastColumn();
  if (lastCol < 14) {
    throw new Error(`Expected at least 14 columns for the live form schema, but found ${lastCol}`);
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

  // Distinct volunteers to test dual ARs vs self-duplicates
  // 1. Volunteer AR 1 (8:00 AM) -> +1 pt, status: 'Recorded'
  // 2. Volunteer AR 2 (8:00 AM, same match) -> +1 pt, status: 'Recorded' (2 ARs = +2 pts)
  // 3. Paid NOCRA referee -> 0 pts, status: 'NOCRA - No Points'
  // 4. Duplicate submission from AR 1 -> 0 pts, status: 'Duplicate Submission'
  // 5. FM Shift 1 -> +1 pt, status: 'Recorded'
  // 6. FM Shift 2 (same day) -> +1 pt, status: 'Recorded' (Same-day FM allowed)
  // 7. FM Shift 3 (same day) -> 0 pts, status: 'Cap Reached' (FM Cap of 2)
  const mockData = [
    [now, "test_ar1_diag@ayso154.org", "Volunteer", "One", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "8:00 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "test_ar2_diag@ayso154.org", "Volunteer", "Two", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "8:00 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "test_nocra_diag@association.org", "Paid", "Official", "Referee", "Referee (NOCRA / USSF)", TEST_TEAM_CODE, "8:00 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "test_ar1_diag@ayso154.org", "Volunteer", "One", "Referee", "Assistant Referee (AYSO)", TEST_TEAM_CODE, "8:00 AM", "LJHS - Field #1", "", "", "", "", ""],
    [now, "test_fm1_diag@ayso154.org", "Marshal", "One", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "10:00 AM", "", ""],
    [now, "test_fm2_diag@ayso154.org", "Marshal", "Two", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "1:00 PM", "", ""],
    [now, "test_fm3_diag@ayso154.org", "Marshal", "Three", "Field Marshal", "", "", "", "", TEST_TEAM_CODE, "Park Lexington", "3:30 PM", "", ""]
  ];

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, mockData.length, 14).setValues(mockData);
  SpreadsheetApp.flush();

  try {
    const stats = getTeamStatsData(TEST_TEAM_CODE);
    const cats = stats.categories || {};
    const refPoints = cats["Referee Assignment"] ?? 0;
    const fmPoints = cats["Field Marshal Shift"] ?? 0;

    if (refPoints !== 2) {
      throw new Error(`Dual AR / NOCRA test failed: Expected exactly 2 Ref points, found: ${refPoints}`);
    }
    if (fmPoints !== 2) {
      throw new Error(`Same-day FM test failed: Expected exactly 2 FM points (capped at 2), found: ${fmPoints}`);
    }

    const hasNocraAudit = stats.audit.some(a => a.status === 'NOCRA - No Points' && a.points === 0);
    if (!hasNocraAudit) {
      throw new Error("NOCRA audit entry with status 'NOCRA - No Points' was not recorded");
    }

    const hasRecordedAudit = stats.audit.some(a => a.status === 'Recorded' && a.points === 1);
    if (!hasRecordedAudit) {
      throw new Error("Form check-in entry with status 'Recorded' was not found");
    }

    const hasDupAudit = stats.audit.some(a => a.status === 'Duplicate Submission' && a.points === 0);
    if (!hasDupAudit) {
      throw new Error("Duplicate submission was not recorded with status 'Duplicate Submission'");
    }

    Logger.log(`   Dual ARs (+2), NOCRA exclusion (0), FM same-day (+2), 'Recorded' status, and duplicate rejection verified.`);
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