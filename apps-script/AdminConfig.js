/**
 * ============================================================================
 * AYSO REGION 154 - MASTER VOLUNTEER POLICY & ADMIN CONFIGURATION (SSOT)
 * ============================================================================
 * Single Source of Truth for all volunteer point rules, division qualification
 * thresholds, category caps, and Google Sheets formula generators.
 */

const VOLUNTEER_POLICY = Object.freeze({
  THRESHOLDS: Object.freeze({
    PLAYGROUND: 4,
    U5_U6: 7,
    U8: 15,
    U10_U19: 17,
    DEFAULT: 17
  }),
  CATEGORY_CAPS: Object.freeze({
    FIELD_SETUP: 5,
    REFEREE: 10,
    FIELD_MARSHAL: 2,
    PICTURE_DAY: 2,
    CERTIFIED_REF: 5,
    MATCHTRAK_BONUS: 2,
    OTHER_ADJUSTMENTS: 5
  }),
  AUDIT: Object.freeze({
    POSTING_DELAY_HOURS: 48,
    LOOKBACK_DAYS: 14,
    MAX_SHIFTS_PER_CHALLENGE: 5
  }),
  SHEETS: Object.freeze({
    LEDGER: 'Season_Master_Ledger',
    CHECKINS: 'Game Day Check-ins',
    FALLBACK_CHECKINS: 'Form Responses 3',
    LEGACY_CHECKINS: 'Form Responses 1',
    DISPUTES: 'Form Responses 2',
    AWARDS: 'Team_Awards',
    SCHEDULE: 'Season_Master_Schedule',
    ADMIN: 'Admin_Config',
    SETTINGS: 'Settings',
    DISPUTE_REPORT: 'Dispute_Audit_Report'
  })
});

/**
 * Resolves the division playoff qualification goal for a given team code or division string.
 * @param {string} teamCodeOrDivision Team code or division string (e.g. '05U', '8U', '10U - Boys - Coach')
 * @returns {number} Required qualification points
 */
function getPlayoffGoalForTeam(teamCodeOrDivision) {
  if (!teamCodeOrDivision) return VOLUNTEER_POLICY.THRESHOLDS.DEFAULT;
  const s = String(teamCodeOrDivision).trim().toUpperCase();
  const t = VOLUNTEER_POLICY.THRESHOLDS;

  if (/PLAYGROUND|SCHOOLYARD/i.test(s)) {
    return t.PLAYGROUND;
  }
  // 5U & 6U: e.g. 05U, 5U, 06U, 6U, BU05, GU06, BU5, GU6, 5UB, 6UG, etc.
  if (/(?:^|[^\d])0?[56]U\b/i.test(s) || /\b[BG]U0?[56]\b/i.test(s) || /-[056]U/i.test(s) || /\b0?[56]U[BG]\b/i.test(s)) {
    return t.U5_U6;
  }
  // 8U: e.g. 08U, 8U, BU08, GU08, BU8, GU8, 8UB, 8UG, etc.
  if (/(?:^|[^\d])0?8U\b/i.test(s) || /\b[BG]U0?8\b/i.test(s) || /-0?8U/i.test(s) || /\b0?8U[BG]\b/i.test(s)) {
    return t.U8;
  }
  // 10U through 19U (10U, 12U, 14U, 16U, 19U)
  if (/(?:^|[^\d])1[02469]U\b/i.test(s) || /\b[BG]U1[02469]\b/i.test(s) || /-1[02469]U/i.test(s) || /\b1[02469]U[BG]\b/i.test(s)) {
    return t.U10_U19;
  }

  // Fallback regex matching general division pattern:
  const match = s.match(/(?:U0?(\d+)|0?(\d+)U)/i);
  if (match) {
    const divNum = parseInt(match[1] || match[2], 10);
    if (divNum === 5 || divNum === 6) return t.U5_U6;
    if (divNum === 8) return t.U8;
    if (divNum >= 10 && divNum <= 19) return t.U10_U19;
  }

  return t.DEFAULT;
}

/**
 * Dynamically generates the Google Sheets formula for Column L (Playoff Goal) using VOLUNTEER_POLICY.THRESHOLDS.
 * @param {number} rowNumber Row index in Season_Master_Ledger
 * @returns {string} Formula string
 */
function getLedgerGoalFormula(rowNumber) {
  const t = VOLUNTEER_POLICY.THRESHOLDS;
  return `=IF(REGEXMATCH($A${rowNumber}, "Playground"), ${t.PLAYGROUND}, IF(REGEXMATCH($A${rowNumber}, "05U|5U|06U|6U"), ${t.U5_U6}, IF(REGEXMATCH($A${rowNumber}, "08U|8U"), ${t.U8}, ${t.U10_U19})))`;
}

/**
 * Dynamically generates the Google Sheets formula for Column P (Gap to Playoff Goal with Full Setup).
 * @param {number} rowNumber Row index in Season_Master_Ledger
 * @returns {string} Formula string
 */
function getLedgerGapFormula(rowNumber) {
  return `=MAX(0, L${rowNumber} - O${rowNumber})`;
}

const ADMIN_CONFIG_SHEET = "Admin_Config";
var PRODUCTION_SHEET_ID = (typeof PRODUCTION_SHEET_ID !== 'undefined') ? PRODUCTION_SHEET_ID : "1RWPNUjVeRRcHiI18b8_IzLn1RzKHG3hLJvIbZjWq6Bc";
var PRODUCTION_FORM_ID = (typeof PRODUCTION_FORM_ID !== 'undefined') ? PRODUCTION_FORM_ID : "1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI";

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
    ["PlayoffThreshold", VOLUNTEER_POLICY.THRESHOLDS.DEFAULT],
    ["RefMaxCap", VOLUNTEER_POLICY.CATEGORY_CAPS.REFEREE],
    ["FieldMarshalCap", VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_MARSHAL],
    ["FieldSetupCap", VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_SETUP],
    ["PictureDayCap", VOLUNTEER_POLICY.CATEGORY_CAPS.PICTURE_DAY],
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
    PlayoffThreshold: VOLUNTEER_POLICY.THRESHOLDS.DEFAULT,
    RefMaxCap: VOLUNTEER_POLICY.CATEGORY_CAPS.REFEREE,
    FieldMarshalCap: VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_MARSHAL,
    FieldSetupCap: VOLUNTEER_POLICY.CATEGORY_CAPS.FIELD_SETUP,
    PictureDayCap: VOLUNTEER_POLICY.CATEGORY_CAPS.PICTURE_DAY,
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VOLUNTEER_POLICY,
    getPlayoffGoalForTeam,
    getLedgerGoalFormula,
    getLedgerGapFormula,
    setupAdminConfigSheet,
    getAuthorizedBoardEmails,
    getAdminConfigSettings,
    setAdminConfigSetting,
    getSupplementalTeams
  };
}
