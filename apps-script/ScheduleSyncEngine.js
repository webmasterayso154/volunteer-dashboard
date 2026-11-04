/**
 * =========================================================================
 * AYSO REGION 154 - SCHEDULE SYNC & FORM DROPDOWN ENGINE
 * File: ScheduleSyncEngine.gs
 * Version: v1.9.1-PM-FIX-COMPLETE
 *
 * CHANGELOG:
 * - Fixed 12-hour AM/PM parser in normalizeTimeSortable to preserve PM timestamps.
 * - Expanded date window to capture midweek Wednesday games along with Friday & Saturday.
 * - Dynamic week cycle: Anchor automatically calculates to Wednesday (Wed–Sun, 5-day cycle).
 * - Chronological sorting: Wednesday games appear first, followed by Friday and Saturday.
 * - Format badges updated: Displays '🗓️ Wed' and form headers reflect proper date spans.
 * - Preserves calculated helper columns AR:AT in Season_Master_Schedule.
 * =========================================================================
 */

const SCHEDULE_CONFIG = {
  DRIVE_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  ARCHIVE_FOLDER_NAME: '02_PROCESSED_ARCHIVE',
  FORM_ID: '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI',
  SCHEDULE_TAB_NAME: 'Master_Schedule',
  SEASON_SCHEDULE_TAB_NAME: 'Season_Master_Schedule',
  SYNC_LOG_TAB_NAME: 'Schedule_Sync_Log',
  TIMEZONE: 'America/Los_Angeles',
  MIN_GAMES_THRESHOLD: 5,
  UNLISTED_MATCH_OPTION: '⚠️ Other / Rescheduled / Unlisted Match'
};

/**
 * Resolves the active match date window spanning Wednesday through Sunday.
 * Automatically accommodates midweek games (Wed, Fri, Sat) without dropping weekend games.
 * @return {{dates: string[], isOverride: boolean, startYMD: string}}
 */
function resolveUpcomingWeekendDates() {
  let overrideDateStr = null;
  try {
    const settings = (typeof getAdminConfigSettings === 'function') ? getAdminConfigSettings() : {};
    overrideDateStr = settings.TargetWeekendStart || null;
  } catch (e) {}

  // 1. Check for manual override in Admin_Config
  if (overrideDateStr) {
    const startYMD = normalizeToYMD(overrideDateStr);
    if (startYMD) {
      const parts = startYMD.split('-');
      const start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const dates = [];
      for (let i = 0; i < 5; i++) {
        dates.push(Utilities.formatDate(new Date(start.getTime() + (i * 86400000)), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'));
      }
      return {
        dates: dates,
        isOverride: true,
        startYMD: startYMD
      };
    }
  }

  // 2. Dynamic Automatic Calculation: Anchor to Wednesday
  const now = new Date();
  const dayStr = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'u'); // 1 = Mon ... 7 = Sun
  const dayOfWeek = parseInt(dayStr, 10);

  // Offset to Wednesday (Day 3):
  // Mon (1) -> +2 | Tue (2) -> +1 | Wed (3) -> 0 | Thu (4) -> -1 | Fri (5) -> -2 | Sat (6) -> -3 | Sun (7) -> -4
  const daysToWed = 3 - dayOfWeek;

  const nowYMD = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
  const baseMidnight = new Date(Number(nowYMD[0]), Number(nowYMD[1]) - 1, Number(nowYMD[2]));
  const wed = new Date(baseMidnight.getTime() + (daysToWed * 86400000));

  // Build 5-day cycle: Wednesday, Thursday, Friday, Saturday, Sunday
  const dates = [];
  for (let i = 0; i < 5; i++) {
    dates.push(Utilities.formatDate(new Date(wed.getTime() + (i * 86400000)), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'));
  }

  return {
    dates: dates,
    isOverride: false,
    startYMD: Utilities.formatDate(wed, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd')
  };
}

/**
 * Main ingestion entry point:
 * Reads newest CSV in Drive, filters to Wed–Sun matches, updates Master_Schedule,
 * upserts into Season_Master_Schedule, and updates the live Google Form dropdowns.
 */
function autoIngestWeeklySchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = DriveApp.getFolderById(SCHEDULE_CONFIG.DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const fileList = [];

  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName().toLowerCase();
    if (name.endsWith('.csv') || f.getMimeType() === MimeType.CSV || f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      fileList.push(f);
    }
  }

  if (fileList.length === 0) {
    Logger.log('ABORTED: No schedule files found in Drive folder.');
    return;
  }

  // Sort newest first
  fileList.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());

  const weekendWindow = resolveUpcomingWeekendDates();
  const latestFile = fileList[0];
  const parsedRaw = extractDataFromFile(latestFile);
  const filteredData = filterScheduleForTargetWeekend(parsedRaw, weekendWindow.dates);

  const totalMatches = filteredData.length - 1;
  if (totalMatches < SCHEDULE_CONFIG.MIN_GAMES_THRESHOLD) {
    const msg = `ABORTED: Found only ${totalMatches} games for ${weekendWindow.dates.join(', ')}. Minimum threshold is ${SCHEDULE_CONFIG.MIN_GAMES_THRESHOLD}.`;
    Logger.log(msg);
    logScheduleSyncEvent(latestFile.getName(), weekendWindow.startYMD, totalMatches, 0, 0, 0, 'ABORTED_LOW_COUNT');
    return;
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(filteredData);
  const startDateLabel = weekendWindow.dates[0];
  const endDateLabel = weekendWindow.dates[weekendWindow.dates.length - 1];

  try {
    const ui = SpreadsheetApp.getUi();
    const prompt = `TARGET DATES (Wed–Sun): ${startDateLabel} to ${endDateLabel}\n` +
      `MATCHES IDENTIFIED (${totalMatches} total):\n` +
      `• 🏟️ Park Lexington: ${parkLexMatches.length - 1}\n` +
      `• 🏫 Luther Elementary: ${lutherMatches.length - 1}\n` +
      `• 🏫 LJHS / Arnold: ${ljhsArnoldMatches.length - 1}\n\n` +
      `⚠️ Overwrite "${SCHEDULE_CONFIG.SCHEDULE_TAB_NAME}" and update live Form dropdowns?`;
    const res = ui.alert('Confirm Live Game Day Sync', prompt, ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  } catch (e) {
    Logger.log('Headless/trigger execution detected — proceeding without UI prompt.');
  }

  // 1. Write filtered Wed–Sun schedule to Master_Schedule
  writeScheduleToSheet(ss, SCHEDULE_CONFIG.SCHEDULE_TAB_NAME, filteredData);

  // 2. Upsert into cumulative Season_Master_Schedule (by Game #)
  upsertSeasonMasterSchedule(ss, filteredData);

  // 3. Push venue match lists to live linked Google Form dropdowns
  updateLiveFormMatchDropdowns(ss, weekendWindow.dates, parkLexMatches, lutherMatches, ljhsArnoldMatches);

  // 4. Log sync event
  logScheduleSyncEvent(
    latestFile.getName(),
    weekendWindow.startYMD,
    totalMatches,
    parkLexMatches.length - 1,
    lutherMatches.length - 1,
    ljhsArnoldMatches.length - 1,
    'SUCCESS'
  );

  // 5. Move processed file to archive subfolder
  archiveProcessedFile(folder, latestFile);
}

/**
 * Direct Manual Sync:
 * Reads whatever is currently sitting in Master_Schedule and updates the Google Form dropdowns.
 * Bypasses CSV re-downloading when Master_Schedule is already populated.
 */
function forceSyncFormDropdownsDirect() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SCHEDULE_CONFIG.SCHEDULE_TAB_NAME);
  if (!sheet) {
    Logger.log('ERROR: Master_Schedule sheet not found.');
    return;
  }

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) {
    Logger.log('ERROR: No games found in Master_Schedule.');
    return;
  }

  const activeDates = [];
  const header = data[0];
  const idxDate = header.indexOf('Date');
  for (let r = 1; r < data.length; r++) {
    const dVal = normalizeToYMD(data[r][idxDate]);
    if (dVal && !activeDates.includes(dVal)) {
      activeDates.push(dVal);
    }
  }
  activeDates.sort();

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(data);
  updateLiveFormMatchDropdowns(ss, activeDates, parkLexMatches, lutherMatches, ljhsArnoldMatches);
  Logger.log(`Direct Form Sync Completed: Park Lex (${parkLexMatches.length - 1}), Luther (${lutherMatches.length - 1}), LJHS/Arnold (${ljhsArnoldMatches.length - 1})`);
}

/**
 * Extracts 2D array from CSV or Google Sheet file.
 */
function extractDataFromFile(file) {
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  const csvText = file.getBlob().getDataAsString();
  return Utilities.parseCsv(csvText);
}

/**
 * Filters raw rows to include target dates (Wed through Sun) and exclude BYE matches.
 */
function filterScheduleForTargetWeekend(rawRows, targetDates) {
  if (!rawRows || rawRows.length === 0) return [];
  const header = rawRows[0];
  const dateIdx = header.indexOf('Date');
  const fieldIdx = header.indexOf('Field');
  if (dateIdx === -1) throw new Error('Schedule CSV is missing "Date" column.');

  const dateSet = {};
  for (let i = 0; i < targetDates.length; i++) {
    dateSet[targetDates[i]] = true;
  }

  const out = [header];
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const rowDate = normalizeToYMD(row[dateIdx]);
    const fieldVal = fieldIdx !== -1 ? String(row[fieldIdx] || '').toUpperCase() : '';
    if (rowDate && dateSet[rowDate] && fieldVal.indexOf('BYE') === -1) {
      const cloned = row.slice();
      cloned[dateIdx] = rowDate;
      out.push(cloned);
    }
  }
  return out;
}

/**
 * Builds formatted dropdown strings sorted chronologically (Wednesday first, then Friday, then Saturday).
 */
function buildScheduleDropdownOptionsByVenue(filteredData) {
  const parkLexMatches = [];
  const lutherMatches = [];
  const ljhsArnoldMatches = [];

  if (!filteredData || filteredData.length < 2) {
    return {
      parkLexMatches: [SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION],
      lutherMatches: [SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION],
      ljhsArnoldMatches: [SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION]
    };
  }

  const h = filteredData[0];
  const idxDate = h.indexOf('Date');
  const idxTime = h.indexOf('Time');
  const idxDiv = h.indexOf('Division');
  const idxField = h.indexOf('Field');
  const idxHome = h.indexOf('Home Team');
  const idxAway = h.indexOf('Away Team');
  const idxCanceled = h.indexOf('Canceled');
  const idxPostponed = h.indexOf('Postponed');

  // Sort chronologically by Date -> Time -> Field
  const body = filteredData.slice(1).sort((a, b) => {
    const da = String(a[idxDate] || '') + ' ' + normalizeTimeSortable(a[idxTime]);
    const db = String(b[idxDate] || '') + ' ' + normalizeTimeSortable(b[idxTime]);
    if (da !== db) return da < db ? -1 : 1;
    return String(a[idxField] || '').localeCompare(String(b[idxField] || ''));
  });

  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    if (idxCanceled !== -1 && String(row[idxCanceled] || '').toUpperCase() === 'Y') continue;
    if (idxPostponed !== -1 && String(row[idxPostponed] || '').toUpperCase() === 'Y') continue;

    const rawField = String(row[idxField] || '');
    if (!rawField || rawField.toUpperCase().indexOf('BYE') !== -1) continue;

    const dayLabel = formatDayAbbrev(row[idxDate]);
    const timeLabel = formatTime12Hr(row[idxTime]);
    const shortField = formatShortFieldName(rawField);
    const divLabel = formatShortDivision(row[idxDiv]);
    const homeShort = formatShortTeamName(row[idxHome]);
    const awayShort = formatShortTeamName(row[idxAway]);

    // Example: 🗓️ Wed • ⏰ 5:45 PM • 📍 LJHS Field 7 • ⚽ 10U-B: Team A vs Team B
    const optionStr = `🗓️ ${dayLabel} • ⏰ ${timeLabel} • 📍 ${shortField} • ⚽ ${divLabel}: ${homeShort} vs ${awayShort}`;
    const upperField = rawField.toUpperCase();

    if (upperField.indexOf('PARK LEX') !== -1) {
      if (!parkLexMatches.includes(optionStr)) parkLexMatches.push(optionStr);
    } else if (upperField.indexOf('LUTHER') !== -1) {
      if (!lutherMatches.includes(optionStr)) lutherMatches.push(optionStr);
    } else if (upperField.indexOf('LEXINGTON JHS') !== -1 || upperField.indexOf('LJHS') !== -1 || upperField.indexOf('ARNOLD') !== -1) {
      if (!ljhsArnoldMatches.includes(optionStr)) ljhsArnoldMatches.push(optionStr);
    }
  }

  parkLexMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);
  lutherMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);
  ljhsArnoldMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);

  return { parkLexMatches, lutherMatches, ljhsArnoldMatches };
}

/**
 * Updates the 3 venue match dropdown questions on the live Google Form.
 */
function updateLiveFormMatchDropdowns(ss, weekendDates, parkLexMatches, lutherMatches, ljhsArnoldMatches) {
  let form = null;
  if (SCHEDULE_CONFIG.FORM_ID) {
    try {
      form = FormApp.openById(SCHEDULE_CONFIG.FORM_ID);
    } catch (e) {
      Logger.log('Could not open form by ID, falling back to getFormUrl()...');
    }
  }
  if (!form) {
    const formUrl = ss.getFormUrl();
    if (!formUrl) {
      Logger.log('ERROR: No valid form ID or linked Google Form found.');
      return;
    }
    form = FormApp.openByUrl(formUrl);
  }

  const items = form.getItems(FormApp.ItemType.LIST);
  const dateRangeBadge = formatWeekendBadge(weekendDates);

  for (let i = 0; i < items.length; i++) {
    const listItem = items[i].asListItem();
    const title = listItem.getTitle();
    if (title.indexOf('Select Match') === -1) continue;

    if (title.indexOf('Park Lex') !== -1) {
      listItem.setTitle(`Select Match - 🏟️ Park Lex (${dateRangeBadge})`);
      listItem.setChoiceValues(parkLexMatches);
    } else if (title.indexOf('Luther') !== -1) {
      listItem.setTitle(`Select Match - 🏫 Luther Elementary (${dateRangeBadge})`);
      listItem.setChoiceValues(lutherMatches);
    } else if (title.indexOf('Lexington Junior High') !== -1 || title.indexOf('LJHS') !== -1 || title.indexOf('Arnold') !== -1) {
      listItem.setTitle(`Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary (${dateRangeBadge})`);
      listItem.setChoiceValues(ljhsArnoldMatches);
    }
  }
}

/**
 * Writes filtered schedule to Master_Schedule tab.
 */
function writeScheduleToSheet(ss, sheetName, data) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  if (data && data.length > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
}

/**
 * Upserts matches into Season_Master_Schedule without touching calculated helper columns (AR:AT).
 */
function upsertSeasonMasterSchedule(ss, filteredData) {
  if (!filteredData || filteredData.length < 2) return;
  let seasonSheet = ss.getSheetByName(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
  if (!seasonSheet) {
    seasonSheet = ss.insertSheet(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
    seasonSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
    return;
  }

  const numCols = filteredData[0].length;
  const lastRow = seasonSheet.getLastRow();
  if (lastRow < 1) {
    seasonSheet.getRange(1, 1, filteredData.length, numCols).setValues(filteredData);
    return;
  }

  const existingRange = seasonSheet.getRange(1, 1, lastRow, numCols);
  const existing = existingRange.getValues();
  const header = existing[0];
  const gameNumIdx = header.indexOf('Game #');
  if (gameNumIdx === -1) return;

  const rowMap = {};
  for (let r = 1; r < existing.length; r++) {
    const gNum = String(existing[r][gameNumIdx] || '').trim();
    if (gNum) rowMap[gNum] = r;
  }

  const rowsToAppend = [];
  const updatedExisting = existing.slice();

  for (let i = 1; i < filteredData.length; i++) {
    const newRow = filteredData[i];
    const gNum = String(newRow[gameNumIdx] || '').trim();
    if (gNum && rowMap.hasOwnProperty(gNum)) {
      updatedExisting[rowMap[gNum]] = newRow;
    } else {
      rowsToAppend.push(newRow);
    }
  }

  existingRange.setValues(updatedExisting);

  if (rowsToAppend.length > 0) {
    const startAppendRow = lastRow + 1;
    seasonSheet.getRange(startAppendRow, 1, rowsToAppend.length, numCols).setValues(rowsToAppend);
  }
}

function archiveProcessedFile(folder, file) {
  try {
    let archiveFolder;
    const subfolders = folder.getFoldersByName(SCHEDULE_CONFIG.ARCHIVE_FOLDER_NAME);
    if (subfolders.hasNext()) {
      archiveFolder = subfolders.next();
    } else {
      archiveFolder = folder.createFolder(SCHEDULE_CONFIG.ARCHIVE_FOLDER_NAME);
    }
    file.moveTo(archiveFolder);
  } catch (e) {
    Logger.log('Archive notice: ' + e.message);
  }
}

function logScheduleSyncEvent(sourceFile, weekendStart, totalRows, parkLexCount, lutherCount, ljhsArnoldCount, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName(SCHEDULE_CONFIG.SYNC_LOG_TAB_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(SCHEDULE_CONFIG.SYNC_LOG_TAB_NAME);
    logSheet.appendRow(['Timestamp', 'Source File', 'Weekend Start', 'Total Rows', 'Park Lex Games', 'Luther Games', 'LJHS/Arnold Games', 'Status']);
  }
  const ts = Utilities.formatDate(new Date(), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  logSheet.appendRow([ts, sourceFile, weekendStart, totalRows, parkLexCount, lutherCount, ljhsArnoldCount, status]);
}

/* ==================== FORMATTING HELPERS ==================== */

function normalizeToYMD(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mdy) {
    const mm = ('0' + mdy[1]).slice(-2);
    const dd = ('0' + mdy[2]).slice(-2);
    const yyyy = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function formatDayAbbrev(ymd) {
  const norm = normalizeToYMD(ymd);
  if (!norm) return '';
  const p = norm.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Utilities.formatDate(d, SCHEDULE_CONFIG.TIMEZONE, 'EEE');
}

function formatWeekendBadge(dates) {
  if (!dates || dates.length === 0) return '';
  const first = dates[0].split('-');
  const last = dates[dates.length - 1].split('-');
  const dStart = new Date(Number(first[0]), Number(first[1]) - 1, Number(first[2]));
  const dEnd = new Date(Number(last[0]), Number(last[1]) - 1, Number(last[2]));
  const mStart = Utilities.formatDate(dStart, SCHEDULE_CONFIG.TIMEZONE, 'MMM');
  const mEnd = Utilities.formatDate(dEnd, SCHEDULE_CONFIG.TIMEZONE, 'MMM');
  const dayStart = parseInt(first[2], 10);
  const dayEnd = parseInt(last[2], 10);

  return (mStart === mEnd)
    ? `${mStart} ${dayStart}-${dayEnd}`
    : `${mStart} ${dayStart} - ${mEnd} ${dayEnd}`;
}

/**
 * Normalizes input time into a 24-hour HH:mm:00 format.
 * Correctly accounts for 12-hour AM/PM values.
 */
function normalizeTimeSortable(val) {
  if (!val) return '00:00:00';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, SCHEDULE_CONFIG.TIMEZONE, 'HH:mm:ss');
  }

  const s = String(val).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return s;

  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const meridian = m[3] ? m[3].toUpperCase() : null;

  if (meridian === 'PM' && hh < 12) {
    hh += 12;
  } else if (meridian === 'AM' && hh === 12) {
    hh = 0;
  }

  return ('0' + hh).slice(-2) + ':' + mm + ':00';
}

/**
 * Formats a normalized time string into user-friendly 12-hour format (e.g. 5:45 PM).
 */
function formatTime12Hr(val) {
  const norm = normalizeTimeSortable(val);
  const m = norm.match(/^(\d{2}):(\d{2})/);
  if (!m) return String(val || '');

  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = hh >= 12 ? 'PM' : 'AM';

  if (hh === 0) {
    hh = 12;
  } else if (hh > 12) {
    hh = hh - 12;
  }

  return `${hh}:${mm} ${ampm}`;
}

function formatShortFieldName(rawField) {
  const f = String(rawField || '');
  const upper = f.toUpperCase();
  if (upper.indexOf('PARK LEX') !== -1) {
    return upper.indexOf('TURF') !== -1 ? 'Park Lex Turf' : 'Park Lex Grass';
  }
  if (upper.indexOf('LUTHER') !== -1) {
    const m = f.match(/Field\s*(\d+)/i);
    return m ? `Luther Field ${m[1]}` : 'Luther';
  }
  if (upper.indexOf('ARNOLD') !== -1) {
    const m = f.match(/Field\s*(\d+)/i);
    return m ? `Arnold Field ${m[1]}` : 'Arnold';
  }
  if (upper.indexOf('LEXINGTON JHS') !== -1 || upper.indexOf('LJHS') !== -1) {
    const m = f.match(/Field\s*(\d+)/i);
    return m ? `LJHS Field ${m[1]}` : 'LJHS';
  }
  return f;
}

function formatShortDivision(rawDiv) {
  const d = String(rawDiv || '').trim().toUpperCase();
  const m = d.match(/^([BG])U(\d{1,2})$/);
  if (m) {
    const age = ('0' + m[2]).slice(-2) + 'U';
    return `${age}-${m[1]}`;
  }
  return d;
}

function formatShortTeamName(rawTeam) {
  return String(rawTeam || '').trim().replace(/^E154-/i, '');
}
