'use strict';

/**
 * modules/steel-rebar — מודול תעשיית ברזל כפוף
 *
 * ממשק ציבורי לכל הלוגיקה הייחודית לפלדה/ברזל.
 * שאר המערכת (routes, services, server.js) מייבאת מכאן — לא מ-constants.js ישירות.
 *
 * כשיגיע מודול תעשייה שני (עץ, אריזה וכו') — אותו ממשק, מימוש שונה.
 */

const { REBAR_WEIGHTS, REBAR_KG_PER_M, VALID_DIAMETERS, rebarKgPerMeter } = require('./weights');
const { autoAssignMachine }                                                  = require('./machines');
const { normalizeFactorySegments, normalizeFactoryShapeName }                = require('./shapes');
const { parseBVBS, parseBVBSLine }                                           = require('./bvbs');

module.exports = {
  // זהות המודול
  MODULE_ID:   'steel-rebar',
  MODULE_NAME: 'ברזל כפוף',

  // חישובי משקל
  rebarKgPerMeter,
  REBAR_WEIGHTS,
  REBAR_KG_PER_M,
  VALID_DIAMETERS,

  // שיוך מכונה
  autoAssignMachine,

  // נורמליזציה של צורות
  normalizeFactorySegments,
  normalizeFactoryShapeName,

  // פרסר BVBS
  parseBVBS,
  parseBVBSLine,
};
