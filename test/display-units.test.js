const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const units = require('../public/display-units');
const newOrderSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'new-order-editor.js'), 'utf8');
const newOrderPageSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const intakeSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.html'), 'utf8');
const ordersSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'orders.html'), 'utf8');

test('display unit boundary converts canonical millimeters to centimeters without losing decimals', () => {
  assert.equal(units.millimetersToCentimeters(1530), 153);
  assert.equal(units.centimetersToMillimeters(153), 1530);
  assert.equal(units.formatLengthCmFromMm(1319), '131.9 ס״מ');
  assert.equal(units.formatLengthCmFromMm(82177.1), '8,217.71 ס״מ');
  assert.equal(units.formatLengthCmFromMm(null), '—');
});

test('only the steel diameter formatter retains millimeters', () => {
  assert.equal(units.formatSteelDiameterMm(16), 'Ø16 מ״מ');
  assert.equal(units.formatSteelDiameterMm(''), '—');
});

test('new-order projection shows unit length in centimeters and aggregate length in meters', () => {
  assert.match(newOrderSource, /function formatLineLength\(item = \{\}\) \{ return formatCm/);
  assert.match(newOrderSource, /function formatLineTotalLength\(item = \{\}\) \{ return formatMeters/);
  assert.match(newOrderSource, /PILE CAGE[\s\S]*?ס״מ[\s\S]*?L [\s\S]*?ס״מ/);
  assert.match(newOrderSource, /function formatMeters\(value\)/);
});

test('image and intake review fields edit centimeters but preserve canonical millimeters', () => {
  assert.match(newOrderPageSource, /אורך כולל \(ס״מ\)[\s\S]*millimetersToCentimeters/);
  assert.match(newOrderPageSource, /total_length_mm = IronBendDisplayUnits\.centimetersToMillimeters/);
  assert.match(newOrderPageSource, /קוטר ספיראלה \(ס״מ\)/);
  assert.match(intakeSource, /צלעות בס״מ|segmentsValue \? `\$\{segmentsValue\} ס״מ`/);
  assert.match(intakeSource, /expandSegmentPart\(IronBendDisplayUnits\.centimetersToMillimeters\(len\), marker\)/);
});

test('order details label physical spiral diameter in centimeters and steel diameter in millimeters', () => {
  assert.match(ordersSource, /קוטר ברזל \$\{IronBendDisplayUnits\.formatSteelDiameterMm/);
  assert.match(ordersSource, /קוטר ספיראלה \$\{IronBendDisplayUnits\.formatLengthCmFromMm/);
});
