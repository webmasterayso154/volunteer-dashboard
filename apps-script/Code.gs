/**
 * AYSO Region 154 - Volunteer Standings Backend
 * Anti-Cheat, Deduplication & Official 2026 Point Capping Logic
 */

const MASTER_TEAMS = [
  "Playground - Playground",
  "05U - Boys - Stefan Colvey", "05U - Boys - Casey Harpham", "05U - Boys - Ryan Loza", "05U - Boys - Ankit Vasa", "05U - Boys - Greg Weber",
  "05U - Girls - Priscilla Alvardo", "05U - Girls - Tim Bouahom", "05U - Girls - Ramzi Nasr", "05U - Girls - Saul Ruiz",
  "06U - Boys - Jessica Campuzano", "06U - Boys - Alber Eskander", "06U - Boys - James Fahrny", "06U - Boys - Ryan Fox", "06U - Boys - Chris Gshweng", "06U - Boys - Deanna Hartman", "06U - Boys - Jessica Matal", "06U - Boys - Amira Medina", "06U - Boys - Brennen Portalski",
  "06U - Girls - Diana Baik", "06U - Girls - Suresh Dangeti", "06U - Girls - Cobi Ferriro", "06U - Girls - Joseph Frontino", "06U - Girls - Kendall Klein", "06U - Girls - Andrea Lopez", "06U - Girls - Matt Olsen", "06U - Girls - Breanna Pena", "06U - Girls - Jeremy Vreeland",
  "08U - Boys - Raushanah Ali", "08U - Boys - Raumin Benjamin", "08U - Boys - Bryce Burnett", "08U - Boys - Dan Carmichael", "08U - Boys - Natasha Dressler", "08U - Boys - Arielle Garcia", "08U - Boys - Casey Harpham", "08U - Boys - Jeffrey Hosler", "08U - Boys - Matthew Kamada", "08U - Boys - Christina Kinne", "08U - Boys - Jorge Marquez", "08U - Boys - Victor Perez", "08U - Boys - Juan Rodriguez", "08U - Boys - Roberto Rojas", "08U - Boys - Veronica Ruiz", "08U - Boys - Amanda Towers", "08U - Boys - Fernando Vega",
  "08U - Girls - Samuel Alvarez", "08U - Girls - Krissy Barone", "08U - Girls - Michael Burke", "08U - Girls - Meghan Codipilly", "08U - Girls - Anukool Gandhi", "08U - Girls - Abraham Gomez", "08U - Girls - Mark Hernandez", "08U - Girls - Nathan Silva", "08U - Girls - Crystal Van Maanen", "08U - Girls - Adrian Yeung",
  "9UX - Boys - Chris Franco", "9UX - Girls - Kevin Yonemoto",
  "10U - Boys - Faheem Armanyous", "10U - Boys - Dustin Brieger", "10U - Boys - Ryan Bulatao", "10U - Boys - Andrew Evango", "10U - Boys - Harold Huang", "10U - Boys - Jeff Klaus", "10U - Boys - Jace Leicht", "10U - Boys - Michael Lewis", "10U - Boys - Leonardo Limon", "10U - Boys - Ryan Loza", "10U - Boys - Mark Mancilla", "10U - Boys - Long Nguyen", "10U - Boys - Stephanie Orozco", "10U - Boys - Trevor Richardson", "10U - Boys - Javier Zambrano", "10U - Boys - Tariq Zidan",
  "10UX - Boys - Paul Cuthbert",
  "10U - Girls - Dawn Caires", "10U - Girls - David Corado", "10U - Girls - Josie Cotton", "10U - Girls - Fekadu Debebe", "10U - Girls - Alexander Olmos", "10U - Girls - Matt Olsen", "10U - Girls - Tomer Otor", "10U - Girls - Brennen Poralski", "10U - Girls - Andrew Yeung",
  "10UX - Girls - Sam Humphery",
  "11UX - Girls - Jon Tarian",
  "12U - Boys - Mina Abader", "12U - Boys - Jonathan Flores", "12U - Boys - Isaiah Hicks", "12U - Boys - Terri Mackay", "12U - Boys - Jorge Marquez", "12U - Boys - Allegra Martin", "12U - Boys - Amira Medina", "12U - Boys - Chris Munoz", "12U - Boys - Lucky Relator", "12U - Boys - Lawrence Tam", "12U - Boys - Hector Vargas",
  "12UX - Boys - Ignacio Brache",
  "12U - Girls - Saul Alvarez", "12U - Girls - David Corado", "12U - Girls - Carlos Cruz", "12U - Girls - Fernando Huerta", "12U - Girls - Justin Rast",
  "12UX - Girls - Jessica Ortega",
  "13UX - Boys - Jessica Husami",
  "14U - Boys - Mina Abader", "14U - Boys - Allegra Martin", "14U - Boys - Ernie Solano", "14U - Boys - Jodie Thomas",
  "14UX - Boys - Christian Villalobos",
  "14U - Girls - Jeff Dronkers", "14U - Girls - Pablo Peregrina",
  "14UX - Girls - Ben Wysocki",
  "16U - Boys - Bruce Conze", "16U - Girls - Miguel Hernandez",
  "19U - Boys - Jennifer Deselm", "19U - Girls - Josh Palafox"
];

// Lexington Jr. High School 10-Field Configuration
const LJHS_FIELDS = [
  "LJHS - Field #1", "LJHS - Field #2", "LJHS - Field #3", // U5/U6
  "LJHS - Field #4", "LJHS - Field #5", "LJHS - Field #6", // U8
  "LJHS - Field #7", "LJHS - Field #8",                   // 10U
  "LJHS - Field #9", "LJHS - Field #10"                   // 12U (North / Arnold Lawn)
];

const CAP_ONFIELD_REF = 10;
const CAP_FIELD_MARSHAL = 2;
const CAP_SETUP = 5;
const CAP_PIC = 2;

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action;
  const callback = params.callback;
  let result = null;

  if (action === 'getDirectory') {
    result = getDirectoryData();
  } else if (action === 'getTeamStats') {
    const teamCode = params.teamCode;
    if (typeof getTeamStatsWithAwards === 'function') {
      result = getTeamStatsWithAwards(teamCode);
    } else {
      result = getTeamStatsData(teamCode);
    }
  } else if (action === 'getSettings') {
    result = getSettingsData();
  } else {
    result = { error: 'Invalid action parameter' };
  }

  const jsonStr = JSON.stringify(result);

  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonStr + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    return ContentService.createTextOutput(jsonStr)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Settings');
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
      sheet.appendRow(['Key', 'Value']);
    }
    const payload = JSON.parse(e.postData.contents);
    const data = sheet.getDataRange().getValues();
    const existingKeys = {};
    for (let i = 1; i < data.length; i++) {
      existingKeys[data[i][0]] = i + 1;
    }

    for (const [k, v] of Object.entries(payload)) {
      if (existingKeys[k]) {
        sheet.getRange(existingKeys[k], 2).setValue(v);
      } else {
        sheet.appendRow([k, v]);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getDirectoryData() {
  const dir = {};
  MASTER_TEAMS.forEach(rawTeam => {
    const parts = rawTeam.split(' - ');
    if (parts.length >= 3) {
      const division = parts[0].trim() + ' - ' + parts[1].trim();
      const coach = parts.slice(2).join(' - ').trim();
      if (!dir[division]) dir[division] = [];
      dir[division].push({ teamCode: rawTeam, coach: coach });
    } else {
      const division = parts[0].trim();
      if (!dir[division]) dir[division] = [];
      dir[division].push({ teamCode: rawTeam, coach: rawTeam });
    }
  });
  return {
    directory: dir,
    syncTimestamp: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a')
  };
}

function getTeamStatsData(targetTeam) {
  const nowStr = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a');

  const baseResult = {
    totalPoints: 0,
    categories: {
      'Referee Assignment': 0,
      'Field Marshal Shift': 0,
      'Friday Night Field Setup': 0,
      'Picture Day': 0
    },
    audit: [],
    syncTimestamp: nowStr
  };

  // Guard: Empty or missing team codes must immediately evaluate to 0
  if (!targetTeam || typeof targetTeam !== 'string' || !targetTeam.trim()) {
    return baseResult;
  }
  const cleanTarget = targetTeam.trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Form Responses 1');
  if (!sheet || sheet.getLastRow() < 2) return baseResult;

  const rows = sheet.getDataRange().getValues();
  let refPoints = 0;
  let fmPoints = 0;
  let setupPoints = 0;
  let picPoints = 0;
  const audit = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    const dateStr = (timestamp instanceof Date)
      ? Utilities.formatDate(timestamp, 'America/Los_Angeles', 'MMM d, yyyy')
      : String(timestamp).slice(0, 10);

    const dutyRaw = String(row[3] || '').trim();
    const rowTeamRef = String(row[5] || '').trim();
    const rowTeamFm = String(row[8] || '').trim();
    const rowTeamSetup = String(row[11] || '').trim();

    let isMatch = false;
    let category = '';
    let status = 'Verified';
    let pts = 0;

    if (rowTeamRef === cleanTarget || (/ref/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Referee Assignment';
      if (refPoints < CAP_ONFIELD_REF) {
        refPoints++;
        pts = 1;
        status = 'Verified';
      } else {
        status = 'Cap Reached';
        pts = 0;
      }
    } else if (rowTeamFm === cleanTarget || (/marshal/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Field Marshal Shift';
      if (fmPoints < CAP_FIELD_MARSHAL) {
        fmPoints++;
        pts = 1;
        status = 'Verified';
      } else {
        status = 'Cap Reached';
        pts = 0;
      }
    } else if (rowTeamSetup === cleanTarget || (/set\s*up/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Friday Night Field Setup';
      if (setupPoints < CAP_SETUP) {
        setupPoints++;
        pts = 1;
        status = 'Verified';
      } else {
        status = 'Cap Reached';
        pts = 0;
      }
    } else if (/picture/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1) {
      isMatch = true;
      category = 'Picture Day';
      if (picPoints < CAP_PIC) {
        picPoints++;
        pts = 1;
        status = 'Verified';
      } else {
        status = 'Cap Reached';
        pts = 0;
      }
    }

    if (isMatch) {
      audit.push({
        duty: category,
        date: dateStr,
        status: status,
        points: pts
      });
    }
  }

  baseResult.totalPoints = refPoints + fmPoints + setupPoints + picPoints;
  baseResult.categories['Referee Assignment'] = refPoints;
  baseResult.categories['Field Marshal Shift'] = fmPoints;
  baseResult.categories['Friday Night Field Setup'] = setupPoints;
  baseResult.categories['Picture Day'] = picPoints;
  baseResult.audit = audit.reverse();

  return baseResult;
}

function getSettingsData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Settings');
  const result = { BoardEmail: '', RCEmail: '', RefMaxCap: 10, PlayoffThreshold: 17 };
  if (!sheet || sheet.getLastRow() < 2) return result;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      result[data[i][0]] = data[i][1];
    }
  }
  return result;
}