'use strict';

const {
  buildBarsShapeContract,
  buildRingShapeContract,
  calculateHelicalSpiral,
} = require('./shapes');
const { buildFullShapeSnapshot, buildMachineProfilesPlaceholder } = require('../../services/shapeSnapshot');

const DEFAULT_PILE = Object.freeze({
  contractVersion: 2,
  shapeVersion: 1,
  shapeType: 'round_pile_cage',
  pileDiameterMm: 680,
  pileLengthMm: 12000,
  concreteCoverMm: 50,
  longitudinalBarCount: 16,
  longitudinalDiameterMm: 20,
  longitudinalBarType: 'straight',
  spiralDiameterMm: 8,
  pitchMode: 'uniform',
  uniformPitchMm: 150,
  noSpiralStartMm: 0,
  noSpiralEndMm: 0,
  hoopDiameterMm: 14,
  hoopSpacingMm: 3000,
  hookLengthMm: 400,
  lBendHeightMm: 0,
  lBendAngleDeg: 90,
  lBendDirection: 'outward',
  lBendOrientationDeg: 0,
});

function number(value, fallback = 0, min = null) {
  const n = Number(value);
  const out = Number.isFinite(n) ? n : fallback;
  return min === null ? out : Math.max(min, out);
}

function hasPositiveNumber(...values) {
  return values.some(value => value !== '' && value !== null && value !== undefined
    && Number.isFinite(Number(value)) && Number(value) > 0);
}

function normalizeExplicitPositions(value) {
  if (!Array.isArray(value) || !value.length) return [];
  const positions = value.map(Number);
  if (positions.some(position => !Number.isFinite(position) || position < 0)) return [];
  if (new Set(positions).size !== positions.length) return [];
  return positions.map(position => round(position, 1));
}

function sourceDefinesBarLength(source = {}) {
  return hasPositiveNumber(source.mainLengthMm, source.lengthMm, source.length);
}

function sourceDefinesBarDiameter(source = {}) {
  return hasPositiveNumber(source.diameterMm, source.diameter);
}

function round(value, digits = 2) {
  const p = 10 ** digits;
  return Math.round((Number(value) || 0) * p) / p;
}

function generatedShapeId() {
  return `pile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePitchMode(value) {
  return value === 'zones' || value === 'variable' ? 'zones' : 'uniform';
}

function normalizeBarType(value) {
  return value === 'L' || value === 'l' ? 'L' : 'straight';
}

function normalizeOrientationDeg(value, fallback = 0) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : Number(fallback);
  return round(((safe % 360) + 360) % 360, 3);
}

function normalizePileInput(input = {}) {
  if (input.data && typeof input.data === 'object') {
    input = { ...input, ...input.data, shapeId: input.shapeId || input.data.shapeId };
  }
  const generalInput = input.general || {};
  const barsInput = input.longitudinalBars && typeof input.longitudinalBars === 'object' ? input.longitudinalBars : {};
  const spiralInput = input.spiral || {};
  const hoopsInput = input.hoops || {};
  const explicitBars = Array.isArray(barsInput.bars) ? barsInput.bars : (Array.isArray(input.barOverrides) ? input.barOverrides : (Array.isArray(input.bars) ? input.bars : []));
  const barPattern = Array.isArray(barsInput.pattern) ? barsInput.pattern : (Array.isArray(input.barPattern) ? input.barPattern : []);
  const ringPositions = Array.isArray(hoopsInput.rings) && Array.isArray(hoopsInput.rings[0]?.positionsMm)
    ? hoopsInput.rings[0].positionsMm
    : null;
  const rawHoopPositions = Array.isArray(hoopsInput.positionsMm)
    ? hoopsInput.positionsMm
    : (Array.isArray(input.hoopPositionsMm) ? input.hoopPositionsMm : ringPositions);
  const explicitHoopPositionsMm = normalizeExplicitPositions(rawHoopPositions);
  const explicitBarCount = barsInput.totalBars ?? input.longitudinalBarCount
    ?? (typeof input.longitudinalBars === 'number' || typeof input.longitudinalBars === 'string' ? input.longitudinalBars : undefined);
  const incomingSpiralZones = Array.isArray(spiralInput.zones) ? spiralInput.zones : (Array.isArray(input.spiralZones) ? input.spiralZones : []);
  const explicitHoopQuantity = hoopsInput.quantity ?? input.hoopQuantity;
  const explicitHoopQuantityAuthored = explicitHoopQuantity !== undefined
    && explicitHoopQuantity !== null
    && explicitHoopQuantity !== ''
    && Number.isFinite(Number(explicitHoopQuantity));
  const inputPresence = {
    pileDiameter: hasPositiveNumber(generalInput.pileDiameterMm, input.pileDiameterMm, input.pileDiameter),
    pileLength: hasPositiveNumber(generalInput.pileLengthMm, input.pileLengthMm, input.pileLength),
    longitudinalBarCount: hasPositiveNumber(explicitBarCount) || explicitBars.length > 0,
    longitudinalBarDiameter: hasPositiveNumber(barsInput.defaultDiameterMm, input.longitudinalDiameterMm, input.longitudinalDiameter)
      || (explicitBars.length > 0 && explicitBars.every(sourceDefinesBarDiameter)),
    longitudinalBarLength: hasPositiveNumber(barsInput.defaultLengthMm, input.defaultLengthMm)
      || (explicitBars.length > 0 && explicitBars.every(sourceDefinesBarLength))
      || (barPattern.length > 0 && barPattern.every(sourceDefinesBarLength)),
    spiralBarDiameter: hasPositiveNumber(spiralInput.barDiameterMm, input.spiralDiameterMm, input.spiralDiameter),
    spiralDiameter: hasPositiveNumber(spiralInput.outerDiameterMm, spiralInput.spiralDiameterMm, input.spiralOuterDiameterMm, input.spiralCenterlineDiameterMm),
    spiralSchedule: incomingSpiralZones.length > 0 || hasPositiveNumber(spiralInput.uniformPitchMm, input.uniformPitchMm, input.pitch),
    spiralPitch: incomingSpiralZones.length
      ? incomingSpiralZones.every(zone => zone?.noWrap === true || zone?.noWrap === 1 || zone?.noWrap === 'true' || hasPositiveNumber(zone?.pitchMm, zone?.pitch))
      : hasPositiveNumber(spiralInput.uniformPitchMm, input.uniformPitchMm, input.pitch),
    hoopBarDiameter: hasPositiveNumber(hoopsInput.hoopBarDiameterMm, hoopsInput.barDiameterMm, input.hoopDiameterMm),
    hoopDiameter: hasPositiveNumber(hoopsInput.bendingDiameterMm, hoopsInput.hoopDiameterMm, hoopsInput.outerDiameterMm, input.hoopRingDiameterMm, input.hoopOuterDiameterMm),
    hoopQuantity: (explicitHoopQuantityAuthored && Number(explicitHoopQuantity) >= 0) || explicitHoopPositionsMm.length > 0,
  };
  const pile = {
    ...DEFAULT_PILE,
    ...input,
    shapeId: input.shapeId || generatedShapeId(),
    shapeVersion: Math.max(1, Math.round(number(input.shapeVersion, DEFAULT_PILE.shapeVersion, 1))),
    contractVersion: Math.max(2, Math.round(number(input.contractVersion, DEFAULT_PILE.contractVersion, 2))),
  };

  pile.pileDiameterMm = number(generalInput.pileDiameterMm ?? input.pileDiameterMm ?? input.pileDiameter, DEFAULT_PILE.pileDiameterMm, 1);
  pile.pileLengthMm = number(generalInput.pileLengthMm ?? input.pileLengthMm ?? input.pileLength, DEFAULT_PILE.pileLengthMm, 1);
  pile.concreteCoverMm = number(generalInput.concreteCoverMm ?? input.concreteCoverMm, DEFAULT_PILE.concreteCoverMm, 0);
  pile.longitudinalBarCount = Math.max(1, Math.round(number(explicitBarCount ?? (explicitBars.length || undefined), DEFAULT_PILE.longitudinalBarCount, 1)));
  pile.longitudinalDiameterMm = number(barsInput.defaultDiameterMm ?? input.longitudinalDiameterMm ?? input.longitudinalDiameter, DEFAULT_PILE.longitudinalDiameterMm, 1);
  pile.longitudinalDefaultLengthMm = number(barsInput.defaultLengthMm ?? input.defaultLengthMm ?? pile.pileLengthMm, pile.pileLengthMm, 1);
  pile.longitudinalLayoutMode = ['uniform', 'alternating', 'grouped', 'individual'].includes(barsInput.layoutMode || input.layoutMode)
    ? (barsInput.layoutMode || input.layoutMode)
    : (Array.isArray(input.barPattern) && input.barPattern.length ? 'alternating' : 'uniform');
  pile.longitudinalBarType = normalizeBarType(barsInput.defaultType ?? input.longitudinalBarType);
  pile.hookLengthMm = number(barsInput.defaultBendLengthMm ?? input.hookLengthMm, DEFAULT_PILE.hookLengthMm, 0);
  pile.lBendHeightMm = number(barsInput.defaultBendHeightMm ?? input.lBendHeightMm, DEFAULT_PILE.lBendHeightMm, 0);
  pile.lBendAngleDeg = number(barsInput.defaultBendAngleDeg ?? input.lBendAngleDeg, DEFAULT_PILE.lBendAngleDeg);
  pile.lBendDirection = barsInput.defaultBendDirection || input.lBendDirection || DEFAULT_PILE.lBendDirection;
  pile.lBendOrientationDeg = normalizeOrientationDeg(
    barsInput.defaultBendOrientationDeg
      ?? input.bendOrientationDeg
      ?? input.lBendOrientationDeg,
    DEFAULT_PILE.lBendOrientationDeg,
  );
  pile.barPattern = barPattern;
  pile.barOverrides = explicitBars;
  pile.spiralEnabled = spiralInput.enabled !== false && input.spiralEnabled !== false;
  pile.spiralDiameterMm = number(spiralInput.barDiameterMm ?? input.spiralDiameterMm ?? input.spiralDiameter, DEFAULT_PILE.spiralDiameterMm, 1);
  pile.spiralOuterDiameterMm = number(spiralInput.outerDiameterMm ?? input.spiralOuterDiameterMm, 0, 0);
  pile.spiralCenterlineDiameterMm = number(spiralInput.spiralDiameterMm ?? input.spiralCenterlineDiameterMm, 0, 0);
  if (pile.spiralOuterDiameterMm > 0) pile.spiralCenterlineDiameterMm = Math.max(1, pile.spiralOuterDiameterMm - pile.spiralDiameterMm);
  pile.pitchMode = normalizePitchMode(spiralInput.pitchMode ?? input.pitchMode ?? (incomingSpiralZones.length ? 'zones' : 'uniform'));
  pile.uniformPitchMm = number(spiralInput.uniformPitchMm ?? input.uniformPitchMm ?? input.pitch, DEFAULT_PILE.uniformPitchMm, 1);
  pile.noSpiralStartMm = number(spiralInput.startNoSpiralMm ?? input.noSpiralStartMm, DEFAULT_PILE.noSpiralStartMm, 0);
  pile.noSpiralEndMm = number(spiralInput.endNoSpiralMm ?? input.noSpiralEndMm, DEFAULT_PILE.noSpiralEndMm, 0);
  pile.spiralZones = incomingSpiralZones;
  pile.internalNoSpiralZones = Array.isArray(input.internalNoSpiralZones) ? input.internalNoSpiralZones : [];
  pile.hoopsEnabled = hoopsInput.enabled !== false && input.hoopsEnabled !== false;
  pile.hoopBarDiameterMm = number(hoopsInput.hoopBarDiameterMm ?? hoopsInput.barDiameterMm ?? input.hoopDiameterMm, DEFAULT_PILE.hoopDiameterMm, 1);
  pile.hoopOuterDiameterMm = number(hoopsInput.outerDiameterMm ?? input.hoopOuterDiameterMm, 0, 0);
  pile.hoopDiameterMm = number(hoopsInput.bendingDiameterMm ?? hoopsInput.hoopDiameterMm ?? input.hoopRingDiameterMm ?? pile.hoopOuterDiameterMm, 0, 0);
  pile.hoopSpacingMm = number(hoopsInput.spacingMm ?? input.hoopSpacingMm, DEFAULT_PILE.hoopSpacingMm, 1);
  pile.explicitHoopPositionsMm = explicitHoopPositionsMm;
  pile.hoopPositionsProvided = Array.isArray(rawHoopPositions);
  pile.hoopQuantityProvided = explicitHoopQuantityAuthored;
  pile.hoopQuantityAuthored = explicitHoopQuantityAuthored;
  pile.hoopQuantityInvalid = explicitHoopQuantityAuthored && Number(explicitHoopQuantity) < 0;
  pile.hoopQuantity = Math.max(0, Math.round(number(explicitHoopQuantity, explicitHoopPositionsMm.length, 0)));
  pile.hoopSpacingMode = pile.hoopQuantityAuthored || pile.hoopQuantity > 0 || hoopsInput.spacingMode === 'byQuantity' ? 'byQuantity' : 'bySpacing';
  // Keep the authored station unchanged. Validation below must expose an
  // out-of-cage position instead of silently clamping it onto the cage.
  pile.firstHoopOffsetMm = number(hoopsInput.firstHoopOffsetMm ?? input.firstHoopOffsetMm ?? pile.noSpiralStartMm, pile.noSpiralStartMm);
  pile.lastHoopOffsetMm = number(hoopsInput.lastHoopOffsetMm ?? input.lastHoopOffsetMm ?? pile.noSpiralEndMm, pile.noSpiralEndMm, 0);
  pile.hoopShape = hoopsInput.shape || input.hoopShape || 'round';
  pile.roundPileCage = Boolean(input.roundPileCage || input.shapeType === 'round_pile_cage');
  pile.productionQuantity = Math.max(1, Math.round(number(input.productionQuantity ?? input.quantity, 1, 1)));
  pile.inputPresence = inputPresence;
  return pile;
}

function cageDiameterMm(pile) {
  return Math.max(0, pile.pileDiameterMm - 2 * pile.concreteCoverMm);
}

function cageCenterlineDiameterMm(pile) {
  return pile.spiralCenterlineDiameterMm > 0 ? pile.spiralCenterlineDiameterMm : Math.max(1, cageDiameterMm(pile) - pile.spiralDiameterMm);
}

function barCenterDiameterMm(pile) {
  return Math.max(1, cageDiameterMm(pile) - pile.spiralDiameterMm - pile.longitudinalDiameterMm);
}

function internalHoopDiameterMm(pile) {
  return Math.max(1, cageDiameterMm(pile) - 2 * pile.spiralDiameterMm - 2 * pile.longitudinalDiameterMm);
}

function hoopShapeSides(shape) {
  const normalized = String(shape || 'round').toLowerCase();
  if (normalized === 'hex' || normalized === 'hexagon' || normalized === 'משושה') return 6;
  if (normalized === 'oct' || normalized === 'octagon' || normalized === 'מתומן') return 8;
  return 0;
}

function longitudinalBarSpacingMm(diameterMm, barCount, barDiameterMm) {
  const count = Math.max(0, Math.round(Number(barCount) || 0));
  const centerToCenterMm = count > 1 ? diameterMm * Math.sin(Math.PI / count) : 0;
  return {
    centerToCenterMm: round(centerToCenterMm, 1),
    clearMm: round(Math.max(0, centerToCenterMm - Number(barDiameterMm || 0)), 1),
  };
}
function patternForIndex(pattern, index) {
  if (!pattern.length) return null;
  const cycle = pattern.reduce((sum, item) => sum + Math.max(1, Math.round(number(item.repeat, 1, 1))), 0);
  let cursor = ((index - 1) % cycle) + 1;
  for (const item of pattern) {
    const repeat = Math.max(1, Math.round(number(item.repeat, 1, 1)));
    if (cursor <= repeat) return item;
    cursor -= repeat;
  }
  return pattern[0];
}

function normalizeBar(pile, index, override = {}, pattern = {}) {
  const type = normalizeBarType(override.type ?? override.shapeType ?? pattern.type ?? pattern.shapeType ?? pile.longitudinalBarType);
  const diameterMm = number(override.diameterMm ?? pattern.diameterMm ?? pile.longitudinalDiameterMm, pile.longitudinalDiameterMm, 1);
  const mainLengthMm = number(override.mainLengthMm ?? pattern.mainLengthMm ?? override.lengthMm ?? pattern.lengthMm ?? pile.longitudinalDefaultLengthMm, pile.longitudinalDefaultLengthMm, 1);
  const bendLengthMm = number(override.bendLengthMm ?? override.hookLengthMm ?? pattern.bendLengthMm ?? pattern.hookLengthMm ?? (type === 'L' ? pile.hookLengthMm : 0), 0, 0);
  const bendHeightMm = number(override.bendHeightMm ?? pattern.bendHeightMm ?? pile.lBendHeightMm, 0, 0);
  const bendAngleDeg = number(override.bendAngleDeg ?? pattern.bendAngleDeg ?? pile.lBendAngleDeg, pile.lBendAngleDeg);
  const bendDirection = override.bendDirection ?? pattern.bendDirection ?? pile.lBendDirection;
  const bendOrientationDeg = normalizeOrientationDeg(
    override.bendOrientationDeg ?? pattern.bendOrientationDeg,
    pile.lBendOrientationDeg,
  );
  const shapeContract = buildBarsShapeContract({
    shapeType: type === 'L' ? 'l_bar' : 'straight_bar',
    diameter: diameterMm,
    sides: type === 'L' ? [mainLengthMm, bendLengthMm] : [mainLengthMm],
    angles: type === 'L' ? [bendAngleDeg] : [],
  }, { quantity: 1 });
  const lengthMm = shapeContract.component.unitLengthMm;
  const positionAngleDeg = round(((index - 1) * 360) / pile.longitudinalBarCount, 3);
  return { barIndex: index, index, diameterMm, type, shapeType: shapeContract.generic.shapeType, mainLengthMm, bendLengthMm, hookLengthMm: bendLengthMm, bendHeightMm, bendAngleDeg, bendDirection, bendOrientationDeg, positionAngleDeg, angleDeg: positionAngleDeg, lengthMm, weightKg: shapeContract.component.weightKg, shapeContract, note: override.note ?? pattern.note ?? '' };
}

function buildLongitudinalBars(pile) {
  const overrides = new Map(pile.barOverrides.map(item => [Number(item.barIndex ?? item.index), item]));
  return Array.from({ length: pile.longitudinalBarCount }, (_, i) => normalizeBar(pile, i + 1, overrides.get(i + 1) || {}, patternForIndex(pile.barPattern, i + 1) || {}));
}

function activeSpiralLengthMm(pile) {
  return Math.max(0, pile.pileLengthMm - pile.noSpiralStartMm - pile.noSpiralEndMm);
}

function buildSpiralZones(pile) {
  const activeLengthMm = activeSpiralLengthMm(pile);
  if (!pile.spiralEnabled || activeLengthMm <= 0) return [];
  if (pile.pitchMode === 'uniform') return [{ zoneIndex: 1, name: 'A', startMm: pile.noSpiralStartMm, endMm: pile.noSpiralStartMm + activeLengthMm, lengthMm: activeLengthMm, pitchMm: pile.uniformPitchMm, noWrap: false }];
  let cursor = pile.noSpiralStartMm;
  return pile.spiralZones.map((zone, idx) => {
    const lengthMm = number(zone.lengthMm ?? zone.length, 0, 0);
    const noWrap = zone.noWrap === true || zone.noWrap === 1 || zone.noWrap === 'true';
    const pitchMm = noWrap ? null : number(zone.pitchMm ?? zone.pitch, 0, 0);
    const out = { zoneIndex: idx + 1, name: zone.name || String.fromCharCode(65 + idx), startMm: cursor, endMm: cursor + lengthMm, lengthMm, pitchMm, noWrap };
    cursor += lengthMm;
    return out;
  });
}

function enrichSpiralZones(pile, zones) {
  const diameterMm = cageCenterlineDiameterMm(pile);
  return zones.map(zone => {
    if (zone.noWrap) {
      return { ...zone, barDiameterMm: pile.spiralDiameterMm, diameterMm: round(diameterMm, 1), spiralDiameterMm: round(diameterMm, 1), turns: 0, turnsCalculated: 0, cutLengthMm: 0, totalLengthMm: 0, weightKg: 0, calculation: null };
    }
    if (!(Number(zone.pitchMm) > 0)) {
      return { ...zone, barDiameterMm: pile.spiralDiameterMm, diameterMm: round(diameterMm, 1), spiralDiameterMm: round(diameterMm, 1), turns: 0, turnsCalculated: 0, cutLengthMm: 0, totalLengthMm: 0, weightKg: 0, calculation: null };
    }
    const canonical = calculateHelicalSpiral({
      axialLengthMm: zone.lengthMm,
      pitchMm: zone.pitchMm,
      effectiveDiameterMm: diameterMm,
      barDiameterMm: pile.spiralDiameterMm,
    });
    return { ...zone, barDiameterMm: pile.spiralDiameterMm, diameterMm: canonical.effectiveDiameterMm, spiralDiameterMm: canonical.effectiveDiameterMm, circumferenceMm: canonical.circumferenceMm, turns: canonical.turns, turnsCalculated: canonical.turns, cutLengthMm: canonical.helicalCutLengthMm, totalLengthMm: canonical.helicalCutLengthMm, weightKg: canonical.barWeightKg, calculation: canonical };
  });
}

function defaultHoopPositions(pile) {
  if (!pile.hoopsEnabled) return [];
  if (pile.explicitHoopPositionsMm.length) return [...pile.explicitHoopPositionsMm];
  const startMm = pile.firstHoopOffsetMm;
  if (pile.hoopSpacingMode === 'byQuantity') {
    if (!(pile.hoopQuantity > 0) || !(pile.hoopSpacingMm > 0)) return [];
    return Array.from({ length: pile.hoopQuantity }, (_, index) => round(startMm + index * pile.hoopSpacingMm, 1));
  }
  const endMm = Math.max(startMm, pile.pileLengthMm - pile.lastHoopOffsetMm);
  const positionsMm = [];
  for (let positionMm = startMm; positionMm <= endMm + 0.001; positionMm += pile.hoopSpacingMm) positionsMm.push(round(positionMm, 1));
  if (!positionsMm.length) positionsMm.push(round(startMm, 1));
  return positionsMm;
}

function buildHoops(pile) {
  if (!pile.hoopsEnabled) return [];
  const hoopDiameterMm = pile.hoopDiameterMm > 0 ? pile.hoopDiameterMm : internalHoopDiameterMm(pile);
  const positionsMm = defaultHoopPositions(pile);
  const count = positionsMm.length;
  if (count === 0) return [];
  const ringContract = buildRingShapeContract({ barDiameterMm: pile.hoopBarDiameterMm, bendingDiameterMm: hoopDiameterMm, quantity: count || 1 });
  const lengthMm = ringContract.component.unitLengthMm;
  const spacing = longitudinalBarSpacingMm(hoopDiameterMm, pile.longitudinalBarCount, pile.longitudinalDiameterMm);
  const totalLengthMm = count > 0 ? round(lengthMm * count, 1) : 0;
  const weightKg = count > 0 ? ringContract.component.weightKg : 0;
  return [{ index: 1, count, hoopCount: count, spacingMode: pile.hoopSpacingMode, spacingMm: pile.hoopSpacingMm, positionsMm, startFromMm: positionsMm[0] ?? 0, diameterMm: round(hoopDiameterMm, 1), hoopDiameterMm: round(hoopDiameterMm, 1), bendingDiameterMm: round(hoopDiameterMm, 1), barDiameterMm: pile.hoopBarDiameterMm, hoopBarDiameterMm: pile.hoopBarDiameterMm, shape: pile.hoopShape, shapeSides: hoopShapeSides(pile.hoopShape), lengthMm: round(lengthMm, 1), unitLengthMm: round(lengthMm, 1), hoopCutLengthMm: round(lengthMm, 1), barCenterSpacingMm: spacing.centerToCenterMm, barClearSpacingMm: spacing.clearMm, totalLengthMm, totalHoopLengthMm: totalLengthMm, weightKg, totalHoopWeightKg: weightKg, shapeContract: ringContract }];
}

function validatePileCage(pile, spiralZones, bars = [], hoops = []) {
  const errors = [];
  const warnings = [];
  const addError = (code, message) => {
    if (!errors.some(error => error.code === code)) errors.push({ code, message });
  };
  const addWarning = (code, message) => warnings.push({ code, message });
  if (pile.pileDiameterMm <= 0) addError('invalid_pile_diameter', 'pileDiameterMm must be positive');
  if (pile.pileLengthMm <= 0) addError('invalid_pile_length', 'pileLengthMm must be positive');
  if (pile.concreteCoverMm < 0) addError('invalid_concrete_cover', 'concreteCoverMm must be non-negative');
  if (pile.concreteCoverMm * 2 >= pile.pileDiameterMm) addError('concrete_cover_too_large', 'concreteCoverMm leaves no cage diameter');
  if (cageDiameterMm(pile) <= 0) addError('invalid_cage_diameter', 'cageDiameterMm must be positive');
  if (pile.longitudinalBarCount < 3) addError('invalid_bar_count', 'longitudinal bar count must be at least 3');
  for (const bar of bars) {
    if (bar.mainLengthMm <= 0) addError('invalid_bar_length', `bar ${bar.barIndex} mainLengthMm must be positive`);
    if (bar.type === 'L' && bar.bendLengthMm <= 0) addError('invalid_l_bend_length', `bar ${bar.barIndex} L bendLengthMm must be positive`);
  }
  if (pile.spiralEnabled) {
    if (pile.spiralDiameterMm <= 0) addError('invalid_spiral_diameter', 'spiral barDiameterMm must be positive');
    if (pile.pitchMode === 'uniform' && pile.uniformPitchMm <= 0) addError('invalid_spiral_pitch', 'uniformPitchMm must be positive');
    if (pile.noSpiralStartMm < 0 || pile.noSpiralEndMm < 0) addError('invalid_no_spiral_length', 'no-spiral lengths must be non-negative');
    if (activeSpiralLengthMm(pile) <= 0) addError('spiral_active_length_not_positive', 'active spiral length must be positive');
    if (pile.pitchMode === 'zones') {
      const expected = activeSpiralLengthMm(pile);
      const sum = spiralZones.reduce((total, zone) => total + zone.lengthMm, 0);
      if (Math.abs(sum - expected) > 0.001) addError('spiral_zones_do_not_cover_active_length', 'spiral zones must exactly fill the active spiral length');
      for (let i = 1; i < spiralZones.length; i += 1) if (spiralZones[i].startMm < spiralZones[i - 1].endMm) addError('spiral_zone_overlap', 'spiral zones must not overlap');
      spiralZones.forEach(zone => {
        if (!zone.noWrap && !(Number(zone.pitchMm) > 0)) addError('invalid_spiral_pitch', `spiral zone ${zone.name} pitchMm must be positive`);
      });
    }
    if (pile.internalNoSpiralZones.length) addError('no_spiral_zone_in_middle_not_allowed', 'internal no-spiral gaps are not allowed');
    if (pile.uniformPitchMm < Math.max(20, pile.spiralDiameterMm * 6)) addWarning('very_dense_spiral_pitch', 'spiral pitch is very dense');
  }
  if (pile.hoopsEnabled) {
    const hasHoopMaterial = pile.hoopQuantity > 0 || pile.explicitHoopPositionsMm.length > 0;
    if (hasHoopMaterial && pile.hoopBarDiameterMm <= 0) addError('invalid_hoop_bar_diameter', 'hoopBarDiameterMm must be positive');
    if (hasHoopMaterial && hoops[0] && hoops[0].diameterMm <= 0) addError('invalid_hoop_diameter', 'hoopDiameterMm must be positive');
    if (pile.hoopSpacingMode === 'bySpacing' && pile.hoopSpacingMm <= 0) addError('invalid_hoop_spacing', 'hoop spacingMm must be positive');
    if (pile.hoopQuantityInvalid) addError('invalid_hoop_quantity', 'hoop quantity must be zero or positive');
    const hoopPositions = hoops.flatMap(hoop => hoop.positionsMm || []);
    const invalidPositions = hoopPositions
      .map((positionMm, index) => ({ index: index + 1, positionMm }))
      .filter(({ positionMm }) => positionMm < 0 || positionMm > pile.pileLengthMm);
    if (invalidPositions.length) {
      const details = invalidPositions.map(({ index, positionMm }) => `P${index}=${positionMm}mm`).join(', ');
      addError('hoop_position_out_of_range', `reinforcing hoop position outside cage length ${pile.pileLengthMm}mm: ${details}`);
    }
  }
  if (pile.roundPileCage) {
    const requiredInputs = [
      ['pileDiameter', 'missing_pile_diameter', 'round pile cage requires an explicit pile diameter'],
      ['pileLength', 'missing_pile_length', 'round pile cage requires an explicit pile length'],
      ['longitudinalBarCount', 'missing_longitudinal_bar_count', 'round pile cage requires an explicit longitudinal bar count'],
      ['longitudinalBarDiameter', 'missing_longitudinal_bar_diameter', 'round pile cage requires an explicit longitudinal bar diameter'],
      ['longitudinalBarLength', 'missing_longitudinal_bar_length', 'round pile cage requires explicit longitudinal bar lengths'],
      ['spiralBarDiameter', 'missing_spiral_bar_diameter', 'round pile cage requires an explicit spiral bar diameter'],
      ['spiralDiameter', 'missing_spiral_diameter', 'round pile cage requires an explicit spiral diameter'],
      ['spiralSchedule', 'missing_spiral_schedule', 'round pile cage requires an explicit spiral schedule'],
      ['spiralPitch', 'missing_spiral_pitch', 'every wrapped spiral segment requires an explicit pitch'],
      ['hoopQuantity', 'missing_hoop_quantity', 'round pile cage requires an explicit hoop quantity or authoritative positions'],
    ];
    if (pile.hoopQuantity > 0 || pile.explicitHoopPositionsMm.length > 0) {
      requiredInputs.push(
        ['hoopBarDiameter', 'missing_hoop_bar_diameter', 'round pile cage with reinforcing hoops requires an explicit hoop bar diameter'],
        ['hoopDiameter', 'missing_hoop_diameter', 'round pile cage with reinforcing hoops requires an explicit hoop bending diameter'],
      );
    }
    requiredInputs.forEach(([field, code, message]) => {
      if (!pile.inputPresence[field]) addError(code, message);
    });
    if (!bars.some(bar => bar.type === 'straight')) addError('missing_straight_bar_quantity', 'round pile cage requires straight longitudinal bars');
    if (!bars.some(bar => bar.type === 'L')) addError('missing_bent_bar_quantity', 'round pile cage requires bent longitudinal bars');
    if (!spiralZones.some(zone => !zone.noWrap && zone.totalLengthMm > 0)) addError('missing_wrapped_spiral_segment', 'round pile cage requires at least one wrapped spiral segment');
    if (pile.hoopPositionsProvided && !pile.explicitHoopPositionsMm.length) addError('invalid_hoop_positions', 'authoritative hoop positions must be finite, unique and non-negative');
    if (pile.hoopQuantityProvided && pile.explicitHoopPositionsMm.length && pile.hoopQuantity !== pile.explicitHoopPositionsMm.length) addError('hoop_quantity_positions_mismatch', 'hoop quantity must match authoritative hoop positions');
  }
  if (new Set(bars.map(bar => bar.diameterMm)).size > 1) addWarning('mixed_bar_diameters', 'longitudinal bars use mixed diameters');
  if (new Set(bars.map(bar => bar.type)).size > 1) addWarning('mixed_bar_types', 'longitudinal bars use mixed types');
  return { ok: errors.length === 0, errors, warnings, errorCodes: errors.map(error => error.code), warningCodes: warnings.map(warning => warning.code) };
}

function groupBarsForProduction(bars) {
  const map = new Map();
  for (const bar of bars) {
    const componentType = bar.type === 'L' ? 'longitudinal_l_bar' : 'longitudinal_straight_bar';
    const key = `${componentType}|${bar.diameterMm}|${bar.mainLengthMm}|${bar.bendLengthMm}|${bar.lengthMm}`;
    if (!map.has(key)) map.set(key, { componentType, type: componentType, sourceSystem: 'longitudinalBars', description: bar.type === 'L' ? 'Longitudinal L bar' : 'Longitudinal straight bar', diameterMm: bar.diameterMm, shapeType: bar.shapeType, mainLengthMm: bar.mainLengthMm, bendLengthMm: bar.bendLengthMm, bendHeightMm: bar.bendHeightMm, bendAngleDeg: bar.bendAngleDeg, lengthMm: bar.lengthMm, unitLengthMm: bar.lengthMm, quantity: 0, barIndexes: [], shapeContract: bar.shapeContract });
    const group = map.get(key);
    group.quantity += 1;
    group.barIndexes.push(bar.barIndex);
  }
  return Array.from(map.values()).map(group => {
    const canonical = buildBarsShapeContract({
      shapeType: group.shapeType,
      diameter: group.diameterMm,
      sides: group.shapeContract.data.sides,
      angles: group.shapeContract.data.angles,
    }, { quantity: group.quantity });
    return { ...group, shapeContract: canonical, segments: canonical.generic.segments, unitLengthMm: canonical.component.unitLengthMm, lengthMm: canonical.component.unitLengthMm, totalLengthMm: canonical.component.totalLengthMm, unitWeightKg: canonical.component.unitWeightKg, weightKg: canonical.component.weightKg };
  });
}

function buildManufacturingBreakdown(pile, bars, spiralZones, hoops) {
  const barGroups = groupBarsForProduction(bars);
  const hoopComponents = hoops.map(hoop => ({ componentType: 'hoop_ring', type: 'hoop_ring', sourceSystem: 'hoops', description: 'Internal hoop ring', diameterMm: hoop.barDiameterMm, hoopDiameterMm: hoop.diameterMm, bendingDiameterMm: hoop.bendingDiameterMm, shape: hoop.shape, shapeSides: hoop.shapeSides, lengthMm: hoop.lengthMm, unitLengthMm: hoop.unitLengthMm, hoopCutLengthMm: hoop.hoopCutLengthMm, barCenterSpacingMm: hoop.barCenterSpacingMm, barClearSpacingMm: hoop.barClearSpacingMm, quantity: hoop.count, spacingMm: hoop.spacingMm, positionsMm: hoop.positionsMm, totalLengthMm: hoop.totalLengthMm, unitWeightKg: hoop.shapeContract.component.unitWeightKg, weightKg: hoop.weightKg, shapeContract: hoop.shapeContract }));
  if (!pile.roundPileCage) {
    const zoneComponents = spiralZones.filter(zone => !zone.noWrap).map(zone => ({ componentType: 'spiral_zone', type: 'spiral_zone', sourceSystem: 'spiral', description: `Spiral zone ${zone.name}`, name: zone.name, zoneIndex: zone.zoneIndex, diameterMm: pile.spiralDiameterMm, pitchMm: zone.pitchMm, lengthMm: zone.totalLengthMm, quantity: 1, startMm: zone.startMm, endMm: zone.endMm, zoneLengthMm: zone.lengthMm, turns: zone.turnsCalculated, totalLengthMm: zone.totalLengthMm, weightKg: zone.weightKg }));
    return [...barGroups, ...zoneComponents, ...hoopComponents];
  }
  const wrapped = spiralZones.filter(zone => !zone.noWrap);
  const spiral = {
    componentType: 'spiral_consolidated',
    type: 'spiral_consolidated',
    sourceSystem: 'spiral',
    description: 'Consolidated cage spiral',
    diameterMm: pile.spiralDiameterMm,
    effectiveDiameterMm: round(cageCenterlineDiameterMm(pile), 1),
    quantity: 1,
    unitLengthMm: round(wrapped.reduce((sum, zone) => sum + zone.totalLengthMm, 0), 1),
    totalLengthMm: round(wrapped.reduce((sum, zone) => sum + zone.totalLengthMm, 0), 1),
    weightKg: round(wrapped.reduce((sum, zone) => sum + zone.weightKg, 0), 3),
    totalWrappedAxialLengthMm: round(wrapped.reduce((sum, zone) => sum + zone.lengthMm, 0), 1),
    totalNoWrapAxialLengthMm: round(spiralZones.filter(zone => zone.noWrap).reduce((sum, zone) => sum + zone.lengthMm, 0), 1),
    schedule: spiralZones.map(zone => ({ name: zone.name, zoneIndex: zone.zoneIndex, startMm: zone.startMm, endMm: zone.endMm, axialLengthMm: zone.lengthMm, pitchMm: zone.noWrap ? null : zone.pitchMm, noWrap: zone.noWrap, turns: zone.turns, helicalCutLengthMm: zone.totalLengthMm, weightKg: zone.weightKg, calculation: zone.calculation })),
  };
  return [...barGroups, spiral, ...hoopComponents];
}

function productionComponentLabel(part) {
  if (part.componentType === 'longitudinal_l_bar') return 'Longitudinal L bars';
  if (part.componentType === 'longitudinal_straight_bar') return 'Longitudinal straight bars';
  if (part.componentType === 'spiral_consolidated') return 'Consolidated cage spiral';
  if (part.componentType === 'hoop_ring') return 'Internal reinforcement hoops';
  return part.description || part.componentType || 'Pile cage component';
}

function buildProductionCards(pile, manufacturingBreakdown) {
  if (!pile.roundPileCage) {
    const cards = [];
    for (let unitIndex = 1; unitIndex <= pile.productionQuantity; unitIndex += 1) {
      cards.push({ cardType: 'pile_master', componentType: 'pile_master', title: `Pile cage ${unitIndex}/${pile.productionQuantity}`, description: 'Complete pile cage unit', unitIndex, unitTotal: pile.productionQuantity, componentIndex: 0, quantity: 1, totalLengthMm: pile.pileLengthMm, weightKg: null, diameterMm: pile.longitudinalDiameterMm, scanCodeSuffix: `P${unitIndex}-MASTER` });
      manufacturingBreakdown.forEach((part, index) => cards.push({ cardType: 'pile_component', componentType: part.componentType || part.type, title: productionComponentLabel(part), description: part.description || productionComponentLabel(part), unitIndex, unitTotal: pile.productionQuantity, componentIndex: index + 1, quantity: Number(part.quantity) || 1, diameterMm: Number(part.diameterMm) || Number(part.barDiameterMm) || pile.longitudinalDiameterMm, hoopDiameterMm: part.hoopDiameterMm || null, barCenterSpacingMm: part.barCenterSpacingMm || null, barClearSpacingMm: part.barClearSpacingMm || null, pitchMm: part.pitchMm || null, totalLengthMm: Number(part.totalLengthMm || part.lengthMm || 0), lengthMm: Number(part.lengthMm || part.totalLengthMm || 0), weightKg: Number(part.weightKg || 0), positionsMm: part.positionsMm || null, source: part, scanCodeSuffix: `P${unitIndex}-C${index + 1}` }));
    }
    return cards;
  }
  const componentCards = manufacturingBreakdown.map((part, index) => ({
    cardType: 'pile_component',
    componentType: part.componentType || part.type,
    title: productionComponentLabel(part),
    description: part.description || productionComponentLabel(part),
    componentIndex: index + 1,
    quantity: Number(part.quantity) || 0,
    diameterMm: Number(part.diameterMm) || Number(part.barDiameterMm) || pile.longitudinalDiameterMm,
    unitLengthMm: Number(part.unitLengthMm || part.lengthMm || 0),
    totalLengthMm: Number(part.totalLengthMm || 0),
    weightKg: Number(part.weightKg || 0),
    source: part,
    scanCodeSuffix: `C${index + 1}`,
  }));
  const assemblyWeightKg = round(manufacturingBreakdown.reduce((sum, part) => sum + Number(part.weightKg || 0), 0), 3);
  const assemblySteelLengthMm = round(manufacturingBreakdown.reduce((sum, part) => sum + Number(part.totalLengthMm || 0), 0), 1);
  const assemblyCard = {
    cardType: 'pile_assembly',
    componentType: 'pile_assembly',
    title: 'PILE CAGE',
    description: 'Round pile reinforcement cage assembly',
    componentIndex: componentCards.length + 1,
    quantity: 1,
    diameterMm: pile.pileDiameterMm,
    unitLengthMm: pile.pileLengthMm,
    totalLengthMm: pile.pileLengthMm,
    totalSteelCutLengthMm: assemblySteelLengthMm,
    weightKg: assemblyWeightKg,
    componentSummary: componentCards.map(card => ({ componentType: card.componentType, quantity: card.quantity, diameterMm: card.diameterMm, unitLengthMm: card.unitLengthMm, totalLengthMm: card.totalLengthMm, weightKg: card.weightKg })),
    scanCodeSuffix: 'ASSEMBLY',
  };
  return [...componentCards, assemblyCard];
}

function sumBy(items, keySelector, valueSelector) {
  const out = {};
  for (const item of items) {
    const key = String(keySelector(item));
    out[key] = round((out[key] || 0) + valueSelector(item), 3);
  }
  return out;
}

function buildViews(pile, bars, spiralZones, hoops) {
  return {
    sideView: { pileLengthMm: pile.pileLengthMm, activeSpiralLengthMm: activeSpiralLengthMm(pile), startNoSpiralMm: pile.noSpiralStartMm, endNoSpiralMm: pile.noSpiralEndMm, spiralZones: spiralZones.map(zone => ({ zoneIndex: zone.zoneIndex, name: zone.name, startMm: zone.startMm, endMm: zone.endMm, lengthMm: zone.lengthMm, pitchMm: zone.pitchMm, noWrap: zone.noWrap, label: zone.noWrap ? `${zone.name} ללא כריכות` : `${zone.name} @${zone.pitchMm}` })), hoops: hoops.flatMap(hoop => hoop.positionsMm || []), longitudinalBars: bars.map(bar => ({ barIndex: bar.barIndex, diameterMm: bar.diameterMm, type: bar.type })) },
    topView: { pileDiameterMm: pile.pileDiameterMm, cageDiameterMm: round(cageDiameterMm(pile), 1), cageCenterlineDiameterMm: round(cageCenterlineDiameterMm(pile), 1), internalHoopDiameterMm: hoops[0]?.diameterMm ?? internalHoopDiameterMm(pile), barCenterSpacingMm: hoops[0]?.barCenterSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).centerToCenterMm, barClearSpacingMm: hoops[0]?.barClearSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).clearMm, bendOrientationReference: 'radial_inward', bendOrientationPositive: 'clockwise', bars: bars.map(bar => ({ barIndex: bar.barIndex, positionAngleDeg: bar.positionAngleDeg, diameterMm: bar.diameterMm, type: bar.type, bendOrientationDeg: bar.bendOrientationDeg })), legend: { straight: 'straight longitudinal bar', L: 'L longitudinal bar', mixedDiameters: new Set(bars.map(bar => bar.diameterMm)).size > 1 } },
    isoView: { cageDiameterMm: round(cageDiameterMm(pile), 1), pileLengthMm: pile.pileLengthMm, longitudinalBars: bars.length, spiralZones: spiralZones.length, hoops: hoops.reduce((sum, hoop) => sum + hoop.count, 0) },
    selectedBarView: bars.map(bar => ({ barIndex: bar.barIndex, type: bar.type, mainLengthMm: bar.mainLengthMm, bendLengthMm: bar.bendLengthMm, bendHeightMm: bar.bendHeightMm, bendAngleDeg: bar.bendAngleDeg, bendDirection: bar.bendDirection, bendOrientationDeg: bar.bendOrientationDeg, diameterMm: bar.diameterMm })),
  };
}

function buildDataContract(pile, bars, spiralZones, hoops) {
  return {
    general: { pileDiameterMm: pile.pileDiameterMm, pileLengthMm: pile.pileLengthMm, concreteCoverMm: pile.concreteCoverMm, cageDiameterMm: round(cageDiameterMm(pile), 1), cageCenterlineDiameterMm: round(cageCenterlineDiameterMm(pile), 1), shapeVersion: pile.shapeVersion, shapeId: pile.shapeId, family: 'piles' },
    longitudinalBars: { totalBars: pile.longitudinalBarCount, defaultDiameterMm: pile.longitudinalDiameterMm, defaultLengthMm: pile.longitudinalDefaultLengthMm, defaultBendOrientationDeg: pile.lBendOrientationDeg, bendOrientationReference: 'radial_inward', bendOrientationPositive: 'clockwise', layoutMode: pile.longitudinalLayoutMode, bars },
    spiral: { enabled: pile.spiralEnabled, barDiameterMm: pile.spiralDiameterMm, outerDiameterMm: pile.spiralOuterDiameterMm || null, spiralDiameterMm: round(cageCenterlineDiameterMm(pile), 1), pitchMode: pile.pitchMode, uniformPitchMm: pile.uniformPitchMm, startNoSpiralMm: pile.noSpiralStartMm, endNoSpiralMm: pile.noSpiralEndMm, zones: spiralZones },
    hoops: { enabled: pile.hoopsEnabled, hoopBarDiameterMm: pile.hoopBarDiameterMm, outerDiameterMm: pile.hoopOuterDiameterMm || pile.hoopDiameterMm || null, bendingDiameterMm: hoops[0]?.bendingDiameterMm ?? pile.hoopDiameterMm, hoopDiameterMm: hoops[0]?.diameterMm ?? internalHoopDiameterMm(pile), spacingMode: pile.hoopSpacingMode, spacingMm: pile.hoopSpacingMm, quantity: pile.hoopQuantity || hoops.reduce((sum, hoop) => sum + hoop.count, 0), positionsMm: hoops[0]?.positionsMm || [], firstHoopOffsetMm: pile.firstHoopOffsetMm, lastHoopOffsetMm: pile.lastHoopOffsetMm, shape: pile.hoopShape, barCenterSpacingMm: hoops[0]?.barCenterSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).centerToCenterMm, barClearSpacingMm: hoops[0]?.barClearSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).clearMm, rings: hoops },
  };
}

function buildCalculated(pile, bars, spiralZones, hoops, manufacturingBreakdown) {
  const barComponents = manufacturingBreakdown.filter(part => ['longitudinal_straight_bar', 'longitudinal_l_bar'].includes(part.componentType));
  const spiralComponents = manufacturingBreakdown.filter(part => ['spiral_consolidated', 'spiral_zone'].includes(part.componentType));
  const hoopComponent = manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');
  const totalLongitudinalLengthMm = barComponents.reduce((sum, part) => sum + part.totalLengthMm, 0);
  const totalLongitudinalWeightKg = barComponents.reduce((sum, part) => sum + part.weightKg, 0);
  const totalSpiralLengthMm = spiralComponents.reduce((sum, part) => sum + Number(part.totalLengthMm || 0), 0);
  const totalSpiralWeightKg = spiralComponents.reduce((sum, part) => sum + Number(part.weightKg || 0), 0);
  const totalHoopLengthMm = hoopComponent?.totalLengthMm || 0;
  const totalHoopWeightKg = hoopComponent?.weightKg || 0;
  const totalSteelLengthMm = manufacturingBreakdown.reduce((sum, part) => sum + Number(part.totalLengthMm || 0), 0);
  const totalWeightKg = manufacturingBreakdown.reduce((sum, part) => sum + Number(part.weightKg || 0), 0);
  return { cageDiameterMm: round(cageDiameterMm(pile), 1), cageCenterlineDiameterMm: round(cageCenterlineDiameterMm(pile), 1), activeSpiralLengthMm: activeSpiralLengthMm(pile), totalStraightBars: bars.filter(bar => bar.type === 'straight').length, totalLBars: bars.filter(bar => bar.type === 'L').length, totalLongitudinalLengthMm: round(totalLongitudinalLengthMm, 1), totalLongitudinalWeightKg: round(totalLongitudinalWeightKg, 3), totalSpiralLengthMm: round(totalSpiralLengthMm, 1), totalSpiralWeightKg: round(totalSpiralWeightKg, 3), totalHoopLengthMm: round(totalHoopLengthMm, 1), totalHoopWeightKg: round(totalHoopWeightKg, 3), totalSteelLengthMm: round(totalSteelLengthMm, 1), totalLengthMm: round(totalSteelLengthMm, 1), totalWeightKg: round(totalWeightKg, 3), weightKg: round(totalWeightKg, 3), internalHoopDiameterMm: hoops[0]?.diameterMm ?? internalHoopDiameterMm(pile), hoopCutLengthMm: hoops[0]?.lengthMm ?? 0, barCenterSpacingMm: hoops[0]?.barCenterSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).centerToCenterMm, barClearSpacingMm: hoops[0]?.barClearSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).clearMm, weightByComponent: { longitudinalBars: round(totalLongitudinalWeightKg, 3), spiral: round(totalSpiralWeightKg, 3), hoops: round(totalHoopWeightKg, 3) }, weightByDiameter: sumBy(manufacturingBreakdown, part => part.diameterMm, part => part.weightKg), groupedBarSummary: groupBarsForProduction(bars), manufacturingBreakdown };
}

function calculatePileCage(input = {}) {
  const pile = normalizePileInput(input);
  const longitudinalBars = buildLongitudinalBars(pile);
  const spiralZones = enrichSpiralZones(pile, buildSpiralZones(pile));
  const hoops = buildHoops(pile);
  const validation = validatePileCage(pile, spiralZones, longitudinalBars, hoops);
  const manufacturingBreakdown = buildManufacturingBreakdown(pile, longitudinalBars, spiralZones, hoops);
  if (pile.roundPileCage) {
    const expected = ['longitudinal_straight_bar', 'longitudinal_l_bar', 'spiral_consolidated'];
    if (pile.hoopQuantity > 0 || pile.explicitHoopPositionsMm.length > 0) expected.push('hoop_ring');
    if (manufacturingBreakdown.length !== expected.length || expected.some(type => manufacturingBreakdown.filter(part => part.componentType === type).length !== 1)) {
      validation.errors.push({ code: 'invalid_component_contract', message: 'round pile cage must resolve to exactly its authored canonical production components' });
      validation.errorCodes.push('invalid_component_contract');
      validation.ok = false;
    }
  }
  const canonicalBreakdown = pile.roundPileCage && !validation.ok ? [] : manufacturingBreakdown;
  const data = buildDataContract(pile, longitudinalBars, spiralZones, hoops);
  const productionCards = validation.ok ? buildProductionCards(pile, canonicalBreakdown) : [];
  const calculated = buildCalculated(pile, longitudinalBars, spiralZones, hoops, canonicalBreakdown);
  const views = buildViews(pile, longitudinalBars, spiralZones, hoops);
  const geometry = { pileDiameterMm: pile.pileDiameterMm, pileLengthMm: pile.pileLengthMm, cageDiameterMm: calculated.cageDiameterMm, cageCenterlineDiameterMm: calculated.cageCenterlineDiameterMm, barCenterDiameterMm: round(barCenterDiameterMm(pile), 1), internalHoopDiameterMm: calculated.internalHoopDiameterMm, barCenterSpacingMm: calculated.barCenterSpacingMm, barClearSpacingMm: calculated.barClearSpacingMm, noSpiralStartMm: pile.noSpiralStartMm, noSpiralEndMm: pile.noSpiralEndMm };
  const assemblySummary = { identity: 'round_pile_cage', pileLengthMm: pile.pileLengthMm, pileDiameterMm: pile.pileDiameterMm, cageQuantity: 1, componentCount: canonicalBreakdown.length, productionCardCount: productionCards.length, totalSteelCutLengthMm: calculated.totalSteelLengthMm, totalWeightKg: calculated.totalWeightKg };
  return buildFullShapeSnapshot({ shapeVersion: pile.shapeVersion, shapeId: pile.shapeId, shapeType: 'round_pile_cage', family: 'piles', source: 'steel-rebar/PileCageEngine', data: { ...data, assemblySummary }, calculated, machineOutput: { generic: { shapeType: 'round_pile_cage', family: 'piles', pileDiameterMm: pile.pileDiameterMm, pileLengthMm: pile.pileLengthMm, manufacturingBreakdown: canonicalBreakdown, productionCards, assemblySummary }, machineProfiles: buildMachineProfilesPlaceholder() }, validation, extra: { productType: 'pile_cage', pitchMode: pile.pitchMode, manufacturingBreakdown: canonicalBreakdown, productionCards, assemblySummary, views, geometry, longitudinalBars, spiralZones, hoops } });
}

module.exports = { DEFAULT_PILE, calculatePileCage, normalizePileInput, buildLongitudinalBars, buildSpiralZones, defaultHoopPositions, validatePileCage, buildProductionCards };
