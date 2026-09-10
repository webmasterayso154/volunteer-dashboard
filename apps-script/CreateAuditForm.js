/**
 * ============================================================================
 * AYSO REGION 154 - 2026 POST-SEASON PLAYOFF VOLUNTEER AUDIT FORM BUILDER
 * ============================================================================
 * File: CreateAuditForm.js
 * Description: Programmatically builds the multi-page, branching Google Form
 *              used by Head Coaches / Team Managers to dispute or backfill
 *              volunteer points ahead of the 17-point playoff threshold, and
 *              wires the response spreadsheet with the board's manual audit
 *              triage columns.
 *
 * Run `createAuditForm()` once from the Apps Script editor (or re-run any
 * time - it is idempotent and will rebuild the form/sheet in place rather
 * than creating duplicates).
 *
 * Brand reference (pulled from index.html / control-panel.html):
 *   - Navy:        #002D62 (header gradient start #001A38)
 *   - Accent Red:  #C8102E
 *   - Accent Blue: #93C5FD
 *   - Logo:        logo.png (repo root)
 *
 * NOTE ON BRANDING: The Apps Script FormApp service has no API for setting a
 * form's theme color or header image - that customization only exists in the
 * Forms UI (gear/paint-roller icon > Customize theme). This script cannot
 * guess a public URL for logo.png, so AUDIT_LOGO_URL below is left blank by
 * design. After running this script, a board member should open the form
 * once and manually: (1) set the theme color to Navy #002D62, and (2) upload
 * logo.png as the header image - or set AUDIT_LOGO_URL/AUDIT_LOGO_DRIVE_ID
 * below to a reachable image source and re-run to have it inserted as the
 * first item automatically.
 * ============================================================================
 */

const AUDIT_FORM_TITLE = "AYSO Region 154 - 2026 Post-Season Playoff Volunteer Audit";
const AUDIT_SPREADSHEET_NAME = "AYSO 154 - 2026 Playoff Audit Responses";

const BRAND_NAVY = "#002D62";
const BRAND_RED = "#C8102E";
const BRAND_ACCENT_BLUE = "#93C5FD";

// Optional: point at a reachable image (public URL or a Drive file ID this
// script's owner has view access to) to auto-insert the region logo as the
// form's first item. Left blank until someone supplies one - see note above.
const AUDIT_LOGO_URL = "";
const AUDIT_LOGO_DRIVE_ID = "";

const AUDIT_DEADLINE_TEXT = "Sunday, November 8, 2026, at 5:00 PM PDT";
const PLAYOFF_KICKOFF_TEXT = "Thursday, November 13, 2026";
const PLAYOFF_THRESHOLD = 17;

// Competitive divisions eligible for the 17-point playoff threshold, per the
// "Competitive Divisions (U8 - U19 & EXTRA)" guideline text in index.html.
// U5/U6 and Playground run on separate 8-point/4-point targets and are not
// audited against the 17-point threshold, so they are intentionally excluded
// from this form's division list.
const AUDIT_DIVISIONS = ["08U", "09U", "10U", "11U", "12U", "13U", "14U", "16U", "19U", "EXTRA"];

const SHIFT_CATEGORIES = ["Referee", "Field Marshal", "Friday Setup", "Picture Day"];

const AUDIT_STATUS_OPTIONS = ["Pending", "Approved", "Denied - No Tent Record", "Denied - Cap Met"];

/**
 * Entry point. Builds (or rebuilds) the audit form and links/prepares the
 * destination spreadsheet with the board's triage columns.
 */
function createAuditForm() {
  const form = getOrCreateAuditForm_();
  clearFormItems_(form);
  configureFormSettings_(form);
  insertBrandHeader_(form);

  // ---- Section 1: Gatekeeper & Triage --------------------------------
  const submitterRoleItem = form
    .addMultipleChoiceItem()
    .setTitle("Submitter Role")
    .setHelpText("Who is submitting this audit request?")
    .setRequired(true);

  form.addPageBreakItem().setTitle("Section 1: Points Check");

  const pointsItem = form
    .addMultipleChoiceItem()
    .setTitle("Current Verified Points")
    .setHelpText("Check the live standings dashboard before answering - the board does not audit teams that have already reached the " + PLAYOFF_THRESHOLD + "-point threshold.")
    .setRequired(true);

  form.addPageBreakItem().setTitle("Section 1: Acknowledgment");

  form
    .addCheckboxItem()
    .setTitle("Rolling Window Acknowledgment")
    .setHelpText("The board only audits shifts that fall inside the active 14-day rolling window and that are old enough for tent logs/match cards to have been reconciled.")
    .setChoiceValues([
      "I confirm this shift occurred within the 14-day rolling window and more than 48 hours ago."
    ])
    .setRequired(true);

  form
    .addPageBreakItem()
    .setTitle("Section 2: Team & Submitter Identification")
    .setHelpText("We use this information to route your ticket to the correct division auditor.");

  // ---- Section 2: Team & Submitter Identification --------------------
  form.addTextItem()
    .setTitle("Submitter Full Name")
    .setRequired(true);

  form.addTextItem()
    .setTitle("Submitter Cell Phone")
    .setHelpText("In case the auditor needs to reach you quickly about a discrepancy.")
    .setRequired(true);

  form.addTextItem()
    .setTitle("SportsConnect Registered Email")
    .setHelpText("Your automated ticket receipt and all audit correspondence, including a place to reply with photos, will be sent here.")
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build())
    .setRequired(true);

  form.addListItem()
    .setTitle("Division")
    .setChoiceValues(AUDIT_DIVISIONS)
    .setRequired(true);

  form.addTextItem()
    .setTitle("Head Coach Name")
    .setRequired(true);

  form.addTextItem()
    .setTitle("Team Number / Name")
    .setRequired(true);

  form.addPageBreakItem().setTitle("Section 3: Shift Details");

  // ---- Section 3: Shift Details ---------------------------------------
  form.addDateItem()
    .setTitle("Date of Shift")
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("Shift Category")
    .setChoiceValues(SHIFT_CATEGORIES)
    .setRequired(true);

  form.addTextItem()
    .setTitle("Volunteer Full Name")
    .setHelpText("As signed in on the tent clipboard or match card - this is what the board cross-references.")
    .setRequired(true);

  form.addTextItem()
    .setTitle("Field Location")
    .setRequired(true);

  form.addTextItem()
    .setTitle("Scheduled Time")
    .setHelpText('e.g. "8:00 AM" or "Friday 6:00 PM setup"')
    .setRequired(true);

  form.addPageBreakItem().setTitle("Section 3: Sibling Leakage Check");

  const siblingCheckItem = form
    .addMultipleChoiceItem()
    .setTitle("Does this volunteer have siblings playing on other AYSO 154 teams?")
    .setHelpText("This prevents accidental point miscrediting when a family has multiple players across divisions.")
    .setRequired(true);

  form.addPageBreakItem().setTitle("Section 3: Sibling Cross-Reference Details");

  form.addParagraphTextItem()
    .setTitle("Sibling Player Name(s)")
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle("Sibling Division(s)")
    .setHelpText("List one division per sibling named above.")
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle("Sibling Coach(es)")
    .setHelpText("List one coach per sibling named above.")
    .setRequired(true);

  const pbSection4 = form
    .addPageBreakItem()
    .setTitle("Section 4: Documentation & Code of Conduct");

  // ---- Section 4: Documentation & Code of Conduct ---------------------
  form.addTextItem()
    .setTitle("Photo Documentation Link")
    .setHelpText("Paste a shareable link to a cloud photo (Google Drive, iCloud, ImgBB, etc.) of the tent clipboard or match card. No Google Form file upload is used here to avoid forcing a Google login - you may also simply reply to your confirmation ticket email with photos attached.")
    .setRequired(false);

  form.addCheckboxItem()
    .setTitle("Code of Conduct Acknowledgment")
    .setChoiceValues([
      "I understand the board's check against the physical tent logs and match cards is final."
    ])
    .setRequired(true);

  // ---- Exit pages (Section 1 gate failures) ---------------------------
  const pbExitWrongSubmitter = form
    .addPageBreakItem()
    .setTitle("Submission Not Accepted")
    .setHelpText("Audit requests must be submitted through your Head Coach or Team Manager.")
    .setGoToPage(FormApp.PageNavigationType.SUBMIT);

  const pbExitAlreadyQualified = form
    .addPageBreakItem()
    .setTitle("Already Qualified")
    .setHelpText("Your team is already qualified for post-season play. Surplus points beyond " + PLAYOFF_THRESHOLD + " are not audited.")
    .setGoToPage(FormApp.PageNavigationType.SUBMIT);

  // ---- Wire up branching (targets above must all exist by this point) --
  submitterRoleItem.setChoices([
    submitterRoleItem.createChoice("Head Coach", FormApp.PageNavigationType.CONTINUE),
    submitterRoleItem.createChoice("Team Manager", FormApp.PageNavigationType.CONTINUE),
    submitterRoleItem.createChoice("Parent / Volunteer / Other", pbExitWrongSubmitter)
  ]);

  pointsItem.setChoices([
    pointsItem.createChoice("Already at " + PLAYOFF_THRESHOLD + "+ points", pbExitAlreadyQualified),
    pointsItem.createChoice("Under " + PLAYOFF_THRESHOLD + " points", FormApp.PageNavigationType.CONTINUE)
  ]);

  siblingCheckItem.setChoices([
    siblingCheckItem.createChoice("Yes", FormApp.PageNavigationType.CONTINUE),
    siblingCheckItem.createChoice("No", pbSection4)
  ]);

  linkAuditSpreadsheet_(form);

  Logger.log("Audit form ready.");
  Logger.log("Edit URL:      " + form.getEditUrl());
  Logger.log("Published URL: " + form.getPublishedUrl());
}

/**
 * Finds an existing audit form by title (so re-running this script updates
 * the same form instead of creating duplicates), or creates a new one.
 */
function getOrCreateAuditForm_() {
  const existing = DriveApp.getFilesByName(AUDIT_FORM_TITLE);
  if (existing.hasNext()) {
    return FormApp.openById(existing.next().getId());
  }
  return FormApp.create(AUDIT_FORM_TITLE);
}

/**
 * Removes all existing items so the form can be rebuilt cleanly on re-run.
 */
function clearFormItems_(form) {
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
}

function configureFormSettings_(form) {
  form.setTitle(AUDIT_FORM_TITLE);
  form.setDescription(
    "Use this form to dispute or backfill a volunteer shift ahead of post-season play.\n\n" +
    "HARD DEADLINE: " + AUDIT_DEADLINE_TEXT + ", prior to post-season kickoff on " + PLAYOFF_KICKOFF_TEXT + ". " +
    "Requests submitted after the deadline cannot be processed in time for playoff seeding.\n\n" +
    "Submitting this form triggers a full ledger check against physical tent logs and match cards. " +
    "The board does not audit teams that have already reached the " + PLAYOFF_THRESHOLD + "-point threshold - " +
    "surplus points are not banked or reviewed.\n\n" +
    "AYSO Region 154 - Cypress, CA"
  );
  form.setCollectEmail(false);
  form.setProgressBar(true);
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage(
    "Your audit request has been logged and a ticket has been opened. " +
    "A confirmation with your ticket details will be sent to the SportsConnect email you provided - " +
    "you can reply directly to that email with photo documentation if you did not paste a link above."
  );
}

/**
 * Inserts the region logo as the form's first item, if a reachable image
 * source has been configured. No-op (with a log message) otherwise, since
 * this script must not guess a public URL for logo.png.
 */
function insertBrandHeader_(form) {
  let blob = null;
  if (AUDIT_LOGO_DRIVE_ID) {
    blob = DriveApp.getFileById(AUDIT_LOGO_DRIVE_ID).getBlob();
  } else if (AUDIT_LOGO_URL) {
    blob = UrlFetchApp.fetch(AUDIT_LOGO_URL).getBlob();
  }

  if (!blob) {
    Logger.log(
      "No AUDIT_LOGO_URL / AUDIT_LOGO_DRIVE_ID configured - skipping automatic logo insert. " +
      "Add logo.png via the Forms UI (top-right image icon) and set the theme color to " + BRAND_NAVY + " (Navy) " +
      "with accents " + BRAND_RED + " (red) / " + BRAND_ACCENT_BLUE + " (accent blue) to match the dashboard branding."
    );
    return;
  }

  form.addImageItem()
    .setImage(blob)
    .setTitle("AYSO Region 154")
    .setAlignment(FormApp.Alignment.CENTER);
}

/**
 * Creates (or reuses) the destination spreadsheet for form responses and
 * appends the board's manual audit-triage columns next to the form-generated
 * response columns.
 */
function linkAuditSpreadsheet_(form) {
  let spreadsheetId = form.getDestinationId();

  if (!spreadsheetId) {
    const existing = DriveApp.getFilesByName(AUDIT_SPREADSHEET_NAME);
    const spreadsheet = existing.hasNext()
      ? SpreadsheetApp.openById(existing.next().getId())
      : SpreadsheetApp.create(AUDIT_SPREADSHEET_NAME);
    spreadsheetId = spreadsheet.getId();
    form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  }

  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets()[0];
  appendTriageColumns_(sheet);
}

/**
 * Appends the board's admin tracking columns immediately after the last
 * form-generated column, if they aren't already present.
 */
function appendTriageColumns_(sheet) {
  const triageHeaders = ["Audit Status", "Auditor Assigned", "Net Point Adjustment", "Internal Notes"];

  const lastColumn = sheet.getLastColumn();
  const existingHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];

  if (triageHeaders.every(h => existingHeaders.indexOf(h) !== -1)) {
    return; // Already wired up from a previous run.
  }

  const startColumn = lastColumn + 1;
  sheet.getRange(1, startColumn, 1, triageHeaders.length).setValues([triageHeaders]);
  sheet.getRange(1, startColumn, 1, triageHeaders.length)
    .setFontWeight("bold")
    .setBackground(BRAND_NAVY)
    .setFontColor("#FFFFFF");

  const auditStatusColumn = startColumn; // "Audit Status" is always the first triage column.
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(AUDIT_STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, auditStatusColumn, sheet.getMaxRows() - 1, 1).setDataValidation(statusRule);

  sheet.autoResizeColumns(startColumn, triageHeaders.length);
}
