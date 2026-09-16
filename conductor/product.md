# Product Definition: AYSO Region 154 Volunteer Dashboard

## Vision & Overview
The AYSO Region 154 Volunteer Dashboard is a high-performance, mobile-first web scoreboard and administrative audit engine designed for AYSO Cypress Region 154. It empowers coaches, parents, and board administrators with real-time tracking of team volunteer point accumulations toward the 17-point playoff qualification threshold.

By connecting game-day Google Form QR check-ins and Google Sheets ledgers, the system automates point audits, prevents duplicate and conflicting referee claims, enforces category caps, and safeguards volunteer PII on the public interface.

## Target Audience & Core Personas
1. **Coaches & Team Parents:** Check weekly standings on mobile devices to verify credits across referee, field setup, marshal, and picture day shifts.
2. **Volunteers (Referees, Field Marshals, Setup Crews):** Scan on-field QR codes to quickly submit game-day duty check-ins.
3. **Referee Administrator & Auditors:** Cross-reference Saturday game cards, resolve center referee conflicts, and ensure proper point attribution without cumbersome manual spreadsheet manipulation.
4. **Regional Commissioner & Board Executive:** Monitor division-wide volunteer engagement, verify playoff readiness, and freeze standings at season's close.

## Core Features & Business Rules
- **17 Points to Playoffs:** Teams must accumulate 17 total points with divisional caps:
  - Referee Assignments: Max 10 points (Dual ARs 1 pt each, NOCRA paid refs 0 pts).
  - Friday Night Setup / Sunday Takedown: Max 5 points (1 pt/hr).
  - Field Marshal Shifts: Max 2 points.
  - Picture Day & Picnic: Max 2 points.
  - Certified Referee Bonus: Max 5 points (via Team_Awards).
  - MatchTrak Compliance: Max 2 points incentive.
- **Privacy First:** Volunteer phone numbers and email addresses are filtered out before reaching the client-side public scoreboard.
- **Instant Synchronization & Offline Resilience:** Fast client-side caching with manual sync capabilities for immediate updates on Saturday match days.
- **Board Control Panel:** One-click management launchpad with links to sheets, forms, administrative tools, and operational checklists.
- **Google Apps Script Backend:** Automated scripts handling data ingestion, audit formulas, configuration management, and contract testing.

## Success Metrics
- 100% accurate point calculation aligned with AYSO Region 154 board guidelines.
- Sub-second dashboard load times on mobile cellular networks at the pitch.
- Zero PII leaks on public standings pages.
- Significant reduction of weekly board audit overhead.
