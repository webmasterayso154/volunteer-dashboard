# AYSO Region 154 — Board Revision & Operations Guide (v1.6.0-RFC007)

**Target Release:** `v1.6.0-RFC007`  
**Target Date:** Fall 2026 Season Operations  
**Audience:** Executive Board, Regional Commissioner, Referee Administrator, Field Operations  

---

## 1. Executive Summary

Version `v1.6.0-RFC007` introduces a fully hardened, automated **Weekly Schedule Ingestion & Multi-Venue Form Synchronization Engine** for AYSO Region 154.

Previously, weekend volunteer check-ins required referees, field marshals, and volunteers to manually type game times and select fields from disparate text questions. This led to typographical inconsistencies (e.g., `"8"`, `"8:00 AM"`, `"8am"`), conflicting time-slot entries, and required extensive manual audit cross-referencing by the board.

With `v1.6.0-RFC007`, MatchTrak schedule exports placed in Google Drive are automatically processed, backed up, and converted into clean, standardized dropdown options across the **3 official game venues**. This update prevents submission typos, accelerates Saturday score card reconciliation, and establishes strict automated safeguards against Google Forms runtime errors.

---

## 2. Key Architecture & Operational Safeguards

```
                      ┌─────────────────────────────────────────┐
                      │ MatchTrak CSV Drop (Google Drive Folder)│
                      └────────────────────┬────────────────────┘
                                           │
                                           ▼
                      ┌─────────────────────────────────────────┐
                      │   ScheduleSyncEngine (Apps Script)      │
                      │  • Pacific Timezone Locking             │
                      │  • Header & Row Validation              │
                      │  • Automated Backup Sheet Generation    │
                      └────────────────────┬────────────────────┘
                                           │
           ┌───────────────────────────────┼───────────────────────────────┐
           │                               │                               │
           ▼                               ▼                               ▼
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  🌲 Park Lexington   │       │ 🏫 Luther Elementary │       │   🏫 LJHS & Arnold   │
│  (Denni & Cerritos)  │       │ (U8/U10 Fields)      │       │ (Fields #1 - #10)    │
│  • Turf & Grass      │       │ • Zero-Game Fallback │       │ • Junior High/Arnold │
└──────────┬───────────┘       └──────────┬───────────┘       └──────────┬───────────┘
           │                               │                               │
           └───────────────────────────────┼───────────────────────────────┘
                                           │
                                           ▼
                      ┌─────────────────────────────────────────┐
                      │ JavaScript Set Deduplication Pass       │
                      │      [...new Set(venueMatches)]         │
                      └────────────────────┬────────────────────┘
                                           │
                                           ▼
                      ┌─────────────────────────────────────────┐
                      │  Live Production Form Dropdown Sync     │
                      │  (ID: 1gIenxzkQeBGcbJZrt_ujp9WTfXg...)  │
                      └─────────────────────────────────────────┘
```

### A. 3-Venue Strict Field Routing
Match fixtures are parsed and routed into 3 dedicated Google Form dropdown questions:
1. **🌲 Park Lexington (Denni & Cerritos):** Captures Park Lex Grass and Park Lex Artificial Turf fixtures.
2. **🏫 Luther Elementary:** Dedicated routing for Luther Elementary School fields (e.g. U8 Field 1, U10 Field 1, ES Field 2), normalized to `Luther Field <N>`.
3. **🏫 Lexington Junior High (LJHS) or Arnold Elementary:** Captures LJHS Fields 1–10 and Arnold Elementary overflow fields.

*Every venue dropdown list includes the standardized escape hatch:*  
`⚠️ Other / Rescheduled / Unlisted Match`

### B. Zero-Game Warning Fallback Safeguard
During regular season weekends where no matches are scheduled at Luther Elementary (e.g., when U8/U10 games are held at LJHS or Arnold), the engine automatically detects zero match rows and populates:
```
⚠️ No games currently scheduled at Luther Elementary
```
**Why this matters:** Google Forms throws a critical exception if `setChoiceValues()` is called with an empty array. This fallback guarantees that form synchronization always succeeds while clearly informing volunteers that no games are scheduled at Luther for the weekend.

### C. JavaScript Set-Based Deduplication
MatchTrak exports frequently contain multiple rows for the same fixture (e.g., Center Referee + Dual Assistant Referee slot listings). Before updating Google Form items, all choice lists are passed through JavaScript Sets:
```javascript
target.setChoiceValues([...new Set(venueMatches)]);
```
**Why this matters:** Google Forms rejects option arrays containing duplicate values (`"Questions cannot have duplicate choice values"`). Set deduplication guarantees 100% exception-free execution.

### D. Pacific Timezone (`America/Los_Angeles`) Locking
All date and time calculations are explicitly locked to Pacific Time (`America/Los_Angeles`) using `Utilities.formatDate`.  
**Why this matters:** Prevents cloud server UTC day-shift errors (e.g., Saturday 5:00 PM Pacific shifting to Sunday morning in UTC).

---

## 3. Operational Workflow for Weekly Schedule Updates

```
Step 1: Export MatchTrak Schedule (.csv)
   │
   ▼
Step 2: Drop into Google Drive: '01_DROP MATCHTRAK'
   │
   ▼
Step 3: Hourly Trigger executes 'autoIngestWeeklySchedule()'
   ├── 1. Validates CSV Headers (Date, Time, Field, Division, Home, Away)
   ├── 2. Creates Timestamped Backup Sheet: 'Master_Schedule_Backup_YYYYMMDD_HHMMSS'
   ├── 3. Overwrites active 'Master Schedule' tab with fresh match rows
   ├── 4. Updates all 3 venue dropdown questions on the Live Production Form
   ├── 5. Records sync audit row in 'Schedule_Sync_Log'
   └── 6. Moves CSV to '02_PROCESSED_ARCHIVE' folder
```

### Manual / On-Demand Sync
If schedule updates need to be pushed immediately without waiting for the time-driven trigger:
1. Open the [Live Production Google Sheet](https://docs.google.com/spreadsheets/d/1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g/edit).
2. Go to **Extensions** > **Apps Script**.
3. Select **`syncContainerFormSchedule`** from the function menu and click **Run**.

---

## 4. Production Configuration Constants

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **Release Version** | `v1.6.0-RFC007` | Official release tag |
| **Timezone** | `America/Los_Angeles` | Enforced Pacific Timezone |
| **Production Sheet ID** | `1vsnueCf-5ZWTOcUXDVqcdcHp59VFjPZ6ra1-Y2TsN8g` | Standings & Master Schedule Workbook |
| **Production Form ID** | `1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI` | Live Volunteer Check-In Form |
| **Drop Folder ID** | `16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv` | `01_DROP MATCHTRAK` Drive folder |
| **Archive Folder ID** | `1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m` | `02_PROCESSED_ARCHIVE` Drive folder |

---

## 5. Automated Verification Test Suite

All 6 automated test suites run against the production codebase and pass with **100% success**:

| Test Suite | Purpose | Result |
| :--- | :--- | :---: |
| `test/verify_schedule_engine.js` | Validates 3-venue routing, Luther zero-game fallback, and Set deduplication | **100% PASS** |
| `test/test_schedule_sync.js` | Validates MatchTrak CSV parsing, division normalization, and timezone safety | **100% PASS** |
| `test/verify_all_contracts.js` | Validates standings calculations, volunteer caps, dual ARs, and NOCRA filters | **100% PASS** |
| `test/run_full_e2e_verification.js` | Synthetic multi-division playoff qualification audit rollup | **100% PASS** |
| `test/verify_audit_engine.js` | Board audit trail and point verification engine | **100% PASS** |
| `test/verify_client_transport_and_rollup.js` | Client-side dual-transport (JSON/JSONP) and LocalStorage state hydration | **100% PASS** |

---

## 6. Board Compliance & Guardrails Confirmation

1. **Backwards Compatibility:** No existing Google Sheet column headers, formulas, or playoff qualification rules have been altered.
2. **Modular Architecture:** Standings calculations remain isolated in [`apps-script/Code.gs`](../apps-script/Code.gs), while schedule automation is encapsulated in [`apps-script/ScheduleSyncEngine.gs`](../apps-script/ScheduleSyncEngine.gs).
3. **Audit Trail:** Every schedule sync event records an immutable row in the `Schedule_Sync_Log` sheet tracking source file, timestamp, total games parsed, and per-venue counts.
