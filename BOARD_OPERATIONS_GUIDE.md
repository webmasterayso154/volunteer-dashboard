<div align="center">
  <img src="logo.png" alt="AYSO Region 154 Cypress" width="110" />
  <h1>⚽ AYSO Region 154 Volunteer System</h1>
  <h3>🏆 Executive Board Playbook & Game Day Operations Guide 🏆</h3>
  <p><em>"Building great soccer experiences for our kids through fair-play volunteer teamwork!"</em></p>
</div>

---

## 🌟 The Game Plan (System Overview)

Our volunteer tracking system runs like a well-coordinated soccer squad with three key positions on the pitch:

* 📱 **The Public Pitch (Coach Dashboard):**  
  👉 `https://webmasterayso154.github.io/volunteer-dashboard/`  
  This is the family-friendly scoreboard coaches and parents check. Teams track their sprint toward the **17-point playoff goal**. To protect our soccer families' privacy, volunteer names and contact info never appear on this public dashboard.
* 📋 **The Official Match Sheet (`Form Responses 1`):**  
  Our central Google Sheet that catches Saturday QR code check-ins from the fields in real time.
* 🎛️ **The Coach's Box (`Admin_Config` & `Team_Awards`):**  
  The private board area where we fine-tune point targets, award special team bonuses, and celebrate extra volunteer hustle.

---

## 🥅 Playoff Targets & Category Caps (`Admin_Config`)

Every player knows the goal! The points required to qualify for playoffs and the maximum points a team can earn per category live in the **`Admin_Config`** tab (Columns D & E).

| Goal / Duty ⚽ | Target / Cap | How Teams Score Points |
| :--- | :---: | :--- |
| **Playoff Qualification** | **17 Total Pts** | The magic number teams need to qualify for post-season and tournament play. |
| **Referee Assignments** | **10 Pts Max** | Saturday on-field referee assignments. Every covered game keeps our kids playing safely! |
| **Friday Night Setup** | **5 Pts Max** | Field lining, putting up nets, and setting corner flags (1 point per hour). |
| **Field Marshal Shifts** | **2 Pts Max** | Keeping our sidelines positive, safe, and family-friendly. |
| **Picture Day & Picnic** | **2 Pts Max** | Helping our young athletes look sharp on photo day. |
| **Certified Team Referees** | **5 Pts Bonus** | Administrative bonus credited to teams with fully certified, rostered referees. |
| **MatchTrak Compliance** | **2 Pts Bonus** | Reward for coaches who have their MatchTrak schedule populated by September 26. |

> 💡 **Board Tip:** Need to adjust a cap mid-season? Change the number in Column E of `Admin_Config` and the public dashboard updates instantly. **Keep the checkbox in cell E8 (`StandingsFrozen`) unchecked** until the regular season concludes and playoff seeds are finalized!

---

## 🦺 Friday Night Setup & Saturday Check-Ins

* 🌙 **Friday Night Field Prep:** Volunteers scan the field QR code, choose **Friday Night Field Setup**, and log their team. The system awards **1 point per hour** up to the 5-point season ceiling.
* 🚩 **Assistant Referees (Dual AR):** Both volunteer line refs get full credit! When two assistant referees work the same match, each team gets **+1 point** with no collision flags.
* ⏱️ **NOCRA Paid Referees:** Paid center referees earn zero team volunteer points and are awarded a neutral **`NOCRA - No Points`** badge in the log.
* 📝 **Live Form Entries:** Incoming check-ins show up with a soft blue **`Recorded` (+1 pt)** badge so coaches know their effort has been captured.

---

## 🏅 Awarding Special Team Points (`Team_Awards`)

Not all great volunteer work happens via Saturday QR codes! When teams earn administrative bonuses, enter them in the **`Team_Awards`** tab:

| Column | Header | What to Enter |
| :---: | :--- | :--- |
| **B** | `preSeasonRefs` | Certified referee bonus points (up to 5). |
| **C** | `matchTrakBonus` | Enter `2` for teams fully compliant on MatchTrak by Sep 26. |
| **D** | `pictureDay` | Picture day volunteer shift credits (up to 2). |
| **E** | `adjustment` | Manual point awards (e.g. `+1` for special field prep) or deductions (`-1` for missed duties). |
| **F** | `reason` | A warm note explaining the credit (e.g., "Helped repair goal nets at Lexington"). |
| **G** | `grantedBy` | Your name or board role (e.g., "Troy B.", "Nikki M."). |

---

## 👟 Welcoming Late Teams & Coaches (`Admin_Config`)

If a new team forms after opening weekend:
1. Open the **`Admin_Config`** tab.
2. Scroll to the first blank row under **Columns G & H (`SUPPLEMENTAL ROSTER`)**.
3. Enter the **Division** (e.g., `10U - Boys`) and **Coach Name**.
4. The system automatically creates the team code and adds them to the coach dropdown on the website!

---

## 🚩 Resolving Sideline Collisions (Anomaly Checks)

Occasionally two parents tap Center Referee for the same field and time:
1. Check the official match card in MatchTrak to verify who centered and who ran the line.
2. Open `Form Responses 1`.
3. Update the line referee's row to "AR" so both parents receive their rightful credit!

---

## 📋 Weekly Board Playbook Checklist

* ☕ **Monday Morning (Referee Admin or delegate):**  
  Review the Saturday game cards against `Form Responses 1`. Resolve any duplicate taps or center ref collisions so all teams start the week with clean points.
* 📱 **Tuesday Evening (Coach Admin or delegate):**  
  Take a quick look at the live coach dashboard to ensure team point progress is tallying smoothly and answer any coach questions.
* 🥅 **Friday Afternoon (Field Director / Webmaster):**  
  Verify the field setup equipment is ready for Friday evening volunteers.
* 🏁 **End of Season (Regional Commissioner):**  
  Head to `Admin_Config`, check the **`StandingsFrozen`** box (cell E8), and lock in the final playoff standings!
