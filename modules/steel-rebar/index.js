'use strict';

/**
 * modules/steel-rebar - active industry implementation for bent rebar.
 *
 * This file keeps the old steel-specific exports and also exposes the generic
 * industry contract consumed by services/moduleLoader.js.
 */

const { REBAR_WEIGHTS, REBAR_KG_PER_M, VALID_DIAMETERS, rebarKgPerMeter } = require('./weights');
const { autoAssignMachine } = require('./machines');
const {
  isSpiralName,
  normalizeSpiralParams,
  spiralCutLengthMm,
  normalizeFactorySegments,
  normalizeFactoryShapeName,
} = require('./shapes');
const { parseBVBS, parseBVBSLine } = require('./bvbs');

function weightPerUnit(item = {}) {
  const spiral = normalizeSpiralParams(item);
  const len = spiral.isSpiral
    ? (Number(item.total_length_mm) || spiralCutLengthMm(spiral.spiralDiameterMm, spiral.turns))
    : (Number(item.total_length_mm) || 0);
  return (len / 1000) * rebarKgPerMeter(item.diameter);
}

module.exports = {
  // Existing steel-specific API.
  MODULE_ID: 'steel-rebar',
  MODULE_NAME: 'ברזל כפוף',
  rebarKgPerMeter,
  REBAR_WEIGHTS,
  REBAR_KG_PER_M,
  VALID_DIAMETERS,
  autoAssignMachine,
  isSpiralName,
  normalizeSpiralParams,
  spiralCutLengthMm,
  normalizeFactorySegments,
  normalizeFactoryShapeName,
  parseBVBS,
  parseBVBSLine,

  // Generic industry module contract.
  id: 'steel-rebar',
  name: 'ברזל כפוף',
  kgPerMeter: rebarKgPerMeter,
  assignResource: autoAssignMachine,
  normalizeSegments: normalizeFactorySegments,
  normalizeShapeName: normalizeFactoryShapeName,
  parseBatchFile: parseBVBS,
  weightPerUnit,
  priceDimension: 'diameter',
  itemFields: [
    { key: 'diameter', label: 'קוטר', type: 'number', unit: 'mm', required: true },
    { key: 'spiral_diameter_mm', label: 'קוטר ספיראלה', type: 'number', unit: 'mm' },
    { key: 'spiral_turns', label: 'מספר כריכות', type: 'number' },
    { key: 'segments', label: 'צלעות', type: 'segments' },
  ],
  labels: {
    item: 'מוט',
    dimension: 'קוטר',
    resource: 'מכונה',
    batchFile: 'קובץ BVBS',
  },
};
