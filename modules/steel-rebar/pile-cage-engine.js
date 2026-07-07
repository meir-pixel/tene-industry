'use strict';

const { rebarKgPerMeter } = require('./weights');
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
});

function number(value, fallback = 0, min = null) {
  const n = Number(value);
  const out = Number.isFinite(n) ? n : fallback;
  return min === null ? out : Math.max(min, out);
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

function normalizePileInput(input = {}) {
  const generalInput = input.general || {};
  const barsInput = input.longitudinalBars || {};
  const spiralInput = input.spiral || {};
  const hoopsInput = input.hoops || {};
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
  pile.longitudinalBarCount = Math.max(1, Math.round(number(barsInput.totalBars ?? input.longitudinalBarCount ?? input.longitudinalBars, DEFAULT_PILE.longitudinalBarCount, 1)));
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
  pile.barPattern = Array.isArray(barsInput.pattern) ? barsInput.pattern : (Array.isArray(input.barPattern) ? input.barPattern : []);
  pile.barOverrides = Array.isArray(barsInput.bars) ? barsInput.bars : (Array.isArray(input.barOverrides) ? input.barOverrides : []);
  pile.spiralEnabled = spiralInput.enabled !== false && input.spiralEnabled !== false;
  pile.spiralDiameterMm = number(spiralInput.barDiameterMm ?? input.spiralDiameterMm ?? input.spiralDiameter, DEFAULT_PILE.spiralDiameterMm, 1);
  pile.spiralCenterlineDiameterMm = number(spiralInput.spiralDiameterMm ?? input.spiralCenterlineDiameterMm, 0, 0);
  pile.pitchMode = normalizePitchMode(spiralInput.pitchMode ?? input.pitchMode);
  pile.uniformPitchMm = number(spiralInput.uniformPitchMm ?? input.uniformPitchMm ?? input.pitch, DEFAULT_PILE.uniformPitchMm, 1);
  pile.noSpiralStartMm = number(spiralInput.startNoSpiralMm ?? input.noSpiralStartMm, DEFAULT_PILE.noSpiralStartMm, 0);
  pile.noSpiralEndMm = number(spiralInput.endNoSpiralMm ?? input.noSpiralEndMm, DEFAULT_PILE.noSpiralEndMm, 0);
  pile.spiralZones = Array.isArray(spiralInput.zones) ? spiralInput.zones : (Array.isArray(input.spiralZones) ? input.spiralZones : []);
  pile.internalNoSpiralZones = Array.isArray(input.internalNoSpiralZones) ? input.internalNoSpiralZones : [];
  pile.hoopsEnabled = hoopsInput.enabled !== false && input.hoopsEnabled !== false;
  pile.hoopBarDiameterMm = Math.max(14, number(hoopsInput.hoopBarDiameterMm ?? input.hoopDiameterMm, DEFAULT_PILE.hoopDiameterMm, 1));
  pile.hoopDiameterMm = number(hoopsInput.hoopDiameterMm ?? input.hoopRingDiameterMm, 0, 0);
  pile.hoopSpacingMode = hoopsInput.spacingMode === 'byQuantity' ? 'byQuantity' : 'bySpacing';
  pile.hoopSpacingMm = number(hoopsInput.spacingMm ?? input.hoopSpacingMm, DEFAULT_PILE.hoopSpacingMm, 1);
  pile.hoopQuantity = Math.max(0, Math.round(number(hoopsInput.quantity ?? input.hoopQuantity, 0, 0)));
  pile.firstHoopOffsetMm = number(hoopsInput.firstHoopOffsetMm ?? input.firstHoopOffsetMm ?? pile.noSpiralStartMm, pile.noSpiralStartMm, 0);
  pile.lastHoopOffsetMm = number(hoopsInput.lastHoopOffsetMm ?? input.lastHoopOffsetMm ?? pile.noSpiralEndMm, pile.noSpiralEndMm, 0);
  pile.hoopShape = hoopsInput.shape || input.hoopShape || 'round';
  pile.productionQuantity = Math.max(1, Math.round(number(input.productionQuantity ?? input.quantity, 1, 1)));
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

function hoopCutLengthMm(diameterMm, shape) {
  const sides = hoopShapeSides(shape);
  if (sides > 2) return sides * diameterMm * Math.sin(Math.PI / sides);
  return Math.PI * diameterMm;
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
  const lengthMm = mainLengthMm + (type === 'L' ? bendLengthMm : 0);
  const positionAngleDeg = round(((index - 1) * 360) / pile.longitudinalBarCount, 3);
  return { barIndex: index, index, diameterMm, type, shapeType: type, mainLengthMm, bendLengthMm, hookLengthMm: bendLengthMm, bendHeightMm, bendAngleDeg, bendDirection, positionAngleDeg, angleDeg: positionAngleDeg, lengthMm, weightKg: round((lengthMm / 1000) * rebarKgPerMeter(diameterMm), 3), note: override.note ?? pattern.note ?? '' };
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
  if (pile.pitchMode === 'uniform') return [{ zoneIndex: 1, name: 'A', startMm: pile.noSpiralStartMm, endMm: pile.noSpiralStartMm + activeLengthMm, lengthMm: activeLengthMm, pitchMm: pile.uniformPitchMm, type: 'spiral' }];
  let cursor = pile.noSpiralStartMm;
  return pile.spiralZones.map((zone, idx) => {
    const lengthMm = number(zone.lengthMm ?? zone.length, 0, 0);
    const pitchMm = number(zone.pitchMm ?? zone.pitch, pile.uniformPitchMm, 1);
    const out = { zoneIndex: idx + 1, name: zone.name || String.fromCharCode(65 + idx), startMm: cursor, endMm: cursor + lengthMm, lengthMm, pitchMm, type: 'spiral' };
    cursor += lengthMm;
    return out;
  });
}

function enrichSpiralZones(pile, zones) {
  const diameterMm = cageCenterlineDiameterMm(pile);
  const circumferenceMm = Math.PI * diameterMm;
  return zones.map(zone => {
    const turnsCalculated = zone.lengthMm > 0 ? zone.lengthMm / zone.pitchMm : 0;
    const helixPerTurnMm = Math.sqrt(circumferenceMm ** 2 + zone.pitchMm ** 2);
    const totalLengthMm = turnsCalculated * helixPerTurnMm;
    return { ...zone, barDiameterMm: pile.spiralDiameterMm, diameterMm: round(diameterMm, 1), spiralDiameterMm: round(diameterMm, 1), circumferenceMm: round(circumferenceMm, 1), turns: round(turnsCalculated, 2), turnsCalculated: round(turnsCalculated, 2), cutLengthMm: round(totalLengthMm, 1), totalLengthMm: round(totalLengthMm, 1), weightKg: round((totalLengthMm / 1000) * rebarKgPerMeter(pile.spiralDiameterMm), 3) };
  });
}

function defaultHoopPositions(pile) {
  if (!pile.hoopsEnabled) return [];
  const startMm = Math.min(pile.pileLengthMm, pile.firstHoopOffsetMm);
  const endMm = Math.max(startMm, pile.pileLengthMm - pile.lastHoopOffsetMm);
  if (pile.hoopSpacingMode === 'byQuantity' && pile.hoopQuantity > 0) {
    if (pile.hoopQuantity === 1) return [round(startMm, 1)];
    const step = (endMm - startMm) / (pile.hoopQuantity - 1);
    return Array.from({ length: pile.hoopQuantity }, (_, i) => round(startMm + i * step, 1));
  }
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
  const lengthMm = hoopCutLengthMm(hoopDiameterMm, pile.hoopShape);
  const spacing = longitudinalBarSpacingMm(hoopDiameterMm, pile.longitudinalBarCount, pile.longitudinalDiameterMm);
  const weightKg = round((lengthMm * count / 1000) * rebarKgPerMeter(pile.hoopBarDiameterMm), 3);
  return [{ index: 1, count, hoopCount: count, spacingMode: pile.hoopSpacingMode, spacingMm: pile.hoopSpacingMode === 'bySpacing' ? pile.hoopSpacingMm : null, positionsMm, startFromMm: positionsMm[0] ?? 0, diameterMm: round(hoopDiameterMm, 1), hoopDiameterMm: round(hoopDiameterMm, 1), barDiameterMm: pile.hoopBarDiameterMm, hoopBarDiameterMm: pile.hoopBarDiameterMm, shape: pile.hoopShape, shapeSides: hoopShapeSides(pile.hoopShape), lengthMm: round(lengthMm, 1), hoopCutLengthMm: round(lengthMm, 1), barCenterSpacingMm: spacing.centerToCenterMm, barClearSpacingMm: spacing.clearMm, totalLengthMm: round(lengthMm * count, 1), totalHoopLengthMm: round(lengthMm * count, 1), weightKg, totalHoopWeightKg: weightKg }];
}

function validatePileCage(pile, spiralZones, bars = [], hoops = []) {
  const errors = [];
  const warnings = [];
  const addError = (code, message) => errors.push({ code, message });
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
    if (pile.uniformPitchMm <= 0) addError('invalid_spiral_pitch', 'uniformPitchMm must be positive');
    if (pile.noSpiralStartMm < 0 || pile.noSpiralEndMm < 0) addError('invalid_no_spiral_length', 'no-spiral lengths must be non-negative');
    if (activeSpiralLengthMm(pile) <= 0) addError('spiral_active_length_not_positive', 'active spiral length must be positive');
    if (pile.pitchMode === 'zones') {
      const expected = activeSpiralLengthMm(pile);
      const sum = spiralZones.reduce((total, zone) => total + zone.lengthMm, 0);
      if (Math.abs(sum - expected) > 0.001) addError('spiral_zones_do_not_cover_active_length', 'spiral zones must exactly fill the active spiral length');
      for (let i = 1; i < spiralZones.length; i += 1) if (spiralZones[i].startMm < spiralZones[i - 1].endMm) addError('spiral_zone_overlap', 'spiral zones must not overlap');
    }
    if (pile.internalNoSpiralZones.length) addError('no_spiral_zone_in_middle_not_allowed', 'internal no-spiral gaps are not allowed');
    if (pile.uniformPitchMm < Math.max(20, pile.spiralDiameterMm * 6)) addWarning('very_dense_spiral_pitch', 'spiral pitch is very dense');
  }
  if (pile.hoopsEnabled) {
    if (pile.hoopBarDiameterMm <= 0) addError('invalid_hoop_bar_diameter', 'hoopBarDiameterMm must be positive');
    if (hoops[0] && hoops[0].diameterMm <= 0) addError('invalid_hoop_diameter', 'hoopDiameterMm must be positive');
    if (pile.hoopSpacingMode === 'bySpacing' && pile.hoopSpacingMm <= 0) addError('invalid_hoop_spacing', 'hoop spacingMm must be positive');
    if (pile.hoopSpacingMode === 'byQuantity' && pile.hoopQuantity <= 0) addError('invalid_hoop_quantity', 'hoop quantity must be positive');
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
    if (!map.has(key)) map.set(key, { componentType, type: componentType, sourceSystem: 'longitudinalBars', description: bar.type === 'L' ? 'Longitudinal L bar' : 'Longitudinal straight bar', diameterMm: bar.diameterMm, shapeType: bar.type, mainLengthMm: bar.mainLengthMm, bendLengthMm: bar.bendLengthMm, bendHeightMm: bar.bendHeightMm, bendAngleDeg: bar.bendAngleDeg, lengthMm: bar.lengthMm, quantity: 0, barIndexes: [], totalLengthMm: 0, weightKg: 0 });
    const group = map.get(key);
    group.quantity += 1;
    group.barIndexes.push(bar.barIndex);
    group.totalLengthMm += bar.lengthMm;
    group.weightKg += bar.weightKg;
  }
  return Array.from(map.values()).map(group => ({ ...group, totalLengthMm: round(group.totalLengthMm, 1), weightKg: round(group.weightKg, 3) }));
}

function buildManufacturingBreakdown(pile, bars, spiralZones, hoops) {
  return [
    ...groupBarsForProduction(bars),
    ...spiralZones.map(zone => ({ componentType: 'spiral_zone', type: 'spiral_zone', sourceSystem: 'spiral', description: `Spiral zone ${zone.name}`, name: zone.name, zoneIndex: zone.zoneIndex, diameterMm: pile.spiralDiameterMm, pitchMm: zone.pitchMm, lengthMm: zone.totalLengthMm, quantity: 1, startMm: zone.startMm, endMm: zone.endMm, zoneLengthMm: zone.lengthMm, turns: zone.turnsCalculated, totalLengthMm: zone.totalLengthMm, weightKg: zone.weightKg })),
    ...hoops.map(hoop => ({ componentType: 'hoop_ring', type: 'hoop_ring', sourceSystem: 'hoops', description: 'Internal hoop ring', diameterMm: hoop.barDiameterMm, hoopDiameterMm: hoop.diameterMm, shape: hoop.shape, shapeSides: hoop.shapeSides, lengthMm: hoop.lengthMm, hoopCutLengthMm: hoop.hoopCutLengthMm, barCenterSpacingMm: hoop.barCenterSpacingMm, barClearSpacingMm: hoop.barClearSpacingMm, quantity: hoop.count, spacingMm: hoop.spacingMm, positionsMm: hoop.positionsMm, totalLengthMm: hoop.totalLengthMm, weightKg: hoop.weightKg })),
  ];
}

function productionComponentLabel(part) {
  if (part.componentType === 'longitudinal_l_bar') return 'Longitudinal L bars';
  if (part.componentType === 'longitudinal_straight_bar') return 'Longitudinal straight bars';
  if (part.componentType === 'spiral_zone') return `Spiral zone ${part.name || part.zoneIndex || ''}`.trim();
  if (part.componentType === 'hoop_ring') return 'Internal reinforcement hoops';
  return part.description || part.componentType || 'Pile cage component';
}

function buildProductionCards(pile, manufacturingBreakdown) {
  const unitTotal = pile.productionQuantity;
  const cards = [];
  for (let unitIndex = 1; unitIndex <= unitTotal; unitIndex += 1) {
    cards.push({
      cardType: 'pile_master',
      componentType: 'pile_master',
      title: `Pile cage ${unitIndex}/${unitTotal}`,
      description: 'Complete pile cage unit',
      unitIndex,
      unitTotal,
      componentIndex: 0,
      quantity: 1,
      totalLengthMm: pile.pileLengthMm,
      weightKg: null,
      diameterMm: pile.longitudinalDiameterMm,
      scanCodeSuffix: `P${unitIndex}-MASTER`,
    });
    manufacturingBreakdown.forEach((part, index) => {
      cards.push({
        cardType: 'pile_component',
        componentType: part.componentType || part.type,
        title: productionComponentLabel(part),
        description: part.description || productionComponentLabel(part),
        unitIndex,
        unitTotal,
        componentIndex: index + 1,
        quantity: Number(part.quantity) || 1,
        diameterMm: Number(part.diameterMm) || Number(part.barDiameterMm) || pile.longitudinalDiameterMm,
        hoopDiameterMm: part.hoopDiameterMm || null,
        barCenterSpacingMm: part.barCenterSpacingMm || null,
        barClearSpacingMm: part.barClearSpacingMm || null,
        pitchMm: part.pitchMm || null,
        totalLengthMm: Number(part.totalLengthMm || part.lengthMm || 0),
        lengthMm: Number(part.lengthMm || part.totalLengthMm || 0),
        weightKg: Number(part.weightKg || 0),
        positionsMm: part.positionsMm || null,
        source: part,
        scanCodeSuffix: `P${unitIndex}-C${index + 1}`,
      });
    });
  }
  return cards;
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
    sideView: { pileLengthMm: pile.pileLengthMm, activeSpiralLengthMm: activeSpiralLengthMm(pile), startNoSpiralMm: pile.noSpiralStartMm, endNoSpiralMm: pile.noSpiralEndMm, spiralZones: spiralZones.map(zone => ({ zoneIndex: zone.zoneIndex, name: zone.name, startMm: zone.startMm, endMm: zone.endMm, lengthMm: zone.lengthMm, pitchMm: zone.pitchMm, label: `${zone.name} @${zone.pitchMm}` })), hoops: hoops.flatMap(hoop => hoop.positionsMm || []), longitudinalBars: bars.map(bar => ({ barIndex: bar.barIndex, diameterMm: bar.diameterMm, type: bar.type })) },
    topView: { pileDiameterMm: pile.pileDiameterMm, cageDiameterMm: round(cageDiameterMm(pile), 1), cageCenterlineDiameterMm: round(cageCenterlineDiameterMm(pile), 1), internalHoopDiameterMm: hoops[0]?.diameterMm ?? internalHoopDiameterMm(pile), barCenterSpacingMm: hoops[0]?.barCenterSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).centerToCenterMm, barClearSpacingMm: hoops[0]?.barClearSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).clearMm, bars: bars.map(bar => ({ barIndex: bar.barIndex, positionAngleDeg: bar.positionAngleDeg, diameterMm: bar.diameterMm, type: bar.type })), legend: { straight: 'straight longitudinal bar', L: 'L longitudinal bar', mixedDiameters: new Set(bars.map(bar => bar.diameterMm)).size > 1 } },
    isoView: { cageDiameterMm: round(cageDiameterMm(pile), 1), pileLengthMm: pile.pileLengthMm, longitudinalBars: bars.length, spiralZones: spiralZones.length, hoops: hoops.reduce((sum, hoop) => sum + hoop.count, 0) },
    selectedBarView: bars.map(bar => ({ barIndex: bar.barIndex, type: bar.type, mainLengthMm: bar.mainLengthMm, bendLengthMm: bar.bendLengthMm, bendHeightMm: bar.bendHeightMm, bendAngleDeg: bar.bendAngleDeg, bendDirection: bar.bendDirection, diameterMm: bar.diameterMm })),
  };
}

function buildDataContract(pile, bars, spiralZones, hoops) {
  return {
    general: { pileDiameterMm: pile.pileDiameterMm, pileLengthMm: pile.pileLengthMm, concreteCoverMm: pile.concreteCoverMm, cageDiameterMm: round(cageDiameterMm(pile), 1), cageCenterlineDiameterMm: round(cageCenterlineDiameterMm(pile), 1), shapeVersion: pile.shapeVersion, shapeId: pile.shapeId, family: 'piles' },
    longitudinalBars: { totalBars: pile.longitudinalBarCount, defaultDiameterMm: pile.longitudinalDiameterMm, defaultLengthMm: pile.longitudinalDefaultLengthMm, layoutMode: pile.longitudinalLayoutMode, bars },
    spiral: { enabled: pile.spiralEnabled, barDiameterMm: pile.spiralDiameterMm, spiralDiameterMm: round(cageCenterlineDiameterMm(pile), 1), pitchMode: pile.pitchMode, uniformPitchMm: pile.uniformPitchMm, startNoSpiralMm: pile.noSpiralStartMm, endNoSpiralMm: pile.noSpiralEndMm, zones: spiralZones },
    hoops: { enabled: pile.hoopsEnabled, hoopBarDiameterMm: pile.hoopBarDiameterMm, hoopDiameterMm: hoops[0]?.diameterMm ?? internalHoopDiameterMm(pile), spacingMode: pile.hoopSpacingMode, spacingMm: pile.hoopSpacingMm, quantity: pile.hoopQuantity || hoops.reduce((sum, hoop) => sum + hoop.count, 0), firstHoopOffsetMm: pile.firstHoopOffsetMm, lastHoopOffsetMm: pile.lastHoopOffsetMm, shape: pile.hoopShape, barCenterSpacingMm: hoops[0]?.barCenterSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).centerToCenterMm, barClearSpacingMm: hoops[0]?.barClearSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).clearMm, rings: hoops },
  };
}

function buildCalculated(pile, bars, spiralZones, hoops, manufacturingBreakdown) {
  const totalLongitudinalLengthMm = bars.reduce((sum, bar) => sum + bar.lengthMm, 0);
  const totalLongitudinalWeightKg = bars.reduce((sum, bar) => sum + bar.weightKg, 0);
  const totalSpiralLengthMm = spiralZones.reduce((sum, zone) => sum + zone.totalLengthMm, 0);
  const totalSpiralWeightKg = spiralZones.reduce((sum, zone) => sum + zone.weightKg, 0);
  const totalHoopLengthMm = hoops.reduce((sum, hoop) => sum + hoop.totalLengthMm, 0);
  const totalHoopWeightKg = hoops.reduce((sum, hoop) => sum + hoop.weightKg, 0);
  const totalSteelLengthMm = totalLongitudinalLengthMm + totalSpiralLengthMm + totalHoopLengthMm;
  const totalWeightKg = totalLongitudinalWeightKg + totalSpiralWeightKg + totalHoopWeightKg;
  return { cageDiameterMm: round(cageDiameterMm(pile), 1), cageCenterlineDiameterMm: round(cageCenterlineDiameterMm(pile), 1), activeSpiralLengthMm: activeSpiralLengthMm(pile), totalStraightBars: bars.filter(bar => bar.type === 'straight').length, totalLBars: bars.filter(bar => bar.type === 'L').length, totalLongitudinalLengthMm: round(totalLongitudinalLengthMm, 1), totalLongitudinalWeightKg: round(totalLongitudinalWeightKg, 3), totalSpiralLengthMm: round(totalSpiralLengthMm, 1), totalSpiralWeightKg: round(totalSpiralWeightKg, 3), totalHoopLengthMm: round(totalHoopLengthMm, 1), totalHoopWeightKg: round(totalHoopWeightKg, 3), totalSteelLengthMm: round(totalSteelLengthMm, 1), totalLengthMm: round(totalSteelLengthMm, 1), totalWeightKg: round(totalWeightKg, 3), weightKg: round(totalWeightKg, 3), internalHoopDiameterMm: hoops[0]?.diameterMm ?? internalHoopDiameterMm(pile), hoopCutLengthMm: hoops[0]?.lengthMm ?? 0, barCenterSpacingMm: hoops[0]?.barCenterSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).centerToCenterMm, barClearSpacingMm: hoops[0]?.barClearSpacingMm ?? longitudinalBarSpacingMm(internalHoopDiameterMm(pile), pile.longitudinalBarCount, pile.longitudinalDiameterMm).clearMm, weightByComponent: { longitudinalBars: round(totalLongitudinalWeightKg, 3), spiral: round(totalSpiralWeightKg, 3), hoops: round(totalHoopWeightKg, 3) }, weightByDiameter: sumBy(manufacturingBreakdown, part => part.diameterMm, part => part.weightKg), groupedBarSummary: groupBarsForProduction(bars), manufacturingBreakdown };
}

function calculatePileCage(input = {}) {
  const pile = normalizePileInput(input);
  const longitudinalBars = buildLongitudinalBars(pile);
  const spiralZones = enrichSpiralZones(pile, buildSpiralZones(pile));
  const hoops = buildHoops(pile);
  const validation = validatePileCage(pile, spiralZones, longitudinalBars, hoops);
  const manufacturingBreakdown = buildManufacturingBreakdown(pile, longitudinalBars, spiralZones, hoops);
  const data = buildDataContract(pile, longitudinalBars, spiralZones, hoops);
  const productionCards = buildProductionCards(pile, manufacturingBreakdown);
  const calculated = buildCalculated(pile, longitudinalBars, spiralZones, hoops, manufacturingBreakdown);
  const views = buildViews(pile, longitudinalBars, spiralZones, hoops);
  const geometry = { pileDiameterMm: pile.pileDiameterMm, pileLengthMm: pile.pileLengthMm, cageDiameterMm: calculated.cageDiameterMm, cageCenterlineDiameterMm: calculated.cageCenterlineDiameterMm, barCenterDiameterMm: round(barCenterDiameterMm(pile), 1), internalHoopDiameterMm: calculated.internalHoopDiameterMm, barCenterSpacingMm: calculated.barCenterSpacingMm, barClearSpacingMm: calculated.barClearSpacingMm, noSpiralStartMm: pile.noSpiralStartMm, noSpiralEndMm: pile.noSpiralEndMm };
  return buildFullShapeSnapshot({ shapeVersion: pile.shapeVersion, shapeId: pile.shapeId, shapeType: 'round_pile_cage', family: 'piles', source: 'steel-rebar/PileCageEngine', data, calculated, machineOutput: { generic: { shapeType: 'round_pile_cage', family: 'piles', pileDiameterMm: pile.pileDiameterMm, pileLengthMm: pile.pileLengthMm, manufacturingBreakdown, productionCards }, machineProfiles: buildMachineProfilesPlaceholder() }, validation, extra: { productType: 'pile_cage', pitchMode: pile.pitchMode, manufacturingBreakdown, productionCards, views, geometry, longitudinalBars, spiralZones, hoops } });
}

module.exports = { DEFAULT_PILE, calculatePileCage, normalizePileInput, buildLongitudinalBars, buildSpiralZones, defaultHoopPositions, validatePileCage, buildProductionCards };
