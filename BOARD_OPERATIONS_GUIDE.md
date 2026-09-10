<div align="center">
  <img src="logo.png" alt="AYSO Region 154 Cypress" width="110" />
  <h1>⚽ AYSO Region 154 Volunteer System</h1>
  <h3>🏆 Executive Board Playbook & Game Day Operations Guide 🏆</h3>
  <p><em>"Building great soccer experiences for our kids through fair-play volunteer teamwork!"</em></p>
</div>

---

## 🌟 The Game Plan (System Overview)

Our volunteer tracking system runs like a well-coordinated soccer squad with key positions on the pitch:

* 📱 **The Public Pitch (Coach Dashboard):**  
  👉 <a href="https://webmasterayso154.github.io/volunteer-dashboard/" target="_blank" rel="noopener noreferrer"><strong>Open Live Volunteer Points Dashboard</strong></a>  
  This is the family-friendly scoreboard coaches and parents check. Teams track their sprint toward the **17-point playoff goal**. Volunteer names and contact info never appear on this public surface.

* 📝 **The Game Day Check-In Form (QR Destination):**  
  👉 <a href="https://docs.google.com/forms/d/e/1FAIpQLSdDPW8Bs7T1v7xYBIzVmHwi7rpx6rrLcqYk83vvVUJo_j5WSQ/viewform" target="_blank" rel="noopener noreferrer"><strong>Open Volunteer Check-In Form</strong></a>  
  The mobile form that parents and referees scan at the fields to record match coverage and setup hours.

* 📋 **The Official Match Sheet (Raw Responses):**  
  👉 <a href="https://docs.google.com/spreadsheets/d/1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGI998ChVVMypyCk/edit" target="_blank" rel="noopener noreferrer"><strong>Open Google Response Spreadsheet</strong></a>  
  Our central database containing raw Saturday check-ins (`Form Responses 1`).

* 🎛️ **The Coach's Box (`Admin_Config` & `Team_Awards`):**  
  👉 <a href="https://docs.google.com/spreadsheets/d/1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGI998ChVVMypyCk/edit#gid=1448287399" target="_blank" rel="noopener noreferrer"><strong>Open Admin_Config Settings Tab</strong></a>  
  The administrative area where point caps are adjusted, late teams are registered, and manual team awards are entered.

---

## 🥅 Playoff Targets & Category Caps (`Admin_Config`)

Every player knows the goal! Point requirements and seasonal caps are configured in the **`Admin_Config`** tab (Columns D & E).

| Goal / Duty ⚽ | Target / Cap | How Teams Score Points |
| :--- | :---: | :--- |
| **Playoff Qualification** | **17 Total Pts** | The target required for post-season and tournament play. |
| **Referee Assignments** | **10 Pts Max** | Saturday on-field referee assignments. Keeps matches staffed and safe. |
| **Friday Night Setup** | **5 Pts Max** | Field lining, putting up nets, and setting corner flags (1 pt/hr). |
| **Field Marshal Shifts** | **2 Pts Max** | Ensuring sideline safety and positive sportsmanship. |
| **Picture Day & Picnic** | **2 Pts Max** | Volunteer assistance during team photo events. |
| **Certified Team Referees** | **5 Pts Bonus** | Administrative bonus credited to teams with fully certified, rostered referees. |
| **MatchTrak Compliance** | **2 Pts Bonus** | Reward for coaches who fully populate their MatchTrak roster by September 26. |

> 💡 **Board Tip:** Keep the checkbox in cell E8 (**`StandingsFrozen`**) unchecked throughout the season. Checking this box locks down points when regular-season tracking closes.

---

## 🦺 Friday Night Setup & Saturday Check-Ins

* 🌙 **Friday Night Field Prep:** Volunteers scan the field QR code, select **Friday Night Field Setup**, and log their team. The backend awards **1 point per hour** up to the 5-point season ceiling.
* 🚩 **Assistant Referees (Dual AR):** When two assistant referees work the same match, both teams are awarded **+1 point** without collision flags.
* ⏱️ **NOCRA Paid Referees:** Paid center referees receive a neutral **`NOCRA - No Points` (0 pts)** badge in the log.
* 📝 **Live Form Entries:** Incoming check-ins display with a soft blue **`Recorded` (+1 pt)** badge so coaches can confirm their shift logged.

---

## 🏅 Awarding Special Team Points (`Team_Awards`)

When teams earn administrative bonuses, enter them in the <a href="https://docs.google.com/spreadsheets/d/1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGI998ChVVMypyCk/edit" target="_blank" rel="noopener noreferrer"><strong>Team_Awards Tab</strong></a>:

| Column | Header | What to Enter |
| :---: | :--- | :--- |
| **B** | `preSeasonRefs` | Certified referee bonus points (up to 5). |
| **C** | `matchTrakBonus` | Enter `2` for teams compliant on MatchTrak by Sep 26. |
| **D** | `pictureDay` | Picture day volunteer shift credits (up to 2). |
| **E** | `adjustment` | Manual point adjustments (`+1`, `+2`) or deductions (`-1`, `-2`). |
| **F** | `reason` | Description (e.g., "Net setup support", "Missed ref assignment"). |
| **G** | `grantedBy` | Board title or initials (e.g., "Nikki M.", "Troy B."). |

---

## 👟 Welcoming Late Teams & Coaches (`Admin_Config`)

If a team is added mid-season:
1. Open <a href="https://docs.google.com/spreadsheets/d/1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGI998ChVVMypyCk/edit#gid=1448287399" target="_blank" rel="noopener noreferrer"><strong>Admin_Config</strong></a>.
2. Scroll to the first empty row under **Columns G & H (`SUPPLEMENTAL ROSTER`)**.
3. Type the **Division** (e.g., `10U - Boys`) and **Coach Name**.
4. The system automatically creates the team code and adds them to the live dashboard dropdowns.

---

## 🚩 Resolving Sideline Collisions (Anomaly Checks)

If two volunteers claim the Center Referee slot for the same match:
1. Open the game card in MatchTrak to verify who centered versus who ran the line.
2. Open <a href="https://docs.google.com/spreadsheets/d/1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGI998ChVVMypyCk/edit" target="_blank" rel="noopener noreferrer"><strong>Form Responses 1</strong></a>.
3. Change the line referee's duty entry to "AR" so both volunteers receive proper credit.

---

## 📋 Weekly Board Playbook Checklist

* ☕ **Monday Morning (Referee Admin or delegate):**  
  Review Saturday game cards against `Form Responses 1`. Resolve center referee collisions or rapid duplicates so point totals stay accurate.
* 📱 **Tuesday Evening (Coach Admin or delegate):**  
  Check the public dashboard to ensure team progress toward the 17-point threshold is tallying smoothly.
* 🥅 **Friday Afternoon (Field Director / Webmaster):**  
  Confirm field setup gear and QR codes are ready for Friday evening volunteers.
* 🏁 **End of Season (Regional Commissioner):**  
  In `Admin_Config`, check the **`StandingsFrozen`** box (cell E8) to lock playoff seeds.
