/**
 * Simulates real user submissions directly into the official response sheet.
 * Use this to populate test data for board demos.
 */

function injectGameDayScenario() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'Form Responses 1' not found!");
    return;
  }

  const now = new Date();
  const rows = [
    // 1. Team 10U - Boys - Faheem Armanyous (Balanced active team)
    [now, "demo.john.smith@ayso154.org", "[DEMO] John", "Smith", "Referee", "Referee (AYSO)", "10U - Boys - Faheem Armanyous", "8:00am", "LJHS - Field #1", "", "", "", "", ""],
    [now, "demo.sarah.connor@ayso154.org", "[DEMO] Sarah", "Connor", "Referee", "Assistant Referee (AYSO)", "10U - Boys - Faheem Armanyous", "9:15am", "LJHS - Field #2", "", "", "", "", ""],
    [now, "demo.bob.taylor@ayso154.org", "[DEMO] Bob", "Taylor", "Field Marshal", "", "", "", "", "10U - Boys - Faheem Armanyous", "Lexington Junior High School (Denni & Orange)", "10:00am", "", ""],
    [now, "demo.maria.lopez@ayso154.org", "[DEMO] Maria", "Lopez", "Field Set Up", "", "", "", "", "", "", "", "10U - Boys - Faheem Armanyous", "LJHS - Field #1"],

    // 2. Team 12U - Girls - Saul Alvarez (Hit maximum caps on Referees)
    [now, "demo.kevin.vance@ayso154.org", "[DEMO] Kevin", "Vance", "Referee", "Referee (AYSO)", "12U - Girls - Saul Alvarez", "8:00am", "Arnold - Field #10", "", "", "", "", ""],
    [now, "demo.kevin.vance@ayso154.org", "[DEMO] Kevin", "Vance", "Referee", "Referee (AYSO)", "12U - Girls - Saul Alvarez", "9:30am", "Arnold - Field #10", "", "", "", "", ""],
    [now, "demo.kevin.vance@ayso154.org", "[DEMO] Kevin", "Vance", "Referee", "Referee (AYSO)", "12U - Girls - Saul Alvarez", "11:00am", "Arnold - Field #10", "", "", "", "", ""],
    [now, "demo.kevin.vance@ayso154.org", "[DEMO] Kevin", "Vance", "Referee", "Referee (AYSO)", "12U - Girls - Saul Alvarez", "1:30pm", "Arnold - Field #10", "", "", "", "", ""],
    [now, "demo.mark.hernandez@ayso154.org", "[DEMO] Mark", "Hernandez", "Field Marshal", "", "", "", "", "12U - Girls - Saul Alvarez", "Park Lexington (Denni & Cerritos)", "8:00am", "", ""],
    [now, "demo.mark.hernandez@ayso154.org", "[DEMO] Mark", "Hernandez", "Field Marshal", "", "", "", "", "12U - Girls - Saul Alvarez", "Park Lexington (Denni & Cerritos)", "10:30am", "", ""],

    // 3. Team 08U - Boys - Amanda Towers (Single setup volunteer)
    [now, "demo.chris.pratt@ayso154.org", "[DEMO] Chris", "Pratt", "Field Set Up", "", "", "", "", "", "", "", "08U - Boys - Amanda Towers", "LJHS - Field #4"]
  ];

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 14).setValues(rows);
  Logger.log(`Successfully injected ${rows.length} mock game day submissions.`);
}

/**
 * Instantly removes all test submissions injected by the mock generator.
 */
function purgeAllMockData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  const data = sheet.getDataRange().getValues();
  
  // Rows to delete identified by tag in First Name (Column C / Index 2)
  let deletedCount = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    const firstName = String(data[i][2] || '');
    if (firstName.includes('[DEMO]') || firstName.includes('[TEST_SUITE]')) {
      sheet.deleteRow(i + 1);
      deletedCount++;
    }
  }
  Logger.log(`Purged ${deletedCount} demo/test rows from response sheet.`);
}