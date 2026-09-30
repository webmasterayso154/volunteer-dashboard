/**
 * Cypress AYSO Region 154 — Fall 2026 Volunteer Point Review
 *
 * Deploy this as a standalone Apps Script project. Run setupAuditSystem() once.
 * The script creates a mobile-friendly Google Form, normalized audit workbook,
 * submission automation, duplicate-challenge detection, emails, and dashboard.
 *
 * Design rule: one Head Coach/Team Manager submission per team per challenge.
 * A team may submit a later, genuinely different challenge. Exact repeats are
 * flagged through a challenge fingerprint instead of silently creating work.
 */

const AUDIT = Object.freeze({
  VERSION: '2026.09.10',
  TIME_ZONE: 'America/Los_Angeles',
  REGION_NAME: 'Cypress AYSO Region 154',
  SEASON: 'Fall 2026',
  FORM_TITLE: 'Cypress AYSO Region 154 — Volunteer Point Review',
  SPREADSHEET_NAME: 'AYSO 154 - 2026 Playoff Audit Responses',
  REQUIRED_POINTS: 17,
  MAX_SHIFTS_PER_CHALLENGE: 5,
  POSTING_DELAY_HOURS: 48,
  LOOKBACK_DAYS: 14,
  STANDARD_CUTOFF: '2026-11-08T17:00:00-08:00',
  FINAL_WINDOW_START: '2026-11-07T00:00:00-08:00',
  FINAL_WINDOW_END: '2026-11-10T23:59:59-08:00',
  FINAL_EXCEPTION_CUTOFF: '2026-11-11T12:00:00-08:00',
  FINAL_DECISION_DEADLINE: '2026-11-11T18:00:00-08:00',
  ELIGIBILITY_CERTIFICATION: '2026-11-12T12:00:00-08:00',
  POST_SEASON_START: '2026-11-13T00:00:00-08:00',
  EARLY_RECONCILIATION: '2026-11-01T17:00:00-08:00',
  SUPPORT_EMAIL: '', // Optional. Add a monitored Region email before deployment.
  SEND_EMAILS: true,
  BRAND_NAVY: '#002D62',
  BRAND_RED: '#C8102E',
  BRAND_LIGHT_BLUE: '#DBEAFE',
  BRAND_GOLD: '#F4C542',
  VENUES: [
    'Park Lexington Fields',
    'Lexington Jr. HS Fields',
    'Other / Regional Event'
  ],
  DIVISIONS: [
    '08U - Boys', '08U - Girls', '09U - Boys', '09U - Girls',
    '10U - Boys', '10U - Girls', '11U - Boys', '11U - Girls',
    '12U - Boys', '12U - Girls', '13U - Boys', '13U - Girls',
    '14U - Boys', '14U - Girls', '16U - Boys', '16U - Girls',
    '19U - Boys', '19U - Girls', 'EXTRA'
  ],
  // Verify these caps with the Board before launch. Edit here and rerun
  // refreshConfigurationSheet() if Region policy changes.
  CATEGORIES: [
    { name: 'Referee (Center / Assistant Referee)', cap: 10, defaultPoints: 1 },
    { name: 'Field Marshal', cap: 2, defaultPoints: 1 },
    { name: 'Friday Field Setup', cap: 1, defaultPoints: 1 },
    { name: 'Picture Day / Special Regional Event', cap: 2, defaultPoints: 1 },
    { name: 'Other Board-Approved Assignment', cap: '', defaultPoints: 1 }
  ]
});

const PROP = Object.freeze({
  FORM_ID: 'AUDIT_FORM_ID',
  SPREADSHEET_ID: 'AUDIT_SPREADSHEET_ID',
  FORM_BUILT_VERSION: 'AUDIT_FORM_BUILT_VERSION',
  NEXT_TICKET: 'AUDIT_NEXT_TICKET'
});

const SHEET = Object.freeze({
  RESPONSES: 'Audit Submissions',
  LEGACY_RESPONSES: 'Form Responses',
  QUEUE: 'Audit Queue',
  SHIFTS: 'Shift Details',
  TEAM_STATUS: 'Team Status',
  DASHBOARD: 'Dashboard',
  CONFIG: 'Configuration',
  LOG: 'Audit Log'
});

const QUEUE_HEADERS = [
  'Ticket ID', 'Received Timestamp', 'Challenge Fingerprint', 'Duplicate Of',
  'Concurrent Team Ticket?', 'Request Type', 'Workflow Status', 'Decision',
  'Priority', 'Timely?', 'Applicable Deadline', 'Submitter Name',
  'Submitter Role', 'Email', 'Cell Phone', 'Division', 'Team Code',
  'Head Coach', 'Current Verified Points', 'Points Needed', 'Shift Count',
  'Potential Points', 'Net Point Adjustment', 'Revised Team Total',
  'Qualification Result', 'Sibling / Multi-Team?', 'Possible Cross-Team Allocation?',
  'Sibling Details', 'Auditor Assigned', 'Physical Log Reference',
  'Auditor Notes', 'Missing Information', 'Decision Date',
  'Notification Status', 'Notification Timestamp', 'Form Response ID'
];

const SHIFT_HEADERS = [
  'Ticket ID', 'Shift Number', 'Team Code', 'Division', 'Shift Start',
  'Venue', 'Field / Location', 'Volunteer Full Name', 'Category',
  'Expected Points', 'Team Credited at Check-In', 'Evidence / Identifying Details',
  'Supporting Link', 'Shift Classification', 'Applicable Deadline',
  'Timely?', '48-Hour Posting Window Complete?', 'Shift Decision',
  'Approved Points', 'Physical Log Reference', 'Auditor Notes'
];

/** Primary deployment entry point. Safe to rerun. */
function setupAuditSystem() {
  validateConfiguration_();
  const ss = getOrCreateSpreadsheet_();
  ensureWorkbook_(ss);
  const form = getOrCreateForm_();

  if (PropertiesService.getScriptProperties().getProperty(PROP.FORM_BUILT_VERSION) !== AUDIT.VERSION) {
    if (form.getItems().length > 0) {
      throw new Error(
        'An existing form was found but its build version differs. To protect live responses, ' +
        'run rebuildAuditForm() intentionally or update AUDIT.VERSION only after reviewing changes.'
      );
    }
    buildAuditForm_(form);
    PropertiesService.getScriptProperties().setProperty(PROP.FORM_BUILT_VERSION, AUDIT.VERSION);
  }

  linkFormToSpreadsheet_(form, ss);
  installAuditTriggers_();
  refreshFormPhase();
  refreshDashboard();
  writeSetupReport_(ss, form);

  Logger.log('Form edit URL: ' + form.getEditUrl());
  Logger.log('Form respondent URL: ' + form.getPublishedUrl());
  Logger.log('Response workbook: ' + ss.getUrl());
}

/**
 * Deliberately rebuilds the questions in the existing form.
 * Existing response rows remain in the destination spreadsheet, but item
 * mappings may change. Use before launch or after making a backup.
 */
function rebuildAuditForm() {
  const form = getOrCreateForm_();
  for (let i = form.getItems().length - 1; i >= 0; i--) form.deleteItem(i);
  buildAuditForm_(form);
  PropertiesService.getScriptProperties().setProperty(PROP.FORM_BUILT_VERSION, AUDIT.VERSION);
  refreshFormPhase();
}

function buildAuditForm_(form) {
  form
    .setTitle(AUDIT.FORM_TITLE)
    .setDescription(formDescriptionForPhase_(new Date()))
    .setConfirmationMessage(
      'Thank you. Your volunteer point review request has been received.\n\n' +
      'A confirmation email will include your ticket number. Please do not submit the same ' +
      'challenge again. If the Board needs more information, reply to the confirmation email.'
    )
    .setAllowResponseEdits(false)
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setProgressBar(true)
    .setPublishingSummary(false)
    .setShowLinkToRespondAgain(false)
    .setShuffleQuestions(false)
    .setIsQuiz(false)
    .setPublished(true);

  // PAGE 1 — role gate.
  const role = form.addMultipleChoiceItem()
    .setTitle('What is your official role for this team?')
    .setHelpText('One rostered Head Coach or Team Manager should submit each team challenge.')
    .setRequired(true);

  // This PageBreakItem begins the threshold page. Role choices jump here.
  const thresholdPage = form.addPageBreakItem()
    .setTitle('Check the Team Dashboard First')
    .setHelpText('Teams at 17 verified points are already qualified and do not need a review.');

  const points = form.addListItem()
    .setTitle('How many verified points are currently shown for your team?')
    .setHelpText('Use the live dashboard total. Choose 17+ if the team has already qualified.')
    .setRequired(true);

  // PAGE 3 — team identity.
  const identityPage = form.addPageBreakItem()
    .setTitle('Team Leadership and Team Information')
    .setHelpText('Enter the information exactly as it appears in SportsConnect and the dashboard.');

  addRequiredText_(form, 'Submitter Full Name');
  addRequiredText_(form, 'SportsConnect Registered Email')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  addRequiredText_(form, 'Submitter Cell Phone Number')
    .setHelpText('Used only if the auditor needs clarification.');
  form.addListItem().setTitle('Division').setChoiceValues(AUDIT.DIVISIONS).setRequired(true);
  addRequiredText_(form, 'Team Number or Dashboard Code')
    .setHelpText('Example: 10UB-04. Use the exact code shown on the dashboard.');
  addRequiredText_(form, 'Head Coach Full Name');

  // PAGE 4 — first shift is always required.
  const shift1Page = form.addPageBreakItem()
    .setTitle('Missing Shift 1')
    .setHelpText('Provide the details needed to locate the physical or digital record.');
  addShiftQuestions_(form, 1, true);
  const more1 = addMoreShiftQuestion_(form, 2);

  const shift2Page = form.addPageBreakItem().setTitle('Missing Shift 2');
  addShiftQuestions_(form, 2, true);
  const more2 = addMoreShiftQuestion_(form, 3);

  const shift3Page = form.addPageBreakItem().setTitle('Missing Shift 3');
  addShiftQuestions_(form, 3, true);
  const more3 = addMoreShiftQuestion_(form, 4);

  const shift4Page = form.addPageBreakItem().setTitle('Missing Shift 4');
  addShiftQuestions_(form, 4, true);
  const more4 = addMoreShiftQuestion_(form, 5);

  const shift5Page = form.addPageBreakItem()
    .setTitle('Missing Shift 5')
    .setHelpText('Five is the maximum number of shifts in one consolidated challenge.');
  addShiftQuestions_(form, 5, true);

  // PAGE 9 — sibling and multi-team allocation check.
  const siblingPage = form.addPageBreakItem()
    .setTitle('Sibling and Multi-Team Check')
    .setHelpText('This helps locate points accidentally credited to another child or team.');
  form.addMultipleChoiceItem()
    .setTitle('Does any listed volunteer have a player on another Region 154 team?')
    .setChoiceValues(['No', 'Yes', 'Not sure'])
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('Sibling or Other-Team Details')
    .setHelpText('If Yes or Not sure, list the player name, division, team code, and coach if known.');

  // PAGE 10 — certification.
  const certificationPage = form.addPageBreakItem()
    .setTitle('Review and Certification')
    .setHelpText('Please confirm each statement before submitting.');
  const acknowledgments = [
    'I am the rostered Head Coach or Team Manager for this team.',
    'I checked the current team total on the live dashboard before submitting.',
    'I am submitting one consolidated request for this specific team challenge.',
    'Except for the final-game exception, I allowed 48 hours for each shift to post.',
    'The information is accurate to the best of my knowledge.'
  ];
  form.addCheckboxItem()
    .setTitle('Required acknowledgments')
    .setChoiceValues(acknowledgments)
    .setValidation(
      FormApp.createCheckboxValidation()
        .requireSelectExactly(acknowledgments.length)
        .setHelpText('Select all five acknowledgments to continue.')
        .build()
    )
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('Anything Else the Auditor Should Know?')
    .setHelpText('Optional. Do not repeat the shift details already entered.');

  // PAGE 11 — terminal role screen.
  const roleExitPage = form.addPageBreakItem()
    .setTitle('Please Coordinate Through Team Leadership')
    .setHelpText(
      'Thank you for volunteering. To keep the review process manageable and prevent duplicate ' +
      'requests, please send your information to your Head Coach or Team Manager. They can review ' +
      'the team total and submit one consolidated challenge through the private leadership link.'
    );

  // PAGE 12 — terminal qualified-team screen.
  const qualifiedExitPage = form.addPageBreakItem()
    .setTitle('Your Team Is Already Qualified')
    .setHelpText(
      'Your team has reached the 17 verified points required for post-season eligibility. ' +
      'Additional points do not change qualification or seeding, so no audit request is needed.'
    );

  // Branch wiring. A PageBreakItem's navigation setting applies to the page
  // immediately before that page break; choice-based navigation takes priority.
  role.setChoices([
    role.createChoice('Head Coach', thresholdPage),
    role.createChoice('Team Manager', thresholdPage),
    role.createChoice('Parent / Volunteer / Other', roleExitPage)
  ]);

  const pointChoices = [];
  for (let p = 0; p < AUDIT.REQUIRED_POINTS; p++) {
    pointChoices.push(points.createChoice(String(p), identityPage));
  }
  pointChoices.push(points.createChoice('17 or more — team is qualified', qualifiedExitPage));
  points.setChoices(pointChoices);

  more1.setChoices([
    more1.createChoice('Yes — add Shift 2', shift2Page),
    more1.createChoice('No — continue', siblingPage)
  ]);
  more2.setChoices([
    more2.createChoice('Yes — add Shift 3', shift3Page),
    more2.createChoice('No — continue', siblingPage)
  ]);
  more3.setChoices([
    more3.createChoice('Yes — add Shift 4', shift4Page),
    more3.createChoice('No — continue', siblingPage)
  ]);
  more4.setChoices([
    more4.createChoice('Yes — add Shift 5', shift5Page),
    more4.createChoice('No — continue', siblingPage)
  ]);

  // Completing Shift 5 proceeds linearly to sibling review.
  // Completing certification submits instead of displaying a terminal page.
  roleExitPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
  // Completing the role terminal page submits. The qualified page is last and
  // therefore submits naturally.
  qualifiedExitPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
}

function addRequiredText_(form, title) {
  return form.addTextItem().setTitle(title).setRequired(true);
}

function addMoreShiftQuestion_(form, nextNumber) {
  return form.addMultipleChoiceItem()
    .setTitle('Do you need to include another missing shift in this same challenge?')
    .setHelpText('Choose Yes only when it belongs to this same team review request.')
    .setRequired(true);
}

function addShiftQuestions_(form, number, required) {
  const prefix = 'Shift ' + number + ' — ';
  form.addDateTimeItem()
    .setTitle(prefix + 'Start Date and Approximate Time')
    .setHelpText('Use the scheduled start time or the closest time you remember.')
    .setRequired(required);
  form.addListItem()
    .setTitle(prefix + 'Venue')
    .setChoiceValues(AUDIT.VENUES)
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Field Number or Specific Location')
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Volunteer Full Name')
    .setHelpText('Use the name entered at the tent, QR check-in, or referee record.')
    .setRequired(required);
  form.addListItem()
    .setTitle(prefix + 'Category')
    .setChoiceValues(AUDIT.CATEGORIES.map(function (c) { return c.name; }))
    .setRequired(required);
  form.addListItem()
    .setTitle(prefix + 'Expected Points')
    .setChoiceValues(['1', '2', '3', '4', '5'])
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Team Credited at Check-In, if Known')
    .setHelpText('Leave blank if the volunteer selected this team or does not remember.');
  form.addParagraphTextItem()
    .setTitle(prefix + 'Evidence or Identifying Details')
    .setHelpText('Example: QR confirmation, match card, paper backup, field tent, or referee crew.')
    .setRequired(required);
  form.addTextItem()
    .setTitle(prefix + 'Supporting Documentation Link')
    .setHelpText(
      'Optional. Use a viewable link or reply to the ticket email with attachments. ' +
      'Do not place sensitive personal information in a publicly shared file.'
    );
}

/** Form submission trigger. */
function handleAuditFormSubmit(e) {
  if (!e || !e.response) throw new Error('This function must run from an installable Form submit trigger.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    processFormResponse_(e.response);
  } finally {
    lock.releaseLock();
  }
}

function processFormResponse_(response) {
  const ss = getAuditSpreadsheet_();
  const answers = responseMap_(response);
  const received = response.getTimestamp();
  const ticketId = nextTicketId_();
  const currentPoints = parseInt(String(answers['How many verified points are currently shown for your team?'] || '0'), 10) || 0;
  const teamCode = normalizeTeamCode_(answers['Team Number or Dashboard Code']);
  const division = clean_(answers.Division);
  const email = clean_(answers['SportsConnect Registered Email']);
  const shifts = extractShifts_(answers, ticketId, teamCode, division, received);
  const potentialPoints = shifts.reduce(function (sum, shift) { return sum + shift.expectedPoints; }, 0);
  const pointsNeeded = Math.max(0, AUDIT.REQUIRED_POINTS - currentPoints);
  const fingerprint = challengeFingerprint_(teamCode, shifts);
  const duplicateOf = findDuplicateTicket_(ss, fingerprint);
  const concurrent = findConcurrentTeamTicket_(ss, teamCode);
  const timing = summarizeTicketTiming_(shifts, received);
  const sibling = clean_(answers['Does any listed volunteer have a player on another Region 154 team?']);
  const missingInfo = findMissingInformation_(answers, shifts);

  let requestType = timing.requestType;
  let workflow = missingInfo ? 'Needs Information' : 'New';
  let decision = 'Pending';
  let priority = calculatePriority_(pointsNeeded, potentialPoints, received, timing, missingInfo);

  if (currentPoints >= AUDIT.REQUIRED_POINTS) {
    requestType = 'Already Qualified';
    workflow = 'Closed';
    decision = 'Not Needed — Team Already Qualified';
    priority = 'Closed';
  } else if (duplicateOf) {
    requestType = 'Duplicate Challenge';
    workflow = 'Closed';
    decision = 'Duplicate';
    priority = 'Closed';
  } else if (!timing.timely) {
    requestType = 'Untimely — Board Confirmation Required';
    workflow = 'Ready for Decision';
    decision = 'Pending';
    priority = 'Urgent Review';
  } else if (timing.hasTooRecentStandardShift) {
    workflow = 'Waiting — 48-Hour Posting Window';
  }

  const queueRow = objectToRow_(QUEUE_HEADERS, {
    'Ticket ID': ticketId,
    'Received Timestamp': received,
    'Challenge Fingerprint': fingerprint,
    'Duplicate Of': duplicateOf,
    'Concurrent Team Ticket?': concurrent ? 'Yes — ' + concurrent : 'No',
    'Request Type': requestType,
    'Workflow Status': workflow,
    'Decision': decision,
    'Priority': priority,
    'Timely?': timing.timely ? 'Yes' : 'No',
    'Applicable Deadline': timing.applicableDeadline,
    'Submitter Name': clean_(answers['Submitter Full Name']),
    'Submitter Role': clean_(answers['What is your official role for this team?']),
    'Email': email,
    'Cell Phone': clean_(answers['Submitter Cell Phone Number']),
    'Division': division,
    'Team Code': teamCode,
    'Head Coach': clean_(answers['Head Coach Full Name']),
    'Current Verified Points': currentPoints,
    'Points Needed': pointsNeeded,
    'Shift Count': shifts.length,
    'Potential Points': potentialPoints,
    'Net Point Adjustment': '',
    'Revised Team Total': currentPoints,
    'Qualification Result': currentPoints >= AUDIT.REQUIRED_POINTS ? 'Qualified' : 'Pending',
    'Sibling / Multi-Team?': sibling,
    'Possible Cross-Team Allocation?': sibling === 'Yes' || sibling === 'Not sure' ? 'Yes' : 'No',
    'Sibling Details': clean_(answers['Sibling or Other-Team Details']),
    'Auditor Assigned': '',
    'Physical Log Reference': '',
    'Auditor Notes': '',
    'Missing Information': missingInfo,
    'Decision Date': '',
    'Notification Status': '',
    'Notification Timestamp': '',
    'Form Response ID': response.getId()
  });

  appendRow_(ss.getSheetByName(SHEET.QUEUE), queueRow);
  shifts.forEach(function (shift) {
    appendRow_(ss.getSheetByName(SHEET.SHIFTS), objectToRow_(SHIFT_HEADERS, shift));
  });
  appendAuditLog_(ss, ticketId, 'Created', '', workflow, 'Automated intake');
  upsertTeamStatus_(ss, teamCode, division, currentPoints, ticketId, workflow);
  refreshDashboard();

  if (AUDIT.SEND_EMAILS && email) {
    sendAcknowledgment_(email, ticketId, teamCode, shifts.length, timing, workflow, duplicateOf, missingInfo);
    updateQueueNotification_(ss, ticketId, 'Acknowledgment Sent');
  }
}

function responseMap_(response) {
  const map = {};
  response.getItemResponses().forEach(function (itemResponse) {
    map[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });
  return map;
}

function extractShifts_(answers, ticketId, teamCode, division, received) {
  const shifts = [];
  for (let n = 1; n <= AUDIT.MAX_SHIFTS_PER_CHALLENGE; n++) {
    const prefix = 'Shift ' + n + ' — ';
    const start = answers[prefix + 'Start Date and Approximate Time'];
    if (!start) continue;
    const timing = classifyShiftTiming_(new Date(start), received);
    shifts.push({
      'Ticket ID': ticketId,
      'Shift Number': n,
      'Team Code': teamCode,
      'Division': division,
      'Shift Start': new Date(start),
      'Venue': clean_(answers[prefix + 'Venue']),
      'Field / Location': clean_(answers[prefix + 'Field Number or Specific Location']),
      'Volunteer Full Name': clean_(answers[prefix + 'Volunteer Full Name']),
      'Category': clean_(answers[prefix + 'Category']),
      'Expected Points': parseInt(answers[prefix + 'Expected Points'], 10) || 0,
      'Team Credited at Check-In': clean_(answers[prefix + 'Team Credited at Check-In, if Known']),
      'Evidence / Identifying Details': clean_(answers[prefix + 'Evidence or Identifying Details']),
      'Supporting Link': clean_(answers[prefix + 'Supporting Documentation Link']),
      'Shift Classification': timing.classification,
      'Applicable Deadline': timing.deadline,
      'Timely?': timing.timely ? 'Yes' : 'No',
      '48-Hour Posting Window Complete?': timing.postingWindowComplete ? 'Yes' : 'No',
      'Shift Decision': 'Pending',
      'Approved Points': '',
      'Physical Log Reference': '',
      'Auditor Notes': ''
    });
  }
  return shifts;
}

function classifyShiftTiming_(shiftStart, received) {
  const standardCutoff = new Date(AUDIT.STANDARD_CUTOFF);
  const finalStart = new Date(AUDIT.FINAL_WINDOW_START);
  const finalEnd = new Date(AUDIT.FINAL_WINDOW_END);
  const finalCutoff = new Date(AUDIT.FINAL_EXCEPTION_CUTOFF);
  const inFinalWindow = shiftStart >= finalStart && shiftStart <= finalEnd;
  const postingReady = received.getTime() >= shiftStart.getTime() + AUDIT.POSTING_DELAY_HOURS * 3600000;
  const lookbackDeadline = new Date(shiftStart.getTime() + AUDIT.LOOKBACK_DAYS * 86400000);
  const deadline = inFinalWindow
    ? finalCutoff
    : new Date(Math.min(lookbackDeadline.getTime(), standardCutoff.getTime()));
  const timely = received <= deadline && received >= shiftStart;

  let classification = inFinalWindow ? 'Final-Game Exception' : 'Standard Review';
  if (received < shiftStart) classification = 'Invalid — Future Shift';
  else if (!timely) classification = 'Untimely';
  else if (!inFinalWindow && !postingReady) classification = 'Waiting — 48-Hour Posting Window';

  return {
    classification: classification,
    requestType: inFinalWindow ? 'Final-Game Exception' : 'Standard Review',
    deadline: deadline,
    timely: timely,
    postingWindowComplete: postingReady || inFinalWindow,
    inFinalWindow: inFinalWindow
  };
}

function summarizeTicketTiming_(shifts, received) {
  if (!shifts.length) {
    return {
      requestType: 'Incomplete', timely: false, applicableDeadline: received,
      hasTooRecentStandardShift: false
    };
  }
  const allFinal = shifts.every(function (s) { return s['Shift Classification'] === 'Final-Game Exception'; });
  const anyFinal = shifts.some(function (s) { return s['Shift Classification'] === 'Final-Game Exception'; });
  const timely = shifts.every(function (s) { return s['Timely?'] === 'Yes'; });
  const deadline = shifts.reduce(function (earliest, s) {
    const d = new Date(s['Applicable Deadline']);
    return !earliest || d < earliest ? d : earliest;
  }, null);
  return {
    requestType: allFinal ? 'Final-Game Exception' : (anyFinal ? 'Mixed — Standard and Final-Game' : 'Standard Review'),
    timely: timely,
    applicableDeadline: deadline,
    hasTooRecentStandardShift: shifts.some(function (s) {
      return s['Shift Classification'] === 'Waiting — 48-Hour Posting Window';
    })
  };
}

function challengeFingerprint_(teamCode, shifts) {
  const parts = shifts.map(function (s) {
    return [
      dateKey_(s['Shift Start']),
      normalize_(s['Volunteer Full Name']),
      normalize_(s.Category),
      normalize_(s.Venue),
      normalize_(s['Field / Location'])
    ].join('|');
  }).sort();
  const raw = normalizeTeamCode_(teamCode) + '||' + parts.join('||');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 24);
}

function findDuplicateTicket_(ss, fingerprint) {
  if (!fingerprint) return '';
  const sheet = ss.getSheetByName(SHEET.QUEUE);
  const rows = dataObjects_(sheet);
  const match = rows.find(function (row) { return String(row['Challenge Fingerprint']) === fingerprint; });
  return match ? String(match['Ticket ID']) : '';
}

function findConcurrentTeamTicket_(ss, teamCode) {
  const openStatuses = ['New', 'Needs Information', 'Assigned', 'In Review', 'Ready for Decision', 'Waiting — 48-Hour Posting Window'];
  const rows = dataObjects_(ss.getSheetByName(SHEET.QUEUE));
  const match = rows.find(function (row) {
    return normalizeTeamCode_(row['Team Code']) === teamCode && openStatuses.indexOf(String(row['Workflow Status'])) >= 0;
  });
  return match ? String(match['Ticket ID']) : '';
}

function calculatePriority_(pointsNeeded, potentialPoints, received, timing, missingInfo) {
  if (missingInfo) return 'Needs Information';
  if (!timing.timely) return 'Urgent Review';
  if (timing.requestType.indexOf('Final-Game') >= 0) return 'Critical — Final Window';
  if (potentialPoints >= pointsNeeded && pointsNeeded <= 3) return 'High — Qualification Impact';
  const hoursLeft = (new Date(AUDIT.FINAL_DECISION_DEADLINE).getTime() - received.getTime()) / 3600000;
  return hoursLeft <= 72 ? 'High — Deadline Near' : 'Normal';
}

function findMissingInformation_(answers, shifts) {
  const missing = [];
  if (!clean_(answers['Team Number or Dashboard Code'])) missing.push('Team code');
  if (!clean_(answers['SportsConnect Registered Email'])) missing.push('Email');
  if (!shifts.length) missing.push('Shift details');
  shifts.forEach(function (s) {
    if (!s['Volunteer Full Name']) missing.push('Shift ' + s['Shift Number'] + ' volunteer name');
    if (!s.Venue) missing.push('Shift ' + s['Shift Number'] + ' venue');
  });
  return Array.from(new Set(missing)).join('; ');
}

function nextTicketId_() {
  const props = PropertiesService.getScriptProperties();
  const next = parseInt(props.getProperty(PROP.NEXT_TICKET) || '1', 10);
  props.setProperty(PROP.NEXT_TICKET, String(next + 1));
  return 'R154-2026-' + String(next).padStart(4, '0');
}

function sendAcknowledgment_(email, ticketId, teamCode, shiftCount, timing, workflow, duplicateOf, missingInfo) {
  let statusText = 'Your request is in the audit queue.';
  if (duplicateOf) statusText = 'This appears to duplicate ticket ' + duplicateOf + '. The Board will use the earlier ticket.';
  else if (!timing.timely) statusText = 'The request was received outside the applicable filing window and is pending a final timeliness decision.';
  else if (missingInfo) statusText = 'More information is needed: ' + missingInfo + '.';
  else if (workflow === 'Waiting — 48-Hour Posting Window') statusText = 'At least one standard shift is still inside the normal 48-hour posting window.';

  const subject = '[' + ticketId + '] Region 154 volunteer point review received';
  const body = [
    'Thank you. Your Region 154 volunteer point review request has been received.',
    '',
    'Ticket: ' + ticketId,
    'Team: ' + teamCode,
    'Shifts included: ' + shiftCount,
    'Request type: ' + timing.requestType,
    'Applicable deadline: ' + formatDateTime_(timing.applicableDeadline),
    '',
    statusText,
    '',
    'Please do not submit this same challenge again. If additional documentation is requested, reply to this email and keep the ticket number in the subject.',
    '',
    'Submission does not guarantee that points will be approved. The Board will compare the request with the official field, event, and referee records.',
    '',
    'Cypress AYSO Region 154'
  ].join('\n');
  const options = { name: AUDIT.REGION_NAME };
  if (AUDIT.SUPPORT_EMAIL) options.replyTo = AUDIT.SUPPORT_EMAIL;
  MailApp.sendEmail(email, subject, body, options);
}

/** Spreadsheet edit trigger: logs workflow/decision changes and sends decisions. */
function handleAuditQueueEdit(e) {
  if (!e || !e.range || e.range.getRow() < 2) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET.QUEUE) return;
  const headers = headerMap_(sheet);
  const editedHeader = sheet.getRange(1, e.range.getColumn()).getValue();
  if (['Workflow Status', 'Decision', 'Net Point Adjustment', 'Auditor Assigned'].indexOf(editedHeader) < 0) return;

  const row = rowObject_(sheet, e.range.getRow());
  appendAuditLog_(
    sheet.getParent(), String(row['Ticket ID']), editedHeader,
    typeof e.oldValue === 'undefined' ? '' : e.oldValue,
    typeof e.value === 'undefined' ? '' : e.value,
    Session.getActiveUser().getEmail() || 'Board editor'
  );

  if (editedHeader === 'Net Point Adjustment') {
    const adjustment = Number(row['Net Point Adjustment']) || 0;
    const revised = Math.min(AUDIT.REQUIRED_POINTS, Number(row['Current Verified Points']) + Math.max(0, adjustment));
    sheet.getRange(e.range.getRow(), headers['Revised Team Total']).setValue(revised);
    sheet.getRange(e.range.getRow(), headers['Qualification Result'])
      .setValue(revised >= AUDIT.REQUIRED_POINTS ? 'Qualified' : 'Not Qualified');
    upsertTeamStatus_(
      sheet.getParent(), normalizeTeamCode_(row['Team Code']), row.Division,
      revised, row['Ticket ID'], revised >= AUDIT.REQUIRED_POINTS ? 'Qualified' : row['Workflow Status']
    );
    if (['Approved', 'Partially Approved'].indexOf(String(row.Decision)) >= 0 &&
        row['Notification Status'] === 'Awaiting Net Point Adjustment') {
      if (AUDIT.SEND_EMAILS) sendDecisionEmail_(sheet, e.range.getRow(), headers);
      sheet.getRange(e.range.getRow(), headers['Workflow Status']).setValue('Closed');
      appendAuditLog_(sheet.getParent(), String(row['Ticket ID']), 'Workflow Status', row['Workflow Status'], 'Closed', 'Automated after adjustment');
    }
  }

  if (editedHeader === 'Decision' && String(e.value || '') !== 'Pending') {
    sheet.getRange(e.range.getRow(), headers['Decision Date']).setValue(new Date());
    const approvedDecision = ['Approved', 'Partially Approved'].indexOf(String(e.value)) >= 0;
    if (approvedDecision && row['Net Point Adjustment'] === '') {
      sheet.getRange(e.range.getRow(), headers['Notification Status']).setValue('Awaiting Net Point Adjustment');
    } else {
      if (String(e.value) !== 'Duplicate' && AUDIT.SEND_EMAILS) {
        sendDecisionEmail_(sheet, e.range.getRow(), headers);
      }
      sheet.getRange(e.range.getRow(), headers['Workflow Status']).setValue('Closed');
      appendAuditLog_(sheet.getParent(), String(row['Ticket ID']), 'Workflow Status', row['Workflow Status'], 'Closed', 'Automated after decision');
    }
  }
  refreshDashboard();
}

function sendDecisionEmail_(sheet, rowNumber, headers) {
  const row = rowObject_(sheet, rowNumber);
  const email = clean_(row.Email);
  if (!email || row['Notification Status'] === 'Decision Sent') return;
  const ticketId = row['Ticket ID'];
  const subject = '[' + ticketId + '] Region 154 volunteer point review decision';
  const body = [
    'The Board has completed its review of your volunteer point challenge.',
    '',
    'Ticket: ' + ticketId,
    'Team: ' + row['Team Code'],
    'Decision: ' + row.Decision,
    'Net point adjustment: ' + (row['Net Point Adjustment'] === '' ? '0' : row['Net Point Adjustment']),
    'Revised verified total: ' + row['Revised Team Total'],
    'Eligibility result: ' + row['Qualification Result'],
    '',
    clean_(row['Auditor Notes']) || 'No additional notes were entered.',
    '',
    'Thank you for supporting Cypress AYSO Region 154.'
  ].join('\n');
  const options = { name: AUDIT.REGION_NAME };
  if (AUDIT.SUPPORT_EMAIL) options.replyTo = AUDIT.SUPPORT_EMAIL;
  MailApp.sendEmail(email, subject, body, options);
  sheet.getRange(rowNumber, headers['Notification Status']).setValue('Decision Sent');
  sheet.getRange(rowNumber, headers['Notification Timestamp']).setValue(new Date());
}

function refreshFormPhase() {
  const form = getOrCreateForm_();
  const now = new Date();
  form.setDescription(formDescriptionForPhase_(now));
  if (now > new Date(AUDIT.FINAL_EXCEPTION_CUTOFF)) {
    form.setCustomClosedFormMessage(
      'The Fall 2026 volunteer point review window closed Wednesday, November 11 at noon Pacific Time. ' +
      'The Board is completing final eligibility certification.'
    );
    form.setAcceptingResponses(false);
  } else {
    form.setAcceptingResponses(true);
  }
}

function formDescriptionForPhase_(now) {
  const standardCutoff = new Date(AUDIT.STANDARD_CUTOFF);
  const finalCutoff = new Date(AUDIT.FINAL_EXCEPTION_CUTOFF);
  const intro =
    'FALL 2026 POST-SEASON ELIGIBILITY\n\n' +
    'This private link is for rostered Head Coaches and Team Managers. Submit one consolidated ' +
    'request per team challenge. Teams with 17 verified points are already qualified.\n\n';
  if (now <= standardCutoff) {
    return intro +
      'STANDARD REQUEST DEADLINE: Sunday, November 8 at 5:00 PM Pacific Time.\n' +
      'Allow 48 hours for a completed shift to appear. Ordinary discrepancies must be submitted ' +
      'within 14 calendar days of the shift and no later than the standard deadline.\n\n' +
      'Shifts worked November 7–10 have a limited final-game exception ending Wednesday, November 11 at noon Pacific Time.';
  }
  if (now <= finalCutoff) {
    return intro +
      'FINAL-GAME EXCEPTION ONLY: The standard request window has closed. New submissions are accepted ' +
      'only for shifts completed November 7–10. The exception closes Wednesday, November 11 at noon Pacific Time. ' +
      'It cannot revive an older discrepancy.';
  }
  return intro + 'The Fall 2026 submission window is closed.';
}

function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create(AUDIT.SPREADSHEET_NAME);
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  ss.setSpreadsheetTimeZone(AUDIT.TIME_ZONE);
  return ss;
}

function getOrCreateForm_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP.FORM_ID);
  if (id) return FormApp.openById(id);
  const form = FormApp.create(AUDIT.FORM_TITLE);
  props.setProperty(PROP.FORM_ID, form.getId());
  return form;
}

function getAuditSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!id) throw new Error('Run setupAuditSystem() first.');
  return SpreadsheetApp.openById(id);
}

function ensureWorkbook_(ss) {
  ss.setSpreadsheetTimeZone(AUDIT.TIME_ZONE);
  const first = ss.getSheets()[0];
  if (ss.getSheets().length === 1 && first.getLastRow() === 0 && first.getName() === 'Sheet1') {
    first.setName(SHEET.CONFIG);
  }
  ensureSheet_(ss, SHEET.CONFIG, ['Setting', 'Value', 'Notes']);
  ensureSheet_(ss, SHEET.QUEUE, QUEUE_HEADERS);
  ensureSheet_(ss, SHEET.SHIFTS, SHIFT_HEADERS);
  ensureSheet_(ss, SHEET.TEAM_STATUS, [
    'Team Code', 'Division', 'Current Verified Points', 'Points Needed',
    'Reconciliation Status', 'Latest Ticket ID', 'Last Updated'
  ]);
  ensureSheet_(ss, SHEET.DASHBOARD, ['Metric', 'Value']);
  ensureSheet_(ss, SHEET.LOG, ['Timestamp', 'Ticket ID', 'Field / Event', 'Old Value', 'New Value', 'Changed By']);
  refreshConfigurationSheet();
  applyQueueValidation_(ss.getSheetByName(SHEET.QUEUE));
  applyWorkbookFormatting_(ss);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else {
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach(function (header, i) {
      if (!existing[i]) sheet.getRange(1, i + 1).setValue(header);
      else if (existing[i] !== header) throw new Error('Unexpected header in ' + name + ' column ' + (i + 1) + ': ' + existing[i]);
    });
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function linkFormToSpreadsheet_(form, ss) {
  let destinationId = '';
  try { destinationId = form.getDestinationId() || ''; } catch (err) { destinationId = ''; }
  if (destinationId && destinationId !== ss.getId()) {
    throw new Error('The form is already linked to a different spreadsheet. Disconnect it manually before continuing.');
  }
  if (!destinationId) form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  const responseSheet = waitForResponseSheet_(ss);
  if (responseSheet.getName() !== SHEET.RESPONSES && !ss.getSheetByName(SHEET.RESPONSES)) {
    responseSheet.setName(SHEET.RESPONSES);
  }
}

function waitForResponseSheet_(ss) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const match = ss.getSheets().find(function (sheet) {
      return /^Form Responses(?: \d+)?$/.test(sheet.getName()) ||
        String(sheet.getRange(1, 1).getValue()).toLowerCase() === 'timestamp';
    });
    if (match) return match;
    Utilities.sleep(500);
    SpreadsheetApp.flush();
  }
  throw new Error('The linked Form Responses sheet was not created. Wait briefly and rerun setupAuditSystem().');
}

function refreshConfigurationSheet() {
  const ss = getAuditSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET.CONFIG) || ss.insertSheet(SHEET.CONFIG);
  const rows = [
    ['Setting', 'Value', 'Notes'],
    ['Script Version', AUDIT.VERSION, 'Change AUDIT.VERSION only when intentionally rebuilding.'],
    ['Required Points', AUDIT.REQUIRED_POINTS, 'Qualification threshold.'],
    ['Posting Delay Hours', AUDIT.POSTING_DELAY_HOURS, 'Normal processing allowance.'],
    ['Lookback Days', AUDIT.LOOKBACK_DAYS, 'Rolling discrepancy deadline.'],
    ['Early Reconciliation', new Date(AUDIT.EARLY_RECONCILIATION), '80% reconciliation checkpoint.'],
    ['Standard Cutoff', new Date(AUDIT.STANDARD_CUTOFF), 'Older shifts cannot be revived afterward.'],
    ['Final Exception Cutoff', new Date(AUDIT.FINAL_EXCEPTION_CUTOFF), 'Only November 7–10 shifts.'],
    ['Final Decision Deadline', new Date(AUDIT.FINAL_DECISION_DEADLINE), 'Board processing deadline.'],
    ['Eligibility Certification', new Date(AUDIT.ELIGIBILITY_CERTIFICATION), 'Final qualification lock.'],
    ['Support Email', AUDIT.SUPPORT_EMAIL || 'NOT CONFIGURED', 'Set AUDIT.SUPPORT_EMAIL before launch.'],
    ['', '', ''],
    ['Category', 'Cap', 'Default Points']
  ];
  AUDIT.CATEGORIES.forEach(function (c) { rows.push([c.name, c.cap, c.defaultPoints]); });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(13, 1, 1, 3).setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.autoResizeColumns(1, 3);
  sheet.setFrozenRows(1);
}

function applyQueueValidation_(sheet) {
  const h = headerMap_(sheet);
  const workflowRule = SpreadsheetApp.newDataValidation().requireValueInList([
    'New', 'Needs Information', 'Waiting — 48-Hour Posting Window', 'Assigned',
    'In Review', 'Ready for Decision', 'Closed'
  ], true).setAllowInvalid(false).build();
  const decisionRule = SpreadsheetApp.newDataValidation().requireValueInList([
    'Pending', 'Approved', 'Partially Approved', 'Denied — No Physical Record',
    'Denied — Category Cap Reached', 'Denied — Untimely', 'Duplicate',
    'Not Needed — Team Already Qualified', 'Not Reviewed — Threshold Reached'
  ], true).setAllowInvalid(false).build();
  const adjustmentRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, AUDIT.REQUIRED_POINTS)
    .setAllowInvalid(false)
    .setHelpText('Enter approved points as a number from 0 through ' + AUDIT.REQUIRED_POINTS + '.')
    .build();
  sheet.getRange(2, h['Workflow Status'], 1000, 1).setDataValidation(workflowRule);
  sheet.getRange(2, h.Decision, 1000, 1).setDataValidation(decisionRule);
  sheet.getRange(2, h['Net Point Adjustment'], 1000, 1).setDataValidation(adjustmentRule);
}

function applyWorkbookFormatting_(ss) {
  [SHEET.QUEUE, SHEET.SHIFTS, SHEET.TEAM_STATUS, SHEET.LOG].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const cols = sheet.getLastColumn();
    if (cols) sheet.getRange(1, 1, 1, cols)
      .setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (cols >= 1) {
      if (sheet.getFilter()) sheet.getFilter().remove();
      sheet.getRange(1, 1, 1000, cols).createFilter();
    }
  });
  const queue = ss.getSheetByName(SHEET.QUEUE);
  const h = headerMap_(queue);
  queue.getRange(2, h['Received Timestamp'], 1000, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
  queue.getRange(2, h['Applicable Deadline'], 1000, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
  queue.getRange(2, h['Decision Date'], 1000, 1).setNumberFormat('m/d/yyyy h:mm AM/PM');
  queue.getRange(2, 1, 1000, queue.getLastColumn()).setVerticalAlignment('top');

  const dataRange = queue.getRange(2, 1, 999, queue.getLastColumn());
  const timelyCol = columnLetter_(h['Timely?']);
  const priorityCol = columnLetter_(h.Priority);
  const workflowCol = columnLetter_(h['Workflow Status']);
  const qualificationCol = columnLetter_(h['Qualification Result']);
  queue.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + timelyCol + '2="No"')
      .setBackground('#FECACA').setFontColor('#7F1D1D').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=REGEXMATCH($' + priorityCol + '2,"Critical|Urgent")')
      .setBackground('#FED7AA').setFontColor('#7C2D12').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + workflowCol + '2="Needs Information"')
      .setBackground('#FEF3C7').setFontColor('#78350F').setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + qualificationCol + '2="Qualified"')
      .setBackground('#DCFCE7').setFontColor('#14532D').setRanges([dataRange]).build()
  ]);
}

function refreshDashboard() {
  const ss = getAuditSpreadsheet_();
  const dashboard = ss.getSheetByName(SHEET.DASHBOARD);
  const queueName = "'" + SHEET.QUEUE.replace(/'/g, "''") + "'";
  const teamName = "'" + SHEET.TEAM_STATUS.replace(/'/g, "''") + "'";
  const qh = headerMap_(ss.getSheetByName(SHEET.QUEUE));
  const th = headerMap_(ss.getSheetByName(SHEET.TEAM_STATUS));
  const col = function (n) { return columnLetter_(n); };
  const rows = [
    ['Region 154 Fall 2026 Volunteer Point Review', ''],
    ['Last Refreshed', new Date()],
    ['Teams at 17+', '=COUNTIF(' + teamName + '!' + col(th['Current Verified Points']) + '2:' + col(th['Current Verified Points']) + ',">=17")'],
    ['Teams below 17', '=COUNTIFS(' + teamName + '!' + col(th['Current Verified Points']) + '2:' + col(th['Current Verified Points']) + ',"<17",' + teamName + '!' + col(th['Team Code']) + '2:' + col(th['Team Code']) + ',"<>")'],
    ['Open Tickets', '=COUNTIFS(' + queueName + '!' + col(qh['Ticket ID']) + '2:' + col(qh['Ticket ID']) + ',"<>",' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"<>Closed")'],
    ['Needs Information', '=COUNTIF(' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"Needs Information")'],
    ['Unassigned Open Tickets', '=COUNTIFS(' + queueName + '!' + col(qh['Auditor Assigned']) + '2:' + col(qh['Auditor Assigned']) + ',"",' + queueName + '!' + col(qh['Ticket ID']) + '2:' + col(qh['Ticket ID']) + ',"<>",' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"<>Closed")'],
    ['Final-Game Exceptions', '=COUNTIF(' + queueName + '!' + col(qh['Request Type']) + '2:' + col(qh['Request Type']) + ',"*Final-Game*")'],
    ['Duplicate Challenges', '=COUNTIF(' + queueName + '!' + col(qh.Decision) + '2:' + col(qh.Decision) + ',"Duplicate")'],
    ['Standard Tickets Received', '=COUNTIF(' + queueName + '!' + col(qh['Request Type']) + '2:' + col(qh['Request Type']) + ',"Standard Review")'],
    ['Standard Tickets Closed', '=COUNTIFS(' + queueName + '!' + col(qh['Request Type']) + '2:' + col(qh['Request Type']) + ',"Standard Review",' + queueName + '!' + col(qh['Workflow Status']) + '2:' + col(qh['Workflow Status']) + ',"Closed")'],
    ['Standard Resolution %', '=IFERROR(B11/B10,0)'],
    ['80% Goal', '=0.8'],
    ['Goal Status', '=IF(B12>=B13,"ON TRACK","ACTION NEEDED")']
  ];
  dashboard.getDataRange().breakApart();
  dashboard.clear();
  dashboard.getRange(1, 1, rows.length, 2).setValues(rows);
  dashboard.getRange('A1:B1').merge().setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  dashboard.getRange('B12:B13').setNumberFormat('0%');
  dashboard.setColumnWidth(1, 260);
  dashboard.setColumnWidth(2, 180);
  dashboard.setFrozenRows(1);
}

function upsertTeamStatus_(ss, teamCode, division, points, ticketId, workflow) {
  const sheet = ss.getSheetByName(SHEET.TEAM_STATUS);
  const rows = dataObjects_(sheet);
  const index = rows.findIndex(function (r) { return normalizeTeamCode_(r['Team Code']) === teamCode; });
  const values = [teamCode, division, points, Math.max(0, AUDIT.REQUIRED_POINTS - points), workflow, ticketId, new Date()];
  if (index >= 0) sheet.getRange(index + 2, 1, 1, values.length).setValues([values]);
  else appendRow_(sheet, values);
}

function updateQueueNotification_(ss, ticketId, status) {
  const sheet = ss.getSheetByName(SHEET.QUEUE);
  const h = headerMap_(sheet);
  const rows = dataObjects_(sheet);
  const index = rows.findIndex(function (row) { return String(row['Ticket ID']) === ticketId; });
  if (index < 0) return;
  sheet.getRange(index + 2, h['Notification Status']).setValue(status);
  sheet.getRange(index + 2, h['Notification Timestamp']).setValue(new Date());
}

function appendAuditLog_(ss, ticketId, event, oldValue, newValue, changedBy) {
  appendRow_(ss.getSheetByName(SHEET.LOG), [new Date(), ticketId, event, oldValue, newValue, changedBy]);
}

function installAuditTriggers_() {
  const form = getOrCreateForm_();
  const ss = getAuditSpreadsheet_();
  const handlers = ['handleAuditFormSubmit', 'handleAuditQueueEdit', 'refreshFormPhase', 'sendDailyQueueSummary'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('handleAuditFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('handleAuditQueueEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('refreshFormPhase').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendDailyQueueSummary').timeBased().atHour(7).everyDays(1).inTimezone(AUDIT.TIME_ZONE).create();
}

function sendDailyQueueSummary() {
  if (!AUDIT.SUPPORT_EMAIL || !AUDIT.SEND_EMAILS) return;
  const now = new Date();
  if (now < new Date(AUDIT.EARLY_RECONCILIATION) || now > new Date(AUDIT.ELIGIBILITY_CERTIFICATION)) return;
  const rows = dataObjects_(getAuditSpreadsheet_().getSheetByName(SHEET.QUEUE));
  const open = rows.filter(function (r) { return r['Ticket ID'] && r['Workflow Status'] !== 'Closed'; });
  const unassigned = open.filter(function (r) { return !r['Auditor Assigned']; }).length;
  const needsInfo = open.filter(function (r) { return r['Workflow Status'] === 'Needs Information'; }).length;
  const critical = open.filter(function (r) { return String(r.Priority).indexOf('Critical') >= 0; }).length;
  MailApp.sendEmail(
    AUDIT.SUPPORT_EMAIL,
    '[AYSO 154 Audit] Daily queue summary — ' + formatDate_(now),
    [
      'Open tickets: ' + open.length,
      'Unassigned: ' + unassigned,
      'Needs information: ' + needsInfo,
      'Critical final-window tickets: ' + critical,
      '',
      'Open the response workbook to assign and resolve the queue.'
    ].join('\n'),
    { name: AUDIT.REGION_NAME }
  );
}

function writeSetupReport_(ss, form) {
  const sheet = ss.getSheetByName(SHEET.CONFIG);
  const start = 22;
  const rows = [
    ['SETUP REPORT', ''],
    ['Form respondent URL', form.getPublishedUrl()],
    ['Form edit URL', form.getEditUrl()],
    ['Response workbook URL', ss.getUrl()],
    ['Required manual step', 'Upload the approved 4:1 header image and set the theme color to ' + AUDIT.BRAND_NAVY],
    ['Required policy check', 'Verify every category cap in the AUDIT.CATEGORIES configuration.'],
    ['Required email check', AUDIT.SUPPORT_EMAIL ? 'Configured: ' + AUDIT.SUPPORT_EMAIL : 'Set AUDIT.SUPPORT_EMAIL before launch.'],
    ['Distribution control', 'Share the respondent URL only in the closed Head Coach and Team Manager WhatsApp groups.']
  ];
  sheet.getRange(start, 1, 14, 3).clearContent().clearFormat();
  sheet.getRange(start, 1, rows.length, 2).setValues(rows);
  sheet.getRange(start, 1, 1, 2).setBackground(AUDIT.BRAND_RED).setFontColor('#FFFFFF').setFontWeight('bold');
}

function validateConfiguration_() {
  const dates = [
    AUDIT.EARLY_RECONCILIATION, AUDIT.STANDARD_CUTOFF, AUDIT.FINAL_WINDOW_START,
    AUDIT.FINAL_WINDOW_END, AUDIT.FINAL_EXCEPTION_CUTOFF,
    AUDIT.FINAL_DECISION_DEADLINE, AUDIT.ELIGIBILITY_CERTIFICATION, AUDIT.POST_SEASON_START
  ].map(function (value) { return new Date(value); });
  if (dates.some(function (d) { return isNaN(d.getTime()); })) throw new Error('One or more configured dates are invalid.');
  if (!(dates[0] < dates[1] && dates[1] < dates[4] && dates[4] < dates[5] && dates[5] < dates[6] && dates[6] < dates[7])) {
    throw new Error('Configured milestone dates are not in chronological order.');
  }
  if (AUDIT.REQUIRED_POINTS <= 0 || AUDIT.MAX_SHIFTS_PER_CHALLENGE < 1) throw new Error('Point and shift limits must be positive.');
}

/** Pure-logic smoke tests. Run before launch. */
function runSelfTests() {
  const cases = [
    {
      name: 'Standard timely', shift: '2026-10-20T10:00:00-07:00', received: '2026-10-23T10:01:00-07:00',
      expected: 'Standard Review', timely: true
    },
    {
      name: 'Standard too recent', shift: '2026-10-20T10:00:00-07:00', received: '2026-10-21T10:00:00-07:00',
      expected: 'Waiting — 48-Hour Posting Window', timely: true
    },
    {
      name: 'Older than 14 days', shift: '2026-10-01T10:00:00-07:00', received: '2026-10-16T10:00:00-07:00',
      expected: 'Untimely', timely: false
    },
    {
      name: 'Old shift after standard cutoff', shift: '2026-10-30T10:00:00-07:00', received: '2026-11-09T10:00:00-08:00',
      expected: 'Untimely', timely: false
    },
    {
      name: 'Final-game exception', shift: '2026-11-10T18:00:00-08:00', received: '2026-11-10T21:00:00-08:00',
      expected: 'Final-Game Exception', timely: true
    },
    {
      name: 'Late final-game exception', shift: '2026-11-10T18:00:00-08:00', received: '2026-11-11T12:01:00-08:00',
      expected: 'Untimely', timely: false
    }
  ];
  cases.forEach(function (test) {
    const result = classifyShiftTiming_(new Date(test.shift), new Date(test.received));
    if (result.classification !== test.expected || result.timely !== test.timely) {
      throw new Error(test.name + ' failed: ' + JSON.stringify(result));
    }
  });
  Logger.log('All ' + cases.length + ' deadline tests passed.');
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (header, i) { if (header) map[String(header)] = i + 1; });
  return map;
}

function dataObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values.shift();
  return values.map(function (row) {
    const obj = {};
    headers.forEach(function (header, i) { obj[String(header)] = row[i]; });
    return obj;
  });
}

function rowObject_(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obj = {};
  headers.forEach(function (header, i) { obj[String(header)] = values[i]; });
  return obj;
}

function objectToRow_(headers, obj) {
  return headers.map(function (header) { return Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : ''; });
}

function appendRow_(sheet, values) {
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
}

function clean_(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (Array.isArray(value)) return value.join('; ').trim();
  return String(value).trim();
}

function normalize_(value) {
  return clean_(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function normalizeTeamCode_(value) {
  return normalize_(value).replace(/\s+/g, '-');
}

function dateKey_(date) {
  return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'yyyy-MM-dd HH:mm');
}

function formatDate_(date) {
  return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'MMM d, yyyy');
}

function formatDateTime_(date) {
  if (!date) return 'Not available';
  return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'EEE, MMM d, yyyy h:mm a') + ' PT';
}

function columnLetter_(column) {
  let result = '';
  while (column > 0) {
    const remainder = (column - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result;
}

// ============================================================================
// HYBRID ADJUDICATION BRIDGE (2026 POST-SEASON PLAYOFF VOLUNTEER AUDIT)
// ============================================================================

const ADJUDICATION_SHEET = Object.freeze({
  DOSSIERS: 'Gem_Dispute_Dossiers',
  AUDIT_SUBMISSIONS: 'Audit Submissions',
  FORM_RESPONSES_2: 'Form Responses 2',
  PLAYOFF_RESPONSES: 'Playoff_Audit_Responses',
  GAME_DAY_CHECKINS: 'Game Day Check-ins',
  FORM_RESPONSES_1: 'Form Responses 1',
  AWARDS: 'Team_Awards',
  LEDGER: 'Season_Master_Ledger'
});

/**
 * Resolves the audit spreadsheet containing the Audit Queue / Form Responses.
 */
function resolveAuditSpreadsheet_() {
  const activeSs = (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null;
  if (activeSs) {
    if (activeSs.getSheetByName(SHEET.QUEUE) || 
        activeSs.getSheetByName(ADJUDICATION_SHEET.AUDIT_SUBMISSIONS) ||
        activeSs.getSheetByName(ADJUDICATION_SHEET.FORM_RESPONSES_2) ||
        activeSs.getSheetByName(ADJUDICATION_SHEET.PLAYOFF_RESPONSES) ||
        activeSs.getSheetByName(SHEET.RESPONSES) ||
        activeSs.getSheetByName(SHEET.LEGACY_RESPONSES) ||
        activeSs.getSheetByName('Form Responses')) {
      return activeSs;
    }
  }

  try {
    const props = (typeof PropertiesService !== 'undefined') ? PropertiesService.getScriptProperties() : null;
    const id = props ? props.getProperty(PROP.SPREADSHEET_ID) : null;
    if (id && typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.openById(id);
    }
  } catch (e) {}

  try {
    if (typeof DriveApp !== 'undefined') {
      const files = DriveApp.getFilesByName(AUDIT.SPREADSHEET_NAME);
      if (files.hasNext() && typeof SpreadsheetApp !== 'undefined') {
        return SpreadsheetApp.openById(files.next().getId());
      }
    }
  } catch (e) {}

  return activeSs;
}

/**
 * Resolves the master spreadsheet containing Season_Master_Ledger and Team_Awards.
 */
function resolveMasterSpreadsheet_() {
  const activeSs = (typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null;
  if (activeSs) {
    if (activeSs.getSheetByName(ADJUDICATION_SHEET.LEDGER) || activeSs.getSheetByName(ADJUDICATION_SHEET.AWARDS)) {
      return activeSs;
    }
  }

  try {
    const props = (typeof PropertiesService !== 'undefined') ? PropertiesService.getScriptProperties() : null;
    const masterId = props ? props.getProperty('MASTER_SPREADSHEET_ID') : null;
    if (masterId && typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.openById(masterId);
    }
  } catch (e) {}

  return activeSs;
}

/**
 * Pre-checks a team's status against Season_Master_Ledger.
 * Identifies current verified points, playoff goal, qualification status, and category caps.
 *
 * @param {string} teamCode The team identifier to check
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [masterSs] Optional master spreadsheet reference
 * @returns {Object} Structured pre-check audit status
 */
function getTeamLedgerPreCheck_(teamCode, masterSs) {
  const ss = masterSs || resolveMasterSpreadsheet_();
  if (!ss) {
    return {
      found: false,
      teamCode: teamCode,
      warnings: ['Master spreadsheet not accessible for ledger pre-check.']
    };
  }

  const sheet = ss.getSheetByName(ADJUDICATION_SHEET.LEDGER) || ss.getSheetByName('Season_Master_Ledger');
  if (!sheet || sheet.getLastRow() < 2) {
    return {
      found: false,
      teamCode: teamCode,
      warnings: ['Season_Master_Ledger tab not found or empty.']
    };
  }

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());

  // Find column indices
  const idxDiv = headers.indexOf('division') !== -1 ? headers.indexOf('division') : 0;
  const idxTeam = headers.indexOf('team code') !== -1 ? headers.indexOf('team code') : 1;
  const idxCoach = headers.indexOf('head coach') !== -1 ? headers.indexOf('head coach') : 2;
  const idxRef = headers.findIndex(h => h.includes('referee') && h.includes('points'));
  const idxFm = headers.findIndex(h => h.includes('marshal'));
  const idxSetup = headers.findIndex(h => h.includes('setup'));
  const idxPic = headers.findIndex(h => h.includes('picture'));
  const idxCert = headers.findIndex(h => h.includes('certified'));
  const idxMatch = headers.findIndex(h => h.includes('matchtrak'));
  const idxOther = headers.findIndex(h => h.includes('other') || h.includes('adjust'));
  const idxTotal = headers.findIndex(h => h.includes('total'));
  const idxGoal = headers.findIndex(h => h.includes('goal'));
  const idxStatus = headers.findIndex(h => h.includes('status'));

  const cleanTarget = String(teamCode || '').trim().toLowerCase();
  const normTarget = normalizeTeamCode_(teamCode);

  let matchRow = null;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowTeam = String(row[idxTeam] || '').trim();
    if (!rowTeam) continue;

    if (rowTeam.toLowerCase() === cleanTarget || normalizeTeamCode_(rowTeam) === normTarget) {
      matchRow = row;
      break;
    }
  }

  // Fallback: match coach name if not exact team code
  if (!matchRow) {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rowTeam = String(row[idxTeam] || '').trim();
      const rowCoach = String(row[idxCoach !== -1 ? idxCoach : 2] || '').trim().toLowerCase();
      if (cleanTarget.includes(rowCoach) && rowCoach.length > 3) {
        matchRow = row;
        break;
      }
    }
  }

  if (!matchRow) {
    return {
      found: false,
      teamCode: teamCode,
      warnings: [`Team '${teamCode}' was not found in Season_Master_Ledger.`]
    };
  }

  const division = String(matchRow[idxDiv] || '').trim();
  const canonicalTeam = String(matchRow[idxTeam] || '').trim();
  const headCoach = String(matchRow[idxCoach !== -1 ? idxCoach : 2] || '').trim();

  const refPts = idxRef !== -1 ? Number(matchRow[idxRef]) || 0 : 0;
  const fmPts = idxFm !== -1 ? Number(matchRow[idxFm]) || 0 : 0;
  const setupPts = idxSetup !== -1 ? Number(matchRow[idxSetup]) || 0 : 0;
  const picPts = idxPic !== -1 ? Number(matchRow[idxPic]) || 0 : 0;
  const certRefPts = idxCert !== -1 ? Number(matchRow[idxCert]) || 0 : 0;
  const matchtrakPts = idxMatch !== -1 ? Number(matchRow[idxMatch]) || 0 : 0;
  const otherPts = idxOther !== -1 ? Number(matchRow[idxOther]) || 0 : 0;
  const totalPts = idxTotal !== -1 ? Number(matchRow[idxTotal]) || 0 : (refPts + fmPts + setupPts + picPts + certRefPts + matchtrakPts + otherPts);
  const playoffGoal = idxGoal !== -1 ? Number(matchRow[idxGoal]) || 17 : 17;
  const playoffStatus = idxStatus !== -1 ? String(matchRow[idxStatus] || '').trim() : (totalPts >= playoffGoal ? 'Qualified' : `${playoffGoal - totalPts} pts needed`);

  const isAlreadyQualified = totalPts >= playoffGoal;
  const pointsNeeded = Math.max(0, playoffGoal - totalPts);

  const caps = {
    refCapMet: refPts >= 10,
    fmCapMet: fmPts >= 2,
    setupCapMet: setupPts >= 5,
    picCapMet: picPts >= 2,
    certRefCapMet: certRefPts >= 5,
    matchtrakCapMet: matchtrakPts >= 2
  };

  const warnings = [];
  if (isAlreadyQualified) {
    warnings.push(`⚠️ ALREADY QUALIFIED: Team currently has ${totalPts} verified points (Goal: ${playoffGoal}). Per board policy, surplus points beyond ${playoffGoal} are not audited or banked.`);
  }
  if (caps.refCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Referee points at 10/10. Additional referee shifts cannot earn points under the category cap.`);
  }
  if (caps.fmCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Field Marshal points at 2/2 cap.`);
  }
  if (caps.picCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Picture Day points at 2/2 cap.`);
  }
  if (caps.setupCapMet) {
    warnings.push(`⚠️ CATEGORY CAP REACHED: Field Setup points at 5/5 cap.`);
  }

  return {
    found: true,
    division: division,
    teamCode: canonicalTeam,
    headCoach: headCoach,
    totalPts: totalPts,
    playoffGoal: playoffGoal,
    playoffStatus: playoffStatus,
    isAlreadyQualified: isAlreadyQualified,
    pointsNeeded: pointsNeeded,
    breakdown: {
      refPts: refPts,
      fmPts: fmPts,
      setupPts: setupPts,
      picPts: picPts,
      certRefPts: certRefPts,
      matchtrakPts: matchtrakPts,
      otherPts: otherPts
    },
    caps: caps,
    warnings: warnings
  };
}

/**
 * Scans for unadjudicated dispute tickets across Audit Queue or response sheets.
 *
 * @param {Object} [options] Optional filter criteria
 * @returns {Array<Object>} List of unadjudicated ticket objects with ledger pre-checks
 */
function getUnadjudicatedDisputes(options = {}) {
  const auditSs = (options && options.auditSs) || resolveAuditSpreadsheet_();
  const masterSs = (options && options.masterSs) || resolveMasterSpreadsheet_();

  if (!auditSs) return [];

  const unadjudicated = [];

  // Strategy 1: Check Audit Queue + Shift Details (from AYSO154_Playoff_Audit.js)
  const queueSheet = auditSs.getSheetByName(SHEET.QUEUE);
  const shiftsSheet = auditSs.getSheetByName(SHEET.SHIFTS);

  if (queueSheet && queueSheet.getLastRow() > 1) {
    const queueRows = dataObjects_(queueSheet);
    const shiftsRows = (shiftsSheet && shiftsSheet.getLastRow() > 1) ? dataObjects_(shiftsSheet) : [];

    queueRows.forEach(row => {
      const ticketId = String(row['Ticket ID'] || '').trim();
      const decision = String(row['Decision'] || '').trim();
      const workflow = String(row['Workflow Status'] || '').trim();

      // Check if ticket is unadjudicated
      const isUnadjudicated = (decision === 'Pending' || !decision) &&
                              workflow !== 'Closed' &&
                              workflow !== 'Duplicate';

      if (isUnadjudicated) {
        // Collect shifts for this ticket
        const ticketShifts = shiftsRows.filter(s => String(s['Ticket ID'] || '').trim() === ticketId).map(s => ({
          shiftNumber: s['Shift Number'] || 1,
          shiftStart: s['Shift Start'] instanceof Date ? formatDateTimeSafe_(s['Shift Start']) : String(s['Shift Start'] || ''),
          venue: s['Venue'] || '',
          fieldLocation: s['Field / Location'] || '',
          volunteerName: s['Volunteer Full Name'] || '',
          category: s['Category'] || '',
          expectedPoints: Number(s['Expected Points']) || 1,
          teamCreditedAtCheckIn: s['Team Credited at Check-In'] || '',
          evidence: s['Evidence / Identifying Details'] || '',
          supportingLink: s['Supporting Link'] || '',
          classification: s['Shift Classification'] || '',
          timely: s['Timely?'] || 'Yes',
          postingWindowComplete: s['48-Hour Posting Window Complete?'] || 'Yes'
        }));

        const teamCode = clean_(row['Team Code']);
        const ledgerPreCheck = getTeamLedgerPreCheck_(teamCode, masterSs);

        unadjudicated.push({
          ticketId: ticketId,
          received: row['Received Timestamp'] instanceof Date ? formatDateTimeSafe_(row['Received Timestamp']) : String(row['Received Timestamp'] || ''),
          submitter: {
            name: clean_(row['Submitter Name']),
            role: clean_(row['Submitter Role']),
            email: clean_(row['Email']),
            phone: clean_(row['Cell Phone'])
          },
          team: {
            teamCode: teamCode,
            division: clean_(row['Division']),
            headCoach: clean_(row['Head Coach'])
          },
          requestType: clean_(row['Request Type']),
          workflowStatus: workflow,
          priority: clean_(row['Priority']),
          timely: clean_(row['Timely?']),
          deadline: row['Applicable Deadline'] instanceof Date ? formatDateTimeSafe_(row['Applicable Deadline']) : String(row['Applicable Deadline'] || ''),
          siblingInfo: {
            hasSibling: clean_(row['Sibling / Multi-Team?']),
            details: clean_(row['Sibling Details'])
          },
          shifts: ticketShifts,
          ledgerPreCheck: ledgerPreCheck
        });
      }
    });
  }

  // Strategy 2: Check Audit Submissions, Form Responses 2, Playoff_Audit_Responses, or Form Responses if queue has no entries
  if (unadjudicated.length === 0) {
    const rawSheet = auditSs.getSheetByName(ADJUDICATION_SHEET.AUDIT_SUBMISSIONS) ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.FORM_RESPONSES_2) ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.PLAYOFF_RESPONSES) ||
                     auditSs.getSheetByName(SHEET.RESPONSES) ||
                     auditSs.getSheetByName(SHEET.LEGACY_RESPONSES) ||
                     auditSs.getSheetByName('Form Responses') ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.GAME_DAY_CHECKINS) ||
                     auditSs.getSheetByName(ADJUDICATION_SHEET.FORM_RESPONSES_1);

    if (rawSheet && rawSheet.getLastRow() > 1) {
      const data = rawSheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h || '').trim().toLowerCase());

      const idxStatus = headers.findIndex(h => h.includes('audit status') || h.includes('workflow status'));
      const idxRole = headers.findIndex(h => h.includes('role'));
      const idxEmail = headers.findIndex(h => h.includes('email'));
      const idxName = headers.findIndex(h => h.includes('submitter') && h.includes('name'));
      const idxPhone = headers.findIndex(h => h.includes('phone'));
      const idxDiv = headers.indexOf('division');
      const idxCoach = headers.findIndex(h => h.includes('coach'));
      const idxTeam = headers.findIndex(h => h.includes('team'));
      const idxDate = headers.findIndex(h => h.includes('date'));
      const idxCat = headers.findIndex(h => h.includes('category'));
      const idxVol = headers.findIndex(h => h.includes('volunteer'));
      const idxField = headers.findIndex(h => h.includes('field') || h.includes('location'));
      const idxTime = headers.findIndex(h => h.includes('time'));
      const idxSibling = headers.findIndex(h => h.includes('sibling') && h.includes('does'));
      const idxSiblingDetails = headers.findIndex(h => h.includes('sibling') && (h.includes('name') || h.includes('detail')));
      const idxLink = headers.findIndex(h => h.includes('link') || h.includes('photo'));

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const status = idxStatus !== -1 ? String(row[idxStatus] || '').trim() : '';

        // If status is Pending or empty, it's unadjudicated
        if (!status || status.toLowerCase() === 'pending') {
          const teamCode = clean_(row[idxTeam !== -1 ? idxTeam : 9]);
          if (!teamCode) continue;

          const ledgerPreCheck = getTeamLedgerPreCheck_(teamCode, masterSs);
          const ticketId = `TICKET-ROW-${i + 1}`;

          unadjudicated.push({
            ticketId: ticketId,
            received: row[0] instanceof Date ? formatDateTimeSafe_(row[0]) : String(row[0] || ''),
            submitter: {
              name: clean_(row[idxName !== -1 ? idxName : 4]),
              role: clean_(row[idxRole !== -1 ? idxRole : 1]),
              email: clean_(row[idxEmail !== -1 ? idxEmail : 6]),
              phone: clean_(row[idxPhone !== -1 ? idxPhone : 5])
            },
            team: {
              teamCode: teamCode,
              division: clean_(row[idxDiv !== -1 ? idxDiv : 7]),
              headCoach: clean_(row[idxCoach !== -1 ? idxCoach : 8])
            },
            requestType: 'Standard Review',
            workflowStatus: status || 'Pending',
            priority: 'Normal',
            timely: 'Yes',
            deadline: 'Sun, Nov 8, 2026',
            siblingInfo: {
              hasSibling: clean_(row[idxSibling !== -1 ? idxSibling : 15]),
              details: clean_(row[idxSiblingDetails !== -1 ? idxSiblingDetails : 16])
            },
            shifts: [{
              shiftNumber: 1,
              shiftStart: `${clean_(row[idxDate !== -1 ? idxDate : 10])} ${clean_(row[idxTime !== -1 ? idxTime : 14])}`.trim(),
              venue: 'Venue',
              fieldLocation: clean_(row[idxField !== -1 ? idxField : 13]),
              volunteerName: clean_(row[idxVol !== -1 ? idxVol : 12]),
              category: clean_(row[idxCat !== -1 ? idxCat : 11]),
              expectedPoints: 1,
              teamCreditedAtCheckIn: teamCode,
              evidence: 'Submitted via Playoff Volunteer Audit Form',
              supportingLink: clean_(row[idxLink !== -1 ? idxLink : 19]),
              classification: 'Standard Review',
              timely: 'Yes',
              postingWindowComplete: 'Yes'
            }],
            ledgerPreCheck: ledgerPreCheck
          });
        }
      }
    }
  }

  return unadjudicated;
}

/**
 * Formats a single ticket into a clean, structured Markdown dispute dossier.
 *
 * @param {Object} ticket The ticket data object with ledgerPreCheck
 * @returns {string} Formatted markdown dossier
 */
function formatDisputeDossier(ticket) {
  const t = ticket;
  const l = t.ledgerPreCheck || {};
  const b = l.breakdown || {};

  const lines = [
    `### 🎫 Ticket Dossier: ${t.ticketId}`,
    `- **Submitter:** ${t.submitter.name} (${t.submitter.role})`,
    `- **Contact:** 📧 ${t.submitter.email || 'N/A'} | 📱 ${t.submitter.phone || 'N/A'}`,
    `- **Team Code:** \`${t.team.teamCode}\` | **Division:** ${t.team.division} | **Head Coach:** ${t.team.headCoach}`,
    `- **Received:** ${t.received} | **Priority:** ${t.priority} | **Timely:** ${t.timely}`,
    '',
    `#### 📊 Season Master Ledger Pre-Check`,
    `- **Verified Points:** **${l.totalPts !== undefined ? l.totalPts : 'N/A'}** / ${l.playoffGoal || 17} pts (${l.playoffStatus || 'Unknown'})`,
    `- **Current Breakdown:** Ref: ${b.refPts || 0}/10 | FM: ${b.fmPts || 0}/2 | Setup: ${b.setupPts || 0}/5 | Pic: ${b.picPts || 0}/2 | CertRef: ${b.certRefPts || 0}/5 | MatchTrak: ${b.matchtrakPts || 0}/2 | Other: ${b.otherPts || 0}`,
    `- **Qualification Status:** ${l.isAlreadyQualified ? '🏆 **ALREADY QUALIFIED**' : `⏳ **${l.pointsNeeded || 0} pts needed**`}`
  ];

  if (l.warnings && l.warnings.length > 0) {
    lines.push(`- **Pre-Check Alerts:**`);
    l.warnings.forEach(w => lines.push(`  - ${w}`));
  }

  lines.push('', `#### ⚽ Disputed Shift(s) (${t.shifts.length} shift${t.shifts.length === 1 ? '' : 's'})`);
  t.shifts.forEach((s, idx) => {
    lines.push(
      `**Shift #${s.shiftNumber || idx + 1}:**`,
      `- **Volunteer:** ${s.volunteerName}`,
      `- **Category:** ${s.category} | **Expected Points:** +${s.expectedPoints}`,
      `- **Date / Time:** ${s.shiftStart}`,
      `- **Venue / Field:** ${s.venue} - ${s.fieldLocation}`,
      `- **Check-In Team:** ${s.teamCreditedAtCheckIn || 'None specified'}`,
      `- **Evidence Notes:** ${s.evidence || 'None provided'}`,
      `- **Supporting Link:** ${s.supportingLink ? `[View Evidence Link](${s.supportingLink})` : 'None attached'}`
    );
  });

  lines.push(
    '',
    `#### 👨‍👩‍👧‍👦 Sibling / Cross-Team Leakage Check`,
    `- **Has Siblings in Region 154:** ${t.siblingInfo.hasSibling || 'No'}`,
    `- **Sibling Details:** ${t.siblingInfo.details || 'None'}`
  );

  lines.push(
    '',
    `#### 🤖 Suggested Gem Adjudication Prompt`,
    `> "Please evaluate ticket \`${t.ticketId}\` for team \`${t.team.teamCode}\`. Volunteer \`${t.shifts.map(s => s.volunteerName).join(', ')}\` claimed shift(s) in \`${t.shifts.map(s => s.category).join(', ')}\`. The team has ${l.totalPts !== undefined ? l.totalPts : 'N/A'}/${l.playoffGoal || 17} pts. Cross-reference against physical tent records/match cards. If verified, approve points into target column ('pictureDay' or 'adjustment'). If cap is exceeded or unverified, deny with reason."`
  );

  return lines.join('\n');
}

/**
 * Compiles all unadjudicated dossiers into Markdown and JSON packages ready for Gem ingestion.
 *
 * @param {Object} [options] Filter options
 * @returns {Object} { count, markdown, json, tickets }
 */
function exportDisputeDossiersForGem(options = {}) {
  const tickets = getUnadjudicatedDisputes(options);

  const header = [
    `# 📋 AYSO REGION 154 — 2026 PLAYOFF VOLUNTEER AUDIT DOSSIERS`,
    `**Export Timestamp:** ${formatDateTimeSafe_(new Date())}`,
    `**Unadjudicated Dispute Tickets:** ${tickets.length}`,
    `--------------------------------------------------------------------------------`,
    ''
  ].join('\n');

  let markdown = '';
  if (tickets.length === 0) {
    markdown = header + '\n✅ *No unadjudicated dispute tickets found. All submissions have been processed.*';
  } else {
    markdown = header + tickets.map(t => formatDisputeDossier(t)).join('\n\n---\n\n');
  }

  const jsonString = JSON.stringify(tickets, null, 2);

  // Write to a dedicated sheet tab 'Gem_Dispute_Dossiers' if spreadsheet is available
  try {
    const ss = resolveMasterSpreadsheet_() || resolveAuditSpreadsheet_();
    if (ss && typeof ss.getSheetByName === 'function') {
      let sheet = ss.getSheetByName(ADJUDICATION_SHEET.DOSSIERS);
      if (!sheet) {
        sheet = ss.insertSheet(ADJUDICATION_SHEET.DOSSIERS);
      }
      sheet.clear();
      sheet.getRange(1, 1).setValue('AYSO 154 GEM DISPUTE DOSSIERS EXPORT (COPY / FEED INTO GEM)');
      sheet.getRange(1, 1).setFontWeight('bold').setBackground(AUDIT.BRAND_NAVY).setFontColor('#FFFFFF').setFontSize(12);
      sheet.getRange(2, 1).setValue(markdown);
      sheet.getRange(2, 1).setFontFamily('Courier New').setFontSize(10).setWrap(true);
      sheet.setColumnWidth(1, 900);
      sheet.setRowHeight(1, 30);
    }
  } catch (e) {
    Logger.log('Could not write to Gem_Dispute_Dossiers tab: ' + e.message);
  }

  return {
    count: tickets.length,
    markdown: markdown,
    json: jsonString,
    tickets: tickets
  };
}

/**
 * Applies an approved Gem decision directly into the Team_Awards matrix
 * and triggers synchronization of the Season Master Ledger.
 *
 * @param {string} teamCode Target team code (e.g. '10U - Boys - Faheem Armanyous')
 * @param {string} targetColumn Target matrix column: 'pictureDay' or 'adjustment'
 * @param {number} points Point adjustment (positive or negative)
 * @param {string} reason Reason / audit finding for the decision
 * @param {string} [reviewerName] Name of the reviewing board member
 * @param {string} [ticketId] Optional associated Ticket ID
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [targetSs] Optional master spreadsheet reference
 * @returns {Object} Result object with updated team totals
 */
function applyGemDecisionToTeamAwards(teamCode, targetColumn, points, reason, reviewerName, ticketId, targetSs) {
  if (!teamCode || !teamCode.trim()) {
    throw new Error('teamCode is required to apply an adjudication decision.');
  }

  const normTarget = String(targetColumn || '').trim().toLowerCase();
  const isPic = normTarget.includes('pic');
  const isAdj = normTarget.includes('adj') || normTarget.includes('oth');

  if (!isPic && !isAdj) {
    throw new Error("Invalid targetColumn: must be 'pictureDay' or 'adjustment'.");
  }

  const pts = Number(points);
  if (isNaN(pts)) {
    throw new Error('points must be a valid number.');
  }

  const masterSs = targetSs || resolveMasterSpreadsheet_();
  if (!masterSs) {
    throw new Error('Master spreadsheet not found.');
  }

  let awardsSheet = masterSs.getSheetByName(ADJUDICATION_SHEET.AWARDS);
  const awardHeaders = [
    'Team Code',
    'Pre-Season Referees',
    'MatchTrak Bonus',
    'Picture Day',
    'Adjustment',
    'Reason / Audit Notes',
    'Reviewer',
    'Last Updated'
  ];

  if (!awardsSheet) {
    awardsSheet = masterSs.insertSheet(ADJUDICATION_SHEET.AWARDS);
    awardsSheet.getRange(1, 1, 1, awardHeaders.length).setValues([awardHeaders]);
    awardsSheet.getRange(1, 1, 1, awardHeaders.length)
      .setFontWeight('bold')
      .setBackground(AUDIT.BRAND_NAVY)
      .setFontColor('#FFFFFF');
  }

  const data = awardsSheet.getDataRange().getValues();
  const cleanTeam = String(teamCode).trim();
  const normTeam = normalizeTeamCode_(cleanTeam);

  let targetRowIdx = -1; // 1-based sheet row index
  let currentPic = 0;
  let currentAdj = 0;
  let currentCert = 0;
  let currentMatch = 0;

  for (let r = 1; r < data.length; r++) {
    const rowTeam = String(data[r][0] || '').trim();
    if (!rowTeam) continue;
    if (rowTeam.toLowerCase() === cleanTeam.toLowerCase() || normalizeTeamCode_(rowTeam) === normTeam) {
      targetRowIdx = r + 1; // 1-indexed row
      currentCert = Number(data[r][1]) || 0;
      currentMatch = Number(data[r][2]) || 0;
      currentPic = Number(data[r][3]) || 0;
      currentAdj = Number(data[r][4]) || 0;
      break;
    }
  }

  const author = reviewerName || (typeof Session !== 'undefined' && Session.getActiveUser().getEmail()) || 'Board Admin';
  const decisionReason = reason || 'Approved Gem Playoff Adjudication';
  const now = new Date();

  let newPic = currentPic;
  let newAdj = currentAdj;

  if (isPic) {
    newPic = Math.max(0, Math.min(2, currentPic + pts));
  } else {
    newAdj = currentAdj + pts;
  }

  if (targetRowIdx > 0) {
    // Update existing row in Team_Awards (Columns: D=4 Pic, E=5 Adj, F=6 Reason, G=7 Reviewer, H=8 Date)
    awardsSheet.getRange(targetRowIdx, 4).setValue(newPic);
    awardsSheet.getRange(targetRowIdx, 5).setValue(newAdj);
    awardsSheet.getRange(targetRowIdx, 6).setValue(decisionReason);
    awardsSheet.getRange(targetRowIdx, 7).setValue(author);
    awardsSheet.getRange(targetRowIdx, 8).setValue(now);
  } else {
    // Append new row for team
    const newRow = [
      cleanTeam,
      currentCert,
      currentMatch,
      newPic,
      newAdj,
      decisionReason,
      author,
      now
    ];
    awardsSheet.appendRow(newRow);
  }

  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
    SpreadsheetApp.flush();
  }

  // If associated with a ticket, update the Audit Queue
  if (ticketId) {
    try {
      const auditSs = resolveAuditSpreadsheet_();
      const queueSheet = auditSs ? auditSs.getSheetByName(SHEET.QUEUE) : null;
      if (queueSheet && queueSheet.getLastRow() > 1) {
        const qData = queueSheet.getDataRange().getValues();
        for (let q = 1; q < qData.length; q++) {
          if (String(qData[q][0] || '').trim() === String(ticketId).trim()) {
            const rowNum = q + 1;
            const hMap = headerMap_(queueSheet);
            if (hMap['Decision']) queueSheet.getRange(rowNum, hMap['Decision']).setValue('Approved');
            if (hMap['Net Point Adjustment']) queueSheet.getRange(rowNum, hMap['Net Point Adjustment']).setValue(pts);
            if (hMap['Auditor Assigned']) queueSheet.getRange(rowNum, hMap['Auditor Assigned']).setValue(author);
            if (hMap['Auditor Notes']) queueSheet.getRange(rowNum, hMap['Auditor Notes']).setValue(decisionReason);
            if (hMap['Decision Date']) queueSheet.getRange(rowNum, hMap['Decision Date']).setValue(now);
            if (hMap['Workflow Status']) queueSheet.getRange(rowNum, hMap['Workflow Status']).setValue('Closed');
            break;
          }
        }
      }
    } catch (err) {
      Logger.log('Could not update queue ticket ' + ticketId + ': ' + err.message);
    }
  }

  // Trigger synchronization of Season_Master_Ledger
  let syncResult = null;
  try {
    if (typeof runAuditAndSyncLedger === 'function') {
      syncResult = runAuditAndSyncLedger();
    } else if (typeof syncSeasonMasterLedger === 'function') {
      const auditSummary = (typeof auditFormResponses === 'function') ? auditFormResponses(masterSs) : { teamPoints: {} };
      syncResult = syncSeasonMasterLedger(masterSs, auditSummary.teamPoints);
    }
  } catch (err) {
    Logger.log('Warning during syncSeasonMasterLedger trigger: ' + err.message);
  }

  // Fetch updated ledger status
  const updatedLedger = getTeamLedgerPreCheck_(cleanTeam, masterSs);

  return {
    success: true,
    teamCode: cleanTeam,
    targetColumn: isPic ? 'pictureDay' : 'adjustment',
    pointsApplied: pts,
    previousPic: currentPic,
    newPic: newPic,
    previousAdj: currentAdj,
    newAdj: newAdj,
    reason: decisionReason,
    reviewer: author,
    ticketId: ticketId || null,
    revisedLedger: updatedLedger,
    message: `Applied ${pts >= 0 ? '+' : ''}${pts} pt(s) to ${cleanTeam} [${isPic ? 'pictureDay' : 'adjustment'}]. Total verified points: ${updatedLedger.totalPts !== undefined ? updatedLedger.totalPts : 'N/A'}. Status: ${updatedLedger.playoffStatus || 'Updated'}.`
  };
}

/**
 * UI Menu Action: Export dispute dossiers and display them in an interactive modal dialog.
 */
function menuExportDisputeDossiers() {
  const ui = SpreadsheetApp.getUi();
  const exportResult = exportDisputeDossiersForGem();

  if (exportResult.count === 0) {
    ui.alert(
      'AYSO 154 Playoff Audit',
      '✅ No unadjudicated dispute tickets found!\n\nAll tickets in the queue have been reviewed and closed.',
      ui.ButtonSet.OK
    );
    return;
  }

  const escapedMarkdown = exportResult.markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; color: #0F172A; background: #F8FAFC; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #002D62; padding-bottom: 12px; margin-bottom: 16px; }
          .title { font-size: 18px; font-weight: bold; color: #002D62; }
          .badge { background: #C8102E; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
          .btn-bar { display: flex; gap: 10px; margin-bottom: 14px; }
          .btn { background: #002D62; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
          .btn:hover { background: #001A38; }
          .btn-secondary { background: #64748B; }
          .btn-secondary:hover { background: #475569; }
          .status { font-size: 12px; color: #15803D; font-weight: bold; margin-left: 8px; display: none; }
          textarea { width: 100%; height: 420px; font-family: "SFMono-Regular", Consolas, Menlo, monospace; font-size: 12px; padding: 12px; border: 1px solid #CBD5E1; border-radius: 6px; background: #FFFFFF; resize: vertical; box-sizing: border-box; }
          .footer { font-size: 11px; color: #64748B; margin-top: 10px; text-align: right; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">📋 Playoff Dispute Dossiers (${exportResult.count} Pending)</div>
          <div class="badge">${exportResult.count} Tickets</div>
        </div>
        <div class="btn-bar">
          <button class="btn" onclick="copyDossier()">📋 Copy Markdown Dossier</button>
          <button class="btn btn-secondary" onclick="copyJson()">📦 Copy Structured JSON</button>
          <span id="copyStatus" class="status">✓ Copied to clipboard!</span>
        </div>
        <textarea id="dossierText" readonly>${escapedMarkdown}</textarea>
        <div class="footer">Feed this dossier into the custom Gem for adjudication recommendations. Tab 'Gem_Dispute_Dossiers' has also been refreshed.</div>

        <script>
          const rawJson = ${JSON.stringify(exportResult.json)};
          function copyDossier() {
            const ta = document.getElementById('dossierText');
            ta.select();
            document.execCommand('copy');
            showStatus('Markdown copied!');
          }
          function copyJson() {
            navigator.clipboard.writeText(rawJson).then(() => {
              showStatus('JSON copied!');
            });
          }
          function showStatus(msg) {
            const el = document.getElementById('copyStatus');
            el.innerText = '✓ ' + msg;
            el.style.display = 'inline';
            setTimeout(() => { el.style.display = 'none'; }, 3000);
          }
        </script>
      </body>
    </html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(720)
    .setHeight(560);

  ui.showModalDialog(htmlOutput, 'AYSO 154 - Gem Adjudication Dossiers');
}

/**
 * UI Menu Action: Prompt board member step-by-step to apply a Gem decision directly into Team_Awards.
 */
function menuApplyGemDecision() {
  const ui = SpreadsheetApp.getUi();

  // 1. Team Code
  const teamPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 1 of 5: Enter the Team Code (e.g., "10U - Boys - Faheem Armanyous"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (teamPrompt.getSelectedButton() !== ui.Button.OK) return;
  const teamCode = teamPrompt.getResponseText().trim();
  if (!teamCode) {
    ui.alert('Team code cannot be blank.');
    return;
  }

  // 2. Target Column
  const colPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 2 of 5: Target Column in Team_Awards?\nEnter "pictureDay" or "adjustment":',
    ui.ButtonSet.OK_CANCEL
  );
  if (colPrompt.getSelectedButton() !== ui.Button.OK) return;
  const targetCol = colPrompt.getResponseText().trim();

  // 3. Points
  const ptsPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 3 of 5: Number of points to add (e.g., 1 or 2):',
    ui.ButtonSet.OK_CANCEL
  );
  if (ptsPrompt.getSelectedButton() !== ui.Button.OK) return;
  const points = Number(ptsPrompt.getResponseText().trim());
  if (isNaN(points)) {
    ui.alert('Points must be a valid number.');
    return;
  }

  // 4. Reason
  const reasonPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 4 of 5: Reason / Audit Finding (e.g., "Approved Gem review - missing shift 10/24 verified on match card"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (reasonPrompt.getSelectedButton() !== ui.Button.OK) return;
  const reason = reasonPrompt.getResponseText().trim();

  // 5. Reviewer / Ticket ID
  const reviewerPrompt = ui.prompt(
    'Apply Gem Adjudication Decision',
    'Step 5 of 5: Reviewer Name / Ticket ID (e.g., "Board Admin - R154-2026-0001"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (reviewerPrompt.getSelectedButton() !== ui.Button.OK) return;
  const reviewer = reviewerPrompt.getResponseText().trim();

  try {
    const res = applyGemDecisionToTeamAwards(teamCode, targetCol, points, reason, reviewer);
    ui.alert(
      '✅ Decision Applied Successfully',
      `${res.message}\n\nSeason_Master_Ledger has been re-synchronized.`,
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('❌ Error Applying Decision', err.message, ui.ButtonSet.OK);
  }
}

/**
 * Creates the dedicated Playoff Audit Bridge menu.
 */
function createPlayoffAuditMenu(ui) {
  const menuUi = ui || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getUi() : null);
  if (!menuUi) return;
  try {
    menuUi.createMenu('⚖️ Playoff Audit Bridge')
      .addItem('📋 Export Playoff Dispute Dossiers (for Gem)', 'menuExportDisputeDossiers')
      .addItem('⚖️ Apply Gem Adjudication Decision', 'menuApplyGemDecision')
      .addToUi();
  } catch (e) {
    Logger.log('Could not create Playoff Audit Bridge menu: ' + e.message);
  }
}

/**
 * Safe date formatter compatible with non-Apps-Script (Node.js) test environments.
 */
function formatDateTimeSafe_(date) {
  if (!date) return 'Not available';
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(new Date(date), AUDIT.TIME_ZONE, 'EEE, MMM d, yyyy h:mm a') + ' PT';
  }
  return new Date(date).toISOString();
}

/**
 * Helper to retrieve the Game Day Check-ins sheet with fallback to legacy Form Responses 1.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss]
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getGameDayCheckinsSheet(ss) {
  const targetSs = ss || ((typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (!targetSs) return null;
  return targetSs.getSheetByName('Game Day Check-ins') || targetSs.getSheetByName('Form Responses 1');
}

/**
 * Helper to retrieve the Audit Submissions sheet with fallbacks to Form Responses 2, Playoff_Audit_Responses, and Form Responses.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss]
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getAuditSubmissionsSheet(ss) {
  const targetSs = ss || ((typeof SpreadsheetApp !== 'undefined') ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (!targetSs) return null;
  return targetSs.getSheetByName('Audit Submissions') ||
         targetSs.getSheetByName('Form Responses 2') ||
         targetSs.getSheetByName(ADJUDICATION_SHEET.PLAYOFF_RESPONSES) ||
         targetSs.getSheetByName(SHEET.RESPONSES) ||
         targetSs.getSheetByName(SHEET.LEGACY_RESPONSES) ||
         targetSs.getSheetByName('Form Responses');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    exportDisputeDossiersForGem,
    applyGemDecisionToTeamAwards,
    getTeamLedgerPreCheck_,
    getUnadjudicatedDisputes,
    formatDisputeDossier,
    menuExportDisputeDossiers,
    menuApplyGemDecision,
    createPlayoffAuditMenu,
    getGameDayCheckinsSheet,
    getAuditSubmissionsSheet,
    ADJUDICATION_SHEET,
    AUDIT,
    SHEET,
    QUEUE_HEADERS,
    SHIFT_HEADERS
  };
}
