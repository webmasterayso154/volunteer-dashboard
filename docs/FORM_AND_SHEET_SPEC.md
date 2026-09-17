# AYSO 154 Check-In Form & Sheet Schema Spec

## Live Google Sheet Tabs
1. `Form Responses 1`: Destination tab for form submissions.
2. `Team_Awards`: Manual board adjustments, bonus points, uniform deductions.
3. `Settings`: Configuration key/value store (Caps, emails, thresholds).

## Form Responses 1 - Column Schema
- Col 1 (A): Timestamp
- Col 2 (B): Email Address
- Col 3 (C): First Name
- Col 4 (D): Last Name
- Col 5 (E): What is your volunteer role today? (Referee, Field Marshal, Field Set Up, Picture Day)
- Col 6 (F): Referee Position for this Game (Assistant Referee (AYSO), Referee (AYSO), Referee (NOCRA / USSF))
- Col 7 (G): Who is the Team you are affiliated with today? (Ref Team dropdown)
- Col 8 (H): Game Time (e.g., 8:00am, 10:00am)
- Col 9 (I): Field (Ref Field)
- Col 10 (J): Team You Are Earning Volunteer Points For (Field Marshal)
- Col 11 (K): Assigned Field/Area (Field Marshal)
- Col 12 (L): Shift Start Time (Field Marshal)
- Col 13 (M): Associated Team (Field Setup)
- Col 14 (N): Field (Field Setup)

## Official Region 154 Business Logic & Rules
- 17 total points required for playoff tournament qualification.
- Dual ARs: Upper/EXTRA division home games award 1 point per volunteer AR (up to 2 pts/game window).
- Paid NOCRA/USSF center referees: Zero points awarded (status: "NOCRA - No Points").
- Deduplication: Granular per volunteer + date + time + duty (prevents self-duplicates while permitting dual ARs and multi-game volunteers).
- Field Marshal shifts: Max 2 points/season; multiple shifts allowed on the same Saturday.
- Status hierarchy: Default form entries are "Recorded"; only board overrides/audited items are "Verified".
- Category Caps: Ref (10), Field Marshal (2), Setup (5), Picture Day (2), Certified Ref Bonus (5), MatchTrak Bonus (2).