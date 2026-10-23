/**
 * ============================================================================
 * STANDALONE AUDIT & PLAYOFF TRACKER TABS (100% NON-DESTRUCTIVE)
 * ============================================================================
 * - Does NOT modify Game_Day_Check-ins, Team_Awards, or Season_Master_Ledger.
 * - Creates two standalone tabs with transparent formulas for Board review:
 *     1. Formula_Audit_Shadow (Side-by-side formula math vs. Production Ledger)
 *     2. Playoff_Qualified_17Pts (Live 17+ Clinched & 14-16 Bubble trackers)
 * - Includes removeStandaloneAuditTabs() for instant, clean deletion.
 * ============================================================================
 */

const AUDIT_TAB_NAME = 'Formula_Audit_Shadow';
const PLAYOFF_TAB_NAME = 'Playoff_Qualified_17Pts';

/**
 * Adds a custom menu to the spreadsheet UI so you or colleagues can build
 * or remove the audit tabs with one click.
 */
function addStandaloneAuditMenu() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Board Audit Tools')
    .addItem('1. Build / Refresh Audit & Playoff Tabs', 'buildStandaloneAuditTabs')
    .addSeparator()
    .addItem('2. Remove Audit & Playoff Tabs (Rollback)', 'removeStandaloneAuditTabs')
    .addToUi();
}

/**
 * Main builder: Creates or refreshes both standalone tabs without touching
 * any production sheets or columns.
 */
function buildStandaloneAuditTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Verify required source sheets exist (Read-Only check)
  const requiredSheets = ['Season_Master_Ledger', 'Game_Day_Check-ins', 'Team_Awards'];
  for (const name of requiredSheets) {
    if (!ss.getSheetByName(name)) {
      throw new Error(`Missing required source sheet: "${name}". Aborting.`);
    }
  }

  buildFormulaAuditShadowTab_(ss);
  buildPlayoffQualifiedTab_(ss);
  
  SpreadsheetApp.flush();
}

/**
 * Creates the 'Formula_Audit_Shadow' tab with transparent row-by-row formulas
 * so Board members can click any cell and trace the exact arithmetic.
 */
function buildFormulaAuditShadowTab_(ss) {
  let sheet = ss.getSheetByName(AUDIT_TAB_NAME);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(AUDIT_TAB_NAME, ss.getNumSheets());
    sheet.setTabColor('#1a73e8'); // Blue tab indicator
  }

  // Determine exact number of team rows in Season_Master_Ledger (116 teams -> rows 2 to 117)
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');
  const lastRow = ledgerSheet.getLastRow();
  const numTeams = lastRow - 1;

  // 1. Set Headers
  const headers = [[
    'Division',
    'Team Code',
    'Head Coach',
    'Formula: Ref Pts (Max 10)',
    'Formula: FM Pts (Max 2)',
    'Formula: Setup Pts (Max 5)',
    'Award: Picture Day (Max 2)',
    'Award: Cert Ref Bonus (Max 5)',
    'Award: MatchTrak (Max 2)',
    'Award: Adjustments',
    'Formula Audit Total',
    'Production Ledger Total',
    'Variance',
    'Audit Status'
  ]];
  
  sheet.getRange(1, 1, 1, headers[0].length)
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground('#1a365d')
    .setFontColor('#ffffff')
    .setWrap(true)
    .setVerticalAlignment('middle');

  // 2. Build transparent row-by-row formulas for every team
  const formulas = [];
  for (let i = 0; i < numTeams; i++) {
    const r = i + 2; // Row index (2 to 117)
    formulas.push([
      `=Season_Master_Ledger!A${r}`,
      `=Season_Master_Ledger!B${r}`,
      `=Season_Master_Ledger!C${r}`,
      // Check-in Rollups (Game_Day_Check-ins Col Y = Points Awarded, Col AA = Credited Team, Col D = Role)
      `=MIN(10, SUMIFS('Game_Day_Check-ins'!$Y:$Y, 'Game_Day_Check-ins'!$AA:$AA, $B${r}, 'Game_Day_Check-ins'!$D:$D, "Referee"))`,
      `=MIN(2, SUMIFS('Game_Day_Check-ins'!$Y:$Y, 'Game_Day_Check-ins'!$AA:$AA, $B${r}, 'Game_Day_Check-ins'!$D:$D, "Field Marshal"))`,
      `=MIN(5, SUMIFS('Game_Day_Check-ins'!$Y:$Y, 'Game_Day_Check-ins'!$AA:$AA, $B${r}, 'Game_Day_Check-ins'!$D:$D, "Field Set Up"))`,
      // Manual Awards Lookups (Team_Awards Col A = teamCode, B = preSeasonRefs, C = matchTrakBonus, D = pictureDay, E = adjustment)
      `=MIN(2, N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$D:$D, 0)))`,
      `=MIN(5, N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$B:$B, 0)))`,
      `=MIN(2, N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$C:$C, 0)))`,
      `=N(XLOOKUP($B${r}, Team_Awards!$A:$A, Team_Awards!$E:$E, 0))`,
      // Arithmetic Sum & Cross-Check against Production Season_Master_Ledger Col K
      `=SUM(D${r}:J${r})`,
      `=Season_Master_Ledger!K${r}`,
      `=K${r}-L${r}`,
      `=IF(M${r}=0, "✅ MATCH", "⚠️ DIFF (" & M${r} & ")")`
    ]);
  }

  sheet.getRange(2, 1, numTeams, headers[0].length).setFormulas(formulas);

  // 3. Add League Summary Totals Row at the Top or Bottom (Bottom Row)
  const totalRow = numTeams + 2;
  const summaryFormulas = [[
    'LEAGUE TOTALS',
    `="116 Teams Audited"`,
    '',
    `=SUM(D2:D${lastRow})`,
    `=SUM(E2:E${lastRow})`,
    `=SUM(F2:F${lastRow})`,
    `=SUM(G2:G${lastRow})`,
    `=SUM(H2:H${lastRow})`,
    `=SUM(I2:I${lastRow})`,
    `=SUM(J2:J${lastRow})`,
    `=SUM(K2:K${lastRow})`,
    `=SUM(L2:L${lastRow})`,
    `=SUM(M2:M${lastRow})`,
    `=IF(M${totalRow}=0, "✅ ALL 116 TEAMS IN SYNC", "⚠️ DISCREPANCY DETECTED")`
  ]];
  
  sheet.getRange(totalRow, 1, 1, headers[0].length)
    .setFormulas(summaryFormulas)
    .setFontWeight('bold')
    .setBackground('#e2e8f0');

  // Basic formatting for readability
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  sheet.getRange(2, 4, numTeams + 1, 10).setHorizontalAlignment('center');
  sheet.autoResizeColumns(1, headers[0].length);
}

/**
 * Creates the 'Playoff_Qualified_17Pts' tab with live QUERY formulas showing:
 *   - Left Table: Teams that have clinched 17+ points
 *   - Right Table: Competitive teams on the bubble (14-16 points)
 */
function buildPlayoffQualifiedTab_(ss) {
  let sheet = ss.getSheetByName(PLAYOFF_TAB_NAME);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(PLAYOFF_TAB_NAME, ss.getNumSheets());
    sheet.setTabColor('#0f9d58'); // Green tab indicator
  }

  // Banner Headers (Row 1)
  sheet.getRange('A1:K1').merge()
    .setValue('🟢 CLINCHED PLAYOFF ELIGIBILITY (17+ VERIFIED POINTS)')
    .setFontWeight('bold')
    .setBackground('#0f9d58')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  sheet.getRange('M1:R1').merge()
    .setValue('🟡 ON THE DOORSTEP / BUBBLE WATCH (14–16 VERIFIED POINTS)')
    .setFontWeight('bold')
    .setBackground('#f4b400')
    .setFontColor('#000000')
    .setHorizontalAlignment('center');

  // Dynamic QUERY Formula 1: Clinched Teams (17+ Points & Playoff Goal = 17)
  const clinchedQuery = 
    `=IFERROR(QUERY(Season_Master_Ledger!A1:W, ` +
    `"SELECT A, B, C, D, E, F, G, H, I, J, K ` +
    `WHERE K >= 17 AND L = 17 ` +
    `ORDER BY K DESC, A ASC", 1), "No teams have reached 17 points yet.")`;
  sheet.getRange('A2').setFormula(clinchedQuery);

  // Dynamic QUERY Formula 2: On the Bubble Teams (14 to 16 Points & Playoff Goal = 17)
  const bubbleQuery = 
    `=IFERROR(QUERY(Season_Master_Ledger!A1:W, ` +
    `"SELECT A, B, C, K, P, U ` +
    `WHERE K >= 14 AND K < 17 AND L = 17 ` +
    `ORDER BY K DESC, A ASC", 1), "No teams currently in the 14-16 point range.")`;
  sheet.getRange('M2').setFormula(bubbleQuery);

  sheet.setFrozenRows(2);
  SpreadsheetApp.flush();
  sheet.autoResizeColumns(1, 18);
}

/**
 * Clean Rollback: Deletes both standalone tabs if the Board decides they
 * don't need them. Leaves all production tabs 100% untouched.
 */
function removeStandaloneAuditTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [AUDIT_TAB_NAME, PLAYOFF_TAB_NAME].forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (sheet) {
      ss.deleteSheet(sheet);
    }
  });
}