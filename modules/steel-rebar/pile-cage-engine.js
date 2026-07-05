'use strict';

const { rebarKgPerMeter } = require('./weights');

const DEFAULT_PILE = Object.freeze({
  pileDiameterMm: 680,
  pileLengthMm: 12000,
  concreteCoverMm: 50,
  longitudinalBarCount: 16,
  longitudinalDiameterMm: 20,
  spiralDiameterMm: 10,
  pitchMode: 'uniform',
  uniformPitchMm: 150,
  noSpiralStartMm: 0,
  noSpiralEndMm: 0,
  hoopDiameterMm: 8,
  hoopSpacingMm: 2000,
  hookLengthMm: 400,
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

function normalizePileInput(input = {}) {
  const pile = { ...DEFAULT_PILE, ...input };
  pile.pileDiameterMm = number(pile.pileDiameterMm ?? pile.pileDiameter, DEFAULT_PILE.pileDiameterMm, 1);
  pile.pileLengthMm = number(pile.pileLengthMm ?? pile.pileLength, DEFAULT_PILE.pileLengthMm, 1);
  pile.concreteCoverMm = number(pile.concreteCoverMm, DEFAULT_PILE.concreteCoverMm, 0);
  pile.longitudinalBarCount = Math.max(1, Math.round(number(pile.longitudinalBarCount ?? pile.longitudinalBars, DEFAULT_PILE.longitudinalBarCount, 1)));
  pile.longitudinalDiameterMm = number(pile.longitudinalDiameterMm ?? pile.longitudinalDiameter, DEFAULT_PILE.longitudinalDiameterMm, 1);
  pile.spiralDiameterMm = number(pile.spiralDiameterMm ?? pile.spiralDiameter, DEFAULT_PILE.spiralDiameterMm, 1);
  pile.pitchMode = pile.pitchMode === 'variable' ? 'variable' : 'uniform';
  pile.uniformPitchMm = number(pile.uniformPitchMm ?? pile.pitch, DEFAULT_PILE.uniformPitchMm, 1);
  pile.noSpiralStartMm = number(pile.noSpiralStartMm, DEFAULT_PILE.noSpiralStartMm, 0);
  pile.noSpiralEndMm = number(pile.noSpiralEndMm, DEFAULT_PILE.noSpiralEndMm, 0);
  pile.hoopDiameterMm = number(pile.hoopDiameterMm, DEFAULT_PILE.hoopDiameterMm, 1);
  pile.hoopSpacingMm = number(pile.hoopSpacingMm, DEFAULT_PILE.hoopSpacingMm, 1);
  pile.hookLengthMm = number(pile.hookLengthMm, DEFAULT_PILE.hookLengthMm, 0);
  pile.barPattern = Array.isArray(pile.barPattern) ? pile.barPattern : [];
  pile.barOverrides = Array.isArray(pile.barOverrides) ? pile.barOverrides : [];
  pile.spiralZones = Array.isArray(pile.spiralZones) ? pile.spiralZones : [];
  pile.hoops = Array.isArray(pile.hoops) ? pile.hoops : [];
  return pile;
}

function cageDiameterMm(pile) {
  return Math.max(1, pile.pileDiameterMm - 2 * pile.concreteCoverMm);
}

function barCenterDiameterMm(pile) {
  return Math.max(1, cageDiameterMm(pile) - pile.spiralDiameterMm - pile.longitudinalDiameterMm);
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

function buildLongitudinalBars(pile) {
  const overrides = new Map(pile.barOverrides.map(item => [Number(item.index), item]));
  const bars = [];
  for (let i = 1; i <= pile.longitudinalBarCount; i += 1) {
    const pattern = patternForIndex(pile.barPattern, i) || {};
    const override = overrides.get(i) || {};
    const diameterMm = number(override.diameterMm ?? pattern.diameterMm ?? pile.longitudinalDiameterMm, pile.longitudinalDiameterMm, 1);
    const shapeType = override.shapeType || pattern.shapeType || 'straight';
    const hookLengthMm = number(override.hookLengthMm ?? pattern.hookLengthMm ?? (shapeType === 'L' ? pile.hookLengthMm : 0), 0, 0);
    const lengthMm = pile.pileLengthMm + hookLengthMm;
    const angleDeg = round(((i - 1) * 360) / pile.longitudinalBarCount, 3);
    bars.push({ index: i, angleDeg, diameterMm, shapeType, hookLengthMm, lengthMm, weightKg: round((lengthMm / 1000) * rebarKgPerMeter(diameterMm), 3) });
  }
  return bars;
}

function buildSpiralZones(pile) {
  const availableLengthMm = Math.max(0, pile.pileLengthMm - pile.noSpiralStartMm - pile.noSpiralEndMm);
  if (pile.pitchMode === 'uniform') {
    return availableLengthMm > 0 ? [{ name: 'A', startMm: pile.noSpiralStartMm, lengthMm: availableLengthMm, pitchMm: pile.uniformPitchMm, type: 'spiral' }] : [];
  }
  let cursor = pile.noSpiralStartMm;
  return pile.spiralZones.map((zone, idx) => {
    const lengthMm = number(zone.lengthMm ?? zone.length, 0, 0);
    const pitchMm = number(zone.pitchMm ?? zone.pitch, pile.uniformPitchMm, 1);
    const out = { name: zone.name || String.fromCharCode(65 + idx), startMm: cursor, lengthMm, pitchMm, type: 'spiral' };
    cursor += lengthMm;
    return out;
  });
}

function enrichSpiralZones(pile, zones) {
  const diameterMm = Math.max(1, cageDiameterMm(pile) - pile.spiralDiameterMm);
  const circumferenceMm = Math.PI * diameterMm;
  return zones.map(zone => {
    const turns = zone.lengthMm > 0 ? zone.lengthMm / zone.pitchMm : 0;
    const helixPerTurnMm = Math.sqrt(circumferenceMm ** 2 + zone.pitchMm ** 2);
    const cutLengthMm = turns * helixPerTurnMm;
    return { ...zone, diameterMm: round(diameterMm, 1), circumferenceMm: round(circumferenceMm, 1), turns: round(turns, 2), cutLengthMm: round(cutLengthMm, 1), weightKg: round((cutLengthMm / 1000) * rebarKgPerMeter(pile.spiralDiameterMm), 3) };
  });
}

function buildHoops(pile) {
  const defaultHoop = { diameterMm: Math.max(1, cageDiameterMm(pile) - pile.longitudinalDiameterMm), barDiameterMm: pile.hoopDiameterMm };
  if (pile.hoops.length) {
    return pile.hoops.map((hoop, idx) => {
      const count = Math.max(1, Math.round(number(hoop.count, 1, 1)));
      const diameterMm = number(hoop.diameterMm, defaultHoop.diameterMm, 1);
      const barDiameterMm = number(hoop.barDiameterMm, defaultHoop.barDiameterMm, 1);
      const lengthMm = Math.PI * diameterMm;
      return { index: idx + 1, count, diameterMm, barDiameterMm, lengthMm: round(lengthMm, 1), totalLengthMm: round(lengthMm * count, 1), weightKg: round((lengthMm * count / 1000) * rebarKgPerMeter(barDiameterMm), 3) };
    });
  }
  const count = Math.max(0, Math.floor(pile.pileLengthMm / pile.hoopSpacingMm) + 1);
  const lengthMm = Math.PI * defaultHoop.diameterMm;
  return [{ index: 1, count, diameterMm: round(defaultHoop.diameterMm, 1), barDiameterMm: defaultHoop.barDiameterMm, lengthMm: round(lengthMm, 1), totalLengthMm: round(lengthMm * count, 1), weightKg: round((lengthMm * count / 1000) * rebarKgPerMeter(defaultHoop.barDiameterMm), 3) }];
}

function validatePileCage(pile, spiralZones) {
  const errors = [];
  const warnings = [];
  if (pile.pileDiameterMm <= 0) errors.push('pileDiameterMm must be positive');
  if (pile.pileLengthMm <= 0) errors.push('pileLengthMm must be positive');
  if (pile.concreteCoverMm * 2 >= pile.pileDiameterMm) errors.push('concreteCoverMm leaves no cage diameter');
  if (pile.noSpiralStartMm + pile.noSpiralEndMm >= pile.pileLengthMm) errors.push('no-spiral start/end zones cover the full pile length');
  if (pile.pitchMode === 'variable') {
    const sum = spiralZones.reduce((total, zone) => total + zone.lengthMm, 0);
    const expected = Math.max(0, pile.pileLengthMm - pile.noSpiralStartMm - pile.noSpiralEndMm);
    if (Math.abs(sum - expected) > 0.001) errors.push('variable spiral zone lengths must exactly fill the wrapped length');
  }
  if (pile.internalNoSpiralZones && pile.internalNoSpiralZones.length) errors.push('internal no-spiral gaps are not allowed');
  if (pile.longitudinalBarCount < 3) warnings.push('longitudinalBarCount is unusually low for a pile cage');
  if (pile.uniformPitchMm > pile.pileDiameterMm) warnings.push('uniformPitchMm is very large compared with pile diameter');
  return { ok: errors.length === 0, errors, warnings };
}

function groupBarsForProduction(bars) {
  const map = new Map();
  for (const bar of bars) {
    const key = `${bar.diameterMm}|${bar.shapeType}|${bar.hookLengthMm}|${bar.lengthMm}`;
    if (!map.has(key)) map.set(key, { type: 'longitudinal_bar', diameterMm: bar.diameterMm, shapeType: bar.shapeType, hookLengthMm: bar.hookLengthMm, lengthMm: bar.lengthMm, quantity: 0, barIndexes: [], totalLengthMm: 0, weightKg: 0 });
    const group = map.get(key);
    group.quantity += 1;
    group.barIndexes.push(bar.index);
    group.totalLengthMm += bar.lengthMm;
    group.weightKg += bar.weightKg;
  }
  return Array.from(map.values()).map(group => ({ ...group, totalLengthMm: round(group.totalLengthMm, 1), weightKg: round(group.weightKg, 3) }));
}

function calculatePileCage(input = {}) {
  const pile = normalizePileInput(input);
  const longitudinalBars = buildLongitudinalBars(pile);
  const spiralZones = enrichSpiralZones(pile, buildSpiralZones(pile));
  const hoops = buildHoops(pile);
  const validation = validatePileCage(pile, spiralZones);
  const totalLongitudinalLengthMm = longitudinalBars.reduce((sum, bar) => sum + bar.lengthMm, 0);
  const totalSpiralLengthMm = spiralZones.reduce((sum, zone) => sum + zone.cutLengthMm, 0);
  const totalHoopLengthMm = hoops.reduce((sum, hoop) => sum + hoop.totalLengthMm, 0);
  const weightKg = longitudinalBars.reduce((sum, bar) => sum + bar.weightKg, 0) + spiralZones.reduce((sum, zone) => sum + zone.weightKg, 0) + hoops.reduce((sum, hoop) => sum + hoop.weightKg, 0);
  const geometry = {
    pileDiameterMm: pile.pileDiameterMm,
    pileLengthMm: pile.pileLengthMm,
    cageDiameterMm: round(cageDiameterMm(pile), 1),
    barCenterDiameterMm: round(barCenterDiameterMm(pile), 1),
    noSpiralStartMm: pile.noSpiralStartMm,
    noSpiralEndMm: pile.noSpiralEndMm,
  };
  const manufacturingBreakdown = [
    ...groupBarsForProduction(longitudinalBars),
    ...spiralZones.map(zone => ({ type: 'spiral', name: zone.name, diameterMm: pile.spiralDiameterMm, pitchMm: zone.pitchMm, lengthMm: zone.cutLengthMm, quantity: 1, startMm: zone.startMm, zoneLengthMm: zone.lengthMm, turns: zone.turns, weightKg: zone.weightKg })),
    ...hoops.map(hoop => ({ type: 'internal_hoop', diameterMm: hoop.barDiameterMm, hoopDiameterMm: hoop.diameterMm, lengthMm: hoop.lengthMm, quantity: hoop.count, totalLengthMm: hoop.totalLengthMm, weightKg: hoop.weightKg })),
  ];
  return {
    family: 'piles',
    productType: 'pile_cage',
    pitchMode: pile.pitchMode,
    geometry,
    longitudinalBars,
    spiralZones,
    hoops,
    calculated: {
      totalLongitudinalLengthMm: round(totalLongitudinalLengthMm, 1),
      totalSpiralLengthMm: round(totalSpiralLengthMm, 1),
      totalHoopLengthMm: round(totalHoopLengthMm, 1),
      totalLengthMm: round(totalLongitudinalLengthMm + totalSpiralLengthMm + totalHoopLengthMm, 1),
      weightKg: round(weightKg, 3),
    },
    manufacturingBreakdown,
    validation,
  };
}

module.exports = {
  DEFAULT_PILE,
  calculatePileCage,
  normalizePileInput,
  buildLongitudinalBars,
  buildSpiralZones,
  validatePileCage,
};

