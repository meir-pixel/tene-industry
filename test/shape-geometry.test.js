const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { shapeSvg } = require('../services/productionCards');
const { normalizeFactorySegments, normalizeFactoryShapeName, spiralCutLengthMm } = require('../modules/steel-rebar/shapes');
const { distributeSurplusToEndSegments } = require('../services/intakeWorkflow');

function loadShapeEditorGeometry() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const context = {
    window: {},
    console,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

test('shape geometry closes a square when all four bends are 90 degrees', () => {
  const { calcShapePoints } = loadShapeEditorGeometry();
  const points = calcShapePoints([150, 150, 150, 150], [90, 90, 90, 90]);
  const first = points[0];
  const last = points[points.length - 1];

  assert.ok(distance(first, last) < 0.000001, `expected square to close, got ${JSON.stringify(points)}`);
  const rounded = points.map(p => p.map(n => Object.is(Math.round(n), -0) ? 0 : Math.round(n)));
  assert.equal(JSON.stringify(rounded), JSON.stringify([
    [0, 0],
    [150, 0],
    [150, -150],
    [0, -150],
    [0, 0],
  ]));
});

test('visual-only 3D preview does not use true-3D azimuth arrays', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /const isReal3D = this\.current\.is3d === 1 \|\| this\.current\.is3d === true/);
  assert.match(editor, /const has3D = isReal3D && \(/);
  assert.match(editor, /azAngles:\s+has3D \?/);
});

test('shape editor supports bend angles from -360 to 360 without quick angle buttons in 2D rows', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /data-angle="\$\{i\}"/);
  assert.match(editor, /min="-360"/);
  assert.match(editor, /max="360"/);
  assert.match(editor, /Math\.min\(360,\s*Math\.max\(-360,\s*Number\(val\) \|\| 90\)\)/);
  assert.doesNotMatch(editor, /<div class="se-angle-btns">/);
  assert.doesNotMatch(editor, /data-angle-value/);
});

test('shape editor opens as a fullscreen clean workspace with direct drawing edits', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /width:100vw;height:100vh/);
  assert.match(editor, /se-direct-edit-note/);
  assert.match(editor, /_editSideFromDrawing\(i\)/);
  assert.match(editor, /_editAngleFromDrawing\(i\)/);
  assert.match(editor, /addEventListener\('dblclick'/);
  assert.match(editor, /דאבל-קליק לעריכת אורך/);
  assert.match(editor, /דאבל-קליק לעריכת זווית/);
});
test('shape editor direct-open hides the count picker before edit page', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const match = editor.match(/_goToEdit\(\) \{[\s\S]*?document\.getElementById\('seHeadTitle'\)/);

  assert.ok(match, 'expected _goToEdit body');
  assert.match(match[0], /document\.getElementById\('sePageCount'\)\.style\.display\s*=\s*'none'/);
  assert.match(match[0], /document\.getElementById\('sePageSelect'\)\.style\.display\s*=\s*'none'/);
  assert.match(match[0], /document\.getElementById\('sePageEdit'\)\.style\.display\s*=\s*''/);
});
test('shape editor one-screen edit layout keeps editing inside the viewport', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /One-screen shape edit layout/);
  assert.match(editor, /#sePageEdit\{[\s\S]*height:calc\(100vh - 118px\)/);
  assert.match(editor, /#seModal \.se-svg-wrap\{[\s\S]*height:calc\(100vh - 246px\)/);
  assert.match(editor, /#seModal \.se-table-wrap\{[\s\S]*overflow-y:auto/);
  assert.match(editor, /#seModal \.se-foot\{[\s\S]*height:58px/);
});
test('shape editor renders one row per side in the 2D dimensions panel', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /One-row side editor/);
  assert.match(editor, /const letter = String\.fromCharCode\(65 \+ i\)/);
  assert.match(editor, /<tr class=\"se-side-row\">/);
  assert.match(editor, /class=\"se-length-cell\"/);
  assert.match(editor, /class=\"se-angle-cell\"/);
  assert.doesNotMatch(editor, /html \+= `<tr class=\"se-bend-row\">/);
});
test('shape editor has mesh and pile families with icon-only preset buttons', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /const SHAPE_FAMILIES = \[/);
  assert.match(editor, /id: 'mesh1'/);
  assert.match(editor, /id: 'pile1'/);
  assert.match(editor, /id="seFamilyTabs"/);
  const presetRender = editor.match(/_renderPresets\(countFilter\) \{[\s\S]*?_renderSavedShapes\(countFilter\) \{/);
  assert.ok(presetRender, 'expected preset renderer block');
  assert.match(presetRender[0], /shapePresetIconSVG\(s\.icon \|\| 'straight'\)/);
  assert.match(presetRender[0], /class="se-preset-name"/);
  assert.doesNotMatch(presetRender[0], /font-size:12px;font-weight:700;line-height:1\.3;word-break:break-word;color:inherit/);
});
test('shape editor built-in preset names stay neutral', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const presetBlock = editor.match(/const SHAPE_PRESETS = \[([\s\S]*?)\];/);

  assert.ok(presetBlock, 'expected shape preset block');
  assert.match(presetBlock[0], /name: 'צורה 2'/);
  assert.match(presetBlock[0], /name: 'רשת'/);
  assert.match(presetBlock[0], /name: 'כלונס'/);
  assert.doesNotMatch(presetBlock[0], /אנקר|הזזה|כפול|אוברל|אסדה|אצבה|כיפופים|חמש צלעות|סימטרית|בסיס/);
});
test('production card renders open U bars as a readable U shape, not a flattened line', () => {
  const svg = shapeSvg(JSON.stringify([
    { length_mm: 200, angle_deg: 90 },
    { length_mm: 1900, angle_deg: 90 },
    { length_mm: 200, angle_deg: 0 },
  ]));

  assert.match(svg, /data-shape-kind="open-u"/);
  assert.match(svg, /M 42,78 L 42,24 L 178,24 L 178,78/);
  assert.match(svg, />1900</);
  assert.match(svg, />200</);
  assert.match(svg, /90&#176;/);
});

test('production card renders closed stirrups as a closed rectangular hoop', () => {
  const svg = shapeSvg(JSON.stringify([
    { length_mm: 100, angle_deg: 90 },
    { length_mm: 950, angle_deg: 90 },
    { length_mm: 300, angle_deg: 90 },
    { length_mm: 950, angle_deg: 90 },
    { length_mm: 300, angle_deg: 90 },
    { length_mm: 100, angle_deg: 0 },
  ]));

  assert.match(svg, /data-shape-kind="closed-stirrup"/);
  assert.match(svg, /Z/);
  assert.match(svg, />300</);
  assert.match(svg, />950</);
  assert.match(svg, /data-stirrup-marker="overlap"/);
  assert.doesNotMatch(svg, /data-tail=/);
  assert.doesNotMatch(svg, /end tails/);
});

test('production card accepts closed stirrup OCR with one visible overlap tail', () => {
  const svg = shapeSvg(JSON.stringify([
    { length_mm: 100, angle_deg: 90 },
    { length_mm: 950, angle_deg: 90 },
    { length_mm: 300, angle_deg: 90 },
    { length_mm: 950, angle_deg: 90 },
    { length_mm: 300, angle_deg: 0 },
  ]));

  assert.match(svg, /data-shape-kind="closed-stirrup"/);
  assert.match(svg, />300</);
  assert.match(svg, />950</);
  assert.match(svg, /data-stirrup-marker="overlap"/);
  assert.doesNotMatch(svg, /data-tail=/);
  assert.doesNotMatch(svg, /end tails/);
});

test('orders detail shape renderer has a dedicated closed-stirrup path', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-renderer.js'), 'utf8');

  assert.match(renderer, /function closedStirrupParts/);
  assert.match(renderer, /data-shape-kind', 'closed-stirrup'/);
  assert.match(renderer, /renderClosedStirrup2D/);
});

test('orders detail normalizes legacy OCR segment order before drawing', () => {
  const orders = fs.readFileSync(path.join(__dirname, '..', 'public', 'orders.html'), 'utf8');

  assert.match(orders, /function normalizeDisplaySegments/);
  assert.match(orders, /צורת ח\|צורת u\|פתוח\|פתוחה/);
  assert.match(orders, /חישוק\|חפיפה\|מסגרת/);
});

test('single segment geometry cannot be normalized as a spiral or ring', () => {
  const segments = [{ length_mm: 25, angle_deg: 0 }];

  assert.equal(normalizeFactoryShapeName('טבעת/ספירלה', segments), 'straight bar');
  assert.equal(normalizeFactoryShapeName('spiral ring', segments), 'straight bar');
});

test('real spiral geometry uses diameter and turns instead of side segments', () => {
  assert.equal(normalizeFactoryShapeName('spiral', [], {
    spiral_diameter_mm: 50,
    spiral_turns: 160,
  }), 'spiral');
  assert.equal(spiralCutLengthMm(50, 160), Math.round(Math.PI * 50 * 160));
});

test('Hebrew open U names normalize side order by physical bending path', () => {
  const segments = normalizeFactorySegments('צורת ח פתוחה', [
    { length_mm: 550, angle_deg: 90 },
    { length_mm: 250, angle_deg: 90 },
    { length_mm: 250, angle_deg: 0 },
  ]);

  assert.deepEqual(segments.map(segment => segment.length_mm), [250, 550, 250]);
  assert.equal(normalizeFactoryShapeName('צורת ח פתוחה', segments), 'open U-shaped bar');
});

test('Hebrew closed stirrup names normalize as closed overlap hoops', () => {
  const segments = normalizeFactorySegments('חישוק', [
    { length_mm: 100, angle_deg: 90 },
    { length_mm: 950, angle_deg: 90 },
    { length_mm: 300, angle_deg: 90 },
    { length_mm: 950, angle_deg: 90 },
    { length_mm: 300, angle_deg: 90 },
    { length_mm: 100, angle_deg: 0 },
  ]);

  assert.deepEqual(segments.map(segment => segment.length_mm), [100, 950, 300, 950, 300, 100]);
  assert.equal(normalizeFactoryShapeName('חישוק', segments), 'closed stirrup 90-degree overlap');
});

test('reported length surplus is assigned to the two physical end legs', () => {
  const result = distributeSurplusToEndSegments([
    { length_mm: 450, angle_deg: 90 },
    { length_mm: 2400, angle_deg: 90 },
    { length_mm: 450, angle_deg: 0 },
  ], 4200);

  assert.equal(result.adjusted, true);
  assert.equal(result.surplus, 900);
  assert.equal(result.perEnd, 450);
  assert.deepEqual(result.segments.map(segment => segment.length_mm), [900, 2400, 900]);
  assert.equal(result.totalLength, 4200);
});
