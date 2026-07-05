'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePileCage } = require('../modules/steel-rebar/pile-cage-engine');

test('pile cage calculator defaults to one continuous uniform spiral zone', () => {
  const pile = calculatePileCage({
    pileDiameterMm: 680,
    pileLengthMm: 12000,
    longitudinalBarCount: 16,
    longitudinalDiameterMm: 20,
    spiralDiameterMm: 10,
    uniformPitchMm: 150,
  });

  assert.equal(pile.family, 'piles');
  assert.equal(pile.pitchMode, 'uniform');
  assert.equal(pile.spiralZones.length, 1);
  assert.equal(pile.spiralZones[0].lengthMm, 12000);
  assert.equal(pile.spiralZones[0].pitchMm, 150);
  assert.equal(pile.longitudinalBars.length, 16);
  assert.equal(pile.validation.ok, true);
  assert.ok(pile.calculated.totalSpiralLengthMm > 0);
  assert.ok(pile.calculated.weightKg > 0);
});

test('pile cage supports alternating bar diameter and shape patterns', () => {
  const pile = calculatePileCage({
    pileLengthMm: 10000,
    longitudinalBarCount: 9,
    longitudinalDiameterMm: 20,
    hookLengthMm: 400,
    barPattern: [
      { repeat: 2, diameterMm: 20, shapeType: 'straight' },
      { repeat: 1, diameterMm: 16, shapeType: 'L', hookLengthMm: 500 },
    ],
  });

  assert.deepEqual(pile.longitudinalBars.map(bar => bar.diameterMm), [20, 20, 16, 20, 20, 16, 20, 20, 16]);
  assert.equal(pile.longitudinalBars[2].shapeType, 'L');
  assert.equal(pile.longitudinalBars[2].lengthMm, 10500);
  assert.ok(pile.manufacturingBreakdown.some(part => part.type === 'longitudinal_bar' && part.shapeType === 'L' && part.quantity === 3));
});

test('variable pitch zones must fill the wrapped length continuously', () => {
  const pile = calculatePileCage({
    pileLengthMm: 2200,
    noSpiralStartMm: 70,
    noSpiralEndMm: 0,
    pitchMode: 'variable',
    spiralZones: [
      { name: 'A', lengthMm: 200, pitchMm: 100 },
      { name: 'B', lengthMm: 1930, pitchMm: 200 },
    ],
  });

  assert.equal(pile.validation.ok, true);
  assert.equal(pile.spiralZones[0].startMm, 70);
  assert.equal(pile.spiralZones[1].startMm, 270);
  assert.equal(pile.spiralZones[0].pitchMm, 100);
  assert.equal(pile.spiralZones[1].pitchMm, 200);
});

test('pile cage rejects internal no-spiral gaps and incomplete variable zones', () => {
  const pile = calculatePileCage({
    pileLengthMm: 2200,
    pitchMode: 'variable',
    internalNoSpiralZones: [{ startMm: 900, lengthMm: 100 }],
    spiralZones: [{ name: 'A', lengthMm: 1000, pitchMm: 150 }],
  });

  assert.equal(pile.validation.ok, false);
  assert.match(pile.validation.errors.join('\n'), /internal no-spiral gaps are not allowed/);
  assert.match(pile.validation.errors.join('\n'), /variable spiral zone lengths must exactly fill/);
});
