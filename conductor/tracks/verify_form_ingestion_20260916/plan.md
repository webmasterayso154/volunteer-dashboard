# Implementation Plan: End-to-End Form Ingestion & Standings Verification

## Phase 1: Ingestion & Formula Contract Audit (Apps Script / Sheet Engine)
- [ ] Task: Audit and verify Apps Script test runner (`Test_Suite.gs`, `Contract_Tests.gs`) against master sheet schema
- [ ] Task: Verify mock ingestion test fixtures for 3 team dropdown columns, role parsing, and canonical team IDs
- [ ] Task: Validate point calculation logic and category caps (10-pt Ref, 5-pt Setup, 2-pt Marshal, 2-pt Picture, 5-pt Bonus, 17-pt Target)
- [ ] Task: Validate referee anomaly rules (Dual AR 1 pt each, NOCRA 0 pt exclusion, Center Ref conflict detection)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 2: Client Transport & Standings Rollup Verification (Frontend UI)
- [ ] Task: Validate `support.js` dual-transport parser with test CSV and GViz payloads
- [ ] Task: Verify client-side `localStorage` caching, cache expiry, and manual sync recovery
- [ ] Task: Verify public dashboard (`index.html`) table rendering, mobile responsiveness, search filters, and modal duty breakdowns
- [ ] Task: Verify board control panel (`control-panel.html`) and setup tracking page (`setup-takedown.html`)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 3: End-to-End Synthetic Validation & Verification Report
- [ ] Task: Execute full end-to-end audit run covering raw form submission -> calculation -> client rollup
- [ ] Task: Compile comprehensive verification findings report and summary
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
