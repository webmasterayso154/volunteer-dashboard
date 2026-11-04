/**
 * =========================================================================
 * AYSO REGION 154 - SCHEDULE SYNC & FORM DROPDOWN ENGINE
 * File: ScheduleSyncEngine.gs
 * Version: v1.8.0-AMPM-FIX
 * 
 * DESCRIPTION:
 * - Reads weekly MatchTrak schedule CSVs from Google Drive
 * - Appends/updates the master schedule sheet
 * - Normalizes match timestamps (fixing 12-hour AM/PM formatting bug)
 * - Populates venue-segmented Google Form dropdowns
 * =========================================================================
 */

// Isolated scoped configuration to prevent collisions with global CONFIG
var SCHEDULE_ENGINE_CONFIG = {
  // Folder ID containing raw MatchTrak CSVs
  SOURCE_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  ARCHIVE_FOLDER_NAME: '02_PROCESSED_ARCHIVE',
  
  // Sheet Names
  SCHEDULE_SHEET_NAME: 'Current_Season_Schedule',
  LEDGER_SHEET_NAME: 'Season_Master_Ledger',
  
  // Google Form ID or Form URL (Uses active/linked form or configured ID)
  FORM_ID: (typeof CONFIG !== 'undefined' && CONFIG.FORM_ID) ? CONFIG.FORM_ID : '',
  
  // Venue question titles matching Google Form sections
  VENUES: {
    LJHS_ARNOLD: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary',
    PARK_LEX: 'Select Match - 🌲 Park Lex',
    LUTHER: 'Select Match - 🏫 Luther Elementary'
  }
};

/**
 * Robust time parser that preserves AM/PM flags from MatchTrak CSV data
 * Handles: "5:45:00 PM", "05:45:00 PM", "7:00 PM", "13:00:00", native Date objects
 */
function normalizeMatchTime(rawTime) {
  if (rawTime === null || rawTime === undefined || rawTime === '') return '';
  
  // If Google Sheets parsed it into a native Date object
  if (rawTime instanceof Date) {
    return Utilities.formatDate(rawTime, Session.getScriptTimeZone() || 'America/Los_Angeles', 'h:mm a');
  }

  var str = String(rawTime).trim();

  // Pattern 1: 12-hour format with AM/PM (e.g., "5:45:00 PM" or "5:45 PM")
  var match12 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (match12) {
    var hour = parseInt(match12[1], 10);
    var min = match12[2];
    var ampm = match12[3].toUpperCase();
    return hour + ':' + min + ' ' + ampm;
  }

  // Pattern 2: 24-hour military format (e.g., "17:45:00" or "13:00")
  var match24 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    var h24 = parseInt(match24[1], 10);
    var m = match24[2];
    var period = h24 >= 12 ? 'PM' : 'AM';
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ' ' + period;
  }

  return str;
}

/**
 * Standardizes match date strings into compact format (e.g., "Fri", "Sat")
 */
function getDayOfWeekAbbr(dateVal) {
  if (!dateVal) return '';
  var d;
  if (dateVal instanceof Date) {
    d = dateVal;
  } else {
    d = new Date(dateVal);
  }
  if (isNaN(d.getTime())) return '';
  
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()];
}

/**
 * Strips division prefix tags if present (e.g. "E154-Limon_L" -> "Limon_L")
 */
function cleanTeamName(name) {
  if (!name) return '';
  return String(name).replace(/^E154-/, '').trim();
}

/**
 * Maps raw field string to compact venue label
 */
function cleanFieldName(fieldStr) {
  if (!fieldStr) return '';
  var f = String(fieldStr);
  if (f.indexOf('Lexington JHS U10 Field 6') !== -1) return 'LJHS Field 6';
  if (f.indexOf('Lexington JHS U10 Field 7') !== -1) return 'LJHS Field 7';
  if (f.indexOf('Lexington JHS U10 Field 8') !== -1) return 'LJHS Field 8';
  if (f.indexOf('Lexington JHS U12 Field 9') !== -1) return 'LJHS Field 9';
  if (f.indexOf('Arnold Elementary') !== -1) return 'Arnold Field 10';
  if (f.indexOf('Park Lexington GRASS') !== -1) return 'Park Lex Grass';
  if (f.indexOf('Park Lexington ARTIFICIAL TURF') !== -1) return 'Park Lex Turf';
  if (f.indexOf('Luther Elementary School - Field 1') !== -1) return 'Luther Field 1';
  if (f.indexOf('Luther Elementary School - Field 2') !== -1) return 'Luther Field 2';
  if (f.indexOf('Luther Elementary School - Field 3') !== -1) return 'Luther Field 3';
  return f.replace(/Fall \d{4}/g, '').trim();
}

/**
 * Formats standard division tag
 */
function cleanDivision(divStr) {
  if (!divStr) return '';
  var s = String(divStr).trim().toUpperCase();
  if (s === 'BU10') return '10U-B';
  if (s === 'GU10') return '10U-G';
  if (s === 'BU12') return '12U-B';
  if (s === 'GU12') return '12U-G';
  if (s === 'BU14') return '14U-B';
  if (s === 'GU14') return '14U-G';
  if (s === 'BU08') return '08U-B';
  if (s === 'GU08') return '08U-G';
  return s;
}

/**
 * Main manual sync runner: Updates Google Form dropdown choices from current schedule sheet
 */
function updateFormDropdown() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SCHEDULE_ENGINE_CONFIG.SCHEDULE_SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('No data found in schedule sheet.');
    return;
  }

  var headers = data[0];
  var colMap = {};
  for (var c = 0; c < headers.length; c++) {
    colMap[String(headers[c]).trim()] = c;
  }

  var dateCol = colMap['Date'] !== undefined ? colMap['Date'] : 1;
  var timeCol = colMap['Time'] !== undefined ? colMap['Time'] : 2;
  var divCol = colMap['Division'] !== undefined ? colMap['Division'] : 4;
  var fieldCol = colMap['Field'] !== undefined ? colMap['Field'] : 8;
  var homeCol = colMap['Home Team'] !== undefined ? colMap['Home Team'] : 10;
  var awayCol = colMap['Away Team'] !== undefined ? colMap['Away Team'] : 14;

  var ljhsArnoldChoices = [];
  var parkLexChoices = [];
  var lutherChoices = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rawDate = row[dateCol];
    var rawTime = row[timeCol];
    var field = String(row[fieldCol] || '');
    var home = cleanTeamName(row[homeCol]);
    var away = cleanTeamName(row[awayCol]);
    var div = cleanDivision(row[divCol]);

    if (!field || field.indexOf('#BYE') !== -1 || field.indexOf('E154-BYE') !== -1) continue;
    if (!home || home === '#BYE') continue;

    var dayAbbr = getDayOfWeekAbbr(rawDate);
    var formattedTime = normalizeMatchTime(rawTime);
    var venueTag = cleanFieldName(field);

    if (!formattedTime || !dayAbbr) continue;

    var label = '🗓️ ' + dayAbbr + ' • ⏰ ' + formattedTime + ' • 📍 ' + venueTag + ' • ⚽ ' + div + ': ' + home + ' vs ' + away;

    if (venueTag.indexOf('LJHS') !== -1 || venueTag.indexOf('Arnold') !== -1) {
      ljhsArnoldChoices.push(label);
    } else if (venueTag.indexOf('Park Lex') !== -1) {
      parkLexChoices.push(label);
    } else if (venueTag.indexOf('Luther') !== -1) {
      lutherChoices.push(label);
    }
  }

  var form;
  if (SCHEDULE_ENGINE_CONFIG.FORM_ID) {
    form = FormApp.openById(SCHEDULE_ENGINE_CONFIG.FORM_ID);
  } else {
    var formUrl = ss.getFormUrl();
    if (formUrl) {
      form = FormApp.openByUrl(formUrl);
    } else {
      throw new Error('Google Form not found. Specify FORM_ID in SCHEDULE_ENGINE_CONFIG.');
    }
  }

  var items = form.getItems(FormApp.ItemType.LIST);
  var updatedCount = 0;

  for (var k = 0; k < items.length; k++) {
    var item = items[k].asListItem();
    var title = item.getTitle();

    if (title.indexOf('Lexington Junior High') !== -1 || title.indexOf('Arnold Elementary') !== -1) {
      if (ljhsArnoldChoices.length > 0) {
        var opts = ljhsArnoldChoices.slice();
        opts.push('⚠️ Other / Rescheduled / Unlisted Match');
        item.setChoiceValues(opts);
        updatedCount++;
      }
    } else if (title.indexOf('Park Lex') !== -1) {
      if (parkLexChoices.length > 0) {
        var opts = parkLexChoices.slice();
        opts.push('⚠️ Other / Rescheduled / Unlisted Match');
        item.setChoiceValues(opts);
        updatedCount++;
      }
    } else if (title.indexOf('Luther') !== -1) {
      if (lutherChoices.length > 0) {
        var opts = lutherChoices.slice();
        opts.push('⚠️ Other / Rescheduled / Unlisted Match');
        item.setChoiceValues(opts);
        updatedCount++;
      }
    }
  }

  Logger.log('Successfully updated ' + updatedCount + ' form dropdown sections.');
}

/**
 * Automates weekly schedule ingestion from Drive CSV and updates Form
 */
function autoIngestWeeklySchedule() {
  var folder = DriveApp.getFolderById(SCHEDULE_ENGINE_CONFIG.SOURCE_FOLDER_ID);
  var files = folder.getFilesByType(MimeType.CSV);

  if (!files.hasNext()) {
    Logger.log('No new schedule CSV found in ingestion folder.');
    return;
  }

  var file = files.next();
  var csvData = Utilities.parseCsv(file.getBlob().getDataAsString());
  
  if (csvData.length < 2) {
    Logger.log('CSV file is empty or missing headers.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SCHEDULE_ENGINE_CONFIG.SCHEDULE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SCHEDULE_ENGINE_CONFIG.SCHEDULE_SHEET_NAME);
  }

  sheet.clear();
  sheet.getRange(1, 1, csvData.length, csvData[0].length).setValues(csvData);

  // Archive CSV
  var archiveFolders = folder.getFoldersByName(SCHEDULE_ENGINE_CONFIG.ARCHIVE_FOLDER_NAME);
  var archiveFolder;
  if (archiveFolders.hasNext()) {
    archiveFolder = archiveFolders.next();
  } else {
    archiveFolder = folder.createFolder(SCHEDULE_ENGINE_CONFIG.ARCHIVE_FOLDER_NAME);
  }

  file.moveTo(archiveFolder);
  Logger.log('Archived ' + file.getName() + ' to ' + SCHEDULE_ENGINE_CONFIG.ARCHIVE_FOLDER_NAME);

  // Update Form Dropdowns
  updateFormDropdown();
}