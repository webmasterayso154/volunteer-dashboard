/**
 * AYSO Region 154 - Admin Configuration Engine
 * Generates and reads the unified Admin_Config control tab.
 */

const ADMIN_CONFIG_SHEET = "Admin_Config";

/**
 * Run this function once from the Apps Script editor to build and format the sheet.
 */
function setupAdminConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(ADMIN_CONFIG_SHEET);
  }

  // Clear existing content and formatting
  sheet.clear();
  sheet.clearFormats();

  // Set visual column widths
  sheet.setColumnWidth(1, 240); // A: Allowlist Email
  sheet.setColumnWidth(2, 170); // B: Name / Role
  sheet.setColumnWidth(3, 35);  // C: Spacer
  sheet.setColumnWidth(4, 180); // D: Setting Key
  sheet.setColumnWidth(5, 120); // E: Setting Value
  sheet.setColumnWidth(6, 35);  // F: Spacer
  sheet.setColumnWidth(7, 140); // G: Supplemental Division
  sheet.setColumnWidth(8, 170); // H: Supplemental Coach
  sheet.setColumnWidth(9, 240); // I: Calculated Team Code

  // Card Category Headers (Row 1)
  sheet.getRange("A1:B1").merge().setValue("BOARD ACCESS ALLOWLIST");
  sheet.getRange("D1:E1").merge().setValue("GLOBAL DASHBOARD SETTINGS");
  sheet.getRange("G1:I1").merge().setValue("SUPPLEMENTAL ROSTER (LATE TEAMS)");

  // Column Sub-headers (Row 2)
  const headers = [
    ["Email Address", "Name / Role", "", "Setting Key", "Current Value", "", "Division", "Coach Name", "Full Team Code (Auto)"]
  ];
  sheet.getRange("A2:I2").setValues(headers);

  // Default Global Settings Data (Starting Row 3)
  const defaultSettings = [
    ["PlayoffThreshold", 17],
    ["RefMaxCap", 10],
    ["FieldMarshalCap", 2],
    ["FieldSetupCap", 5],
    ["PictureDayCap", 2],
    ["StandingsFrozen", false]
  ];
  sheet.getRange("D3:E8").setValues(defaultSettings);

  // Set Checkbox Data Validation for "StandingsFrozen" (Cell E8)
  const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange("E8").setDataValidation(checkboxRule);

  // Pre-seed the Calculated Team Code formula down the Supplemental Roster column (Row 3 to 50)
  sheet.getRange("I3:I50").setFormulaR1C1('=IF(RC[-2]="","", RC[-2] & " - " & RC[-1])');

  // Styling: Category Headers (Row 1)
  const categoryRanges = ["A1:B1", "D1:E1", "G1:I1"];
  categoryRanges.forEach(ref => {
    sheet.getRange(ref)
      .setBackground("#0F2537") // Navy
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
  });

  // Styling: Column Headers (Row 2)
  const headerRanges = ["A2:B2", "D2:E2", "G2:I2"];
  headerRanges.forEach(ref => {
    sheet.getRange(ref)
      .setBackground("#E2E8F0") // Slate light
      .setFontColor("#1E293B")
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
  });

  // Alignments & Clean Borders
  sheet.getRange("A1:I50").setFontFamily("Arial").setFontSize(10);
  sheet.getRange("A1:I2").setFontSize(10);
  sheet.getRange("D3:D8").setFontWeight("bold").setFontColor("#334155");
  sheet.getRange("E3:E7").setHorizontalAlignment("center");
  sheet.getRange("I3:I50").setFontColor("#64748B"); // Gray tone for auto-generated codes

  // Set row heights
  sheet.setRowHeight(1, 28);
  sheet.setRowHeight(2, 24);

  SpreadsheetApp.flush();
  Logger.log("✅ Admin_Config sheet initialized and styled successfully.");
}

/**
 * Reads all authorized emails from Column A.
 */
function getAuthorizedBoardEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return [];

  const values = sheet.getRange(3, 1, sheet.getLastRow() - 2, 1).getValues();
  return values
    .map(row => String(row[0] || "").trim().toLowerCase())
    .filter(email => email.length > 0 && email.indexOf("@") !== -1);
}

/**
 * Reads global key-value settings from Columns D and E.
 */
function getAdminConfigSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  const defaults = {
    PlayoffThreshold: 17,
    RefMaxCap: 10,
    FieldMarshalCap: 2,
    FieldSetupCap: 5,
    PictureDayCap: 2,
    StandingsFrozen: false
  };

  if (!sheet || sheet.getLastRow() < 3) return defaults;

  const data = sheet.getRange(3, 4, 6, 2).getValues();
  const settings = {};

  data.forEach(row => {
    const key = String(row[0]).trim();
    if (key) {
      settings[key] = row[1];
    }
  });

  return Object.assign(defaults, settings);
}

/**
 * Writes a single Global Dashboard Setting (Columns D/E) by key. Used to keep
 * control-panel writes and the Admin_Config sheet as one source of truth
 * instead of forking a second copy in the legacy Settings sheet.
 */
function setAdminConfigSetting(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  if (!sheet) return false;

  const lastRow = Math.max(sheet.getLastRow(), 8);
  const keys = sheet.getRange(3, 4, lastRow - 2, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0] || '').trim() === key) {
      sheet.getRange(3 + i, 5).setValue(value);
      return true;
    }
  }
  sheet.getRange(lastRow + 1, 4, 1, 2).setValues([[key, value]]);
  return true;
}

/**
 * Reads late-added coaches from Columns G through I.
 */
function getSupplementalTeams() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return [];

  const values = sheet.getRange(3, 7, sheet.getLastRow() - 2, 3).getValues();
  const teams = [];

  values.forEach(row => {
    const division = String(row[0] || "").trim();
    const coach = String(row[1] || "").trim();
    const fullCode = String(row[2] || "").trim();

    if (division && coach) {
      teams.push({
        division: division,
        coach: coach,
        teamCode: fullCode || (division + " - " + coach)
      });
    }
  });

  return teams;
}