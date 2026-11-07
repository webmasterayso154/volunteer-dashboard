/**
 * ============================================================================
 * AYSO REGION 154 - MASTER CONFIGURATION & SINGLE SOURCE OF TRUTH (SSOT)
 * ============================================================================
 * File: AdminConfig.js
 * Version: 5.1.0-FIX-16U-COLLISION
 * Author: AYSO 154 Webmaster
 * ============================================================================
 */

const VOLUNTEER_POLICY = Object.freeze({
  SEASON: 'Fall 2026',

  // 1. Division Playoff / Cypress Cup Qualification Thresholds
  THRESHOLDS: {
    PLAYGROUND: 4,
    U5_U6: 7,
    U8: 15,
    U10_U19: 17,
    DEFAULT: 17
  },

  // 2. Maximum Credit Caps per Category
  CATEGORY_CAPS: {
    FIELD_SETUP: 5,
    REFEREE: 10,
    FIELD_MARSHAL: 2,
    PICTURE_DAY: 2,
    OTHER_ADJUSTMENTS: 5
  },

  // 3. Post-Season Audit & Adjudication Rules
  AUDIT: {
    POSTING_DELAY_HOURS: 48,
    LOOKBACK_DAYS: 14,
    MAX_SHIFTS_PER_CHALLENGE: 5
  },

  // 4. Tab Identifiers
  SHEETS: {
    LEDGER: 'Season_Master_Ledger',
    CHECKINS: 'Game Day Check-ins',
    FALLBACK_CHECKINS: 'Form Responses 1',
    LEGACY_CHECKINS: 'Game Day Check-ins (Responses)',
    AWARDS: 'Team_Awards',
    SCHEDULE: 'Master_Schedule',
    SEASON_SCHEDULE: 'Season_Master_Schedule',
    ADMIN_CONFIG: 'Admin_Config',
    SYNC_LOG: 'Schedule_Sync_Log',
    AUDIT_RESPONSES: 'AYSO 154 - 2026 Playoff Audit Responses'
  },

  // 5. External Integrations
  INTEGRATIONS: {
    DRIVE_FOLDER_ID: '16p94d5o6ZZZdPVkjnd8MYcWbtXe5V8tv',
    CHECKIN_FORM_ID: '1gIenxzkQeBGcbJZrt_ujp9WTfXg_1HUD_BgHDjLS3cI',
    AUDIT_FORM_ID: '1HIQW67qTEQgv6BnBqUno6nodP7y77-RfCVSoeSr75rk',
    TIMEZONE: 'America/Los_Angeles'
  }
});

/**
 * Returns the exact playoff goal.
 * Evaluates 10U–19U FIRST to prevent "16U" from matching "6U".
 */
function getPlayoffGoalForTeam(teamCodeOrDivision) {
  const code = String(teamCodeOrDivision || '').trim().toUpperCase();
  if (!code) return VOLUNTEER_POLICY.THRESHOLDS.DEFAULT;

  // 1. Playground / Schoolyard -> 4
  if (code.indexOf('PLAYGROUND') !== -1 || code.indexOf('SCHOOLYARD') !== -1) {
    return VOLUNTEER_POLICY.THRESHOLDS.PLAYGROUND;
  }

  // 2. Competitive Divisions (9U through 19U) -> 17
  if (/\b(09U|9U|9UX|10U|10UX|11UX|12U|12UX|13UX|14U|14UX|16U|19U)\b/i.test(code) || /^(09U|9U|10U|12U|14U|16U|19U|BU|GU)/i.test(code)) {
    return VOLUNTEER_POLICY.THRESHOLDS.U10_U19;
  }

  // 3. 8U -> 15
  if (/\b(08U|8U)\b/i.test(code) || /^(08U|8U)/i.test(code)) {
    return VOLUNTEER_POLICY.THRESHOLDS.U8;
  }

  // 4. 5U & 6U -> 7 (Boundaries ensure 16U never triggers this)
  if (/\b(05U|5U|06U|6U)\b/i.test(code) || /^(05U|5U|06U|6U)/i.test(code)) {
    return VOLUNTEER_POLICY.THRESHOLDS.U5_U6;
  }

  return VOLUNTEER_POLICY.THRESHOLDS.DEFAULT;
}

/**
 * Google Sheets dynamic formula for Column L in Season_Master_Ledger.
 * Evaluates 16U / 10U-19U before testing for 6U.
 */
function getLedgerGoalFormula(rowNumber) {
  const t = VOLUNTEER_POLICY.THRESHOLDS;
  return `=IF(REGEXMATCH($A${rowNumber}, "Playground|Schoolyard"), ${t.PLAYGROUND}, IF(REGEXMATCH($A${rowNumber}, "(09U|9U|10U|11U|12U|13U|14U|16U|19U)"), ${t.U10_U19}, IF(REGEXMATCH($A${rowNumber}, "(08U|8U)"), ${t.U8}, ${t.U5_U6})))`;
}

function getLedgerGapFormula(rowNumber) {
  return `=MAX(0, L${rowNumber} - O${rowNumber})`;
}

if (typeof module !== 'undefined') {
  module.exports = {
    VOLUNTEER_POLICY,
    getPlayoffGoalForTeam,
    getLedgerGoalFormula,
    getLedgerGapFormula
  };
}