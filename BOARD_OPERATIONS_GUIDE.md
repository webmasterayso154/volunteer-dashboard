# AYSO Region 154 Volunteer System: Executive Board Operations Guide

This operational guide provides step-by-step instructions for the AYSO Cypress Region 154 Executive Board to manage volunteer points, award administrative bonuses, add late teams, and audit game-day entries.

---

## 1. System Ecosystem & Access Links

* **Public Coach Dashboard:** `https://webmasterayso154.github.io/volunteer-dashboard/`  
  *(Publicly accessible. Displays team totals, category breakdowns, and duty badges. Volunteer names are redacted for privacy.)*
* **Google Response Sheet:** `AYSO 154 - Game Day Hub - Fall 2026 (Responses)`  
  *(Internal database with raw check-ins, config caps, and award overrides.)*

---

## 2. Managing Team Awards & Manual Points (`Team_Awards` Tab)

Use the **`Team_Awards`** tab to credit points that do not come from standard Saturday QR code check-ins. All teams are listed alphabetically in **Column A (`teamCode`)**.

| Column | Header | What to Enter | Responsible Role |
| :--- | :--- | :--- | :--- |
| **B** | `preSeasonRefs` | Number of certified referee bonus points (up to 5 max). | Referee Administrator |
| **C** | `matchTrakBonus` | Enter `2` for teams with full MatchTrak scheduling compliance by Sep 26. | Coach Administrator |
| **D** | `pictureDay` | Points earned for Picture Day volunteer shifts (up to 2 max). | Event Lead / Webmaster |
| **E** | `adjustment` | Manual numeric adjustment (e.g., `1`, `2`, or negative `-1`, `-2` for penalties). | Regional Commissioner |
| **F** | `reason` | Short description of why the adjustment was made (e.g., "Field painting", "Missed ref duty"). | Awarding Admin |
| **G** | `grantedBy` | Your name or board title (e.g., "Nikki M.", "Troy B."). | Awarding Admin |
| **H** | `lastUpdated` | Date of award entry (e.g., `9/15/2026`). | Awarding Admin |

### Step-by-Step: Adding an Award or Deduction
1. Open the **`Team_Awards`** tab.
2. Press **Ctrl + F** and search for the coach's last name or team code in Column A.
3. Scroll across to the appropriate column (e.g., Column B for Referees, Column E for Adjustments).
4. Enter the numeric value.
5. In Column F, type the operational reason.
6. In Column G, type your name or initials.
7. The change will reflect immediately on the coach dashboard upon next refresh.

---

## 3. Global Settings & Season Caps (`Admin_Config` Tab)

Global rules are configured in **Columns D & E (`GLOBAL DASHBOARD SETTINGS`)**.

* **PlayoffThreshold (Default: `17`):** Target points required for playoff and post-season tournament eligibility.
* **RefMaxCap (Default: `10`):** Maximum regular season on-field referee points a team can earn.
* **FieldMarshalCap (Default: `2`):** Maximum points earned for Field Marshal duties.
* **FieldSetupCap (Default: `5`):** Maximum points earned for Friday Night field setup.
* **PictureDayCap (Default: `2`):** Maximum points earned for Picture Day/Picnic duties.
* **StandingsFrozen (Checkbox in cell E8):**  
  * Check this box when regular-season volunteer tracking closes before playoffs.  
  * When checked, the dashboard locks all standings and halts automatic recalculations from new form entries.

---

## 4. Registering Mid-Season Coaches (`Admin_Config` Tab)

When late teams are formed or coach assignments change after opening day, use **Columns G through I (`SUPPLEMENTAL ROSTER`)**:

1. Open the **`Admin_Config`** tab.
2. Scroll to the first empty row under **Column G (`Division`)**.
3. Select or type the division (e.g., `10U - Boys`, `12U - Girls`).
4. In **Column H (`Coach Name`)**, enter the Head Coach's full name.
5. **Column I (`Full Team Code (Auto)`)** will automatically generate the standardized team key.
6. Once entered, the coach will immediately appear in the dropdown menus on the live website.

---

## 5. Game-Day Audits & Resolving Anomaly Flags (`Form Responses 1`)

Saturday volunteer submissions automatically enter `Form Responses 1`. The system handles points as follows:

* **Assistant Referees (Dual AR):** Two Assistant Referees on the same game time will each receive **+1 point** automatically without conflict.
* **Paid Referees:** NOCRA center referees receive **`NOCRA - No Points` (0 pts)**.
* **Pending Entries:** Normal form check-ins display as **`Recorded` (+1 pt)**.

### Resolving Collisions (e.g., Two Center Referees Claimed Same Slot)
1. Open `Form Responses 1` and locate the flagged time slot.
2. Compare the entries against the official MatchTrak game card to verify who actually centered the match versus who ran the line.
3. For the volunteer who served as the Assistant Referee, update their duty column in the row from "Center" to "AR" (or leave an explanatory note in the notes column).
4. If a submission was an accidental double-tap (same person submitting twice within seconds), change the extra row's duty or status note to "Duplicate" to credit 0 points.

---

## 6. Weekly Executive Board Maintenance Checklist

* **Monday Morning (Referee Admin):** Cross-reference Saturday game cards against `Form Responses 1` to verify unassigned slots or center-ref conflicts.
* **Tuesday Evening (Coach Admin):** Review the public dashboard to ensure all teams with active volunteers show updated totals toward the 17-point requirement.
* **Friday Afternoon (Webmaster / Field Director):** Confirm setup slots for Friday Night Field Setup are ready for form check-ins.
