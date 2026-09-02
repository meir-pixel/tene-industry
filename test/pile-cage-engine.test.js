'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePileCage } = require('../modules/steel-rebar/pile-cage-engine');
const { buildBarsShapeContract, buildRingShapeContract, calculateHelicalSpiral } = require('../modules/steel-rebar/shapes');
const { buildFullShapeSnapshot } = require('../services/shapeSnapshot');

function codes(result) {
  return result.validation.errorCodes;
}

function componentTypes(result) {
  return new Set(result.manufacturingBreakdown.map(part => part.componentType));
}

function completeRoundPileInput() {
  return {
    roundPileCage: true,
    pileDiameterMm: 600,
    pileLengthMm: 12000,
    longitudinalBars: { totalBars: 10, defaultDiameterMm: 20, defaultLengthMm: 12000, layoutMode: 'alternating', pattern: [{ type: 'straight', lengthMm: 12000 }, { type: 'L', lengthMm: 12000, bendLengthMm: 200 }] },
    spiral: { barDiameterMm: 8, outerDiameterMm: 480, pitchMode: 'zones', zones: [{ name: 'A', lengthMm: 3000, pitchMm: 150 }, { name: 'B', lengthMm: 2000, noWrap: true }, { name: 'C', lengthMm: 7000, pitchMm: 200 }] },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
  };
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

test('pile bend orientation is snapshot metadata and never changes canonical L-bar material', () => {
  const base = completeRoundPileInput();
  base.longitudinalBars.defaultBendOrientationDeg = 42.75;
  const oriented = calculatePileCage(base);
  const neutralInput = completeRoundPileInput();
  neutralInput.longitudinalBars.defaultBendOrientationDeg = 0;
  const neutral = calculatePileCage(neutralInput);
  const bentBars = oriented.data.longitudinalBars.bars.filter(bar => bar.type === 'L');

  assert.equal(oriented.data.longitudinalBars.defaultBendOrientationDeg, 42.75);
  assert.equal(oriented.data.longitudinalBars.bendOrientationReference, 'radial_inward');
  assert.equal(oriented.data.longitudinalBars.bendOrientationPositive, 'clockwise');
  assert.equal(bentBars.every(bar => bar.bendOrientationDeg === 42.75), true);
  assert.equal(oriented.views.topView.bendOrientationReference, 'radial_inward');
  assert.equal(oriented.views.topView.bars.filter(bar => bar.type === 'L').every(bar => bar.bendOrientationDeg === 42.75), true);
  assert.equal(oriented.calculated.totalSteelLengthMm, neutral.calculated.totalSteelLengthMm);
  assert.equal(oriented.calculated.totalWeightKg, neutral.calculated.totalWeightKg);
  assert.deepEqual(
    oriented.manufacturingBreakdown.map(part => ({ type: part.componentType, unit: part.unitLengthMm, total: part.totalLengthMm, weight: part.weightKg })),
    neutral.manufacturingBreakdown.map(part => ({ type: part.componentType, unit: part.unitLengthMm, total: part.totalLengthMm, weight: part.weightKg })),
  );
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

  assert.equal(pile.hoops[0].barDiameterMm, 8);
  assert.deepEqual(pile.hoops[0].positionsMm, [1000, 4000, 7000, 10000]);
  assert.equal(pile.hoops[0].count, 4);
});

test('round pile cage uses the authored hoop quantity for positions, steel and production', () => {
  for (const quantity of [1, 3, 5, 8]) {
    const input = completeRoundPileInput();
    input.hoops = { ...input.hoops, quantity, firstHoopOffsetMm: 1000, spacingMm: 1000 };
    const pile = calculatePileCage(input);
    const ring = pile.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');
    const expectedPositions = Array.from({ length: quantity }, (_, index) => 1000 + index * 1000);
    const standalone = buildRingShapeContract({ barDiameterMm: 18, bendingDiameterMm: 420, quantity });

    assert.equal(pile.validation.ok, true, `quantity ${quantity} must be a valid cage-specific value`);
    assert.equal(pile.data.hoops.quantity, quantity);
    assert.deepEqual(pile.data.hoops.positionsMm, expectedPositions);
    assert.equal(ring.quantity, quantity);
    assert.equal(ring.totalLengthMm, standalone.component.totalLengthMm);
    assert.equal(ring.weightKg, standalone.component.weightKg);
    assert.equal(pile.productionCards.find(card => card.componentType === 'hoop_ring').quantity, quantity);
  }
});

test('round pile cage keeps arbitrary out-of-range hoop stations and fails closed with the exact position', () => {
  const input = completeRoundPileInput();
  input.hoops = { ...input.hoops, quantity: 7, firstHoopOffsetMm: 7000, spacingMm: 1000 };
  const pile = calculatePileCage(input);

  assert.equal(pile.validation.ok, false);
  assert.ok(pile.validation.errorCodes.includes('hoop_position_out_of_range'));
  assert.match(pile.validation.errors.find(error => error.code === 'hoop_position_out_of_range').message, /P7=13000mm/);
  assert.deepEqual(pile.data.hoops.positionsMm, [7000, 8000, 9000, 10000, 11000, 12000, 13000]);
  assert.deepEqual(pile.manufacturingBreakdown, []);
  assert.deepEqual(pile.productionCards, []);
});

test('round pile cage accepts an authored zero hoop quantity without fabricating material or a card', () => {
  const input = completeRoundPileInput();
  input.hoops = { enabled: true, spacingMode: 'byQuantity', quantity: 0, firstHoopOffsetMm: 1500, spacingMm: 300 };
  const pile = calculatePileCage(input);

  assert.equal(pile.validation.ok, true);
  assert.ok(!pile.validation.errorCodes.includes('missing_hoop_quantity'));
  assert.equal(pile.data.hoops.quantity, 0);
  assert.deepEqual(pile.data.hoops.positionsMm, []);
  assert.equal(pile.manufacturingBreakdown.length, 3);
  assert.ok(!pile.manufacturingBreakdown.some(part => part.componentType === 'hoop_ring'));
  assert.equal(pile.productionCards.length, 4);
  assert.ok(!pile.productionCards.some(card => card.componentType === 'hoop_ring'));
  assert.equal(pile.assemblySummary.componentCount, 3);
  assert.equal(pile.assemblySummary.productionCardCount, 4);
  assert.equal(pile.calculated.totalHoopLengthMm, 0);
  assert.equal(pile.calculated.totalHoopWeightKg, 0);
  assert.equal(pile.calculated.totalWeightKg, pile.manufacturingBreakdown.reduce((sum, part) => sum + part.weightKg, 0));
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
  assert.equal(hoop.hoopCutLengthMm, 1106);
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

test('round pile cage preserves alternating bars, external diameters and the complete production BOM', () => {
  const pile = calculatePileCage({
    shapeId: 'round-pile-600x12000',
    roundPileCage: true,
    pileDiameterMm: 600,
    pileLengthMm: 12000,
    longitudinalBars: {
      totalBars: 10,
      defaultDiameterMm: 20,
      defaultLengthMm: 12000,
      layoutMode: 'alternating',
      pattern: [
        { repeat: 1, type: 'straight', lengthMm: 12000 },
        { repeat: 1, type: 'L', lengthMm: 12000, bendLengthMm: 200 },
      ],
    },
    spiral: { barDiameterMm: 8, outerDiameterMm: 480, pitchMode: 'zones', zones: [
      { name: 'A', lengthMm: 3000, pitchMm: 150 },
      { name: 'B', lengthMm: 2000, noWrap: true },
      { name: 'C', lengthMm: 7000, pitchMm: 200 },
    ] },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
  });
  const straight = pile.manufacturingBreakdown.find(part => part.componentType === 'longitudinal_straight_bar');
  const bent = pile.manufacturingBreakdown.find(part => part.componentType === 'longitudinal_l_bar');
  const spiral = pile.manufacturingBreakdown.find(part => part.componentType === 'spiral_consolidated');
  const rings = pile.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');

  assert.equal(pile.validation.ok, true);
  assert.deepEqual(pile.longitudinalBars.map(bar => bar.type), ['straight', 'L', 'straight', 'L', 'straight', 'L', 'straight', 'L', 'straight', 'L']);
  assert.deepEqual(pile.longitudinalBars.map(bar => bar.positionAngleDeg), [0, 36, 72, 108, 144, 180, 216, 252, 288, 324]);
  assert.equal(straight.quantity, 5); assert.equal(straight.lengthMm, 12000);
  assert.equal(bent.quantity, 5); assert.equal(bent.lengthMm, 12200); assert.equal(bent.bendLengthMm, 200);
  assert.equal(pile.calculated.totalLongitudinalLengthMm, 121000);
  assert.equal(pile.data.spiral.outerDiameterMm, 480); assert.equal(pile.data.spiral.spiralDiameterMm, 472);
  assert.deepEqual(spiral.schedule.map(zone => ({ noWrap: zone.noWrap, startMm: zone.startMm, endMm: zone.endMm, pitchMm: zone.pitchMm, turns: zone.turns, cut: zone.helicalCutLengthMm })), [
    { noWrap: false, startMm: 0, endMm: 3000, pitchMm: 150, turns: 20, cut: 29808 },
    { noWrap: true, startMm: 3000, endMm: 5000, pitchMm: null, turns: 0, cut: 0 },
    { noWrap: false, startMm: 5000, endMm: 12000, pitchMm: 200, turns: 35, cut: 52369.1 },
  ]);
  assert.equal(spiral.totalLengthMm, 82177.1);
  assert.equal(pile.data.hoops.outerDiameterMm, 420); assert.equal(rings.hoopDiameterMm, 420); assert.equal(rings.bendingDiameterMm, 420);
  assert.deepEqual(rings.positionsMm, [1500, 1800, 2100, 2400, 2700]); assert.equal(rings.quantity, 5); assert.equal(rings.spacingMm, 300);
  assert.equal(pile.shapeType, 'round_pile_cage'); assert.equal(pile.family, 'piles');
  assert.equal(pile.data.longitudinalBars.bars.length, 10); assert.equal(pile.machineOutput.generic.manufacturingBreakdown.length, 4);
  assert.deepEqual(pile.productionCards.map(card => card.componentType), ['longitudinal_straight_bar', 'longitudinal_l_bar', 'spiral_consolidated', 'hoop_ring', 'pile_assembly']);
  assert.equal(pile.productionCards.filter(card => card.cardType === 'pile_component').length, 4);
  assert.equal(pile.productionCards.filter(card => card.cardType === 'pile_assembly').length, 1);
  assert.equal(pile.productionCards[4].weightKg, pile.calculated.totalWeightKg);
  assert.equal(pile.productionCards[4].totalSteelCutLengthMm, 209772.1);
  assert.equal(pile.productionCards[4].componentSummary.length, 4);
  assert.equal(pile.assemblySummary.productionCardCount, 5);
  assert.equal(pile.calculated.totalWeightKg, 344.52);
});

test('round pile cage components have parity with standalone canonical engines', () => {
  const pile = calculatePileCage({
    roundPileCage: true,
    pileDiameterMm: 600,
    pileLengthMm: 12000,
    longitudinalBars: { totalBars: 10, defaultDiameterMm: 20, defaultLengthMm: 12000, layoutMode: 'alternating', pattern: [{ repeat: 1, type: 'straight', lengthMm: 12000 }, { repeat: 1, type: 'L', lengthMm: 12000, bendLengthMm: 200 }] },
    spiral: { barDiameterMm: 8, outerDiameterMm: 480, pitchMode: 'zones', zones: [{ name: 'A', lengthMm: 3000, pitchMm: 150 }, { name: 'B', lengthMm: 2000, noWrap: true }, { name: 'C', lengthMm: 7000, pitchMm: 200 }] },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
  });
  const straight = pile.manufacturingBreakdown.find(part => part.componentType === 'longitudinal_straight_bar');
  const bent = pile.manufacturingBreakdown.find(part => part.componentType === 'longitudinal_l_bar');
  const spiral = pile.manufacturingBreakdown.find(part => part.componentType === 'spiral_consolidated');
  const ring = pile.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');
  assert.deepEqual({ unit: straight.unitLengthMm, total: straight.totalLengthMm, weight: straight.weightKg, segments: straight.segments }, (() => { const c = buildBarsShapeContract({ shapeType: 'straight_bar', diameter: 20, sides: [12000], angles: [] }, { quantity: 5 }); return { unit: c.component.unitLengthMm, total: c.component.totalLengthMm, weight: c.component.weightKg, segments: c.component.segments }; })());
  assert.deepEqual({ unit: bent.unitLengthMm, total: bent.totalLengthMm, weight: bent.weightKg, segments: bent.segments }, (() => { const c = buildBarsShapeContract({ shapeType: 'l_bar', diameter: 20, sides: [12000, 200], angles: [90] }, { quantity: 5 }); return { unit: c.component.unitLengthMm, total: c.component.totalLengthMm, weight: c.component.weightKg, segments: c.component.segments }; })());
  const expectedWrapped = [calculateHelicalSpiral({ axialLengthMm: 3000, pitchMm: 150, effectiveDiameterMm: 472, barDiameterMm: 8 }), calculateHelicalSpiral({ axialLengthMm: 7000, pitchMm: 200, effectiveDiameterMm: 472, barDiameterMm: 8 })];
  assert.deepEqual(spiral.schedule.filter(zone => !zone.noWrap).map(zone => ({ turns: zone.turns, cut: zone.helicalCutLengthMm, weight: zone.weightKg })), expectedWrapped.map(zone => ({ turns: zone.turns, cut: zone.helicalCutLengthMm, weight: zone.barWeightKg })));
  const standaloneRing = buildRingShapeContract({ barDiameterMm: 18, bendingDiameterMm: 420, quantity: 5 });
  assert.deepEqual({ diameter: ring.bendingDiameterMm, unit: ring.unitLengthMm, total: ring.totalLengthMm, weight: ring.weightKg }, { diameter: standaloneRing.component.bendingDiameterMm, unit: standaloneRing.component.unitLengthMm, total: standaloneRing.component.totalLengthMm, weight: standaloneRing.component.weightKg });
});

test('standalone ring contract adds overlap to circumference and scales manufacturing quantity', () => {
  const ring = buildRingShapeContract({
    barDiameterMm: 18,
    bendingDiameterMm: 420,
    overlapMm: 200,
    quantity: 168,
  });

  assert.equal(ring.data.ringDiameterMm, 420);
  assert.equal(ring.data.overlapMm, 200);
  assert.equal(ring.calculated.circumferenceMm, 1319);
  assert.equal(ring.component.unitLengthMm, 1519);
  assert.equal(ring.component.totalLengthMm, 255192);
  assert.equal(ring.component.quantity, 168);
});

test('round pile cage blocks production cards when explicit hoop quantity is missing', () => {
  const pile = calculatePileCage({ roundPileCage: true, pileLengthMm: 12000, longitudinalBars: { totalBars: 10, layoutMode: 'alternating', pattern: [{ type: 'straight' }, { type: 'L', bendLengthMm: 200 }] }, spiral: { barDiameterMm: 8, outerDiameterMm: 480, uniformPitchMm: 150 }, hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420 } });
  assert.equal(pile.validation.ok, false);
  assert.ok(pile.validation.errorCodes.includes('missing_hoop_quantity'));
  assert.deepEqual(pile.productionCards, []);
});

test('historical round pile snapshot derives hoop quantity only from authoritative saved positions', () => {
  const historical = completeRoundPileInput();
  delete historical.hoops.quantity;
  historical.hoops.positionsMm = [1500, 1800, 2100, 2400, 2700];
  const pile = calculatePileCage(historical);
  const rings = pile.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');
  assert.equal(pile.validation.ok, true);
  assert.equal(rings.quantity, 5);
  assert.deepEqual(rings.positionsMm, historical.hoops.positionsMm);
  assert.equal(pile.productionCards.find(card => card.componentType === 'hoop_ring').quantity, 5);
});

test('round pile cage fails closed when wrapped pitch is missing instead of using the uniform default', () => {
  const input = completeRoundPileInput();
  delete input.spiral.zones[0].pitchMm;
  const pile = calculatePileCage(input);
  assert.equal(pile.validation.ok, false);
  assert.ok(pile.validation.errorCodes.includes('missing_spiral_pitch'));
  assert.deepEqual(pile.productionCards, []);
  assert.deepEqual(pile.manufacturingBreakdown, []);
  assert.equal(pile.calculated.totalSteelLengthMm, 0);
  assert.equal(pile.calculated.totalWeightKg, 0);
});

test('round pile cage fails closed when longitudinal sources are absent instead of fabricating default bars', () => {
  const input = completeRoundPileInput();
  input.longitudinalBars = { pattern: [{ type: 'straight' }, { type: 'L', bendLengthMm: 200 }] };
  const pile = calculatePileCage(input);
  assert.equal(pile.validation.ok, false);
  assert.ok(pile.validation.errorCodes.includes('missing_longitudinal_bar_count'));
  assert.ok(pile.validation.errorCodes.includes('missing_longitudinal_bar_diameter'));
  assert.ok(pile.validation.errorCodes.includes('missing_longitudinal_bar_length'));
  assert.deepEqual(pile.productionCards, []);
  assert.deepEqual(pile.manufacturingBreakdown, []);
  assert.equal(pile.calculated.totalWeightKg, 0);
});
