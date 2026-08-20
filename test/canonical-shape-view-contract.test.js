const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('saved 2D views consume the canonical server SVG without rebuilding card geometry', () => {
  const queue = read('public/production-queue.html');
  const printPage = read('services/productionCardPrintPage.js');
  const worker = read('public/worker-visual.html');
  const liveSheet = read('public/production-order-sheet.html');

  assert.match(queue, /const canonicalShapeSvg = typeof item\.shape_svg/);
  assert.match(queue, /<div class="queue-shape">\$\{canonicalShapeSvg\}<\/div>/);
  assert.doesNotMatch(queue, /function renderQueueShapes\(/);
  assert.doesNotMatch(queue, /IronBendShapes\.render2D/);

  assert.match(printPage, /cards\.shapeSvgForProductionCard\(it\)/);
  assert.match(printPage, /return item\.shape_svg \|\| generated/);
  assert.doesNotMatch(printPage, /if \(cleanSegments\.length\) return generated/);

  assert.match(worker, /if\(item\.shape_svg\)return item\.shape_svg/);
  assert.match(liveSheet, /card\.shape_svg\|\|''/);
});

test('portal saved items keep the canonical SVG while draft previews use the shape engine', () => {
  const portalRoute = read('routes/portal.js');
  const portalProjection = read('services/customerPortalProjection.js');
  const customer = read('public/customer.html');
  const newOrder = read('public/index.html');

  assert.match(portalRoute, /shape_svg: productionCards\.itemShapeSvg\(item\)/);
  assert.match(portalProjection, /shape_svg: item\.shape_svg \|\| null/);
  assert.match(customer, /item\?\.shape_svg.*includes\('<svg'\).*return item\.shape_svg/);
  assert.match(customer, /IronBendShapeGeometry\?\.ShapeEngineRouter/);
  assert.match(newOrder, /ShapeEngineRouter\.render\(shape, 180, 96/);
});

test('intake previews use the same special-shape engines without changing their containers', () => {
  const intake = read('public/intake.html');

  assert.match(intake, /IronBendShapeGeometry\.ShapeEngineRouter\.render\(shape, 150, 108\)/);
  assert.match(intake, /IronBendShapeGeometry\.benchBarSVGPath\(previewSides, width, height\)/);
  assert.match(intake, /<text x="75" y="12"[^>]*>\$\{escapeHtml\(turns\)\} כריכות/);
});
