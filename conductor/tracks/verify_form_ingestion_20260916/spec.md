# Specification: End-to-End Form Ingestion & Standings Verification

## Overview
A comprehensive, non-destructive verification and test track to audit and validate that all game-day volunteer submissions from the existing locked Google Form ingest cleanly, execute board-mandated point calculation algorithms accurately with all caps enforced, and render seamlessly on the public dashboard and board control panel.

## Scope Constraint (CRITICAL)
- **Zero Schema Changes:** The Google Form structure, question items, logic branches, and category point caps are strictly locked and approved by the board. No changes to the form schema or business rules are permitted.

## Verification Requirements

### 1. Form Ingestion & Column Mapping
- Confirm that submissions across the 3 separate team dropdown questions map reliably to unified canonical team identifiers (`[Division] - [Gender] - [Coach Name]`).
- Validate that all game-day roles (Referee, Assistant Referee, Friday Night Setup, Sunday Takedown, Field Marshal, Picture Day) are properly parsed from raw sheet rows.

### 2. Point Calculation & Category Caps
- Verify mathematical correctness of point rollups:
  - **Referee Assignments:** Max 10 points per team.
  - **Friday Night Setup / Sunday Takedown:** Max 5 points per team (1 pt/hr).
  - **Field Marshal Shifts:** Max 2 points per team.
  - **Picture Day & Picnic:** Max 2 points per team.
  - **Certified Referee Bonus:** Max 5 points per team (from `Team_Awards`).
  - **MatchTrak Compliance Bonus:** Max 2 points per team.
  - **Playoff Threshold:** Correct evaluation of the 17-point qualification goal.

### 3. Referee Anomaly & Split Credit Rules
- Validate that Dual Assistant Referees (ARs) each earn 1 credit when submitted for the same match.
- Confirm NOCRA paid center referees are assigned 0 volunteer points.
- Verify collision detection and flagging for duplicate/conflicting Center Referee claims.

### 4. UI Rollup & Client-Side Transport
- Verify that `support.js` parses Google Sheets GViz CSV/JSON endpoints without runtime exceptions.
- Validate local cache fallback behavior (`localStorage`) when offline or experiencing slow networks.
- Confirm standings table sorting, search filtering, responsive mobile rendering, and modal details show exact match with underlying spreadsheet totals.

## Acceptance Criteria
- [ ] Apps Script test suites (`Test_Suite.gs`, `Contract_Tests.gs`) execute and pass 100% of assertion cases.
- [ ] Synthetic mock submissions covering all edge cases (at-cap, over-cap, multi-division, dual AR, NOCRA) produce exact expected standings tallies.
- [ ] Public dashboard (`index.html`) and board panel (`control-panel.html`) load clean data with zero console errors and accurate point breakdowns.
- [ ] Verification report documented with full test results.

## Out of Scope
- Modifying Google Form questions, choices, or destination sheet layout.
- Modifying point formulas, qualification thresholds, or board operational policies.
