/**
 * ============================================================================
 * AYSO REGION 154 - PRE-FLIGHT FORM READINESS AUDITOR
 * ============================================================================
 * File: VerifyFormReadiness.gs
 * Description: Validates that all 8 sections, question targets, venue dropdowns,
 *              and Section 8 cleanup meet 100% of the operational requirements
 *              before deploying the schedule synchronization engine.
 * ============================================================================
 */
function verifyFormReadiness() {
  const FORM_ID = '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI';
  const form = FormApp.openById(FORM_ID);
  const items = form.getItems();
  
  const checks = [];
  function recordCheck(name, passed, details) {
    checks.push({ name, passed, details });
  }

  Logger.log('====================================================================');
  Logger.log(`AUDITING FORM READINESS: "${form.getTitle()}"`);
  Logger.log(`Form ID: ${FORM_ID}`);
  Logger.log('====================================================================\n');

  // 1. Check Accepting Responses Status
  recordCheck('Form Accepting Responses', form.isAcceptingResponses(), `Status: ${form.isAcceptingResponses()}`);

  // 2. Map Items by Section
  const sections = { 1: [] };
  let currentSection = 1;
  const pageBreaks = [];

  items.forEach((item) => {
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) {
      currentSection++;
      sections[currentSection] = [];
      pageBreaks.push(item.asPageBreakItem());
    } else {
      sections[currentSection].push(item);
    }
  });

  // Check Total Section Count
  recordCheck('Total Section Count', currentSection === 8, `Found ${currentSection} sections (Expected: 8)`);

  // 3. Section 1 Validation (Role Branching)
  const sec1RoleItem = sections[1].find(i => i.getType() === FormApp.ItemType.MULTIPLE_CHOICE && /volunteer role/i.test(i.getTitle()));
  if (sec1RoleItem) {
    const choices = sec1RoleItem.asMultipleChoiceItem().getChoices();
    const refChoice = choices.find(c => /referee/i.test(c.getValue()));
    const fmChoice = choices.find(c => /field marshal/i.test(c.getValue()));
    const fsChoice = choices.find(c => /field set up/i.test(c.getValue()));

    const refTarget = refChoice && refChoice.getGotoPage() ? refChoice.getGotoPage().getTitle() : null;
    const fmTarget = fmChoice && fmChoice.getGotoPage() ? fmChoice.getGotoPage().getTitle() : null;
    const fsTarget = fsChoice && fsChoice.getGotoPage() ? fsChoice.getGotoPage().getTitle() : null;

    const roleRoutingPass = /referee check-in/i.test(refTarget || '') &&
                            /field marshal/i.test(fmTarget || '') &&
                            /field set up/i.test(fsTarget || '');
    recordCheck('Section 1 Role Branching', roleRoutingPass, 
      `Referee -> "${refTarget}", FM -> "${fmTarget}", Set Up -> "${fsTarget}"`);
  } else {
    recordCheck('Section 1 Role Branching', false, 'Missing "What is your volunteer role today?" question');
  }

  // 4. Section 2 Validation (Venue Branching)
  const sec2VenueItem = sections[2].find(i => i.getType() === FormApp.ItemType.MULTIPLE_CHOICE && /venue/i.test(i.getTitle()));
  if (sec2VenueItem) {
    const choices = sec2VenueItem.asMultipleChoiceItem().getChoices();
    const ljhsChoice = choices.find(c => /lexington|arnold/i.test(c.getValue()));
    const parkChoice = choices.find(c => /park lex/i.test(c.getValue()));
    const lutherChoice = choices.find(c => /luther/i.test(c.getValue()));

    const ljhsTarget = ljhsChoice && ljhsChoice.getGotoPage() ? ljhsChoice.getGotoPage().getTitle() : null;
    const parkTarget = parkChoice && parkChoice.getGotoPage() ? parkChoice.getGotoPage().getTitle() : null;
    const lutherTarget = lutherChoice && lutherChoice.getGotoPage() ? lutherChoice.getGotoPage().getTitle() : null;

    const venueRoutingPass = /lexington.*arnold/i.test(ljhsTarget || '') &&
                             /park lex/i.test(parkTarget || '') &&
                             /luther/i.test(lutherTarget || '');
    recordCheck('Section 2 Venue Branching', venueRoutingPass, 
      `LJHS -> "${ljhsTarget}", Park Lex -> "${parkTarget}", Luther -> "${lutherTarget}"`);
  } else {
    recordCheck('Section 2 Venue Branching', false, 'Missing "Select Venue / Location" question in Section 2');
  }

  // 5. Section 3, 4, 5 Match Dropdown Item Existence
  const sec3MatchItem = (sections[3] || []).find(i => i.getType() === FormApp.ItemType.LIST && /lexington.*arnold/i.test(i.getTitle()));
  const sec4MatchItem = (sections[4] || []).find(i => i.getType() === FormApp.ItemType.LIST && /park lex/i.test(i.getTitle()));
  const sec5MatchItem = (sections[5] || []).find(i => i.getType() === FormApp.ItemType.LIST && /luther/i.test(i.getTitle()));

  recordCheck('Section 3 LJHS Dropdown Target', !!sec3MatchItem, sec3MatchItem ? `Found: "${sec3MatchItem.getTitle()}"` : 'Missing LJHS match dropdown in Section 3');
  recordCheck('Section 4 Park Lex Dropdown Target', !!sec4MatchItem, sec4MatchItem ? `Found: "${sec4MatchItem.getTitle()}"` : 'Missing Park Lex match dropdown in Section 4');
  recordCheck('Section 5 Luther Dropdown Target', !!sec5MatchItem, sec5MatchItem ? `Found: "${sec5MatchItem.getTitle()}"` : 'Missing Luther match dropdown in Section 5');

  // 6. Section Navigation to "Check-In Complete" (Section 8)
  const checkSectionNav = (secIndex, expectedTargetName) => {
    const pb = pageBreaks[secIndex - 1];
    if (!pb) return { pass: false, desc: `No page break found after Section ${secIndex}` };
    const nav = pb.getPageNavigationType();
    const target = pb.getGoToPage();
    const title = target ? target.getTitle() : (nav === FormApp.PageNavigationType.CONTINUE ? 'Next Section' : nav.toString());
    const pass = target ? new RegExp(expectedTargetName, 'i').test(target.getTitle()) : false;
    return { pass, desc: `After Section ${secIndex} -> "${title}"` };
  };

  const nav3 = checkSectionNav(3, 'Check-In Complete');
  const nav4 = checkSectionNav(4, 'Check-In Complete');
  const nav5 = checkSectionNav(5, 'Check-In Complete');
  const nav6 = checkSectionNav(6, 'Check-In Complete');
  const nav7 = checkSectionNav(7, 'Check-In Complete');

  recordCheck('Section 3 Routing to Complete', nav3.pass, nav3.desc);
  recordCheck('Section 4 Routing to Complete', nav4.pass, nav4.desc);
  recordCheck('Section 5 Routing to Complete', nav5.pass, nav5.desc);
  recordCheck('Section 6 Routing to Complete', nav6.pass, nav6.desc);
  recordCheck('Section 7 Routing to Complete', nav7.pass || /next section/i.test(nav7.desc), nav7.desc);

  // 7. Section 8 Cleanliness Check (Must contain 0 questions)
  const sec8Items = sections[8] || [];
  const sec8Clean = sec8Items.length === 0;
  recordCheck('Section 8 Zero-Question Landing Screen', sec8Clean, 
    sec8Clean ? 'Passed: Section 8 is clean (0 question cards).' : `Failed: Found ${sec8Items.length} question(s) inside Section 8!`);

  // =====================================================================
  // AUDIT SCORECARD SUMMARY
  // =====================================================================
  Logger.log('\n================== READINESS SCORECARD ==================');
  let allPassed = true;
  checks.forEach((c) => {
    const icon = c.passed ? '✅ PASS' : '❌ FAIL';
    if (!c.passed) allPassed = false;
    Logger.log(`${icon} | ${c.name.padEnd(36)} | ${c.details}`);
  });
  Logger.log('=========================================================');

  if (allPassed) {
    Logger.log('🎉 RESULT: 100% READY. The form layout matches the production sync engine specification.');
  } else {
    Logger.log('⚠️ RESULT: ACTION REQUIRED. Review the items marked with ❌ FAIL above.');
  }
}