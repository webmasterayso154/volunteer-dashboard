/**
 * Automatically creates an administrative menu inside Google Sheets when opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚽ AYSO 154 Test Tools')
    .addItem('▶ Run System Diagnostics', 'menuRunDiagnostics')
    .addSeparator()
    .addItem('➕ Inject Demo Game Day Submissions', 'menuInjectData')
    .addItem('🗑️ Purge All Demo & Test Data', 'menuPurgeData')
    .addSeparator()
    .addItem('🔍 Inspect Test Team Stats (Faheem Armanyous)', 'menuInspectTeam')
    .addToUi();
}

function menuRunDiagnostics() {
  const ui = SpreadsheetApp.getUi();
  ui.alert("Running tests... Click OK, then check Extensions > Apps Script > Execution Log when complete.");
  runAllDiagnostics();
}

function menuInjectData() {
  injectGameDayScenario();
  SpreadsheetApp.getUi().alert("Mock game day check-ins have been added. Open your GitHub dashboard to verify live standings!");
}

function menuPurgeData() {
  purgeAllMockData();
  SpreadsheetApp.getUi().alert("All mock data has been purged from the sheet.");
}

function menuInspectTeam() {
  const stats = getTeamStatsData(TEST_TEAM_CODE);
  const ui = SpreadsheetApp.getUi();
  const msg = `Team: ${TEST_TEAM_CODE}\n` +
              `Total Points: ${stats.totalPoints}\n` +
              `Ref Points: ${stats.categories['Referee Assignment']} / 17\n` +
              `FM Points: ${stats.categories['Field Marshal Shift']} / 2\n` +
              `Setup Points: ${stats.categories['Friday Night Field Setup']} / 5\n` +
              `Logged Submissions: ${stats.audit.length}`;
  ui.alert("Team Standings Inspection", msg, ui.ButtonSet.OK);
}