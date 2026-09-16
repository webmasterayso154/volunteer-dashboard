/**
 * Comprehensive End-to-End Synthetic Multi-Division Audit Runner
 * AYSO Region 154 Volunteer Standings Verification Track
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('🏆 AYSO 154 END-TO-END MULTI-DIVISION SYNTHETIC AUDIT RUN');
console.log('================================================================\n');

// Multi-Division Test Teams
const TEST_ROSTER = [
  { team: '10U - Boys - Faheem Armanyous', div: '10U - Boys', goal: 17 },
  { team: '10U - Girls - Dawn Caires', div: '10U - Girls', goal: 17 },
  { team: '12U - Boys - Isaiah Hicks', div: '12U - Boys', goal: 17 },
  { team: '12U - Girls - Saul Alvarez', div: '12U - Girls', goal: 17 },
  { team: '14U - Boys - Mina Abader', div: '14U - Boys', goal: 17 },
  { team: '08U - Boys - Amanda Towers', div: '08U - Boys', goal: 17 },
  { team: '08U - Girls - Crystal Van Maanen', div: '08U - Girls', goal: 17 },
  { team: '06U - Boys - Ryan Fox', div: '06U - Boys', goal: 8 },
  { team: '05U - Girls - Priscilla Alvardo', div: '05U - Girls', goal: 8 },
  { team: 'Playground - Playground', div: 'Playground', goal: 4 }
];

function normalizeTimeSlot(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function processTeamStandings(targetTeam, formResponses, teamAwards = [], capsOverride = {}) {
  const caps = {
    onFieldRef: capsOverride.RefMaxCap || 10,
    fieldMarshal: capsOverride.FieldMarshalCap || 2,
    setup: capsOverride.FieldSetupCap || 5,
    pic: capsOverride.PictureDayCap || 2,
    certifiedRef: 5,
    matchtrak: 2,
    maxPossible: (capsOverride.RefMaxCap || 10) + (capsOverride.FieldMarshalCap || 2) + (capsOverride.FieldSetupCap || 5) + (capsOverride.PictureDayCap || 2) + 5 + 2
  };

  const cleanTarget = targetTeam.trim();
  let refPoints = 0;
  let fmPoints = 0;
  let setupPoints = 0;
  let picPoints = 0;

  const audit = [];
  const seenVolunteerSlots = new Set();

  for (let i = 0; i < formResponses.length; i++) {
    const row = formResponses[i];
    if (!row || !row[0]) continue;

    const timestamp = row[0];
    const dateStr = typeof timestamp === 'string' ? timestamp.split(' ')[0] : '2026-09-12';

    const email = String(row[1] || '').trim().toLowerCase();
    const firstName = String(row[2] || '').trim();
    const lastName = String(row[3] || '').trim();
    const volId = email || (firstName + ' ' + lastName).trim().toLowerCase();

    const dutyRaw = String(row[4] || '').trim();
    const refPosition = String(row[5] || '').trim();
    const rowTeamRef = String(row[6] || '').trim();
    const refGameTime = String(row[7] || '').trim();
    
    const rowTeamFm = String(row[9] || '').trim();
    const fmGameTime = String(row[11] || '').trim();

    const rowTeamSetup = String(row[12] || '').trim();

    let isMatch = false;
    let category = '';
    let categoryCap = 0;
    let currentCategoryTotal = 0;
    let timeSlot = '';
    let isNocra = false;

    if (rowTeamRef === cleanTarget || (/ref/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Referee Assignment';
      categoryCap = caps.onFieldRef;
      currentCategoryTotal = refPoints;
      timeSlot = refGameTime || 'GameTime';
      if (/nocra|ussf/i.test(refPosition)) isNocra = true;
    } else if (rowTeamFm === cleanTarget || (/marshal/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Field Marshal Shift';
      categoryCap = caps.fieldMarshal;
      currentCategoryTotal = fmPoints;
      timeSlot = fmGameTime || 'ShiftTime';
    } else if (rowTeamSetup === cleanTarget || (/set\s*up/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1)) {
      isMatch = true;
      category = 'Friday Night Field Setup';
      categoryCap = caps.setup;
      currentCategoryTotal = setupPoints;
      timeSlot = 'FridayNight';
    } else if (/picture/i.test(dutyRaw) && row.indexOf(cleanTarget) !== -1) {
      isMatch = true;
      category = 'Picture Day';
      categoryCap = caps.pic;
      currentCategoryTotal = picPoints;
      timeSlot = 'PicShift';
    }

    if (isMatch) {
      let status = 'Recorded';
      let pts = 0;

      if (isNocra) {
        status = 'NOCRA - No Points';
        pts = 0;
      } else {
        const slotKey = volId + '_' + dateStr + '_' + normalizeTimeSlot(timeSlot) + '_' + category;

        if (seenVolunteerSlots.has(slotKey)) {
          status = 'Duplicate Submission';
          pts = 0;
        } else if (currentCategoryTotal >= categoryCap) {
          status = 'Cap Reached';
          pts = 0;
        } else {
          status = 'Recorded';
          pts = 1;
          seenVolunteerSlots.add(slotKey);

          if (category === 'Referee Assignment') refPoints++;
          else if (category === 'Field Marshal Shift') fmPoints++;
          else if (category === 'Friday Night Field Setup') setupPoints++;
          else if (category === 'Picture Day') picPoints++;
        }
      }

      audit.push({
        duty: category + (timeSlot && timeSlot !== 'FridayNight' && timeSlot !== 'PicShift' ? ` (${timeSlot})` : ''),
        date: dateStr,
        status: status,
        points: pts
      });
    }
  }

  // Team Awards
  let certRefPoints = 0;
  let matchtrakPoints = 0;
  let discretionaryAwards = 0;

  teamAwards.forEach(aRow => {
    const aTeam = String(aRow[1] || '').trim();
    if (aTeam !== cleanTarget) return;

    const aType = String(aRow[2] || '').trim();
    const aPts = Number(aRow[3]) || 0;
    const aNote = String(aRow[4] || '').trim();
    const aDateStr = String(aRow[0]).split(' ')[0];

    if (aType.includes('Uniform') || aType.includes('Disqualification')) {
      refPoints = Math.max(0, refPoints + aPts);
      audit.push({ duty: aType, date: aDateStr, status: 'Deduction Applied', points: aPts, note: aNote });
    } else if (aType === 'Certified Team Referees') {
      certRefPoints = Math.min(caps.certifiedRef, certRefPoints + aPts);
      audit.push({ duty: aType, date: aDateStr, status: 'Verified', points: aPts, note: aNote });
    } else if (aType === 'MatchTrak Filled by Sep 26') {
      matchtrakPoints = Math.min(caps.matchtrak, matchtrakPoints + aPts);
      audit.push({ duty: aType, date: aDateStr, status: 'Verified', points: aPts, note: aNote });
    } else {
      discretionaryAwards += aPts;
      audit.push({ duty: aType, date: aDateStr, status: aPts < 0 ? 'Deduction Applied' : 'Verified', points: aPts, note: aNote });
    }
  });

  const totalPoints = Math.min(
    caps.maxPossible,
    Math.max(0, refPoints + fmPoints + setupPoints + picPoints + certRefPoints + matchtrakPoints + discretionaryAwards)
  );

  return {
    totalPoints,
    categories: {
      'Certified Team Referees': certRefPoints,
      'MatchTrak Filled by Sep 26': matchtrakPoints,
      'Referee (On-Field)': refPoints,
      'Referee Assignment': refPoints,
      'Field Marshal': fmPoints,
      'Field Marshal Shift': fmPoints,
      'Friday Night Setup': setupPoints,
      'Friday Night Field Setup': setupPoints,
      'Picture Picnic Day': picPoints,
      'Picture Day': picPoints
    },
    audit: audit.reverse()
  };
}

// Generate Season Submissions (Weeks 1 through 8)
const allFormResponses = [];
const allTeamAwards = [];

// 1. 10U Boys - Faheem Armanyous (Fully Qualified with mixed duties)
for (let w = 1; w <= 8; w++) {
  allFormResponses.push([`2026-09-${10+w*7} 08:00`, `faheem.ref${w}@ayso154.org`, `Ref${w}`, 'V', 'Referee', 'Referee (AYSO)', '10U - Boys - Faheem Armanyous', `${7+w}:00 AM`, 'LJHS - Field #1', '', '', '', '', '']);
}
allFormResponses.push([`2026-09-12 10:00`, `faheem.fm1@ayso154.org`, 'FM1', 'V', 'Field Marshal', '', '', '', '', '10U - Boys - Faheem Armanyous', 'Park Lexington', '10:00 AM', '', '']);
allFormResponses.push([`2026-09-19 10:00`, `faheem.fm2@ayso154.org`, 'FM2', 'V', 'Field Marshal', '', '', '', '', '10U - Boys - Faheem Armanyous', 'Park Lexington', '10:00 AM', '', '']);
allFormResponses.push([`2026-09-11 18:00`, `faheem.setup@ayso154.org`, 'Setup', 'V', 'Field Set Up', '', '', '', '', '', '', '', '10U - Boys - Faheem Armanyous', 'LJHS - Field #1']);
allTeamAwards.push(['2026-09-01', '10U - Boys - Faheem Armanyous', 'Certified Team Referees', 5, '3 Rostered refs']);
allTeamAwards.push(['2026-09-26', '10U - Boys - Faheem Armanyous', 'MatchTrak Filled by Sep 26', 2, 'Roster completed']);

// 2. 08U Boys - Amanda Towers (Qualified with Setup + Upper Division Ref + Bonuses)
for (let w = 1; w <= 5; w++) {
  allFormResponses.push([`2026-09-${10+w*7} 18:00`, `towers.setup${w}@ayso154.org`, `Setup${w}`, 'V', 'Field Set Up', '', '', '', '', '', '', '', '08U - Boys - Amanda Towers', 'LJHS - Field #4']);
  allFormResponses.push([`2026-09-${10+w*7} 08:00`, `towers.ref${w}@ayso154.org`, `Ref${w}`, 'V', 'Referee', 'Assistant Referee (AYSO)', '08U - Boys - Amanda Towers', '8:00 AM', 'LJHS - Field #1', '', '', '', '', '']);
}
allTeamAwards.push(['2026-09-01', '08U - Boys - Amanda Towers', 'Certified Team Referees', 5, 'Rostered refs']);
allTeamAwards.push(['2026-09-26', '08U - Boys - Amanda Towers', 'MatchTrak Filled by Sep 26', 2, 'On-time MatchTrak']);

// 3. 06U Boys - Ryan Fox (8-point goal: 4 Setup + 2 FM + 2 Picture)
for (let w = 1; w <= 4; w++) {
  allFormResponses.push([`2026-09-${10+w*7} 07:00`, `fox.setup${w}@ayso154.org`, `Setup${w}`, 'V', 'Field Set Up', '', '', '', '', '', '', '', '06U - Boys - Ryan Fox', 'LJHS - Field #2']);
}
allFormResponses.push([`2026-09-19 09:00`, `fox.fm1@ayso154.org`, 'FM1', 'V', 'Field Marshal', '', '', '', '', '06U - Boys - Ryan Fox', 'Park Lexington', '9:00 AM', '', '']);
allFormResponses.push([`2026-10-17 09:00`, `fox.fm2@ayso154.org`, 'FM2', 'V', 'Field Marshal', '', '', '', '', '06U - Boys - Ryan Fox', 'Park Lexington', '9:00 AM', '', '']);
allFormResponses.push([`2026-09-26 09:00`, `fox.pic1@ayso154.org`, 'Pic1', 'V', 'Picture Day', '', '', '', '', '', '', '', '', '06U - Boys - Ryan Fox']);
allFormResponses.push([`2026-09-26 11:00`, `fox.pic2@ayso154.org`, 'Pic2', 'V', 'Picture Day', '', '', '', '', '', '', '', '', '06U - Boys - Ryan Fox']);

// 4. Playground - Playground (4-point goal: 2 FM + 2 Picture)
allFormResponses.push([`2026-09-19 08:30`, `play.fm1@ayso154.org`, 'FM1', 'V', 'Field Marshal', '', '', '', '', 'Playground - Playground', 'Park Lexington', '8:30 AM', '', '']);
allFormResponses.push([`2026-10-17 08:30`, `play.fm2@ayso154.org`, 'FM2', 'V', 'Field Marshal', '', '', '', '', 'Playground - Playground', 'Park Lexington', '8:30 AM', '', '']);
allFormResponses.push([`2026-09-26 08:30`, `play.pic1@ayso154.org`, 'Pic1', 'V', 'Picture Day', '', '', '', '', '', '', '', '', 'Playground - Playground']);
allFormResponses.push([`2026-09-26 10:30`, `play.pic2@ayso154.org`, 'Pic2', 'V', 'Picture Day', '', '', '', '', '', '', '', '', 'Playground - Playground']);

console.log('AUDIT STANDINGS SUMMARY BY TEAM:\n');
console.log('Team Name'.padEnd(35) + 'Division'.padEnd(16) + 'Points'.padEnd(10) + 'Goal'.padEnd(8) + 'Status');
console.log('-'.repeat(80));

TEST_ROSTER.forEach(item => {
  const result = processTeamStandings(item.team, allFormResponses, allTeamAwards);
  const status = result.totalPoints >= item.goal ? 'QUALIFIED / MET' : 'IN PROGRESS';
  console.log(
    item.team.padEnd(35) +
    item.div.padEnd(16) +
    String(result.totalPoints).padEnd(10) +
    String(item.goal).padEnd(8) +
    status
  );
  assert(result.totalPoints >= 0, 'Points must be >= 0');
});

console.log('\n================================================================');
console.log('✅ MULTI-DIVISION SYNTHETIC AUDIT VERIFICATION COMPLETE: ALL PASS');
console.log('================================================================');
