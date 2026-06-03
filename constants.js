'use strict';

/**
 * constants.js — קבועים אוניברסליים של הפלטפורמה.
 *
 * לוגיקה ייחודית לתעשייה (משקל ברזל, שיוך מכונה, צורות) עברה ל:
 *   modules/steel-rebar/
 *
 * הייצוא של REBAR_WEIGHTS / rebarKgPerMeter / autoAssignMachine כאן
 * הוא לתאימות לאחור בלבד — ייבא מ-modules/steel-rebar ישירות בקוד חדש.
 */

const steelRebar = require('./modules/steel-rebar');

// ── Universal platform constants ──────────────────────────────────

const MACHINE_STATES = Object.freeze([
  'ריצה',
  'סרק',
  'הכנה',
  'תקלה',
  'תחזוקה',
  'ידני',
  'לא מחובר',
]);

const STATE_TRANSITIONS = Object.freeze({
  'לא מחובר': Object.freeze(['סרק']),
  'סרק':      Object.freeze(['ריצה', 'הכנה', 'ידני', 'לא מחובר']),
  'ריצה':     Object.freeze(['סרק', 'תקלה']),
  'הכנה':     Object.freeze(['סרק', 'ריצה']),
  'תקלה':     Object.freeze(['תחזוקה', 'סרק']),
  'תחזוקה':  Object.freeze(['סרק']),
  'ידני':     Object.freeze(['סרק']),
});

// ── Backward-compat re-exports from steel-rebar ───────────────────
// קוד קיים שמייבא מ-constants.js ממשיך לעבוד ללא שינוי.
// קוד חדש: ייבא מ-modules/steel-rebar ישירות.

const { REBAR_WEIGHTS, REBAR_KG_PER_M, VALID_DIAMETERS, rebarKgPerMeter } = steelRebar;
const { autoAssignMachine }                                                  = steelRebar;
const { normalizeFactorySegments, normalizeFactoryShapeName }                = steelRebar;

module.exports = {
  // universal
  MACHINE_STATES,
  STATE_TRANSITIONS,
  // steel-rebar (backward compat)
  REBAR_WEIGHTS,
  REBAR_KG_PER_M,
  VALID_DIAMETERS,
  rebarKgPerMeter,
  autoAssignMachine,
  normalizeFactorySegments,
  normalizeFactoryShapeName,
};
