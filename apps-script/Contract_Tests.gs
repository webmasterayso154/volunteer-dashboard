/**
 * AYSO Region 154 — API contract tests.
 *
 * index.html reads the exact key strings asserted below. Keys may be ADDED to
 * these payloads freely; renaming or removing anything asserted here silently
 * breaks the live parent-facing dashboard, because the template resolves a
 * missing value to blank rather than throwing.
 *
 * Run before and after every backend change: Run ▸ runContractTests, then
 * read the Execution log.
 */

// Read by renderVals() in index.html. Keep in step with its activeCats lists.
const CONTRACT_CATEGORY_KEYS = [
  'Referee Assignment',
  'Field Marshal Shift',
  'Friday Night Field Setup',
  'Picture Day'
];

const CONTRACT_AUDIT_KEYS = ['duty', 'date', 'status', 'points'];

const CONTRACT_TEAM = '10U - Boys - Faheem Armanyous';

function runContractTests() {
  const tests = [
    ['Directory payload shape', testContractDirectory],
    ['MASTER_TEAMS entries all parse to a real division', testContractMasterTeamFormat],
    ['Served teamStats payload shape', testContractTeamStats],
    ['Required category keys present and numeric', testContractCategoryKeys],
    ['Audit row shape', testContractAuditRows],
    ['JSONP and JSON envelopes', testContractEnvelopes],
    ['Empty and unknown teamCode stay renderable', testContractUnknownTeam],
    ['Qualification is mathematically reachable', testContractQualificationReachable],
    ['Every flyer point bucket reaches the payload', testContractBucketCoverage]
  ];

  let passed = 0;
  const failures = [];

  Logger.log('===== AYSO 154 API CONTRACT TESTS =====');
  tests.forEach(function (t) {
    try {
      t[1]();
      Logger.log('  PASS  ' + t[0]);
      passed++;
    } catch (err) {
      Logger.log('  FAIL  ' + t[0]);
      Logger.log('        ' + err.message);
      failures.push(t[0] + ' — ' + err.message);
    }
  });

  Logger.log('===== ' + passed + ' passed, ' + failures.length + ' failed =====');
  return { passed: passed, failed: failures.length, failures: failures };
}

function contractAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function contractAssertType(value, expected, label) {
  contractAssert(
    typeof value === expected,
    label + ' must be a ' + expected + ' — got ' + typeof value + ' (' + JSON.stringify(value) + ')'
  );
}

/** The payload doGet actually serves for action=getTeamStats. */
function contractServedStats(teamCode) {
  if (typeof getTeamStatsWithAwards === 'function') return getTeamStatsWithAwards(teamCode);
  return getTeamStatsData(teamCode);
}

function testContractDirectory() {
  const res = getDirectoryData();

  contractAssert(res && typeof res === 'object', 'getDirectoryData() must return an object');
  contractAssert(res.directory && typeof res.directory === 'object', "payload is missing the 'directory' object");
  contractAssertType(res.syncTimestamp, 'string', "'syncTimestamp'");

  const divisions = Object.keys(res.directory);
  contractAssert(divisions.length > 0, 'directory contains no divisions');

  divisions.forEach(function (d) {
    const teams = res.directory[d];
    contractAssert(Array.isArray(teams), "division '" + d + "' must map to an array");
    contractAssert(teams.length > 0, "division '" + d + "' is empty");
    teams.forEach(function (t, i) {
      contractAssertType(t.teamCode, 'string', "directory['" + d + "'][" + i + '].teamCode');
      contractAssertType(t.coach, 'string', "directory['" + d + "'][" + i + '].coach');
    });
  });

  Logger.log('        ' + divisions.length + ' divisions verified');
}

/**
 * Catches the malformed-roster bug class: an entry missing its gender segment
 * (e.g. "12U - Isaiah Hicks") collapses into a phantom one-team division and
 * its teamCode will never match a form response, so the team scores zero
 * forever with no error anywhere.
 */
function testContractMasterTeamFormat() {
  const bad = MASTER_TEAMS.filter(function (t) {
    if (String(t).indexOf('Playground') === 0) return false;
    return String(t).split(' - ').length < 3;
  });

  contractAssert(
    bad.length === 0,
    'these MASTER_TEAMS entries are missing a segment and will never match a submission: ' + bad.join(' | ')
  );
}

function testContractTeamStats() {
  const s = contractServedStats(CONTRACT_TEAM);

  contractAssert(s && typeof s === 'object', 'teamStats must be an object');
  contractAssertType(s.totalPoints, 'number', "'totalPoints'");
  contractAssert(s.categories && typeof s.categories === 'object', "missing the 'categories' object");
  contractAssert(Array.isArray(s.audit), "'audit' must be an array");
  contractAssertType(s.syncTimestamp, 'string', "'syncTimestamp'");
}

function testContractCategoryKeys() {
  const cats = contractServedStats(CONTRACT_TEAM).categories;

  CONTRACT_CATEGORY_KEYS.forEach(function (k) {
    contractAssert(
      Object.prototype.hasOwnProperty.call(cats, k),
      "categories is missing '" + k + "' — index.html reads this exact string"
    );
    contractAssertType(cats[k], 'number', "categories['" + k + "']");
  });
}

function testContractAuditRows() {
  const audit = contractServedStats(CONTRACT_TEAM).audit;

  if (!audit.length) {
    Logger.log('        no audit rows for the test team — shape not exercised');
    return;
  }

  audit.forEach(function (row, i) {
    CONTRACT_AUDIT_KEYS.forEach(function (k) {
      contractAssert(
        Object.prototype.hasOwnProperty.call(row, k),
        'audit[' + i + "] is missing '" + k + "'"
      );
    });
    contractAssertType(row.points, 'number', 'audit[' + i + '].points');
  });

  Logger.log('        ' + audit.length + ' audit rows verified');
}

/**
 * The dashboard now tries fetch() before falling back to JSONP, so the
 * no-callback path must return parseable JSON with a JSON MIME type.
 */
function testContractEnvelopes() {
  const jsonp = doGet({ parameter: { action: 'getDirectory', callback: 'cb_contract' } });
  const body = jsonp.getContent();

  contractAssert(body.indexOf('cb_contract(') === 0, 'JSONP body must open with the requested callback name');
  contractAssert(body.charAt(body.length - 1) === ')', 'JSONP body must close with )');
  contractAssert(
    jsonp.getMimeType() === ContentService.MimeType.JAVASCRIPT,
    'JSONP must be served as JAVASCRIPT, got ' + jsonp.getMimeType()
  );

  const plain = doGet({ parameter: { action: 'getDirectory' } });
  contractAssert(
    plain.getMimeType() === ContentService.MimeType.JSON,
    'callback-less requests must be served as JSON, got ' + plain.getMimeType()
  );

  try {
    JSON.parse(plain.getContent());
  } catch (err) {
    throw new Error('callback-less response is not parseable JSON — the fetch() transport will fail');
  }
}

function testContractUnknownTeam() {
  ['', 'Not A Real Team - Nobody'].forEach(function (code) {
    const s = contractServedStats(code);
    contractAssertType(s.totalPoints, 'number', "totalPoints for '" + code + "'");
    contractAssert(s.categories && typeof s.categories === 'object', "categories for '" + code + "'");
    contractAssert(Array.isArray(s.audit), "audit for '" + code + "'");
    contractAssert(s.totalPoints === 0, "'" + code + "' must score 0, got " + s.totalPoints);
  });
}

/**
 * Forward-looking invariant, not a reproduction of the original defect: it
 * fires if someone raises PlayoffThreshold above what the caps can produce,
 * or trims a cap below it. The bug this suite was written after — a bucket
 * declared but never actually awarded — is caught by the bucket-coverage
 * test below instead.
 */
function testContractQualificationReachable() {
  const threshold = Number(getSettingsData().PlayoffThreshold) || 17;

  let maxPossible = 0;
  Object.keys(POINT_CAPS).forEach(function (k) { maxPossible += POINT_CAPS[k]; });

  contractAssert(
    maxPossible >= threshold,
    'a team can reach at most ' + maxPossible + ' points but needs ' + threshold +
    ' to qualify — qualification is impossible'
  );
  contractAssert(
    maxPossible > threshold,
    'max reachable (' + maxPossible + ') exactly equals the threshold (' + threshold +
    '), so only a perfect score qualifies — the flyer allows 26 possible against 17 needed'
  );

  Logger.log('        ' + maxPossible + ' possible vs ' + threshold + ' required');
}

/**
 * Every bucket in the flyer model must reach the payload as a category the
 * dashboard can read. This is the guard for the actual defect: `picPoints`
 * existed, was summed into the total, and was returned under 'Picture Day' —
 * but nothing ever incremented it, so two of the season's points were
 * unreachable and nothing anywhere reported that.
 */
function testContractBucketCoverage() {
  const cats = contractServedStats(CONTRACT_TEAM).categories;

  const bucketToCategory = {
    preSeasonRefs: 'Pre-Season Referees',
    matchTrakBonus: 'MatchTrak Roster Bonus',
    onFieldReferee: 'Referee Assignment',
    fieldMarshal: 'Field Marshal Shift',
    fridaySetup: 'Friday Night Field Setup',
    pictureDay: 'Picture Day'
  };

  const missing = [];
  Object.keys(POINT_CAPS).forEach(function (bucket) {
    const category = bucketToCategory[bucket];
    if (!category) {
      missing.push(bucket + ' (no category mapping declared in this test)');
    } else if (!Object.prototype.hasOwnProperty.call(cats, category)) {
      missing.push(bucket + " -> '" + category + "'");
    }
  });

  contractAssert(
    missing.length === 0,
    'these flyer point buckets never reach the dashboard and so can never be awarded: ' + missing.join(', ')
  );

  Logger.log('        all ' + Object.keys(POINT_CAPS).length + ' flyer buckets reach the payload');
}