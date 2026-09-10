\# AYSO Region 154 Volunteer System: Executive Board Operations Guide



This operational manual outlines the workflows, administrative controls, and audit procedures powering the AYSO Region 154 Volunteer Points Tracking System.



\---



\## 1. System Ecosystem \& Access Levels



The tracking system is partitioned into three discrete tiers to protect volunteer privacy while providing operational transparency:



\* \*\*Public Coach Dashboard (`https://webmasterayso154.github.io/volunteer-dashboard/`):\*\* Coach- and parent-facing view. It displays aggregate team progress toward the 17-point playoff threshold and itemized duty badges. Volunteer names and contact information are strictly redacted on this surface.

\* \*\*Google Response Sheet (`Form Responses 1`):\*\* The operational database receiving automated form check-ins, row timestamps, division classifications, and raw notes.

\* \*\*Board Portal \& Admin Config:\*\* The internal administrative interface used to configure season point caps, award administrative points, and audit game-day integrity flags.



\---



\## 2. Managing Caps \& Season Rules (`Admin\_Config`)



All point thresholds and category caps are managed dynamically from the \*\*`Admin\_Config`\*\* tab in the main Google Spreadsheet. Any changes made here automatically propagate across both the Board Portal and the public coach view without editing code.



| Setting Key | Default Value | Operational Rule |

| :--- | :--- | :--- |

| \*\*PlayoffThreshold\*\* | `17` | Total points required for post-season and tournament eligibility. |

| \*\*RefMaxCap\*\* | `10` | Maximum points earned via regular-season on-field referee assignments. |

| \*\*FieldMarshalCap\*\* | `2` | Maximum points earned for Field Marshal duties. Shifts may occur on separate dates or the same Saturday. |

| \*\*FieldSetupCap\*\* | `5` | Maximum points earned for Friday Night field setup (1 pt/hr). |

| \*\*PictureDayCap\*\* | `2` | Maximum points earned for Picture Day/Picnic volunteer coverage. |

| \*\*CertifiedRefMax\*\* | `5` | Administrative bonus points granted for rostered, certified team referees. |

| \*\*MatchTrakBonus\*\* | `2` | Incentive bonus for full MatchTrak scheduling compliance by September 26. |



> \*\*Administrative Note:\*\* Never delete column headers in the `Admin\_Config` tab. Modify only the numeric values in the adjacent setting value cells.



\---



\## 3. Game-Day Integrity Queue \& Anomaly Audits



The system contains an automated anomaly engine (`BoardApp.gs`) designed to flag irregularities while preventing false alarms. Division Commissioners and the Referee Administrator should review the audit queue weekly after Saturday matches.



\### How the Engine Evaluates Entries



\* \*\*Assistant Referees (Dual AR):\*\* Fully supported. Two Assistant Referees on the same pitch and time slot will award 1 point to each respective team without triggering flags.

\* \*\*NOCRA / Paid Referees:\*\* Paid center referees receive a neutral \*\*`NOCRA - No Points`\*\* badge with 0 points credited toward volunteer standings.

\* \*\*Recorded Status:\*\* Form submissions enter the system under the \*\*`Recorded`\*\* status until audited or season-end reconciliations take place.



\### Common Anomaly Flags \& Required Actions



\* \*\*`SLOT\_COLLISION` (Conflicting Center Referee):\*\*

&#x20; \* \*Trigger:\* Two separate volunteers claimed the Center Referee position for the identical field, date, and game time.

&#x20; \* \*Action:\* Consult the official game card in MatchTrak. Identify the actual Center Referee versus the Assistant Referee, open `Form Responses 1`, and update the secondary volunteer's duty description or team credit.

\* \*\*`RAPID\_DUPLICATE`:\*\*

&#x20; \* \*Trigger:\* An identical volunteer ID or team submitted the same category within seconds of each other.

&#x20; \* \*Action:\* The engine automatically assigns 0 points to the secondary submission as a duplicate. Confirm the duplicate entry in the sheet and leave it marked or strike the row if requested by the coach.

\* \*\*`CAP\_REACHED`:\*\*

&#x20; \* \*Trigger:\* A team submitted valid volunteer service, but their point total in that category has reached the season ceiling (e.g., an 11th referee point).

&#x20; \* \*Action:\* Informational only. The public log will acknowledge the volunteer's service with a `Cap Reached` badge, but extra points will not inflate the team's playoff total.



\---



\## 4. Administrative Awards \& Manual Overrides (`TeamAwards.gs`)



Points not originating from standard form check-ins (such as Certified Referee bonuses, MatchTrak bonuses, or disciplinary deductions) are entered directly through the Board Portal or the designated administrative tabs:



\* \*\*Certified Referee Bonus:\*\* Enter confirmed badge certifications for a team directly into the Board Portal Award tool to credit up to 5 points toward qualification.

\* \*\*MatchTrak Compliance:\*\* Once verified on September 26, execute the batch award function to credit compliant teams with their 2-point incentive.

\* \*\*Disciplinary Deductions:\*\* If a team fails a mandatory assignment, enter a negative adjustment (e.g., `-1` or `-2`) tagged under `Board Deduction`. The public dashboard renders these in soft rose styling and deducts the value from the team's live standing.



\---



\## 5. Mid-Season Roster \& Coach Adjustments



When new teams are formed or head coaches change after opening weekend:



\* \*\*Adding Late Coaches:\*\* Open the \*\*`Admin\_Config`\*\* tab and navigate to Columns G through I (\*\*Late-Added Coaches\*\*). Enter the Division, Team Code, and Head Coach Name. The Apps Script engine merges these entries with `MASTER\_TEAMS` dynamically.

\* \*\*Team Directory Sync:\*\* Once a new team is saved in `Admin\_Config`, coaches and team managers will immediately appear in the dropdown menu on both the public dashboard and internal portal.



\---



\## 6. Weekly Administrative Maintenance Checklist



1\. \*\*Monday Morning:\*\* Open the Google Spreadsheet and access \*\*AYSO 154 Admin Tools\*\* -> \*\*Launch Board Portal\*\*.

2\. \*\*Review Flags:\*\* Check the \*\*Integrity \& Anomaly Queue\*\* for any pitch collisions or disputed times.

3\. \*\*Verify Caps:\*\* Ensure manual credits (setup hours, picture day shifts) have accurately tallied under the Category Breakdown table.

4\. \*\*Run System Health Check:\*\* If any structural spreadsheet edits were made, select \*\*AYSO 154 Admin Tools\*\* -> \*\*Run Diagnostics\*\* to ensure all contract tests remain 100% compliant.

