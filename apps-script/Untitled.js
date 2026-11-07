/**
 * ============================================================================
 * AYSO REGION 154 - EMERGENCY WEDNESDAY MAKE-UP GAME INJECTOR
 * ============================================================================
 * Purpose: Immediately prepends tonight's 6 rescheduled games (Nov 4) to the
 *          LJHS dropdown in the live Google Form and logs them in Master_Schedule.
 * ============================================================================
 */

function forceInjectWednesdayGamesNow() {
  const FORM_ID = '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI';
  
  // 1. Tonight's exact matches (rescheduled from 10/23/2026)
  const wednesdayMatches = [
    '🗓️ Wed • ⏰ 5:45 PM • 📍 LJHS Field 7 • ⚽ 10U-B: Orozco_S vs Huang_H',
    '🗓️ Wed • ⏰ 5:45 PM • 📍 LJHS Field 8 • ⚽ 10U-G: Olmos_A vs Portalski_B',
    '🗓️ Wed • ⏰ 5:45 PM • 📍 LJHS Field 9 • ⚽ 12U-B: Vargas_H vs Hicks_I',
    '🗓️ Wed • ⏰ 7:00 PM • 📍 LJHS Field 7 • ⚽ 10U-B: Brieger_D vs Zidan_T',
    '🗓️ Wed • ⏰ 7:00 PM • 📍 LJHS Field 8 • ⚽ 10U-G: Otor_T vs Corado_D',
    '🗓️ Wed • ⏰ 7:00 PM • 📍 LJHS Field 9 • ⚽ 12U-G: Huerta_F vs Cruz_C'
  ];

  // 2. Open live Google Form and locate the Lexington/Arnold dropdown
  const form = FormApp.openById(FORM_ID);
  const items = form.getItems(FormApp.ItemType.LIST);
  let updatedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const listItem = items[i].asListItem();
    const title = listItem.getTitle();

    if (title.indexOf('Lexington Junior High') !== -1 || title.indexOf('LJHS') !== -1 || title.indexOf('Arnold') !== -1) {
      const existingChoices = listItem.getChoices().map(c => c.getValue());
      
      // Filter out any choices that might already be Wednesday to prevent duplicates
      const cleanedExisting = existingChoices.filter(choice => choice.indexOf('🗓️ Wed') === -1);
      
      // Combine: Wednesday games first, followed by Friday/Saturday/Sunday
      const newChoices = wednesdayMatches.concat(cleanedExisting);
      
      listItem.setChoiceValues(newChoices);
      listItem.setTitle('Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary (Nov 4-8)');
      updatedCount++;
      Logger.log(`Successfully updated: ${title}`);
    }
  }

  // 3. Upsert tonight's games into Master_Schedule so backend lookups and check-ins resolve cleanly
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let masterSheet = ss.getSheetByName('Master_Schedule');
  if (!masterSheet) {
    masterSheet = ss.insertSheet('Master_Schedule');
  }

  const rawRows = [
    ['S11E154-26-Fall', '2026-11-04', '5:45:00 PM', '22841', 'BU10', '2', 'A', 'General', 'E154-Lexington JHS U10 Field 7 Fall 2026', 'E154-Orozco_S', 'E154-Orozco_S', '0', 'E154-Huang_H', 'E154-Huang_H', '0', 'N', 'N', '', '', '', '', '', '', '', 'Trinidad Everett', 'R154', 'Regional', 'Yes', 'E154-Orozco_S (BU10)', 'Kong David', 'R154', 'Regional', '', 'E154-Huang_H (BU10)', 'NOCRA', '', '', '', '', '', ''],
    ['S11E154-26-Fall', '2026-11-04', '5:45:00 PM', '22883', 'GU10', '1', 'A', 'General', 'E154-Lexington JHS U10 Field 8 Fall 2026', 'E154-Olmos_A', 'E154-Olmos_A', '0', 'E154-Portalski_B', 'E154-Portalski_B', '0', 'N', 'N', '', '', '', '', '', '', '', '', '', '', '', '', 'Meni Roux', 'R154', 'Regional', 'Yes', 'E154-Huerta_F (GU12)', 'NOCRA', '', '', '', '', '', ''],
    ['S11E154-26-Fall', '2026-11-04', '5:45:00 PM', '23026', 'BU12', '1', 'A', 'General', 'E154-Lexington JHS U12 Field 9 Fall 2026', 'E154-Vargas_H', 'E154-Vargas_H', '0', 'E154-Hicks_I', 'E154-Hicks_I', '0', 'N', 'N', '', '', '', '', '', '', '', 'Hicks Westley', 'R154', 'Regional', 'Yes', 'E154-Hicks_I (BU12)', '', '', '', '', '', 'NOCRA', '', '', '', '', '', ''],
    ['S11E154-26-Fall', '2026-11-04', '7:00:00 PM', '22808', 'BU10', '1', 'A', 'General', 'E154-Lexington JHS U10 Field 7 Fall 2026', 'E154-Brieger_D', 'E154-Brieger_D', '0', 'E154-Zidan_T', 'E154-Zidan_T', '0', 'N', 'N', '', '', '', '', '', '', '', 'Brieger Kammi', 'R154', 'Regional', 'Yes', 'E154-Brieger_D (BU10)', '', '', '', '', '', 'NOCRA', '', '', '', '', '', ''],
    ['S11E154-26-Fall', '2026-11-04', '7:00:00 PM', '22884', 'GU10', '1', 'A', 'General', 'E154-Lexington JHS U10 Field 8 Fall 2026', 'E154-Otor_T', 'E154-Otor_T', '0', 'E154-Corado_D', 'E154-Corado_D', '0', 'N', 'N', '', '', '', '', '', '', '', 'Chong JohnPaul', 'R154', 'Regional', '', 'E154-Otor_T (GU10)', '', '', '', '', '', 'NOCRA', '', '', '', '', '', ''],
    ['S11E154-26-Fall', '2026-11-04', '7:00:00 PM', '23088', 'GU12', '1', 'A', 'General', 'E154-Lexington JHS U12 Field 9 Fall 2026', 'E154-Huerta_F', 'E154-Huerta_F', '0', 'E154-Cruz_C', 'E154-Cruz_C', '0', 'N', 'N', '', '', '', '', '', '', '', 'Vang Samouang', 'R154', 'Regional', '', 'E154-Cruz_C (GU12)', '', '', '', '', '', 'NOCRA', '', '', '', '', '', '']
  ];

  const lastRow = masterSheet.getLastRow();
  if (lastRow > 0) {
    const existingGameIds = masterSheet.getRange(1, 4, lastRow, 1).getValues().flat().map(String);
    const rowsToAppend = rawRows.filter(row => existingGameIds.indexOf(row[3]) === -1);
    if (rowsToAppend.length > 0) {
      masterSheet.getRange(lastRow + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }
  }

  // 4. Alert completion
  try {
    SpreadsheetApp.getUi().alert('Success', `Injected ${wednesdayMatches.length} games for tonight into the Google Form!`, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log('Injected tonight\'s games successfully.');
  }
}