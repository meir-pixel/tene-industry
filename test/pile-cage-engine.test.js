'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePileCage } = require('../modules/steel-rebar/pile-cage-engine');
const { buildFullShapeSnapshot } = require('../services/shapeSnapshot');

function codes(result) {
  return result.validation.errorCodes;
}

function componentTypes(result) {
  return new Set(result.manufacturingBreakdown.map(part => part.componentType));
}

test('uniform spiral pile cage calculates active length correctly', () => {
  const pile = calculatePileCage({ pileLengthMm: 12000, noSpiralStartMm: 1000, noSpiralEndMm: 500, uniformPitchMm: 150 });

  assert.equal(pile.pitchMode, 'uniform');
  assert.equal(pile.calculated.activeSpiralLengthMm, 10500);
  assert.equal(pile.spiralZones.length, 1);
  assert.equal(pile.spiralZones[0].startMm, 1000);
  assert.equal(pile.spiralZones[0].endMm, 11500);
  assert.equal(pile.validation.ok, true);
});

test('start no-spiral and end no-spiral zones are allowed', () => {
  const pile = calculatePileCage({ pileLengthMm: 2200, noSpiralStartMm: 70, noSpiralEndMm: 200, uniformPitchMm: 100 });

  assert.equal(pile.validation.ok, true);
  assert.equal(pile.data.spiral.startNoSpiralMm, 70);
  assert.equal(pile.data.spiral.endNoSpiralMm, 200);
  assert.equal(pile.calculated.activeSpiralLengthMm, 1930);
});

test('no-spiral zone in middle is rejected', () => {
  const pile = calculatePileCage({ internalNoSpiralZones: [{ startMm: 900, lengthMm: 100 }] });

  assert.equal(pile.validation.ok, false);
  assert.ok(codes(pile).includes('no_spiral_zone_in_middle_not_allowed'));
});

test('spiral zones must cover active length', () => {
  const pile = calculatePileCage({
    pileLengthMm: 2200,
    pitchMode: 'zones',
    noSpiralStartMm: 70,
    noSpiralEndMm: 0,
    spiralZones: [{ name: 'A', lengthMm: 200, pitchMm: 100 }],
  });

  assert.equal(pile.validation.ok, false);
  assert.ok(codes(pile).includes('spiral_zones_do_not_cover_active_length'));
});

test('spiral turns are calculated per zone', () => {
  const pile = calculatePileCage({
    pileLengthMm: 2200,
    pitchMode: 'zones',
    spiralZones: [
      { name: 'A', lengthMm: 200, pitchMm: 100 },
      { name: 'B', lengthMm: 2000, pitchMm: 200 },
    ],
  });

  assert.equal(pile.validation.ok, true);
  assert.equal(pile.spiralZones[0].turnsCalculated, 2);
  assert.equal(pile.spiralZones[1].turnsCalculated, 10);
});

test('longitudinal bars uniform layout generates correct bar count', () => {
  const pile = calculatePileCage({ longitudinalBars: { totalBars: 26, defaultDiameterMm: 22, layoutMode: 'uniform' } });

  assert.equal(pile.data.longitudinalBars.layoutMode, 'uniform');
  assert.equal(pile.longitudinalBars.length, 26);
  assert.equal(pile.longitudinalBars.every(bar => bar.diameterMm === 22), true);
});

test('alternating straight/L bars generates correct pattern', () => {
  const pile = calculatePileCage({
    pileLengthMm: 10000,
    longitudinalBars: {
      totalBars: 9,
      layoutMode: 'alternating',
      pattern: [
        { repeat: 2, diameterMm: 20, type: 'straight' },
        { repeat: 1, diameterMm: 16, type: 'L', bendLengthMm: 500 },
      ],
    },
  });

  assert.deepEqual(pile.longitudinalBars.map(bar => bar.diameterMm), [20, 20, 16, 20, 20, 16, 20, 20, 16]);
  assert.deepEqual(pile.longitudinalBars.map(bar => bar.type), ['straight', 'straight', 'L', 'straight', 'straight', 'L', 'straight', 'straight', 'L']);
  assert.ok(pile.validation.warningCodes.includes('mixed_bar_diameters'));
  assert.ok(pile.validation.warningCodes.includes('mixed_bar_types'));
});

test('L bar includes bendLengthMm in length calculation', () => {
  const pile = calculatePileCage({
    pileLengthMm: 12000,
    longitudinalBars: { totalBars: 4, defaultType: 'L', defaultBendLengthMm: 400 },
  });

  assert.equal(pile.longitudinalBars[0].mainLengthMm, 12000);
  assert.equal(pile.longitudinalBars[0].bendLengthMm, 400);
  assert.equal(pile.longitudinalBars[0].lengthMm, 12400);
  assert.equal(pile.calculated.totalLBars, 4);
});

test('mixed diameters group correctly in manufacturing breakdown', () => {
  const pile = calculatePileCage({
    longitudinalBars: {
      totalBars: 3,
      bars: [
        { barIndex: 1, diameterMm: 20 },
        { barIndex: 2, diameterMm: 20 },
        { barIndex: 3, diameterMm: 16 },
      ],
    },
  });
  const barGroups = pile.manufacturingBreakdown.filter(part => part.sourceSystem === 'longitudinalBars');

  assert.equal(barGroups.length, 2);
  assert.deepEqual(barGroups.map(group => group.quantity).sort((a, b) => a - b), [1, 2]);
});

test('hoops by spacing calculate hoop count', () => {
  const pile = calculatePileCage({
    pileLengthMm: 12000,
    noSpiralStartMm: 1000,
    hoops: { spacingMode: 'bySpacing', spacingMm: 3000, hoopBarDiameterMm: 8 },
  });

  assert.equal(pile.hoops[0].barDiameterMm, 14);
  assert.deepEqual(pile.hoops[0].positionsMm, [1000, 4000, 7000, 10000]);
  assert.equal(pile.hoops[0].count, 4);
});


test('internal hoops calculate weld spacing from internal diameter', () => {
  const pile = calculatePileCage({
    pileDiameterMm: 400,
    concreteCoverMm: 0,
    spiralDiameterMm: 8,
    longitudinalBars: { totalBars: 6, defaultDiameterMm: 16 },
    hoops: { enabled: true, spacingMode: 'bySpacing', spacingMm: 200, hoopBarDiameterMm: 14 },
  });
  const hoop = pile.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');

  assert.equal(pile.calculated.internalHoopDiameterMm, 352);
  assert.equal(hoop.hoopDiameterMm, 352);
  assert.equal(hoop.hoopCutLengthMm, 1105.8);
  assert.equal(hoop.barCenterSpacingMm, 176);
  assert.equal(hoop.barClearSpacingMm, 160);
  assert.equal(pile.views.topView.barCenterSpacingMm, 176);
  assert.equal(pile.views.topView.barClearSpacingMm, 160);
});

test('manufacturing breakdown includes all required component types', () => {
  const pile = calculatePileCage({
    longitudinalBars: {
      totalBars: 4,
      pattern: [
        { repeat: 1, type: 'straight' },
        { repeat: 1, type: 'L', bendLengthMm: 400 },
      ],
    },
  });
  const types = componentTypes(pile);

  assert.ok(types.has('longitudinal_straight_bar'));
  assert.ok(types.has('longitudinal_l_bar'));
  assert.ok(types.has('spiral_zone'));
  assert.ok(types.has('hoop_ring'));
});

test('total weight equals component weights', () => {
  const pile = calculatePileCage({ longitudinalBars: { totalBars: 6 }, uniformPitchMm: 200 });
  const componentWeight = pile.manufacturingBreakdown.reduce((sum, part) => sum + part.weightKg, 0);

  assert.equal(pile.calculated.totalWeightKg, Math.round(componentWeight * 1000) / 1000);
  assert.equal(pile.calculated.weightKg, pile.calculated.totalWeightKg);
});

test('Shape V2 envelope remains valid for pile cage', () => {
  const pile = calculatePileCage({ shapeId: 'shape-test-1', shapeVersion: 3 });

  assert.equal(pile.contractVersion, 2);
  assert.equal(pile.shapeVersion, 3);
  assert.equal(pile.shapeId, 'shape-test-1');
  assert.equal(pile.shapeType, 'round_pile_cage');
  assert.equal(pile.family, 'piles');
  assert.ok(pile.data.general);
  assert.ok(pile.data.longitudinalBars);
  assert.ok(pile.data.spiral);
  assert.ok(pile.data.hoops);
  assert.ok(pile.calculated.manufacturingBreakdown);
  assert.ok(pile.machineOutput.generic);
  assert.deepEqual(Object.keys(pile.machineOutput.machineProfiles).sort(), ['MEP', 'PEDAX', 'SCHNELL']);
  assert.equal(typeof buildFullShapeSnapshot, 'function');
  assert.ok(pile.views.sideView);
  assert.ok(pile.views.topView);
  assert.ok(pile.views.isoView);
  assert.ok(pile.views.selectedBarView);
});


test('production cards include one master and component cards per pile unit', () => {
  const pile = calculatePileCage({ quantity: 2, longitudinalBars: { totalBars: 4 }, uniformPitchMm: 200 });
  const perUnitComponentCount = pile.manufacturingBreakdown.length;

  assert.equal(pile.productionCards.length, 2 * (1 + perUnitComponentCount));
  assert.equal(pile.productionCards.filter(card => card.cardType === 'pile_master').length, 2);
  assert.equal(pile.productionCards.filter(card => card.cardType === 'pile_component').length, 2 * perUnitComponentCount);
  assert.deepEqual(pile.productionCards.filter(card => card.cardType === 'pile_master').map(card => card.unitIndex), [1, 2]);
  assert.ok(pile.machineOutput.generic.productionCards.length === pile.productionCards.length);
});
