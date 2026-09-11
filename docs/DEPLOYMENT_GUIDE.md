# Cypress AYSO Region 154 Volunteer Point Review

This package creates the Fall 2026 Google Form, response workbook, normalized audit queue, shift-level review table, team-status table, administrative dashboard, audit log, notifications, and deadline controls.

## Before deployment

Confirm these policy decisions with the Board:

1. The category caps in `AUDIT.CATEGORIES` are correct.
2. November 9 brackets are provisional until eligibility certification on November 12.
3. Final-game exception requests are limited to shifts completed November 7–10.
4. Field-tent and referee records for November 7–10 will be photographed or entered the same day.
5. A monitored Region email address is available for replies and daily queue summaries.

The same-day record requirement is important. A normal 48-hour posting delay cannot support a November 11 noon exception deadline for a November 10 evening shift.

## Install

1. Go to [script.google.com](https://script.google.com) and create a new standalone Apps Script project.
2. Replace the default script contents with `AYSO154_Playoff_Audit.gs`.
3. In Project Settings, enable **Show `appsscript.json` manifest file in editor**.
4. Replace the manifest with the supplied `appsscript.json`.
5. In the script configuration, set `AUDIT.SUPPORT_EMAIL` to the monitored Region address.
6. Verify every category cap and point value in `AUDIT.CATEGORIES`.
7. Run `setupAuditSystem()` and approve the requested permissions.
8. Open the URLs shown in the execution log or the Configuration tab’s Setup Report.
9. In the Google Form editor, upload the approved 4:1 Region 154 header image and set the theme color to `#002D62`.
10. Run `runSelfTests()`. Confirm that all deadline tests pass.

## Required routing tests

Use Preview in Google Forms and verify each path:

| Test | Expected result |
|---|---|
| Parent / Volunteer / Other | Polite team-leadership terminal screen, then submit |
| Head Coach or Team Manager with 17+ | Qualified-team terminal screen, then submit |
| Team leader with 0–16 points | Team identity and shift workflow |
| One missing shift | Shift 1, sibling check, certification, submit |
| Multiple missing shifts | Only the requested shift sections appear |
| Five missing shifts | Shift 5 proceeds to sibling check |
| Valid audit submission | Never displays a parent or qualified-team terminal screen |
| Certification | All five boxes must be selected |

Delete these test responses before distributing the live link, or label them clearly as tests in the queue.

## Distribution control

Share only the Google Form respondent URL in the closed Head Coach and Team Manager WhatsApp groups. Do not place it on the public website.

Recommended WhatsApp note:

> This private Volunteer Point Review form is for Head Coaches and Team Managers only. Before submitting, please check your team’s current dashboard total and coordinate internally so only one leadership request is submitted for each specific challenge. If several missing shifts belong to the same challenge, include them together in one ticket. Please do not forward the link outside the Coaches and Team Managers groups.

Digital distribution controls the audience but does not technically authenticate rostered leadership. The form therefore records the submitter’s role, name, registered email, team code, and coach name. The Board should compare these fields against SportsConnect when the ticket is reviewed.

## Workbook structure

- **Form Responses**: Google’s untouched raw response destination.
- **Audit Queue**: one row per leadership challenge and the Board workflow.
- **Shift Details**: one row per disputed shift.
- **Team Status**: current dashboard points, gap to 17, and latest ticket.
- **Dashboard**: queue counts and progress toward the 80% standard-resolution goal.
- **Configuration**: dates, thresholds, category caps, URLs, and setup reminders.
- **Audit Log**: timestamped workflow and decision changes.

## Duplicate-control rule

The script creates a challenge fingerprint from:

- normalized team code;
- shift date and approximate time;
- volunteer name;
- category;
- venue; and
- field or location.

An exact repeat is flagged as a duplicate of the earlier ticket. A different shift or materially different challenge from the same team is allowed, while the queue also identifies whether that team already has another open ticket.

## Recommended Board workflow

1. **New** — confirm team leadership and inspect the request.
2. **Needs Information** — ask for missing identifying details using the ticket number.
3. **Assigned** — identify the responsible auditor.
4. **In Review** — compare the claim with tent sheets, QR records, referee cards, and sibling-team records.
5. Enter the **Net Point Adjustment**. The revised team total is capped at 17 because surplus points are not audited.
6. Select the final **Decision**. The script sends the decision email once.
7. Set **Workflow Status** to **Closed**.

Do not use **Resolved** as both a decision and a workflow state. The package keeps those concepts separate.

## Deadline model

- Ordinary discrepancies must be submitted within 14 calendar days of the shift and by November 8 at 5:00 PM Pacific Time, whichever occurs first.
- Ordinary shifts should receive 48 hours to post before a challenge is submitted.
- Shifts completed November 7–10 use the final-game exception and must be submitted by November 11 at noon Pacific Time.
- The final-game exception cannot revive an older discrepancy.
- Submission timestamps determine timeliness. The hourly trigger changes the displayed form phase and closes the form after the final deadline, but it is not the legal or policy clock.

## Operational milestones

| Date | Operational objective |
|---|---|
| November 1, 5:00 PM PT | Every team below 17 checks the dashboard and reconciles known mature discrepancies |
| November 8, 5:00 PM PT | Standard request window closes |
| November 9 | Provisional brackets prepared |
| November 10, noon PT | At least 80% of standard tickets resolved |
| November 11, noon PT | Final-game exception closes |
| November 11, 6:00 PM PT | Final audit decisions completed |
| November 12, noon PT | Eligibility certified and brackets finalized |
| November 13 | Post-season begins |

## Safe updates

- Rerunning `setupAuditSystem()` reuses the stored Form and spreadsheet IDs.
- It does not intentionally clear the audit queue or raw responses.
- If `AUDIT.VERSION` changes while an existing form contains questions, setup stops rather than silently rebuilding the live form.
- Use `rebuildAuditForm()` only before launch or after making a backup. Rebuilding deletes and recreates form questions, which can change response-column mappings.
- Never delete the Script Properties containing the Form and spreadsheet IDs unless you intentionally want a completely separate system.

## Final launch checklist

- [ ] Category caps verified by the Board
- [ ] Support email configured and tested
- [ ] Form header and colors applied
- [ ] All routing paths tested in Preview
- [ ] Deadline self-tests passed
- [ ] Test confirmation and decision emails received
- [ ] Audit Queue dropdowns work
- [ ] Dashboard formulas display correctly
- [ ] Tent/referee record owners assigned for November 7–10
- [ ] Respondent URL shared only in the closed leadership WhatsApp groups
