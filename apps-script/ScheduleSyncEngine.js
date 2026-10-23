/**
 * ============================================================================
 * AYSO REGION 154 — SCHEDULE SYNC ENGINE (ScheduleSyncEngine.gs)
 * Version: build_20261021_v5 (Strict Fri–Sun Window; Excludes Thursday Outliers)
 * ============================================================================
 */

const SCHEDULE_CONFIG = {
  DRIVE_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  SCHEDULE_TAB_NAME: 'Master_Schedule',
  SEASON_SCHEDULE_TAB_NAME: 'Season_Master_Schedule',
  SYNC_LOG_TAB_NAME: 'Schedule_Sync_Log',
  TIMEZONE: 'America/Los_Angeles',
  MIN_GAMES_THRESHOLD: 5,
  UNLISTED_MATCH_OPTION: '⚠️ Other / Rescheduled / Unlisted Match'
};

/**
 * Resolves the upcoming Friday–Sunday date window (excludes Thursday outliers).
 * @return {{dates: string[], isOverride: boolean, startYMD: string}}
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
          startYMD, // Friday
          Utilities.formatDate(new Date(start.getTime() + 86400000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'),  // Saturday
          Utilities.formatDate(new Date(start.getTime() + 172800000), SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd') // Sunday
        ],
        isOverride: true,
        startYMD: startYMD
      };
    }
  }

  const now = new Date();
  const dayStr = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'u'); // 1 = Mon ... 7 = Sun
  const dayOfWeek = parseInt(dayStr, 10);

  let daysToFri = 0;
  if (dayOfWeek <= 4) daysToFri = 5 - dayOfWeek;
  else if (dayOfWeek === 5) daysToFri = 0;
  else if (dayOfWeek === 6) daysToFri = -1;
  else if (dayOfWeek === 7) daysToFri = -2;

  const nowYMD = Utilities.formatDate(now, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
  const baseMidnight = new Date(Number(nowYMD[0]), Number(nowYMD[1]) - 1, Number(nowYMD[2]));
  const fri = new Date(baseMidnight.getTime() + (daysToFri * 86400000));
  const sat = new Date(fri.getTime() + 86400000);
  const sun = new Date(fri.getTime() + 172800000);

  return {
    dates: [
      Utilities.formatDate(fri, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'), // Friday
      Utilities.formatDate(sat, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd'), // Saturday
      Utilities.formatDate(sun, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd')  // Sunday
    ],
    isOverride: false,
    startYMD: Utilities.formatDate(fri, SCHEDULE_CONFIG.TIMEZONE, 'yyyy-MM-dd')
  };
}

/**
 * Main automated/manual entry point:
 * Finds newest schedule CSV in Drive, filters to Fri–Sun only, updates Master_Schedule,
 * merges into Season_Master_Schedule, and updates live Google Form dropdown lists.
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
  fileList.sort(function(a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

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
    const prompt = `TARGET DATES (Fri–Sun Only): ${startDateLabel} to ${endDateLabel}\n` +
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

  // 1. Write filtered Fri–Sun schedule to Master_Schedule
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
 * Filters raw CSV rows so ONLY rows matching targetDates (Fri, Sat, Sun) and non-BYE fields remain.
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
 * Builds formatted dropdown strings grouped by the 3 venue dropdowns on the Game Day Form.
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

  // Sort chronologically by Date + Time + Field
  const body = filteredData.slice(1).sort(function(a, b) {
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
 * Updates the 3 venue match dropdown questions on the linked Google Form.
 */
function updateLiveFormMatchDropdowns(ss, weekendDates, parkLexMatches, lutherMatches, ljhsArnoldMatches) {
  const formUrl = ss.getFormUrl();
  if (!formUrl) {
    Logger.log('No linked Google Form found on this spreadsheet.');
    return;
  }

  const form = FormApp.openByUrl(formUrl);
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
    } else if (title.indexOf('Lexington Junior High') !== -1 || title.indexOf('LJHS') !== -1) {
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
 * Upserts filtered weekend matches into cumulative Season_Master_Schedule by Game #.
 */
function upsertSeasonMasterSchedule(ss, filteredData) {
  if (!filteredData || filteredData.length < 2) return;
  let seasonSheet = ss.getSheetByName(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
  if (!seasonSheet) {
    seasonSheet = ss.insertSheet(SCHEDULE_CONFIG.SEASON_SCHEDULE_TAB_NAME);
    seasonSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
    return;
  }

  const existing = seasonSheet.getDataRange().getValues();
  if (existing.length < 1) {
    seasonSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
    return;
  }

  const header = existing[0];
  const gameNumIdx = header.indexOf('Game #');
  if (gameNumIdx === -1) return;

  const rowMap = {};
  for (let r = 1; r < existing.length; r++) {
    const gNum = String(existing[r][gameNumIdx] || '').trim();
    if (gNum) rowMap[gNum] = r;
  }

  for (let i = 1; i < filteredData.length; i++) {
    const newRow = filteredData[i];
    const gNum = String(newRow[gameNumIdx] || '').trim();
    if (gNum && rowMap.hasOwnProperty(gNum)) {
      existing[rowMap[gNum]] = newRow;
    } else {
      existing.push(newRow);
    }
  }

  seasonSheet.clearContents();
  seasonSheet.getRange(1, 1, existing.length, existing[0].length).setValues(existing);
}

/**
 * Appends a row to Schedule_Sync_Log.
 */
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

function normalizeTimeSortable(val) {
  if (!val) return '00:00:00';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, SCHEDULE_CONFIG.TIMEZONE, 'HH:mm:ss');
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return ('0' + m[1]).slice(-2) + ':' + m[2] + ':00';
  return s;
}

function formatTime12Hr(val) {
  const norm = normalizeTimeSortable(val);
  const m = norm.match(/^(\d{2}):(\d{2})/);
  if (!m) return String(val || '');
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = hh >= 12 ? 'PM' : 'AM';
  if (hh === 0) hh = 12;
  else if (hh > 12) hh = hh - 12;
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
  const t = String(rawTeam || '').trim();
  return t.replace(/^E154-/i, '');
}

function formatWeekendBadge(dates) {
  if (!dates || dates.length === 0) return '';
  const first = dates[0].split('-');
  const last = dates[dates.length - 1].split('-');
  const dStart = new Date(Number(first[0]), Number(first[1]) - 1, Number(first[2]));
  const monthAbbrev = Utilities.formatDate(dStart, SCHEDULE_CONFIG.TIMEZONE, 'MMM');
  return `${monthAbbrev} ${parseInt(first[2], 10)}-${parseInt(last[2], 10)}`;
}