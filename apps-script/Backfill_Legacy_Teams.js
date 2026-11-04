/**
 * ============================================================================
 * AYSO REGION 154 - WEEKS 1–4 TEAM AFFILIATION MIGRATION ENGINE
 * ============================================================================
 * File: Backfill_Legacy_Teams.gs
 * Description: Scans Form Responses 1 to extract early-season team affiliations
 *              and writes them into Column AB (Legacy_Backfill_Team) of
 *              Form Responses 3 so historical check-ins are not orphaned.
 * ============================================================================
 */

function backfillLegacyTeamsToFR3() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fr1 = ss.getSheetByName('Form Responses 1') || ss.getSheetByName('ARCHIVE_Form_Responses_1_PreOct10');
  const fr3 = ss.getSheetByName('Form Responses 3') || ss.getSheetByName('Game Day Check-ins');

  if (!fr1 || !fr3) {
    throw new Error("Could not find both Form Responses 1 and Form Responses 3 tabs.");
  }

  const fr1Data = fr1.getDataRange().getValues();
  const fr3Data = fr3.getDataRange().getValues();

  const teamLookupByExact = new Map();
  const teamLookupByNameRole = new Map();

  for (let i = 1; i < fr1Data.length; i++) {
    const r = fr1Data[i];
    if (!r[0]) continue;

    const ts = (r[0] instanceof Date) ? Math.floor(r[0].getTime() / 1000) : String(r[0]).trim();
    const fName = String(r[2] || '').trim().toLowerCase();
    const lName = String(r[3] || '').trim().toLowerCase();
    const role = String(r[4] || '').trim().toLowerCase();

    // Check Credited Team (Col AT [45]), Branched Cols [23-31], Legacy Cols G[6], J[9], M[12]
    const candidateCols = [45, 23, 24, 25, 26, 27, 28, 29, 30, 31, 6, 9, 12];
    let foundTeam = '';
    for (const cIdx of candidateCols) {
      const val = String(r[cIdx] || '').trim();
      if (val && !/select|confirm|recorded|duplicate|unrecognized/i.test(val)) {
        foundTeam = val;
        break;
      }
    }

    if (foundTeam) {
      teamLookupByExact.set(`${ts}|${fName}|${lName}`, foundTeam);
      teamLookupByNameRole.set(`${fName}|${lName}|${role}`, foundTeam);
    }
  }

  const BACKFILL_COL = 28; // Column AB
  fr3.getRange(1, BACKFILL_COL).setValue('Legacy_Backfill_Team');

  const backfillOutput = [];
  let backfilledCount = 0;

  for (let j = 1; j < fr3Data.length; j++) {
    const row = fr3Data[j];
    const ts = (row[0] instanceof Date) ? Math.floor(row[0].getTime() / 1000) : String(row[0]).trim();
    const fName = String(row[1] || '').trim().toLowerCase();
    const lName = String(row[2] || '').trim().toLowerCase();
    const role = String(row[3] || '').trim().toLowerCase();

    // Check if FR3 already contains an active branched team dropdown selection (Cols N-V / indices 13-21)
    const existingBranched = [13, 14, 15, 16, 17, 18, 19, 20, 21]
      .map(idx => String(row[idx] || '').trim())
      .find(v => v.length > 0) || '';

    let backfillVal = '';
    if (!existingBranched) {
      backfillVal = teamLookupByExact.get(`${ts}|${fName}|${lName}`) || 
                    teamLookupByNameRole.get(`${fName}|${lName}|${role}`) || '';
      if (backfillVal) backfilledCount++;
    }

    backfillOutput.push([backfillVal]);
  }

  if (backfillOutput.length > 0) {
    fr3.getRange(2, BACKFILL_COL, backfillOutput.length, 1).setValues(backfillOutput);
  }

  Logger.log(`✅ Backfill Complete! Restored ${backfilledCount} early-season team affiliations into Form Responses 3 (Column AB).`);
}