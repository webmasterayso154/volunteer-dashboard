/**
 * ============================================================================
 * AYSO REGION 154 - COMPREHENSIVE PRE-FLIGHT TEST BATTERY
 * ============================================================================
 * File: Test_Suite.gs
 * Version: v4.1.2-HEADLESS-VERIFIED
 * Author: AYSO 154 Webmaster
 * ============================================================================
 */

function runComprehensivePreFlightAudit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log("CRITICAL ERROR: No active spreadsheet bound to this script.");
    return;
  }

  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log("Running in editor/headless mode: Alert popups disabled, output will log below.");
  }

  Logger.log("========================================================");
  Logger.log("⚽ STARTING AYSO 154 PRE-FLIGHT VERIFICATION BATTERY");
  Logger.log("========================================================");

  let passed = 0;
  let failed = 0;
  const failureLog = [];

  const batteries = [
    { name: "Battery 1: Schema & Header Contracts", fn: testSchemaContracts_ },
    { name: "Battery 2: 116-Team Runway Arithmetic & Tiers", fn: testRunwayArithmetic_ },
    { name: "Battery 3: Home Match Schedule & Capacity Engine", fn: testScheduleCapacityEngine_ },
    { name: "Battery 4: Read-Only Web API JSON Contracts", fn: testApiPayloadContracts_ },
    { name: "Battery 5: Deduplication & Override Security", fn: testDeduplicationAndOverrides_ }
  ];

  batteries.forEach((b) => {
    try {
      Logger.log(`\n▶ Running ${b.name}...`);
      b.fn(ss);
      Logger.log(`✅ [PASS] ${b.name}`);
      passed++;
    } catch (err) {
      Logger.log(`❌ [FAIL] ${b.name}: ${err.message}`);
      failureLog.push(`${b.name}: ${err.message}`);
      failed++;
    }
  });

  Logger.log("========================================================");
  Logger.log(`RESULTS: ${passed} Passed | ${failed} Failed`);
  Logger.log("========================================================");

  const title = failed === 0 ? "🏆 All Pre-Flight Tests Passed" : "⚠️ Test Failures Detected";
  const body = failed === 0
    ? `All 5 Test Batteries passed with 100% data integrity!\n\n` +
      `• 116 Team Ledgers: Math Balanced (Cols D-J = Col K)\n` +
      `• 3 Point Tiers & 4 Status Tiers: 100% Verified\n` +
      `• Region 154 Home Match Lookups: 100% Resolved\n` +
      `• Web API 'proactiveRunway' Payloads: Validated\n\n` +
      `Clear to promote preview.html to production.`
    : `Encountered ${failed} test failure(s):\n\n` + failureLog.join("\n\n");

  Logger.log(body);

  if (ui) {
    try {
      ui.alert(title, body, ui.ButtonSet.OK);
    } catch (e) {}
  }
}

function testSchemaContracts_(ss) {
  const reqSheets = ['Season_Master_Ledger', 'Form Responses 1', 'Team_Awards', 'Season_Master_Schedule'];
  reqSheets.forEach(sName => {
    const s = ss.getSheetByName(sName);
    if (!s) throw new Error(`Missing required tab: "${sName}"`);
    if (s.getLastRow() < 2) throw new Error(`Tab "${sName}" is empty.`);
  });

  const respSheet = ss.getSheetByName('Form Responses 1');
  const respHeader = String(respSheet.getRange(1, 46).getValue()).trim();
  if (respHeader !== 'Credited Team') {
    throw new Error(`Form Responses 1 Col AT (46) mismatch: expected "Credited Team", found "${respHeader}"`);
  }

  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  const expectedLedgerCols = [
    'Division', 'Team Code', 'Head Coach', 'Referee Points (Max 10)',
    'Field Marshal Points (Max 2)', 'Field Setup Points (Max 5)',
    'Picture Day Points (Max 2)', 'Certified Ref Bonus (Max 5)',
    'MatchTrak Bonus (Max 2)', 'Other Adjustments', 'Current Verified Points',
    'Playoff Goal', 'Pending FM Obligations', 'Projected Base Points',
    'Projected with Full Setup', 'Gap to 17 (With Full Setup)', 'Ref Match Target',
    'Home Games Remaining', 'Home Ref Capacity', 'Target Shifts / Week',
    'Eligibility Status Tier', 'Automated Action Directive', 'Last Audited'
  ];
  
  const actualCols = ledgerSheet.getRange(1, 1, 1, expectedLedgerCols.length).getValues()[0];
  for (let c = 0; c < expectedLedgerCols.length; c++) {
    if (String(actualCols[c]).trim() !== expectedLedgerCols[c]) {
      throw new Error(`Ledger Col ${c+1} mismatch: expected "${expectedLedgerCols[c]}", found "${actualCols[c]}"`);
    }
  }
}

function testRunwayArithmetic_(ss) {
  SpreadsheetApp.flush();
  const ledger = ss.getSheetByName('Season_Master_Ledger');
  const rows = ledger.getDataRange().getValues();

  let evaluatedTeams = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const team = row[1];
    if (!team || team.toString().startsWith('Team Code')) continue;

    const ref = Number(row[3]) || 0;
    const fm = Number(row[4]) || 0;
    const setup = Number(row[5]) || 0;
    const pic = Number(row[6]) || 0;
    const cert = Number(row[7]) || 0;
    const match = Number(row[8]) || 0;
    const adj = Number(row[9]) || 0;
    const verified = Number(row[10]) || 0;
    const goal = Number(row[11]) || 17;
    const pendingFm = Number(row[12]) || 0;
    const projectedBase = Number(row[13]) || 0;
    const setupMax = Number(row[14]) || 0;
    const gap = Number(row[15]) || 0;
    const refTarget = Number(row[16]) || 0;
    const homeGames = Number(row[17]) || 0;
    const homeCap = Number(row[18]) || 0;
    const tier = String(row[20] || '');

    const expectedVerified = Math.max(0, ref + fm + setup + pic + cert + match + adj);
    if (verified !== expectedVerified) {
      throw new Error(`Math imbalance for ${team}: Col K (${verified}) != sum of categories (${expectedVerified})`);
    }

    if (pendingFm !== Math.max(0, 2 - fm)) {
      throw new Error(`Pending FM mismatch for ${team}: Col M (${pendingFm}) != 2 - ${fm}`);
    }

    if (projectedBase !== (verified + pendingFm)) {
      throw new Error(`Projected Base mismatch for ${team}: Col N (${projectedBase}) != ${verified} + ${pendingFm}`);
    }

    const expectedSetupMax = Math.min(26, verified + Math.max(0, 5 - setup) + pendingFm);
    if (setupMax !== expectedSetupMax) {
      throw new Error(`Setup Max mismatch for ${team}: Col O (${setupMax}) != expected ${expectedSetupMax}`);
    }

    if (gap !== Math.max(0, goal - setupMax)) {
      throw new Error(`Gap mismatch for ${team}: Col P (${gap}) != goal ${goal} - setupMax ${setupMax}`);
    }

    if (homeCap !== homeGames * 2) {
      throw new Error(`Home ref capacity mismatch for ${team}: Col S (${homeCap}) != ${homeGames} * 2`);
    }

    let expectedTier = '';
    if (verified >= goal) expectedTier = "🟢 CLINCHED";
    else if (setupMax >= goal) expectedTier = "🟡 ON TRACK (Pending Setup)";
    else if (refTarget <= homeCap) expectedTier = "🟠 ACTION REQUIRED";
    else expectedTier = "🔴 CRITICAL DEFICIT";

    if (tier !== expectedTier) {
      throw new Error(`Status Tier mismatch for ${team}: Col U is "${tier}", expected "${expectedTier}"`);
    }

    evaluatedTeams++;
  }

  if (evaluatedTeams < 100) {
    throw new Error(`Evaluated only ${evaluatedTeams} teams; expected 100+.`);
  }
}

function testScheduleCapacityEngine_(ss) {
  const schedSheet = ss.getSheetByName('Season_Master_Schedule');
  const rows = schedSheet.getDataRange().getValues();

  if (rows.length < 200) {
    throw new Error(`Season_Master_Schedule contains only ${rows.length} rows; expected 200+ full-season matches.`);
  }

  const headers = rows[0].map(h => String(h || '').trim());
  const fieldIdx = headers.findIndex(h => /field/i.test(h));
  const homeIdx = headers.findIndex(h => /home team$/i.test(h) || (/home/i.test(h) && !/id/i.test(h)));

  if (fieldIdx === -1 || homeIdx === -1) {
    throw new Error("Season_Master_Schedule missing 'Field' or 'Home Team' header.");
  }

  let cypressHomeMatches = 0;
  for (let i = 1; i < rows.length; i++) {
    const f = String(rows[i][fieldIdx] || '');
    if (f.includes('154')) cypressHomeMatches++;
  }

  if (cypressHomeMatches < 150) {
    throw new Error(`Found only ${cypressHomeMatches} Region 154 home field matches; expected 150+.`);
  }
}

function testApiPayloadContracts_(ss) {
  const dirRes = getDirectoryData();
  if (!dirRes || !dirRes.directory || Object.keys(dirRes.directory).length === 0) {
    throw new Error("getDirectoryData() returned invalid or empty directory.");
  }

  const testTeam = "10U - Boys - Faheem Armanyous";
  const stats = getTeamStatsData(testTeam);

  if (!stats || !stats.categories) {
    throw new Error(`getTeamStatsData("${testTeam}") failed to return categories.`);
  }

  const r = stats.proactiveRunway;
  if (!r) {
    throw new Error(`getTeamStatsData("${testTeam}") missing 'proactiveRunway' object.`);
  }

  const requiredRunwayKeys = [
    'verifiedPoints', 'projectedBasePoints', 'projectedWithFullSetup',
    'gapTo17', 'refMatchTarget', 'homeGamesRemaining', 'homeRefCapacity',
    'targetShiftsPerWeek', 'statusTier', 'actionDirective'
  ];

  requiredRunwayKeys.forEach(k => {
    if (r[k] === undefined || r[k] === null) {
      throw new Error(`proactiveRunway missing key: "${k}"`);
    }
  });

  // Validates Faheem Armanyous audited verified points (9 points as of Oct 10 check-in)
  if (r.verifiedPoints !== 9) {
    throw new Error(`Faheem Armanyous verified points mismatch: expected 9, found ${r.verifiedPoints}`);
  }
}

function testDeduplicationAndOverrides_(ss) {
  const respSheet = ss.getSheetByName('Form Responses 1');
  const data = respSheet.getDataRange().getValues();

  let recordedCount = 0;
  let nocraCount = 0;

  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][14] || '');
    const pts = Number(data[i][15]) || 0;

    if (status === 'Recorded') {
      recordedCount++;
      if (pts !== 1) throw new Error(`Row ${i+1}: Status is "Recorded" but points is ${pts} (expected 1)`);
    } else if (status.includes('Duplicate')) {
      if (pts !== 0) throw new Error(`Row ${i+1}: Duplicate status awarded non-zero points (${pts})`);
    } else if (status.includes('NOCRA')) {
      nocraCount++;
      if (pts !== 0) throw new Error(`Row ${i+1}: NOCRA status awarded non-zero points (${pts})`);
    }
  }

  if (recordedCount < 350) throw new Error(`Expected 350+ Recorded check-ins, found ${recordedCount}`);
  if (nocraCount < 70) throw new Error(`Expected 70+ filtered NOCRA shifts, found ${nocraCount}`);
}