/**
 * ============================================================================
 * AYSO REGION 154 - EXECUTIVE BOARD SUMMARY & KPI ENGINE
 * ============================================================================
 * File: ExecutiveSummary.gs
 * Description: Generates and formats the dedicated 'Executive_Summary' tab inside
 *              the production Google Sheet to provide the board with an instant
 *              read-only snapshot of submission counts, venue coverage, verification
 *              status, and volunteer points breakdown.
 * ============================================================================
 */

const EXECUTIVE_SUMMARY_SHEET = "Executive_Summary";

/**
 * Builds or refreshes the dedicated Executive Summary tab in the active or target spreadsheet.
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [targetSpreadsheet] Optional spreadsheet instance
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The formatted Executive Summary sheet
 */
function setupExecutiveSummarySheet(targetSpreadsheet) {
  const ss = targetSpreadsheet || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (!ss) {
    if (typeof Logger !== 'undefined') Logger.log("No spreadsheet available to build Executive Summary tab.");
    return null;
  }

  const brandNavy = "#002D62";
  const brandLightBg = "#F8FAFC";
  const brandHeaderBg = "#002D62";
  const brandHeaderTxt = "#FFFFFF";
  const brandSubheaderBg = "#E2E8F0";
  const brandSubheaderTxt = "#002D62";

  let sheet = ss.getSheetByName(EXECUTIVE_SUMMARY_SHEET) || ss.getSheetByName("Executive Summary");
  if (!sheet) {
    sheet = ss.insertSheet(EXECUTIVE_SUMMARY_SHEET);
  }

  // Clear existing content and formats
  sheet.clear();
  sheet.clearFormats();

  // Set visual column widths
  sheet.setColumnWidth(1, 380); // A: Category / Metric Label
  sheet.setColumnWidth(2, 160); // B: Primary Count / Value
  sheet.setColumnWidth(3, 200); // C: Share / Points / Sub-metric
  sheet.setColumnWidth(4, 280); // D: Notes / Qualification Status

  // Row 1: Main Title Banner
  sheet.getRange("A1:D1").merge()
    .setValue("AYSO REGION 154 — EXECUTIVE BOARD VOLUNTEER SUMMARY")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(13)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // Row 2: Live Dashboard Link & Dynamic Status Banner
  sheet.getRange("A2:D2").merge()
    .setValue("📊 Public Volunteer Dashboard: https://webmasterayso154.github.io/volunteer-dashboard/   •   Status: Live Automated Sync")
    .setBackground(brandLightBg)
    .setFontColor(brandNavy)
    .setFontStyle("italic")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 24);

  // Freeze top 2 banner rows
  sheet.setFrozenRows(2);

  // ==========================================================================
  // SECTION 1: KEY PERFORMANCE INDICATORS (KPIs)
  // ==========================================================================
  sheet.getRange("A4:D4").merge()
    .setValue("1. CHECK-IN VOLUME & AUDIT VERIFICATION STATUS")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A5:D5")
    .setValues([["Metric Description", "Submissions Count", "Metric Share", "Operational Status"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const kpiData = [
    ["Total Volunteer Check-In Submissions", "=MAX(0, COUNTA('Form Responses 1'!A2:A))", "100.0%", "Raw intake from Google Form"],
    ["Verified & Clean Check-Ins (Audited)", "=COUNTIF('Form Responses 1'!O2:O, \"Verified\")", "=IF($B$6>0, B7/$B$6, 0)", "Credited towards team playoff points"],
    ["Pending / Recorded Submissions (Awaiting Audit)", "=COUNTIF('Form Responses 1'!O2:O, \"\") + COUNTIF('Form Responses 1'!O2:O, \"Recorded\")", "=IF($B$6>0, B8/$B$6, 0)", "Under routine 48h board triage window"],
    ["Filtered Submissions (Duplicate / NOCRA / Cap Met)", "=COUNTIF('Form Responses 1'!O2:O, \"Duplicate*\") + COUNTIF('Form Responses 1'!O2:O, \"NOCRA*\") + COUNTIF('Form Responses 1'!O2:O, \"Cap Met*\")", "=IF($B$6>0, B9/$B$6, 0)", "Deduplicated or zero-point exceptions"],
    ["Total Verified Volunteer Points Logged", "=SUM('Form Responses 1'!P2:P)", "-", "Cumulative season points credited"]
  ];
  sheet.getRange("A6:D10").setValues(kpiData);

  // ==========================================================================
  // SECTION 2: VOLUNTEER ROLES & POINTS BREAKDOWN
  // ==========================================================================
  sheet.getRange("A12:D12").merge()
    .setValue("2. VOLUNTEER DUTIES & POINTS CONTRIBUTION")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A13:D13")
    .setValues([["Duty Category", "Submissions Count", "Points Awarded", "Official Category Cap Rule"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const rolesData = [
    ["Referee (Center Referee & Assistant Referee)", "=COUNTIF('Form Responses 1'!E2:E, \"*Referee*\")", "=SUMIFS('Form Responses 1'!P2:P, 'Form Responses 1'!E2:E, \"*Referee*\")", "Max 10 On-Field Ref Points/Team"],
    ["Field Marshal Shift", "=COUNTIF('Form Responses 1'!E2:E, \"*Field Marshal*\")", "=SUMIFS('Form Responses 1'!P2:P, 'Form Responses 1'!E2:E, \"*Field Marshal*\")", "Max 2 Field Marshal Points/Team"],
    ["Friday Night Field Setup & Takedown", "=COUNTIF('Form Responses 1'!E2:E, \"*Set Up*\") + COUNTIF('Form Responses 1'!E2:E, \"*Setup*\")", "=SUMIFS('Form Responses 1'!P2:P, 'Form Responses 1'!E2:E, \"*Set*\")", "Max 1 Setup Point/Team (5 for U8/U6)"],
    ["Picture Day & Special Regional Events", "=COUNTIF('Form Responses 1'!E2:E, \"*Picture*\")", "=SUMIFS('Form Responses 1'!P2:P, 'Form Responses 1'!E2:E, \"*Picture*\")", "Max 2 Picture Day Points/Team"]
  ];
  sheet.getRange("A14:D17").setValues(rolesData);

  // ==========================================================================
  // SECTION 3: VENUE COVERAGE BREAKDOWN
  // ==========================================================================
  sheet.getRange("A19:D19").merge()
    .setValue("3. VENUE COVERAGE & DISTRIBUTION (MATCHTRAK ROUTING)")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A20:D20")
    .setValues([["Venue Complex", "Check-Ins Logged", "Coverage Share", "Active Dropdown Question Status"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const venueData = [
    ["🌲 Park Lexington (Denni & Cerritos)", "=COUNTIF('Form Responses 1'!I2:I, \"*Park Lex*\") + COUNTIF('Form Responses 1'!K2:K, \"*Park Lex*\") + COUNTIF('Form Responses 1'!N2:N, \"*Park Lex*\")", "=IF($B$6>0, B21/$B$6, 0)", "Turf & Grass Fields Synced"],
    ["🏫 Luther Elementary (U8/U10 Complex)", "=COUNTIF('Form Responses 1'!I2:I, \"*Luther*\") + COUNTIF('Form Responses 1'!K2:K, \"*Luther*\") + COUNTIF('Form Responses 1'!N2:N, \"*Luther*\")", "=IF($B$6>0, B22/$B$6, 0)", "Active with Zero-Game Fallback"],
    ["🏫 Lexington Junior High (LJHS) & Arnold", "=COUNTIF('Form Responses 1'!I2:I, \"*LJHS*\") + COUNTIF('Form Responses 1'!I2:I, \"*Lexington*\") + COUNTIF('Form Responses 1'!I2:I, \"*Arnold*\") + COUNTIF('Form Responses 1'!K2:K, \"*LJHS*\") + COUNTIF('Form Responses 1'!K2:K, \"*Arnold*\") + COUNTIF('Form Responses 1'!N2:N, \"*LJHS*\") + COUNTIF('Form Responses 1'!N2:N, \"*Arnold*\")", "=IF($B$6>0, B23/$B$6, 0)", "Fields #1–#10 & Overflow"]
  ];
  sheet.getRange("A21:D23").setValues(venueData);

  // ==========================================================================
  // SECTION 4: TEAM PLAYOFF QUALIFICATION SNAPSHOT
  // ==========================================================================
  sheet.getRange("A25:D25").merge()
    .setValue("4. TEAM PLAYOFF QUALIFICATION SNAPSHOT (SEASON MASTER LEDGER)")
    .setBackground(brandHeaderBg)
    .setFontColor(brandHeaderTxt)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.getRange("A26:D26")
    .setValues([["Standings Qualification Tier", "Team Count", "Percentage of Teams", "Playoff Target Requirement"]])
    .setBackground(brandSubheaderBg)
    .setFontColor(brandSubheaderTxt)
    .setFontWeight("bold");

  const playoffData = [
    ["🏆 Qualified / Playoff Target Met", "=IF(ISREF(Season_Master_Ledger!E2:E), COUNTIF(Season_Master_Ledger!E2:E, \">= 17\"), 0)", "=IF($B$29>0, B27/$B$29, 0)", ">= 17 Points (Competitive Divisions)"],
    ["⏳ In Progress (Working Towards Target)", "=IF(ISREF(Season_Master_Ledger!E2:E), MAX(0, COUNTIF(Season_Master_Ledger!E2:E, \"< 17\") - COUNTIF(Season_Master_Ledger!E2:E, \"\")), 0)", "=IF($B$29>0, B28/$B$29, 0)", "< 17 Points (Active Volunteer Effort)"],
    ["📊 Total Teams Tracked in Master Ledger", "=IF(ISREF(Season_Master_Ledger!A2:A), MAX(0, COUNTA(Season_Master_Ledger!A2:A) - 1), 116)", "100.0%", "116 Master Roster Teams"]
  ];
  sheet.getRange("A27:D29").setValues(playoffData);

  // ==========================================================================
  // FORMATTING & STYLING PASS
  // ==========================================================================
  // Format numbers
  sheet.getRange("B6:B10").setNumberFormat("#,##0");
  sheet.getRange("C7:C9").setNumberFormat("0.0%");
  sheet.getRange("B14:C17").setNumberFormat("#,##0");
  sheet.getRange("B21:B23").setNumberFormat("#,##0");
  sheet.getRange("C21:C23").setNumberFormat("0.0%");
  sheet.getRange("B27:B29").setNumberFormat("#,##0");
  sheet.getRange("C27:C28").setNumberFormat("0.0%");

  // Alignments & Font styling
  sheet.getRange("A4:D29").setFontFamily("Arial");
  sheet.getRange("B6:C10").setHorizontalAlignment("center");
  sheet.getRange("B14:C17").setHorizontalAlignment("center");
  sheet.getRange("B21:C23").setHorizontalAlignment("center");
  sheet.getRange("B27:C29").setHorizontalAlignment("center");
  sheet.getRange("A6:A10").setFontWeight("bold");
  sheet.getRange("A14:A17").setFontWeight("bold");
  sheet.getRange("A21:A23").setFontWeight("bold");
  sheet.getRange("A27:A29").setFontWeight("bold");

  const borderStyle = (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.BorderStyle) ? SpreadsheetApp.BorderStyle.SOLID : null;
  sheet.getRange("A5:D10").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);
  sheet.getRange("A13:D17").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);
  sheet.getRange("A20:D23").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);
  sheet.getRange("A26:D29").setBorder(true, true, true, true, true, true, "#CBD5E1", borderStyle);

  if (typeof Logger !== 'undefined') {
    Logger.log("Executive Summary tab successfully constructed and formatted.");
  }

  return sheet;
}

/**
 * Alias for setupExecutiveSummarySheet for on-demand menu triggers.
 */
function refreshExecutiveSummaryTab() {
  const sheet = setupExecutiveSummarySheet();
  if (sheet && typeof SpreadsheetApp !== 'undefined') {
    try {
      SpreadsheetApp.getUi().alert("Executive Summary", "Executive Summary tab has been refreshed successfully!", SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      // Non-interactive context
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setupExecutiveSummarySheet,
    refreshExecutiveSummaryTab,
    EXECUTIVE_SUMMARY_SHEET
  };
}
