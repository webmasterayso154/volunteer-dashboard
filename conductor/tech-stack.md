# Technology Stack: AYSO Region 154 Volunteer Dashboard

## Client / Frontend Architecture
- **Language & Standards:** HTML5, CSS3, JavaScript (ES6+ standard)
- **Styling Paradigm:** Vanilla CSS with custom property design tokens, responsive CSS Grid / Flexbox, dark/light sports-themed UI
- **State & Data Ingestion:**
  - `support.js`: Modular client-side data parsing, caching in `localStorage`, background synchronization, and dynamic DOM rendering
  - Dual-transport fallback mechanism for resilient live data retrieval from Google Sheets (GViz CSV / JSON endpoints)
- **Pages & Entrypoints:**
  - `index.html`: Public volunteer standings and team progress dashboard
  - `control-panel.html`: Executive board launchpad and operational console
  - `setup-takedown.html`: Dedicated field setup and takedown tracking interface

## Backend & Automation Services
- **Platform:** Google Apps Script (V8 runtime)
- **Script Components (`apps-script/`):**
  - `Code.gs`: Core web app routing, endpoint handling, and data transformation
  - `AYSO154_Playoff_Audit.gs`: Automated playoff points calculation and business rule enforcement
  - `AdminConfig.gs`: Configuration properties and regional setting management
  - `BoardApp.gs` & `BoardPortal.html`: Secure administrative portal and audit interface
  - `TeamAwards.gs`: Roster bonuses, certified referee awards, and administrative credits
  - `Contract_Tests.gs` & `Test_Suite.gs`: Integrated unit and contract test suites
- **Deployment Tooling:** Google Clasp (`.clasp.json`) for local development and synchronization with Google Cloud / Apps Script project

## Data Layer & Integrations
- **Primary Datastore:** Google Sheets (Master Response Ledger, `Admin_Config`, `Team_Awards`)
- **Ingestion / Check-In:** Google Forms (QR code-driven mobile volunteer check-in form)
- **Third-Party Schedule Ingestion:** MatchTrak schedule data processing via local PowerShell utility (`Process-MatchTrak.ps1`)

## Hosting & Delivery
- **Static Hosting:** GitHub Pages (`webmasterayso154.github.io/volunteer-dashboard`)
- **DNS / Custom Domain Support:** Subdomain routing capability (e.g., `points.ayso154cypress.org`)
