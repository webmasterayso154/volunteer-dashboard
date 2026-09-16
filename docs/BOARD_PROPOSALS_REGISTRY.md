# AYSO Region 154 - Executive Board Proposals Registry (RFC)

This registry documents proposed system enhancements, field additions, and policy modifications identified during the Fall 2026 Game Day audit. All items require formal board review and vote prior to implementation in production forms or backend scoring engines.

---

## Proposal Summary Table

| RFC ID | Item Name | Category | Priority | Board Action Required | Target Implementation |
| :---: | :--- | :--- | :---: | :--- | :---: |
| **RFC-001** | Add Arnold Park to Setup / Takedown List | Form Schema | High | Approve addition of Arnold Park location | Week 3 Games |
| **RFC-002** | Playground Setup & Takedown Credit Eligibility | Policy / Cap | High | Vote on awarding 1 pt setup credit to Playground teams | Immediate |
| **RFC-003** | Coach Name Normalization: Brennen Portalski | Data Cleanliness | Low | Approve standardize spelling in Master Roster | End of Season |
| **RFC-004** | Dual-Slot Same-Day AR Policy Clarification | Policy Rule | Medium | Reaffirm policy on volunteers claiming 2+ AR slots/day | Next Board Meeting |
| **RFC-005** | NOCRA Auto-Notification Workflow | Operations | Low | Approve automated email notice for non-credited refs | Spring 2027 |
| **RFC-006** | End-of-Season Playoff Tiebreaker Protocol | Standings Policy | Medium | Formalize point tiebreakers (Setup vs. Ref balance) | Fall Playoffs |
| **RFC-007** | Unified Schedule Dropdown Sync Sandbox | Form UX & Automation | Medium | Review sandbox testing results for schedule dropdown | Spring 2027 / Post-Season |

---

## Detailed Proposals

### RFC-001: Add Arnold Park Location to Check-In Schema
* **Current State:** The live Google Form only lists Lexington Junior High School (Fields #1–#9). Arnold Park is utilized for overflow and younger divisions but lacks a dedicated check-in option.
* **Proposed Change:** Add "Arnold Park" as an explicit dropdown value in the Field selection questions (Columns I, K, and N).
* **Impact:** Eliminates manual text overrides and ensures proper regional field audit tracking.

### RFC-002: Playground Division Setup Point Eligibility
* **Current State:** Playground division targets are 4 points, but early season guidelines were ambiguous regarding whether Playground parents could fulfill requirements via Friday Night Setup.
* **Proposed Change:** Allow Playground teams to earn up to 2 of their 4 required points via Friday Setup / Takedown shifts.
* **Impact:** Increases volunteer engagement among early-age division families without saturating field marshal slots.

### RFC-003: Brennen Portalski Name Harmonization
* **Current State:** Minor typographic variances exist across legacy spreadsheet rosters ("Brennan" vs. "Brennen").
* **Proposed Change:** Standardize all references to "Brennen Portalski" across `Season_Master_Ledger` and SportsConnect rosters.
* **Impact:** Zero points impact; prevents future lookup misses during automated script syncs.

### RFC-007: Unified Schedule Dropdown Sync (Sandbox Proposal)
* **Current State:** Referees and volunteers currently type free-text times (e.g. "8", "8:00 AM", "8am") and select fields manually, requiring normalization and manual audit cross-referencing on Saturday afternoons.
* **Proposed Change:** In an isolated sandbox environment (`apps-script/Sandbox_ScheduleDropdownSync.js`), test dynamically syncing weekly MatchTrak schedules from a `Master_Schedule` tab into a single unified dropdown question: `[Field] Time — Division (Home vs Away)`.
* **Impact:** Eliminates typos, prevents conflicting time slot entries, and accelerates Saturday game card reconciliation.
* **Status:** Sandbox Prototype & Offline Tests Complete (`test/test_schedule_sync.js`). Production deployment blocked pending formal board vote and sign-off.