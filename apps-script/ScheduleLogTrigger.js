/**
 * Call this function from whatever script triggers when a new file is dropped 
 * in the folder. Pass it the file name and the data array that was extracted.
 */
function logScheduleSyncEvent(fileName, parsedDataArray) {
  const syncLogSheetId = '1RWPNUjVeRRcHiI18b8_IzLn1RzKHG3hLJvIbZjWq6Bc'; // Your New Sheet ID
  const ss = SpreadsheetApp.openById(syncLogSheetId);
  let logTab = ss.getSheetByName('Schedule_Sync_Log');
  
  // Create the log tab if it doesn't exist
  if (!logTab) {
    logTab = ss.insertSheet('Schedule_Sync_Log');
    logTab.appendRow(['Timestamp', 'Trigger File Name', 'Status', 'Total Rows Parsed']);
    logTab.getRange("A1:D1").setFontWeight("bold");
  }

  const timestamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss');
  const rowsFound = parsedDataArray ? parsedDataArray.length : 0;
  let status = rowsFound > 5 ? "SUCCESS" : "WARNING - NO DATA";

  // Write to the log
  logTab.appendRow([timestamp, fileName, status, rowsFound]);
}