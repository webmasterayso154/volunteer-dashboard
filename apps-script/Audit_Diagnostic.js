/**
 * ============================================================================
 * AYSO REGION 154 - AUDIT VERIFICATION & DIVISION DIRECTOR RUNWAY ALERTER
 * ============================================================================
 * File: Audit_Diagnostic.gs
 * Version: v4.0.1-PRODUCTION-SAFE
 * Author: AYSO 154 Webmaster
 * ============================================================================
 */

function runWeeklyPointReconciliation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;

  const ui = SpreadsheetApp.getUi();
  Logger.log("Starting weekly formula, points, and proactive runway verification...");

  SpreadsheetApp.flush();

  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  if (!ledgerSheet) {
    ui.alert("Reconciliation Error", "Could not locate 'Season_Master_Ledger'.", ui.ButtonSet.OK);
    return;
  }

  let reportSheet = ss.getSheetByName('Audit_Verification_Report');
  if (!reportSheet) {
    reportSheet = ss.insertSheet('Audit_Verification_Report');
  }
  reportSheet.clear();

  const reportHeaders = [
    'Division', 'Team Code', 'Coach', 'Eligibility Tier',
    'Banked Verified Pts', 'Goal', 'Projected Base',
    'With Full Setup', 'Gap to 17', 'Ref Matches Needed',
    'Home Games Left', 'Home Ref Capacity', 'Shifts / Week',
    'Automated Coach Directive', 'Arithmetic Audit'
  ];

  const ledgerRows = ledgerSheet.getDataRange().getValues();
  const reportRows = [];
  let atRiskCount = 0;

  for (let r = 2; r <= ledgerRows.length; r++) {
    const row = ledgerRows[r - 1];
    const division = row[0];
    const team = row[1];
    const coach = row[2];
    if (!team || team.toString().startsWith('Team Code')) continue;

    const tier = row[20];
    if (tier && (tier.includes('ACTION') || tier.includes('CRITICAL'))) {
      atRiskCount++;
    }

    reportRows.push([
      division, team, coach,
      `=Season_Master_Ledger!U${r}`,
      `=Season_Master_Ledger!K${r}`,
      `=Season_Master_Ledger!L${r}`,
      `=Season_Master_Ledger!N${r}`,
      `=Season_Master_Ledger!O${r}`,
      `=Season_Master_Ledger!P${r}`,
      `=Season_Master_Ledger!Q${r}`,
      `=Season_Master_Ledger!R${r}`,
      `=Season_Master_Ledger!S${r}`,
      `=Season_Master_Ledger!T${r}`,
      `=Season_Master_Ledger!V${r}`,
      `=IF(Season_Master_Ledger!K${r} = (Season_Master_Ledger!D${r}+Season_Master_Ledger!E${r}+Season_Master_Ledger!F${r}+Season_Master_Ledger!G${r}+Season_Master_Ledger!H${r}+Season_Master_Ledger!I${r}+Season_Master_Ledger!J${r}), "✅ BALANCED", "❌ MATH ERROR")`
    ]);
  }

  reportSheet.getRange(1, 1, 1, reportHeaders.length).setValues([reportHeaders])
    .setFontWeight('bold')
    .setBackground('#002D62')
    .setFontColor('#FFFFFF');

  if (reportRows.length > 0) {
    reportSheet.getRange(2, 1, reportRows.length, reportHeaders.length).setValues(reportRows);
    reportSheet.autoResizeColumns(1, reportHeaders.length);
  }

  const alertMsg = `Proactive Eligibility Verification Complete!\n\n` +
    `• Teams Audited: ${reportRows.length}\n` +
    `• Action Required / Critical Teams: ${atRiskCount}\n\n` +
    `Directives and runway metrics compiled in 'Audit_Verification_Report'.`;

  Logger.log(alertMsg);
  ui.alert("Runway Audit Complete", alertMsg, ui.ButtonSet.OK);
}

/**
 * Compiles a division-by-division action list for Division Directors.
 */
function generateDivisionDirectorAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  if (!ledgerSheet) return;

  let alertSheet = ss.getSheetByName('Director_Action_Alerts');
  if (!alertSheet) alertSheet = ss.insertSheet('Director_Action_Alerts');
  alertSheet.clear();

  const headers = [
    'Division', 'Team Code', 'Coach', 'Status Tier',
    'Banked Pts', 'Deficit to 17', 'Shifts/Wk Needed', 'Director Follow-Up Directive'
  ];

  alertSheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#7F1D1D').setFontColor('#FFFFFF');

  const rows = ledgerSheet.getDataRange().getValues();
  const alertRows = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const tier = String(row[20] || '');
    if (tier.includes('ACTION') || tier.includes('CRITICAL')) {
      alertRows.push([
        row[0], row[1], row[2], row[20],
        row[10], row[15], row[19], row[21]
      ]);
    }
  }

  if (alertRows.length > 0) {
    alertSheet.getRange(2, 1, alertRows.length, headers.length).setValues(alertRows);
    alertSheet.autoResizeColumns(1, headers.length);
  }

  SpreadsheetApp.getUi().alert("Director Alerts Generated", `Flagged ${alertRows.length} teams requiring coach outreach in 'Director_Action_Alerts'.`, SpreadsheetApp.getUi().ButtonSet.OK);
}