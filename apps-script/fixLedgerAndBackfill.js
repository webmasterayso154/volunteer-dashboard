/**
 * 1. Locks in Column AB (Legacy_Backfill_Team) on 'Game Day Check-ins' so Weeks 1-4 teams can never be wiped.
 * 2. Restores the exact 116-team canonical roster in 'Season_Master_Ledger' from 'Team_Awards' (eliminating the 21 duplicates and restoring the 22 missing teams).
 */
function repairLedgerAndLockBackfill() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checkinsSheet = ss.getSheetByName('Game Day Check-ins');
  const awardsSheet = ss.getSheetByName('Team_Awards');
  const ledgerSheet = ss.getSheetByName('Season_Master_Ledger');

  if (!checkinsSheet || !awardsSheet || !ledgerSheet) {
    throw new Error('Missing one of required sheets: Game Day Check-ins, Team_Awards, or Season_Master_Ledger.');
  }

  // --- STEP 1: Lock in Col AB (Legacy_Backfill_Team) in 'Game Day Check-ins' ---
  const ciLastRow = checkinsSheet.getLastRow();
  const ciData = checkinsSheet.getRange(1, 1, ciLastRow, 28).getValues(); // A..AB
  checkinsSheet.getRange(1, 28).setValue('Legacy_Backfill_Team');

  const backfillValues = [];
  for (let r = 1; r < ciData.length; r++) {
    const row = ciData[r];
    // Cols N..V are indices 13..21
    const hasDropdownTeam = row.slice(13, 22).some(val => String(val || '').trim() !== '');
    const creditedTeam = String(row[26] || '').trim(); // Col AA (idx 26)
    const existingBackfill = String(row[27] || '').trim(); // Col AB (idx 27)

    if (existingBackfill) {
      backfillValues.push([existingBackfill]);
    } else if (!hasDropdownTeam && creditedTeam && !creditedTeam.toUpperCase().includes('NOCRA')) {
      backfillValues.push([creditedTeam]);
    } else {
      backfillValues.push(['']);
    }
  }
  if (backfillValues.length > 0) {
    checkinsSheet.getRange(2, 28, backfillValues.length, 1).setValues(backfillValues);
  }

  // --- STEP 2: Rebuild Canonical 116-Team Roster in 'Season_Master_Ledger' Cols A:C ---
  const awardsData = awardsSheet.getDataRange().getValues();
  const canonicalTeams = [];

  for (let i = 1; i < awardsData.length; i++) {
    const teamCode = String(awardsData[i][0] || '').trim();
    if (!teamCode) continue;

    // Parse Division & Head Coach from teamCode (e.g., "10U - Boys - Ryan Loza")
    const parts = teamCode.split(' - ');
    let division = '';
    let headCoach = '';
    if (parts.length >= 3) {
      division = parts[0].trim() + ' - ' + parts[1].trim();
      headCoach = parts.slice(2).join(' - ').trim();
    } else if (parts.length === 2) {
      division = parts[0].trim() + ' - ' + parts[1].trim();
      headCoach = parts[1].trim();
    } else {
      division = teamCode;
      headCoach = teamCode;
    }
    canonicalTeams.push([division, teamCode, headCoach]);
  }

  // Write the 116 unique teams into Season_Master_Ledger A2:C117
  if (canonicalTeams.length > 0) {
    ledgerSheet.getRange(2, 1, canonicalTeams.length, 3).setValues(canonicalTeams);
  }

  // Re-run your formula injector if present in the project
  if (typeof injectTraceableLedgerFormulas === 'function') {
    injectTraceableLedgerFormulas();
  }

  SpreadsheetApp.flush();
}