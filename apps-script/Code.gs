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

function doGet(e) {
  const action = e.parameter.action;
  const callback = e.parameter.callback;
  let result = {};

  if (action === 'getDirectory') {
    result = getDirectoryData();
  } else if (action === 'getTeamStats') {
    // Defined in TeamAwards.gs — wraps getTeamStatsData with the administrative
    // point buckets (pre-season referees, MatchTrak bonus, Picture Picnic Day)
    // that no QR check-in can produce.
    result = getTeamStatsWithAwards(e.parameter.teamCode);
  } else if (action === 'getSettings') {
    result = getSettingsData();
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (callback) {
    const jsonp = callback + '(' + JSON.stringify(result) + ')';
    return ContentService.createTextOutput(jsonp)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Settings');
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
      sheet.appendRow(['Key', 'Value']);
    }
    const settings = ['BoardEmail', 'RCEmail', 'RefMaxCap', 'PlayoffThreshold'];
    sheet.clearContents();
    sheet.appendRow(['Key', 'Value']);
    settings.forEach(k => {
      if (data[k] !== undefined) sheet.appendRow([k, data[k]]);
    });
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getFormSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Form Responses 1') ||
         ss.getSheetByName('Form_Responses') ||
         ss.getSheets()[0];
}

function getDirectoryData() {
  const dir = {};
  MASTER_TEAMS.forEach(rawTeam => {
    const parts = rawTeam.split(' - ');
    if (parts.length >= 3) {
      const division = (parts[0].trim() + ' - ' + parts[1].trim());
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

function getColumnMap(headerRow) {
  const map = {
    timestamp: 0,
    firstName: -1,
    lastName: -1,
    email: -1,
    role: -1,
    refTeam: -1,
    refTime: -1,
    refField: -1,
    fmTeam: -1,
    fmField: -1,
    fmTime: -1,
    setupTeam: -1,
    setupField: -1
  };

  const fieldCols = [];

  headerRow.forEach((col, idx) => {
    const h = String(col).toLowerCase().trim();
    if (h.includes('timestamp')) map.timestamp = idx;
    else if (h.includes('first name')) map.firstName = idx;
    else if (h.includes('last name')) map.lastName = idx;
    else if (h.includes('email address')) map.email = idx;
    else if (h.includes('volunteer role')) map.role = idx;
    else if (h.includes('who is the team')) map.refTeam = idx;
    else if (h.includes('game time')) map.refTime = idx;
    else if (h.includes('earning volunteer points')) map.fmTeam = idx;
    else if (h.includes('assigned field')) map.fmField = idx;
    else if (h.includes('shift start')) map.fmTime = idx;
    else if (h.includes('associated team')) map.setupTeam = idx;
    else if (h.includes('field') && !h.includes('assigned')) {
      fieldCols.push(idx);
    }
  });

  if (fieldCols.length > 0) map.refField = fieldCols[0];
  if (fieldCols.length > 1) map.setupField = fieldCols[1];

  return map;
}

function getTeamStatsData(teamCode) {
  if (!teamCode) return { totalPoints: 0, categories: {}, audit: [] };

  const formSheet = getFormSheet();

  // Official point caps from the 2026 rules flyer
  const CAP_ONFIELD_REF = 10;
  const CAP_FM = 2;
  const CAP_SETUP = 5;
  const CAP_PIC = 2;

  let refPoints = 0;
  let fmPoints = 0;
  let setupPoints = 0;
  let picPoints = 0;

  // Anti-cheat tracking collections
  const submissionFingerprints = new Set();
  const personTimeSlots = new Set();
  const teamSetupDates = new Set();

  const audit = [];

  if (formSheet && formSheet.getLastRow() > 1) {
    const data = formSheet.getDataRange().getValues();
    const headers = data[0];
    const cols = getColumnMap(headers);

    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      const timestamp = r[cols.timestamp];
      const role = String(r[cols.role] || '').trim();

      const firstName = cols.firstName !== -1 ? String(r[cols.firstName] || '').trim() : '';
      const lastName = cols.lastName !== -1 ? String(r[cols.lastName] || '').trim() : '';
      const personKey = (firstName + ' ' + lastName).toLowerCase().trim();

      let assignedTeam = '';
      let timeVal = '';
      let fieldVal = '';

      if (role === 'Referee') {
        assignedTeam = cols.refTeam !== -1 ? String(r[cols.refTeam] || '').trim() : '';
        timeVal = cols.refTime !== -1 ? String(r[cols.refTime] || '').trim() : '';
        fieldVal = cols.refField !== -1 ? String(r[cols.refField] || '').trim() : '';
      } else if (role === 'Field Marshal') {
        assignedTeam = cols.fmTeam !== -1 ? String(r[cols.fmTeam] || '').trim() : '';
        fieldVal = cols.fmField !== -1 ? String(r[cols.fmField] || '').trim() : '';
        timeVal = cols.fmTime !== -1 ? String(r[cols.fmTime] || '').trim() : '';
      } else if (role === 'Field Set Up' || role.includes('Set Up')) {
        assignedTeam = cols.setupTeam !== -1 ? String(r[cols.setupTeam] || '').trim() : '';
        fieldVal = cols.setupField !== -1 ? String(r[cols.setupField] || '').trim() : '';
      }

      if (assignedTeam !== teamCode) continue;

      let dateStr = 'Game Day';
      try {
        const d = (timestamp instanceof Date) ? timestamp : new Date(timestamp);
        if (!isNaN(d.getTime())) {
          dateStr = Utilities.formatDate(d, 'America/Los_Angeles', 'MMM d, yyyy');
        }
      } catch (err) {}

      let dutyLabel = role;
      if (fieldVal) dutyLabel += ' - ' + fieldVal;
      if (timeVal) dutyLabel += ' (' + timeVal + ')';

      const normTime = timeVal.toLowerCase().replace(/\s+/g, '');
      const normField = fieldVal.toLowerCase().trim();

      // Anti-Cheat Check 1: Exact Duplicate Submissions
      const exactKey = [personKey, role, dateStr, normTime, normField].join('|');
      if (submissionFingerprints.has(exactKey)) {
        audit.push({ duty: dutyLabel, date: dateStr, status: 'Duplicate Submission', points: 0 });
        continue;
      }
      submissionFingerprints.add(exactKey);

      // Anti-Cheat Check 2: Simultaneous Time Conflicts (Same person, same date, same time slot)
      if (normTime && (role === 'Referee' || role === 'Field Marshal')) {
        const timeSlotKey = [personKey, dateStr, normTime].join('|');
        if (personTimeSlots.has(timeSlotKey)) {
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Time Conflict', points: 0 });
          continue;
        }
        personTimeSlots.add(timeSlotKey);
      }

      // Point Evaluation & Category Caps
      if (role === 'Referee') {
        if (refPoints < CAP_ONFIELD_REF) {
          refPoints++;
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Verified', points: 1 });
        } else {
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Cap Exceeded (Max 10)', points: 0 });
        }
      } else if (role === 'Field Marshal') {
        if (fmPoints < CAP_FM) {
          fmPoints++;
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Verified', points: 1 });
        } else {
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Cap Exceeded (Max 2)', points: 0 });
        }
      } else if (role === 'Field Set Up' || role.includes('Set Up')) {
        // Daily Setup Cap: Max 1 point per team per date
        const setupDateKey = [teamCode, dateStr].join('|');
        if (teamSetupDates.has(setupDateKey)) {
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Daily Cap (1/date)', points: 0 });
        } else if (setupPoints < CAP_SETUP) {
          setupPoints++;
          teamSetupDates.add(setupDateKey);
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Verified', points: 1 });
        } else {
          audit.push({ duty: dutyLabel, date: dateStr, status: 'Cap Exceeded (Max 5)', points: 0 });
        }
      }
    }
  }

  const total = refPoints + fmPoints + setupPoints + picPoints;

  return {
    totalPoints: total,
    categories: {
      'Referee Assignment': refPoints,
      'Field Marshal Shift': fmPoints,
      'Friday Night Field Setup': setupPoints,
      'Picture Day': picPoints
    },
    audit: audit.reverse(), // Most recent submissions on top
    syncTimestamp: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy, h:mm a')
  };
}

function getSettingsData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Settings');
  const result = { BoardEmail: '', RCEmail: '', RefMaxCap: 10, PlayoffThreshold: 17 };
  if (!sheet || sheet.getLastRow() < 2) return result;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    result[data[i][0]] = data[i][1];
  }
  return result;
}
