/**
 * ============================================================================
 * AYSO REGION 154 - BOARD TOOLS & RUNWAY MENU
 * ============================================================================
 * File: Test_Menu.gs
 * Version: v4.0.0
 * Author: AYSO 154 Webmaster
 * ============================================================================
 */

function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('⚽ AYSO 154 Board Tools')
      .addItem('🔍 Run Proactive Points & Runway Verification', 'runWeeklyPointReconciliation')
      .addItem('📢 Generate Division Director Action Alerts', 'generateDivisionDirectorAlerts')
      .addItem('📊 Run Audit & Sync Ledger', 'runAuditAndSyncLedger')
      .addSeparator()
      .addItem('🔄 Sync Form Schedule Dropdowns', 'syncContainerFormSchedule')
      .addSeparator()
      .addItem('🔍 Inspect Test Team Stats (Faheem Armanyous)', 'menuInspectTeam')
      .addToUi();
  } catch (e) {
    Logger.log('onOpen skipped in non-interactive context: ' + e.message);
  }
}

function menuInspectTeam() {
  const TEST_TEAM_CODE = "10U - Boys - Faheem Armanyous";
  const stats = (typeof getTeamStatsData === 'function') ? getTeamStatsData(TEST_TEAM_CODE) : null;
  const ui = SpreadsheetApp.getUi();
  if (!stats) {
    ui.alert("Inspection failed: getTeamStatsData function not found.");
    return;
  }
  const r = stats.proactiveRunway;
  const msg = `Team: ${TEST_TEAM_CODE}\n\n` +
              `Status Tier: ${r.statusTier}\n` +
              `Points Banked: ${r.verifiedPoints} / ${stats.playoffGoal}\n` +
              `Projected with Full Setup: ${r.projectedWithFullSetup} / ${stats.playoffGoal}\n` +
              `Ref Matches Needed: ${r.refMatchTarget}\n` +
              `Home Ref Capacity: ${r.homeRefCapacity} pts (${r.homeGamesRemaining} home matches)\n` +
              `Target Run-Rate: ${r.targetShiftsPerWeek} refs/wk over next 5 weeks\n\n` +
              `Directive:\n${r.actionDirective}`;
  ui.alert("Proactive Runway Inspection", msg, ui.ButtonSet.OK);
}