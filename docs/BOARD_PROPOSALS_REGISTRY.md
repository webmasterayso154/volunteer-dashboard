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
| **RFC-007** | Unified 3-Venue Schedule Dropdown Sync Engine | Form UX & Automation | High | Implemented & Deployed (`v1.6.0-RFC007`) | Live Production |

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

### RFC-007: Unified 3-Venue Schedule Dropdown Sync Engine
* **Current State:** Referees and volunteers previously typed free-text times and fields, causing typographic variances and manual audit work on Saturday afternoons.
* **Implemented Change:** Hardened production schedule ingestion and form synchronization engine (`apps-script/ScheduleSyncEngine.gs`) that automatically ingests MatchTrak CSV drops, enforces 3-venue routing (Park Lexington, Luther Elementary with zero-game fallback, LJHS/Arnold), locks to Pacific Timezone (`America/Los_Angeles`), and applies JavaScript Set deduplication (`[...new Set(...)]`) to prevent form choice exceptions.
* **Impact:** Eliminates typos, prevents conflicting time slot entries, prevents Google Forms choice exceptions, and automates weekly dropdown updates.
* **Documentation & Operations:** See [REVISION_GUIDE_v1.6.0.md](REVISION_GUIDE_v1.6.0.md).
* **Status:** Implemented, verified (100% test pass), and deployed to live production (`v1.6.0-RFC007`).