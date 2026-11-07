/**
 * ============================================================================
 * AYSO REGION 154 — SCHEDULE SYNC ENGINE (ScheduleSyncEngine.gs)
 * ============================================================================
 * Target Live Form: https://docs.google.com/forms/d/1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI/edit
 * Target Spreadsheet: AYSO 154 - Game Day Hub - Fall 2026 (Responses)
 * ============================================================================
 */

const SCHEDULE_CONFIG = {
  // Explicit live Form ID - connects directly without relying on getFormUrl()
  FORM_ID: '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI',
  DRIVE_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  SCHEDULE_TAB_NAME: 'Master_Schedule',
  SEASON_SCHEDULE_TAB_NAME: 'Season_Master_Schedule',
  SYNC_LOG_TAB_NAME: 'Schedule_Sync_Log',
  TIMEZONE: 'America/Los_Angeles',
  MIN_GAMES_THRESHOLD: 1,
  UNLISTED_MATCH_OPTION: '⚠️ Other / Rescheduled / Unlisted Match'
};

/**
 * Returns strictly upcoming target dates from today forward through Sunday.
 * Excludes yesterday and past days.
 */
function resolveUpcomingWeekendDates() {
  let overrideDateStr = null;
  try {
    const settings = (typeof getAdminConfigSettings === 'function') ? getAdminConfigSettings() : {};
    overrideDateStr = settings.TargetWeekendStart || null;
  } catch (e) {}

  if (overrideDateStr) {
    const startYMD = normalizeToYMD(overrideDateStr);
    if (startYMD) {
      const parts = startYMD.split('-');
      const start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return {
        dates: [
          startYMD,
          Utilities.formatDate(new Date(start.getTime() + 86400000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'),
          Utilities.formatDate(new Date(start.getTime() + 172800000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd')
        ],
        isOverride: true,
        startYMD: startYMD
      };
    }
  }

  const now = new Date();
  const dayOfWeek = parseInt(Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'u'), 10); // 1 = Mon ... 7 = Sun
  const nowYMD = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
  const baseMidnight = new Date(Number(nowYMD[0]), Number(nowYMD[1]) - 1, Number(nowYMD[2]));
  const dates = [];

  // Monday (1) through Friday (5): include today forward through Sunday
  if (dayOfWeek <= 5) {
    const daysUntilSunday = 7 - dayOfWeek;
    for (let i = 0; i <= daysUntilSunday; i++) {
      const d = new Date(baseMidnight.getTime() + (i * 86400000));
      dates.push(Utilities.formatDate(d, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'));
    }
  } else if (dayOfWeek === 6) {
    // Saturday + Sunday
    dates.push(Utilities.formatDate(baseMidnight, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'));
    dates.push(Utilities.formatDate(new Date(baseMidnight.getTime() + 86400000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'));
  } else {
    // Sunday only
    dates.push(Utilities.formatDate(baseMidnight, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'));
  }

  return {
    dates: dates,
    isOverride: false,
    startYMD: dates[0]
  };
}

/**
 * Validates if a match kickoff is in the future.
 * Strictly excludes any date prior to today.
 */
function isGameUpcoming(rowDateStr, rowTimeStr) {
  if (!rowDateStr) return false;
  const now = new Date();
  const todayYMD = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // Past dates are excluded
  if (rowDateStr < todayYMD) return false;
  if (rowDateStr > todayYMD) return true;

  // For games today, allow check-in window up to 2.5 hours post-kickoff
  if (!rowTimeStr) return true;
  const sortTime = normalizeTimeSortable(rowTimeStr);
  const currentTime = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'HH:mm');
  const [gh, gm] = sortTime.split(':').map(Number);
  const [ch, cm] = currentTime.split(':').map(Number);

  return (ch * 60 + cm) <= (gh * 60 + gm + 150);
}

/**
 * PRIMARY RUN ENTRY POINT:
 * Reads Master_Schedule, filters out Wednesday/past games, and forcefully
 * overwrites the live Google Form dropdown questions.
 */
function forceSyncFormDropdownsDirect() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const weekendWindow = resolveUpcomingWeekendDates();

  let scheduleSheet = ss.getSheetByName(SCHEDULE_CONFIG.SCHEDULE_TAB_NAME);
  let rawData = scheduleSheet ? scheduleSheet.getDataRange().getDisplayValues() : [];

  if (!rawData || rawData.length < 2) {
    scheduleSheet = ss.getSheetByName(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
    rawData = scheduleSheet ? scheduleSheet.getDataRange().getDisplayValues() : [];
  }

  if (!rawData || rawData.length < 2) {
    SpreadAppAlert_('Sync Error', 'No schedule data found in Master_Schedule.');
    return;
  }

  const filteredData = filterScheduleForTargetWeekend(rawData, weekendWindow.dates);
  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(filteredData);

  updateLiveFormMatchDropdowns(weekendWindow.dates, parkLexMatches, lutherMatches, ljhsArnoldMatches);

  SpreadAppAlert_(
    'Sync Complete',
    `Updated live form dropdowns with upcoming games:\n` +
    `• Dates active: ${weekendWindow.dates.join(', ')}\n` +
    `• Park Lex: ${Math.max(0, parkLexMatches.length - 1)} matches\n` +
    `• Luther: ${Math.max(0, lutherMatches.length - 1)} matches\n` +
    `• LJHS / Arnold: ${Math.max(0, ljhsArnoldMatches.length - 1)} matches`
  );
}

/**
 * Automated Drive Ingestion:
 * Reads newest CSV in Drive folder, updates Master_Schedule, and pushes to Google Form.
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

  fileList.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());

  const weekendWindow = resolveUpcomingWeekendDates();
  const latestFile = fileList[0];
  const parsedRaw = extractDataFromFile(latestFile);
  const filteredData = filterScheduleForTargetWeekend(parsedRaw, weekendWindow.dates);
  const totalMatches = filteredData.length - 1;

  if (totalMatches < SCHEDULE_CONFIG.MIN_GAMES_THRESHOLD) {
    Logger.log(`ABORTED: Found only ${totalMatches} games for ${weekendWindow.dates.join(', ')}.`);
    logScheduleSyncEvent(latestFile.getName(), weekendWindow.startYMD, totalMatches, 0, 0, 0, 'ABORTED_LOW_COUNT');
    return;
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(filteredData);

  writeScheduleToSheet(ss, SCHEDULE_CONFIG.SCHEDULE_TAB_NAME, filteredData);
  upsertSeasonMasterSchedule(ss, filteredData);
  updateLiveFormMatchDropdowns(weekendWindow.dates, parkLexMatches, lutherMatches, ljhsArnoldMatches);

  logScheduleSyncEvent(
    latestFile.getName(),
    weekendWindow.startYMD,
    totalMatches,
    parkLexMatches.length - 1,
    lutherMatches.length - 1,
    ljhsArnoldMatches.length - 1,
    'SUCCESS'
  );
}

function extractDataFromFile(file) {
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  return Utilities.parseCsv(file.getBlob().getDataAsString());
}

function filterScheduleForTargetWeekend(rawRows, targetDates) {
  if (!rawRows || rawRows.length === 0) return [];
  const header = rawRows[0];
  const dateIdx = header.indexOf('Date') !== -1 ? header.indexOf('Date') : header.indexOf('DateTime');
  const timeIdx = header.indexOf('Time');
  const fieldIdx = header.indexOf('Field');

  if (dateIdx === -1) return rawRows;

  const dateSet = {};
  for (let i = 0; i < targetDates.length; i++) {
    dateSet[targetDates[i]] = true;
  }

  const out = [header];
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const rowDate = normalizeToYMD(row[dateIdx]);
    const rowTime = timeIdx !== -1 ? row[timeIdx] : '';
    const fieldVal = fieldIdx !== -1 ? String(row[fieldIdx] || '').toUpperCase() : '';

    if (rowDate && dateSet[rowDate] && fieldVal.indexOf('BYE') === -1 && isGameUpcoming(rowDate, rowTime)) {
      const cloned = row.slice();
      cloned[dateIdx] = rowDate;
      out.push(cloned);
    }
  }

  return out;
}

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
  const dateIdx = h.indexOf('Date') !== -1 ? h.indexOf('Date') : h.indexOf('DateTime');
  const timeIdx = h.indexOf('Time');
  const divIdx = h.indexOf('Division');
  const fieldIdx = h.indexOf('Field');
  const homeIdx = h.indexOf('Home Team') !== -1 ? h.indexOf('Home Team') : h.indexOf('Home Team ID');
  const awayIdx = h.indexOf('Away Team') !== -1 ? h.indexOf('Away Team') : h.indexOf('Away Team ID');
  const canceledIdx = h.indexOf('Canceled');
  const postponedIdx = h.indexOf('Postponed');

  const body = filteredData.slice(1).sort((a, b) => {
    const da = String(a[dateIdx] || '') + ' ' + normalizeTimeSortable(timeIdx !== -1 ? a[timeIdx] : '');
    const db = String(b[dateIdx] || '') + ' ' + normalizeTimeSortable(timeIdx !== -1 ? b[timeIdx] : '');
    if (da !== db) return da < db ? -1 : 1;
    return String(a[fieldIdx] || '').localeCompare(String(b[fieldIdx] || ''));
  });

  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    if (canceledIdx !== -1 && String(row[canceledIdx] || '').toUpperCase() === 'Y') continue;
    if (postponedIdx !== -1 && String(row[postponedIdx] || '').toUpperCase() === 'Y') continue;

    const rawField = String(row[fieldIdx] || '');
    if (!rawField || rawField.toUpperCase().indexOf('BYE') !== -1) continue;

    const dayLabel = formatDayAbbrev(row[dateIdx]);
    const timeLabel = formatTime12Hr(timeIdx !== -1 ? row[timeIdx] : '');
    const shortField = formatShortFieldName(rawField);
    const divLabel = formatShortDivision(divIdx !== -1 ? row[divIdx] : '');
    const homeShort = formatShortTeamName(homeIdx !== -1 ? row[homeIdx] : '');
    const awayShort = formatShortTeamName(awayIdx !== -1 ? row[awayIdx] : '');

    const optionStr = `🗓️ ${dayLabel} • ⏰ ${timeLabel} • 📍 ${shortField} • ⚽ ${divLabel}: ${homeShort} vs ${awayShort}`;
    const upperField = rawField.toUpperCase();

    if (upperField.indexOf('PARK LEX') !== -1) {
      if (parkLexMatches.indexOf(optionStr) === -1) parkLexMatches.push(optionStr);
    } else if (upperField.indexOf('LUTHER') !== -1) {
      if (lutherMatches.indexOf(optionStr) === -1) lutherMatches.push(optionStr);
    } else if (upperField.indexOf('LEXINGTON JHS') !== -1 || upperField.indexOf('LJHS') !== -1 || upperField.indexOf('ARNOLD') !== -1) {
      if (ljhsArnoldMatches.indexOf(optionStr) === -1) ljhsArnoldMatches.push(optionStr);
    }
  }

  parkLexMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);
  lutherMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);
  ljhsArnoldMatches.push(SCHEDULE_CONFIG.UNLISTED_MATCH_OPTION);

  return { parkLexMatches, lutherMatches, ljhsArnoldMatches };
}

/**
 * Directly connects to form 1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI and
 * replaces all dropdown choices with upcoming matches only.
 */
function updateLiveFormMatchDropdowns(weekendDates, parkLexMatches, lutherMatches, ljhsArnoldMatches) {
  const form = FormApp.openById(SCHEDULE_CONFIG.FORM_ID);
  const items = form.getItems(FormApp.ItemType.LIST);
  const dateRangeBadge = formatWeekendBadge(weekendDates);
  let updatedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const listItem = items[i].asListItem();
    const title = listItem.getTitle().toLowerCase();

    if (title.indexOf('select match') === -1) continue;

    if (title.indexOf('park lex') !== -1) {
      listItem.setTitle(`Select Match - 🏟️ Park Lex (${dateRangeBadge})`);
      listItem.setChoiceValues(parkLexMatches);
      updatedCount++;
    } else if (title.indexOf('luther') !== -1) {
      listItem.setTitle(`Select Match - 🏫 Luther Elementary (${dateRangeBadge})`);
      listItem.setChoiceValues(lutherMatches);
      updatedCount++;
    } else if (title.indexOf('lexington') !== -1 || title.indexOf('ljhs') !== -1 || title.indexOf('arnold') !== -1) {
      listItem.setTitle(`Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary (${dateRangeBadge})`);
      listItem.setChoiceValues(ljhsArnoldMatches);
      updatedCount++;
    }
  }

  Logger.log(`Successfully updated ${updatedCount} match dropdown questions on Form ${SCHEDULE_CONFIG.FORM_ID}`);
}

function writeScheduleToSheet(ss, sheetName, data) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  if (data && data.length > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
}

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
    if (gNum) rowMap[gNum] = r + 1;
  }

  const newRows = [];
  for (let i = 1; i < filteredData.length; i++) {
    const incomingRow = filteredData[i];
    const incomingGameNum = String(incomingRow[gameNumIdx] || '').trim();
    if (!incomingGameNum) continue;

    if (rowMap[incomingGameNum]) {
      seasonSheet.getRange(rowMap[incomingGameNum], 1, 1, numCols).setValues([incomingRow]);
    } else {
      newRows.push(incomingRow);
    }
  }

  if (newRows.length > 0) {
    seasonSheet.getRange(lastRow + 1, 1, newRows.length, numCols).setValues(newRows);
  }
}

function logScheduleSyncEvent(fileName, startYMD, total, pLex, luth, ljhs, status) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName(SCHEDULE_CONFIG.SYNC_LOG_TAB_NAME);
    if (!logSheet) {
      logSheet = ss.insertSheet(SCHEDULE_CONFIG.SYNC_LOG_TAB_NAME);
      logSheet.appendRow(['Timestamp', 'Source File', 'Target Date', 'Total Games', 'Park Lex', 'Luther', 'LJHS/Arnold', 'Status']);
    }
    logSheet.appendRow([new Date(), fileName, startYMD, total, pLex, luth, ljhs, status]);
  } catch (e) {
    Logger.log('Could not write to Schedule_Sync_Log: ' + e.message);
  }
}

function normalizeToYMD(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  // Match YYYY-MM-DD or YYYY/MM/DD
  let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}`;
  }
  // Match MM/DD/YYYY or M/D/YYYY
  m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    return `${m[3]}-${('0' + m[1]).slice(-2)}-${('0' + m[2]).slice(-2)}`;
  }
  return '';
}

function normalizeTimeSortable(timeVal) {
  const str = String(timeVal || '').trim();
  const m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return '00:00';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return ('0' + h).slice(-2) + ':' + min;
}

function formatDayAbbrev(dateVal) {
  const ymd = normalizeToYMD(dateVal);
  if (!ymd) return 'Sat';
  const parts = ymd.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[d.getDay()] || 'Sat';
}

function formatTime12Hr(timeVal) {
  const str = String(timeVal || '').trim();
  const m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return str || 'TBD';
  let h = parseInt(m[1], 10);
  const min = m[2];
  let ampm = (m[3] || '').toUpperCase();
  if (!ampm) {
    ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
  }
  return `${h}:${min} ${ampm}`;
}

function formatShortFieldName(fieldStr) {
  return String(fieldStr || '')
    .replace(/E154-/gi, '')
    .replace(/Lexington JHS/gi, 'LJHS')
    .replace(/Park Lexington/gi, 'Park Lex')
    .replace(/Fall \d{4}/gi, '')
    .trim();
}

function formatShortDivision(divStr) {
  const s = String(divStr || '').trim();
  const m = s.match(/(B|G)?(U\d{1,2}|\d{1,2}U)(B|G)?/i);
  if (m) return m[0].toUpperCase();
  return s;
}

function formatShortTeamName(teamStr) {
  return String(teamStr || '')
    .replace(/^E154-/i, '')
    .replace(/_\w+/g, '')
    .trim();
}

function formatWeekendBadge(dates) {
  if (!dates || dates.length === 0) return 'Upcoming Games';
  const first = dates[0].split('-');
  const last = dates[dates.length - 1].split('-');
  const m1 = parseInt(first[1], 10);
  const d1 = parseInt(first[2], 10);
  const m2 = parseInt(last[1], 10);
  const d2 = parseInt(last[2], 10);

  if (m1 === m2) {
    return `${m1}/${d1}–${d2}`;
  }
  return `${m1}/${d1}–${m2}/${d2}`;
}

function SpreadAppAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(`${title}: ${message}`);
  }
}