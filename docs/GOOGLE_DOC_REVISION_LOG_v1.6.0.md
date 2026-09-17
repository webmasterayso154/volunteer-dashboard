# AYSO Region 154 — Schedule Ingestion & Form Sync Engine (v1.6.0-RFC007) Revision Log

**Deployment Date:** September 16, 2026  
**System Target:** Production Google Sheet & Volunteer Check-In Form  
**Version:** `v1.6.0-RFC007`  
**Status:** Live in Production (Verified 100%)  

---

## 1. Overview

On September 16, 2026, the AYSO Region 154 production system was updated to deploy the **v1.6.0-RFC007 Schedule Ingestion and Multi-Venue Form Synchronization Engine**. 

This update transitions our weekend volunteer check-in workflow from legacy manual text entries to an automated, schedule-driven dropdown model across all regular-season venues. The engine automates the weekly processing of MatchTrak CSV schedule exports, generates automated backup snapshots, and populates live dropdown choices on the production Google Form.

---

## 2. Core Updates & Technical Safeguards

### 1. 3-Venue Strict Field Routing
Match fixtures from MatchTrak are parsed, normalized, and partitioned into 3 distinct venue selection questions on the volunteer check-in form:
* **🌲 Park Lexington (Denni & Cerritos):** Captures Park Lex Grass and Park Lex Artificial Turf fixtures.
* **🏫 Luther Elementary:** Dedicated routing for Luther Elementary School fields (e.g., U8 Field 1, U10 Field 1, ES Field 2), cleanly formatted to `Luther Field <N>`.
* **🏫 Lexington Junior High (LJHS) or Arnold Elementary:** Captures LJHS Fields 1–10 and Arnold Elementary overflow fields.
* *Every venue list also includes a standardized escape option:* `⚠️ Other / Rescheduled / Unlisted Match`.

### 2. Zero-Game Fallback Safeguard
When no games are scheduled at Luther Elementary on a given weekend (e.g., during tournaments or off-weeks), the sync engine automatically detects the empty list and displays:
> `⚠️ No games currently scheduled at Luther Elementary`

*Benefit:* Prevents Google Forms runtime exceptions (which occur when attempting to set an empty choices array) and eliminates volunteer ambiguity at check-in.

### 3. JavaScript Set-Based Deduplication
MatchTrak exports frequently list multiple lines for a single fixture (e.g., separate entries for Center Referee and Assistant Referee assignments). All choice arrays are passed through JavaScript Sets (`[...new Set(...)]`) before the form is updated.
*Benefit:* Permanently eliminates the Google Forms `"Questions cannot have duplicate choice values"` error.

### 4. Pacific Timezone (`America/Los_Angeles`) Locking
All date and time calculations are explicitly locked to `America/Los_Angeles` via `Utilities.formatDate`.
*Benefit:* Prevents UTC time-shift errors when running on Google Cloud backend servers.

---

## 3. Operational & Administration Workflow

### Automated Weekly Ingestion
1. **Drop File:** Board members drop the weekly MatchTrak export CSV into Google Drive: `01_DROP MATCHTRAK`.
2. **Automated Trigger:** The backend Apps Script time-driven trigger runs hourly:
   * Validates required headers (`Date`, `Time`, `Field`, `Division`, `Home Team`, `Away Team`).
   * Creates an automated timestamped backup sheet (`Master_Schedule_Backup_YYYYMMDD_HHMMSS`).
   * Overwrites the `Master Schedule` tab with fresh match rows.
   * Synchronizes all 3 venue dropdown questions on the live check-in form.
   * Records a sync audit row in `Schedule_Sync_Log`.
   * Archives the processed CSV to `02_PROCESSED_ARCHIVE`.

### On-Demand Synchronization
To manually force an immediate form sync:
1. Open the **Production Google Sheet** > **Extensions** > **Apps Script**.
2. Select **`syncContainerFormSchedule`** from the function menu and click **Run**.

---

## 4. Verification & Quality Assurance

* **Backwards Compatibility:** 100% compliant with existing Google Sheet column schemas, formulas, point caps, and playoff rules.
* **Automated Test Suite:** 6/6 test suites passed with 100% success (covering 3-venue routing, zero-game fallbacks, deduplication, time formatting, standings rollup, and client transport).
