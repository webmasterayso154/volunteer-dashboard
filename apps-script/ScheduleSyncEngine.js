/**
 * ============================================================================
 * AYSO REGION 154 - PRODUCTION SCHEDULE & DRIVE INGEST ENGINE (v1.7.1)
 * ============================================================================
 * File: ScheduleSyncEngine.gs
 * Version: v1.7.1-RFC008
 * Description: Hardened production schedule engine with strict 3-venue routing,
 *              Hybrid Upcoming Weekend filtering (Fri/Sat/Sun), interactive
 *              pre-flight confirmation dialogs, headless abort thresholds,
 *              automated sheet snapshots, resilient multi-type item resolution,
 *              and non-destructive in-place dropdown updates.
 * ============================================================================
 */

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================
const CONFIG = {
  VERSION: 'v1.7.1-RFC008',
  TIMEZONE: 'America/Los_Angeles',
  PRODUCTION_SHEET_ID: '1NZpCVu0ibHHQ1huBXnjN4SHNB_ahGl998ChVVMypyCk',
  PRODUCTION_FORM_ID: '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI',
  DROP_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
  ARCHIVE_FOLDER_ID: '1F1BxAQrb7hzwUt2dSSgedUCp4u1pqV5m',
  DASHBOARD_URL: 'https://webmasterayso154.github.io/volunteer-dashboard/',
  FORM_DESCRIPTION: "🙌 Game day happens because of YOU! ⚽\nThank you for volunteering your time for our players and community today.\n\nQuick Steps for New Volunteers:\n1. Enter your name and role.\n2. Pick your field venue and select your match from the dropdown.\n3. Submit to log your points!\n\n📊 View live team points on the Volunteer Standings Dashboard: https://webmasterayso154.github.io/volunteer-dashboard/",
  CONFIRMATION_MESSAGE: "⚽ Thanks for checking in! 🙌\n\nYou can track live team standings and volunteer points on the Volunteer Dashboard here:\nhttps://webmasterayso154.github.io/volunteer-dashboard/",
  VENUE_TITLES: {
    PARK_LEX: 'Select Match - 🌲 Park Lexington (Denni & Cerritos)',
    LUTHER: 'Select Match - 🏫 Luther Elementary',
    LJHS_ARNOLD: 'Select Match - 🏫 Lexington Junior High (LJHS) or Arnold Elementary'
  },
  LUTHER_ZERO_GAMES_OPTION: '⚠️ No games currently scheduled at Luther Elementary',
  OTHER_UNLISTED_OPTION: '⚠️ Other / Rescheduled / Unlisted Match',
  MIN_GAMES_THRESHOLD: 5
};

// ============================================================================
// HYBRID UPCOMING WEEKEND RESOLVER & DATE HELPERS
// ============================================================================

/**
 * Normalizes any date string or object to YYYY-MM-DD in Pacific Time.
 */
function normalizeToYMD(rawDate) {
  if (!rawDate) return '';
  if (rawDate instanceof Date) {
    return Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  const str = String(rawDate).trim();
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    let y = slashMatch[3];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const parsed = new Date(str);
  return !isNaN(parsed.getTime()) ? Utilities.formatDate(parsed, CONFIG.TIMEZONE, 'yyyy-MM-dd') : '';
}

/**
 * Resolves the 3-day weekend window (Fri, Sat, Sun). Checks Admin_Config
 * for 'TargetWeekendStart' override, otherwise computes rolling upcoming weekend.
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
      const start = new Date(parts[0], parts[1] - 1, parts[2]);
      const d1 = startYMD;
      const d2 = Utilities.formatDate(new Date(start.getTime() + 86400000), CONFIG.TIMEZONE, 'yyyy-MM-dd');
      const d3 = Utilities.formatDate(new Date(start.getTime() + 172800000), CONFIG.TIMEZONE, 'yyyy-MM-dd');
      return { dates: [d1, d2, d3], isOverride: true, startYMD: d1 };
    }
  }

  const now = new Date();
  const dayStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'u'); // 1=Mon .. 7=Sun
  const dayOfWeek = parseInt(dayStr, 10);

  let daysToFri = 0;
  if (dayOfWeek <= 4) daysToFri = 5 - dayOfWeek;
  else if (dayOfWeek === 5) daysToFri = 0;
  else if (dayOfWeek === 6) daysToFri = -1;
  else if (dayOfWeek === 7) daysToFri = -2;

  const nowYMD = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
  const baseMidnight = new Date(nowYMD[0], nowYMD[1] - 1, nowYMD[2]);
  const fri = new Date(baseMidnight.getTime() + (daysToFri * 86400000));
  const sat = new Date(fri.getTime() + 86400000);
  const sun = new Date(fri.getTime() + 172800000);

  return {
    dates: [
      Utilities.formatDate(fri, CONFIG.TIMEZONE, 'yyyy-MM-dd'),
      Utilities.formatDate(sat, CONFIG.TIMEZONE, 'yyyy-MM-dd'),
      Utilities.formatDate(sun, CONFIG.TIMEZONE, 'yyyy-MM-dd')
    ],
    isOverride: false,
    startYMD: Utilities.formatDate(fri, CONFIG.TIMEZONE, 'yyyy-MM-dd')
  };
}

/**
 * Filters parsed rows to only include matches on the target Friday, Saturday, and Sunday.
 */
function filterScheduleForTargetWeekend(parsedData, targetDates) {
  if (!parsedData || parsedData.length <= 1) return [];
  const headers = parsedData[0];
  const dateIdx = headers.findIndex(h => /date|day/i.test(String(h || '')));
  if (dateIdx === -1) return parsedData;

  const targetSet = new Set(targetDates);
  const filtered = [headers];

  for (let i = 1; i < parsedData.length; i++) {
    const row = parsedData[i];
    if (!row || row.length === 0) continue;
    const ymd = normalizeToYMD(row[dateIdx]);
    if (targetSet.has(ymd)) {
      filtered.push(row);
    }
  }
  return filtered;
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

function formatDay(rawDate) {
  if (!rawDate) return '';
  if (typeof Utilities !== 'undefined') {
    if (rawDate instanceof Date) return Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'EEE');
    const parsed = new Date(String(rawDate));
    if (!isNaN(parsed.getTime())) return Utilities.formatDate(parsed, CONFIG.TIMEZONE, 'EEE');
  }
  const str = String(rawDate).trim();
  if (/^sat/i.test(str)) return 'Sat';
  if (/^sun/i.test(str)) return 'Sun';
  if (/^fri/i.test(str)) return 'Fri';
  return str;
}

function formatTime(rawTime) {
  if (!rawTime) return '';
  if (typeof Utilities !== 'undefined' && rawTime instanceof Date) {
    return Utilities.formatDate(rawTime, CONFIG.TIMEZONE, 'h:mm a');
  }
  let timeStr = String(rawTime || '').trim();
  const milMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (milMatch) {
    let hour = parseInt(milMatch[1], 10);
    const min = milMatch[2];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;
    return `${hour}:${min} ${ampm}`;
  }
  timeStr = timeStr.replace(/(\d{1,2}:\d{2}):\d{2}/, '$1');
  return timeStr.replace(/\s*([AaPp][Mm])/, ' $1').toUpperCase();
}

function formatField(rawField) {
  if (!rawField) return '';
  const f = String(rawField).trim();
  if (/luther/i.test(f)) {
    const m = f.match(/field\s*#?\s*(\d+)/i);
    return m ? `Luther Field ${m[1]}` : 'Luther Field';
  }
  if (/park lex/i.test(f) || /denni/i.test(f)) {
    if (/turf/i.test(f) || /art/i.test(f)) return 'Park Lex Turf';
    if (/grass/i.test(f)) return 'Park Lex Grass';
    return 'Park Lex';
  }
  if (/lexington|ljhs/i.test(f)) {
    const m = f.match(/field\s*#?\s*(\d+)/i);
    return m ? `LJHS Field ${m[1]}` : 'LJHS';
  }
  if (/arnold/i.test(f)) {
    const m = f.match(/field\s*#?\s*(\d+)/i);
    return m ? `Arnold Field ${m[1]}` : 'Arnold';
  }
  return f;
}

function formatDivision(rawDiv) {
  if (!rawDiv) return '';
  const d = String(rawDiv).trim();
  let m = d.match(/^([BGbg])(?:U|u)?(\d{1,2})/);
  if (m) return `${m[2].padStart(2, '0')}U-${m[1].toUpperCase()}`;
  m = d.match(/^(\d{1,2})(?:U|u)?\s*([BGbg])/);
  if (m) return `${m[1].padStart(2, '0')}U-${m[2].toUpperCase()}`;
  m = d.match(/^(\d{1,2})UX\s*([BGbg])/i);
  if (m) return `${m[1].padStart(2, '0')}UX-${m[2].toUpperCase()}`;
  return d;
}

function formatTeam(rawTeam) {
  if (!rawTeam) return '';
  let t = String(rawTeam).trim();
  t = t.replace(/^\d+[-_]/, '');
  return t.replace(/^E154[-_]/i, '').trim();
}

function getVenueCategory(rawField) {
  if (!rawField) return 'LJHS_ARNOLD';
  const f = String(rawField).trim().toLowerCase();
  if (f.includes('park lex') || f.includes('denni') || f.includes('cerritos')) return 'PARK_LEX';
  if (f.includes('luther')) return 'LUTHER';
  return 'LJHS_ARNOLD';
}

function buildScheduleDropdownOptionsByVenue(scheduleData) {
  if (!scheduleData || scheduleData.length <= 1) {
    return {
      parkLexMatches: [CONFIG.OTHER_UNLISTED_OPTION],
      lutherMatches: [CONFIG.LUTHER_ZERO_GAMES_OPTION, CONFIG.OTHER_UNLISTED_OPTION],
      ljhsArnoldMatches: [CONFIG.OTHER_UNLISTED_OPTION]
    };
  }

  const headers = scheduleData[0].map(h => String(h || '').trim());
  const dateIdx = headers.findIndex(h => /date|day/i.test(h));
  const timeIdx = headers.findIndex(h => /^time$/i.test(h) || /game time/i.test(h) || (/time/i.test(h) && !/date/i.test(h)));
  const fieldIdx = headers.findIndex(h => /field/i.test(h));
  const divIdx = headers.findIndex(h => /div/i.test(h));
  const homeIdx = headers.findIndex(h => /home/i.test(h));
  const awayIdx = headers.findIndex(h => /away/i.test(h));

  const rawPark = [];
  const rawLuther = [];
  const rawLjhs = [];

  for (let i = 1; i < scheduleData.length; i++) {
    const row = scheduleData[i];
    if (!row || row.length === 0) continue;

    const timeStr = formatTime(timeIdx !== -1 ? row[timeIdx] : '');
    const fieldStr = formatField(fieldIdx !== -1 ? row[fieldIdx] : '');
    if (!timeStr || !fieldStr || timeStr.includes('###')) continue;

    const dayStr = formatDay(dateIdx !== -1 ? row[dateIdx] : '');
    const divStr = formatDivision(divIdx !== -1 ? row[divIdx] : '');
    const homeStr = formatTeam(homeIdx !== -1 ? row[homeIdx] : '');
    const awayStr = formatTeam(awayIdx !== -1 ? row[awayIdx] : '');

    const matchup = (homeStr && awayStr) ? `${homeStr} vs ${awayStr}` : (homeStr || awayStr);
    const dayPrefix = dayStr ? `🗓️ ${dayStr} • ` : '';
    const divPrefix = divStr ? ` • ⚽ ${divStr}: ` : ' • ⚽ ';
    const matchString = `${dayPrefix}⏰ ${timeStr} • 📍 ${fieldStr}${divPrefix}${matchup}`.trim();

    const venue = getVenueCategory(fieldIdx !== -1 ? row[fieldIdx] : '');
    if (venue === 'PARK_LEX') rawPark.push(matchString);
    else if (venue === 'LUTHER') rawLuther.push(matchString);
    else rawLjhs.push(matchString);
  }

  const parkLexMatches = [...new Set(rawPark)];
  const lutherMatches = [...new Set(rawLuther)];
  const ljhsArnoldMatches = [...new Set(rawLjhs)];

  if (lutherMatches.length === 0) lutherMatches.push(CONFIG.LUTHER_ZERO_GAMES_OPTION);
  parkLexMatches.push(CONFIG.OTHER_UNLISTED_OPTION);
  lutherMatches.push(CONFIG.OTHER_UNLISTED_OPTION);
  ljhsArnoldMatches.push(CONFIG.OTHER_UNLISTED_OPTION);

  return {
    parkLexMatches: [...new Set(parkLexMatches)],
    lutherMatches: [...new Set(lutherMatches)],
    ljhsArnoldMatches: [...new Set(ljhsArnoldMatches)]
  };
}

function extractDataFromFile(file) {
  const mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_SHEETS || mime === 'application/vnd.google-apps.spreadsheet') {
    const ss = SpreadsheetApp.openById(file.getId());
    const sheet = ss.getSheets()[0];
    const range = sheet.getDataRange();
    return (typeof range.getDisplayValues === 'function') ? range.getDisplayValues() : range.getValues();
  }
  const blob = file.getBlob();
  const content = blob.getDataAsString('UTF-8') || blob.getDataAsString();
  if (!content || !content.trim()) throw new Error(`File "${file.getName()}" is empty.`);
  return Utilities.parseCsv(content);
}

// ============================================================================
// CORE SYNCHRONIZATION PIPELINE (NON-DESTRUCTIVE & RESILIENT)
// ============================================================================

/**
 * Updates dropdown choices directly inside Sections 3, 4, and 5.
 * Scans all form items with fuzzy matching across multiple item types
 * to avoid false-negative missing item aborts.
 */
function syncContainerFormSchedule(optionalScheduleData) {
  const form = FormApp.openById(CONFIG.PRODUCTION_FORM_ID);
  let data = optionalScheduleData;

  if (!data) {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION_SHEET_ID);
    const sheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');
    if (!sheet) throw new Error("Could not find 'Master Schedule' tab.");
    data = sheet.getDataRange().getDisplayValues();
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(data);

  // Scan all items to find venue placeholders regardless of specific visual type
  const allItems = form.getItems();
  let ljhsItem = null;
  let parkLexItem = null;
  let lutherItem = null;

  allItems.forEach(item => {
    const title = item.getTitle().toLowerCase();
    const type = item.getType();
    const isChoiceType = (type === FormApp.ItemType.LIST || 
                          type === FormApp.ItemType.MULTIPLE_CHOICE || 
                          type === FormApp.ItemType.CHECKBOX);

    if (isChoiceType) {
      if ((title.includes('lexington') || title.includes('arnold')) && !title.includes('park')) {
        ljhsItem = item;
      } else if (title.includes('park lex') || title.includes('denni') || title.includes('cerritos')) {
        parkLexItem = item;
      } else if (title.includes('luther')) {
        lutherItem = item;
      }
    }
  });

  if (!ljhsItem || !parkLexItem || !lutherItem) {
    const missing = [];
    if (!ljhsItem) missing.push("LJHS/Arnold");
    if (!parkLexItem) missing.push("Park Lexington");
    if (!lutherItem) missing.push("Luther");
    throw new Error(`Missing venue target(s): [${missing.join(', ')}]. Check item titles in Sections 3, 4, or 5.`);
  }

  // Update choice values in place
  const applyChoices = (targetItem, choices) => {
    if (targetItem.getType() === FormApp.ItemType.LIST) {
      targetItem.asListItem().setChoiceValues(choices);
    } else if (targetItem.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      targetItem.asMultipleChoiceItem().setChoiceValues(choices);
    } else if (targetItem.getType() === FormApp.ItemType.CHECKBOX) {
      targetItem.asCheckboxItem().setChoiceValues(choices);
    }
  };

  applyChoices(ljhsItem, ljhsArnoldMatches);
  applyChoices(parkLexItem, parkLexMatches);
  applyChoices(lutherItem, lutherMatches);

  // Lock UI metadata and reopen form
  form.setDescription(CONFIG.FORM_DESCRIPTION);
  form.setConfirmationMessage(CONFIG.CONFIRMATION_MESSAGE);
  form.setAcceptingResponses(true);

  Logger.log(`✅ Dropdowns updated in-place: LJHS (${ljhsArnoldMatches.length}), Park Lex (${parkLexMatches.length}), Luther (${lutherMatches.length})`);
}

/**
 * Main ingestion workflow with pre-flight interactive warning for manual runs
 * and automated threshold guard for background runs.
 */
function autoIngestWeeklySchedule() {
  const weekendWindow = resolveUpcomingWeekendDates();
  Logger.log(`Target Weekend Window: ${weekendWindow.dates.join(', ')} (Override: ${weekendWindow.isOverride})`);

  const dropFolder = DriveApp.getFolderById(CONFIG.DROP_FOLDER_ID);
  const archiveFolder = DriveApp.getFolderById(CONFIG.ARCHIVE_FOLDER_ID);
  const fileIter = dropFolder.getFiles();
  const fileList = [];
  while (fileIter.hasNext()) fileList.push(fileIter.next());

  if (fileList.length === 0) {
    Logger.log("No files in drop folder. Running form sync from existing Master Schedule.");
    syncContainerFormSchedule();
    return;
  }

  fileList.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
  const latestFile = fileList[0];
  const parsedRaw = extractDataFromFile(latestFile);
  const filteredData = filterScheduleForTargetWeekend(parsedRaw, weekendWindow.dates);
  const totalMatches = filteredData.length - 1;

  if (totalMatches < CONFIG.MIN_GAMES_THRESHOLD) {
    const msg = `ABORTED: Found only ${totalMatches} games for weekend ${weekendWindow.dates.join(', ')}. Minimum threshold is ${CONFIG.MIN_GAMES_THRESHOLD}. Check date format or Drop folder.`;
    Logger.log(msg);
    try {
      SpreadsheetApp.getUi().alert('Sync Aborted: Low Match Count', msg, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {}
    return;
  }

  const { parkLexMatches, lutherMatches, ljhsArnoldMatches } = buildScheduleDropdownOptionsByVenue(filteredData);

  // Interactive Pre-Flight Confirmation for manual sheet runs
  try {
    const ui = SpreadsheetApp.getUi();
    const prompt = `TARGET WEEKEND: ${weekendWindow.dates[0]} to ${weekendWindow.dates[2]}\n` +
                   `SOURCE FILE: ${latestFile.getName()}\n\n` +
                   `MATCHES IDENTIFIED (${totalMatches} total):\n` +
                   `• 🌲 Park Lexington: ${parkLexMatches.length - 1}\n` +
                   `• 🏫 Luther Elementary: ${lutherMatches.length - 1}\n` +
                   `• 🏫 LJHS / Arnold: ${ljhsArnoldMatches.length - 1}\n\n` +
                   `⚠️ Overwrite "Master Schedule" and update live Form dropdowns?`;
    const res = ui.alert('Confirm Live Game Day Sync', prompt, ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) {
      Logger.log("Sync canceled by user.");
      return;
    }
  } catch (headless) {}

  const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION_SHEET_ID);
  let scheduleSheet = ss.getSheetByName('Master Schedule') || ss.getSheetByName('Master_Schedule');

  // Backup snapshot
  const tag = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  if (scheduleSheet && scheduleSheet.getLastRow() > 1) {
    try {
      const bkp = scheduleSheet.copyTo(ss);
      bkp.setName(`Master_Schedule_Backup_${tag}`);
    } catch (err) {}
  } else if (!scheduleSheet) {
    scheduleSheet = ss.insertSheet('Master Schedule');
  }

  scheduleSheet.clearContents();
  scheduleSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);

  // In-place dropdown sync
  syncContainerFormSchedule(filteredData);

  // Log to Schedule_Sync_Log
  let logSheet = ss.getSheetByName('Schedule_Sync_Log') || ss.insertSheet('Schedule_Sync_Log');
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['Timestamp', 'Source File', 'Weekend Start', 'Total Rows', 'Park Lex', 'Luther', 'LJHS/Arnold', 'Status']);
  }
  logSheet.appendRow([
    Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    latestFile.getName(),
    weekendWindow.dates[0],
    totalMatches,
    parkLexMatches.length - 1,
    lutherMatches.length - 1,
    ljhsArnoldMatches.length - 1,
    'SUCCESS'
  ]);

  try { latestFile.moveTo(archiveFolder); } catch (e) {}
  Logger.log("🏆 AUTO INGEST & FORM SYNC COMPLETED SUCCESSFULLY.");
}

// ============================================================================
// NODE.JS TEST EXPORTS
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG,
    buildScheduleDropdownOptionsByVenue,
    formatDay,
    formatTime,
    formatField,
    formatDivision,
    formatTeam,
    getVenueCategory,
    extractDataFromFile,
    resolveUpcomingWeekendDates,
    filterScheduleForTargetWeekend,
    autoIngestWeeklySchedule,
    syncContainerFormSchedule
  };
}