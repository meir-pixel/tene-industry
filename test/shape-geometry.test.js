const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { shapeSvg, itemShapeSvg } = require('../services/productionCards');
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

test('shape editor 2D preview rotates U bars so the long bridge is the bottom base', () => {
  const { shapeSVGPath } = loadShapeEditorGeometry();
  const { pts } = shapeSVGPath([300, 1000, 300], [90, 90], 300, 260, 38);
  const segments = pts.slice(0, -1).map((point, index) => {
    const next = pts[index + 1];
    const dx = next[0] - point[0];
    const dy = next[1] - point[1];
    return { dx, dy, length: Math.hypot(dx, dy), y: (point[1] + next[1]) / 2 };
  });
  const longest = segments.reduce((best, segment) => segment.length > best.length ? segment : best, segments[0]);
  const centerY = pts.reduce((sum, point) => sum + point[1], 0) / pts.length;

  assert.ok(Math.abs(longest.dy) < 0.2, 'expected the long bridge side to be horizontal');
  assert.ok(centerY <= longest.y, 'expected the long bridge to be the bottom base with the legs/body above it');
});

test('shape editor exposes a visual-only 90-degree rotation control for ambiguous bar orientation', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const { shapeSVGPath } = loadShapeEditorGeometry();
  const { pts } = shapeSVGPath([300, 1000, 300], [90, 90], 300, 260, 38, { rotateDegrees: 90 });
  const segments = pts.slice(0, -1).map((point, index) => {
    const next = pts[index + 1];
    const dx = next[0] - point[0];
    const dy = next[1] - point[1];
    return { dx, dy, length: Math.hypot(dx, dy) };
  });
  const longest = segments.reduce((best, segment) => segment.length > best.length ? segment : best, segments[0]);

  assert.match(editor, /id="seRotateShape"/);
  assert.match(editor, /window.seRotateShape90 = function/);
  assert.match(editor, /_previewRotation/);
  assert.ok(Math.abs(longest.dx) < 0.2, 'expected 90-degree rotation to turn the long side vertical');
  assert.ok(Math.abs(longest.dy) > 100, 'expected rotated preview to keep the full shape geometry, not just move labels');
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
test('shape editor bypasses the legacy shape selection screen', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const goToSelect = editor.match(new RegExp("_goToSelect\\(\\) \\{[\\s\\S]*?\\n  \\}"));
  const openBlock = editor.match(/open\(existingData\) \{[\s\S]*?\n  \}/);

  assert.ok(goToSelect, 'expected _goToSelect body');
  assert.match(goToSelect[0], /this\._startDefaultEdit\(this\._selectedFamily \|\| 'bars'\)/);
  assert.doesNotMatch(goToSelect[0], /sePageSelect'\)\.style\.display\s*=\s*'flex'/);
  assert.ok(openBlock, 'expected open block');
  assert.match(openBlock[0], /this\._startDefaultEdit\('bars'\)/);
});

test('shape editor family tabs switch directly to family editors', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const jumpToFamily = editor.match(new RegExp("_jumpToFamily\\(family\\) \\{[\\s\\S]*?\\n  \\}"));

  assert.ok(jumpToFamily, 'expected _jumpToFamily body');
  assert.match(jumpToFamily[0], /this\._startDefaultEdit\(this\._selectedFamily\)/);
  assert.doesNotMatch(jumpToFamily[0], /this\._goToSelect\(\)/);
});

test('shape editor one-screen edit layout keeps editing inside the viewport', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /One-screen shape edit layout/);
  assert.match(editor, /#sePageEdit\{[\s\S]*height:calc\(100vh - 132px\)/);
  assert.match(editor, /#seModal \.se-svg-wrap\{[\s\S]*height:calc\(100vh - 254px\)/);
  assert.match(editor, /#seModal \.se-table-wrap\{[\s\S]*overflow-y:auto/);
  assert.match(editor, /#sePageEdit\{[\s\S]*overflow:hidden/);
  assert.match(editor, /#seModal \.se-table-wrap\{[\s\S]*overflow-x:hidden/);
  assert.match(editor, /#seModal \.se-table\.se-table-3d tr\{[\s\S]*grid-template-columns:28px minmax\(112px,1fr\) minmax\(82px,.72fr\) minmax\(74px,.66fr\) 22px/);
  assert.match(editor, /#seModal \.se-foot\{[\s\S]*height:68px/);
});
test('shape editor keeps bend parameter rows compact and technical', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /#seModal \.se-field-shell \.se-input\{[\s\S]*min-height:24px/);
  assert.match(editor, /#seModal \.se-field-shell \.se-input\{[\s\S]*font-size:12px/);
  assert.match(editor, /#seModal \.se-table\.se-table-2d tr\{[\s\S]*minmax\(72px,\.58fr\)/);
  assert.match(editor, /#seModal \.se-param-example\{display:none;\}/);
  assert.match(editor, /grid-template-columns:440px minmax\(360px,1fr\) 154px/);
  assert.match(editor, /td\.se-empty-cell\{background:transparent/);
  assert.match(editor, /class="se-angle-cell \$\{i < angles\.length \? '' : 'se-empty-cell'\}"/);
  assert.match(editor, /class="se-no-bend"/);
});

test('shape editor draws non-right bend angles as small arc labels without a tag box', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const bendBlock = editor.match(/Bend marks:[\s\S]*?svg\.innerHTML = html/);

  assert.ok(bendBlock, 'expected bend marker rendering block');
  assert.match(bendBlock[0], /A \$\{r\.toFixed\(1\)\}/);
  assert.match(bendBlock[0], /font-size="9"/);
  assert.doesNotMatch(bendBlock[0], /<rect x="\$\{\(-tagW\/2\)/);
});

test('shape editor approved reference UI keeps Hebrew workspace chrome', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /Approved TENA reference layout - UI only/);
  assert.match(editor, /src="\/brand\/tene-pdf-logo\.jpg"/);
  assert.match(editor, /id="seStepIndicator"/);
  assert.match(editor, /class="se-family-panel"/);
  assert.match(editor, /data-edit-family="bars"/);
  assert.match(editor, /data-edit-family="mesh"/);
  assert.match(editor, /data-edit-family="piles"/);
  assert.match(editor, /class="se-field-shell"/);
  assert.match(editor, /class="se-param-icon"/);
  assert.match(editor, /id="seTotalWeight"/);
  assert.match(editor, /id="seQuantityInput"/);
  assert.match(editor, /_focusFamilyField/);
  assert.match(editor, /_applyFamilyFocus/);
  assert.doesNotMatch(editor, /Mesh Editor/);
  assert.doesNotMatch(editor, /Pile Cage Editor/);
  assert.doesNotMatch(editor, /Side Lengths \/ Bend Angles/);
});


test('shape editor does not embed a page-local UI tuning panel', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.doesNotMatch(editor, /seUiTunePanel/);
  assert.doesNotMatch(editor, /seUiTuneBtn/);
  assert.doesNotMatch(editor, /se-ui-tune/);
  assert.doesNotMatch(editor, /ironbend\.shapeEditor\.uiTune/);
});
test('shape editor connects parameter fields to drawing focus targets', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /_inferFieldShellMeta/);
  assert.match(editor, /data-se-param="\$\{focusKey\}"/);
  assert.match(editor, /onfocusin="window\._seEditor\?\._setFieldFocus/);
  assert.match(editor, /se-focus-mode/);
  assert.match(editor, /se-focus-hit/);
  assert.match(editor, /data-se-focus="mesh-longitudinal-bars mesh-longitudinal-diameter mesh-longitudinal-spacing"/);
  assert.match(editor, /data-se-focus="pile-spiral-pitch pile-spiral-diameter pile-zone"/);
  assert.match(editor, /data-se-focus="bar-side-\$\{i\}"/);
  assert.match(editor, /data-se-focus="bar-angle-\$\{i\}"/);
});

test('shape editor focuses Z angle fields without switching to side length editing', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /if \(el !== ''\) meta = \{ \.\.\.meta, focusKey: `bar-z-\$\{el\}`/);
  assert.match(editor, /data-el="\$\{i\}" onfocus="window\._seEditor\._focusRow\(\$\{i\}, 'z'\)"/);
  assert.ok(editor.includes("focusAngle === 'z' ? '[data-el]'"));
  assert.doesNotMatch(editor, /if \(el\) meta = \{ \.\.\.meta, focusKey: `bar-side-\$\{el\}`/);
});

test('shape editor includes pile cage 2D engineering views without 3D helper output', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const pileRenderBlock = editor.match(/PileCageEngine\.render = function\(pile, w = 300, h = 260\) \{[\s\S]*?\n\};/);

  assert.ok(pileRenderBlock, 'expected PileCageEngine renderer block');
  assert.match(pileRenderBlock[0], /data-view=\"side\"/);
  assert.match(pileRenderBlock[0], /data-view=\"top\"/);
  assert.match(pileRenderBlock[0], /pile-side-engineering-view/);
  assert.match(pileRenderBlock[0], /pile-top-engineering-view/);
  assert.match(pileRenderBlock[0], /pile-zone-dimension/);
  assert.match(pileRenderBlock[0], /pile-pitch-label/);
  assert.match(pileRenderBlock[0], /pile-spiral-loop/);
  assert.match(editor, /data-se-focus="mesh-longitudinal-spacing mesh-transverse-spacing"/);
  assert.doesNotMatch(pileRenderBlock[0], /data-view=\"3d\"/);
  assert.doesNotMatch(pileRenderBlock[0], /se-engineer-helper/);
});

test('shape editor renders one row per side in the 2D dimensions panel', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /One-row side editor/);
  assert.match(editor, /const letter = String\.fromCharCode\(65 \+ i\)/);
  assert.match(editor, /<tr class=\"se-side-row\">/);
  assert.match(editor, /class=\"se-length-cell\"/);
  assert.match(editor, /class=\"se-angle-cell/);
  assert.match(editor, /se-empty-cell/);
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
test('shape editor exposes the requested Easybar category filters', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /const SHAPE_CATEGORY_FILTERS = \['הכל', 'חישוק', 'פיגורה', 'ספירלים', 'ציפורים', 'משקפיים', 'קלמרה'\]/);
  assert.match(editor, /id="seCategoryFilters"/);
  assert.match(editor, /class="se-category-filter/);
  assert.match(editor, /s\.category === category/);
});
test('shape editor exposes side-count filters for built-in and saved shapes', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /const SHAPE_SIDE_FILTERS = \['הכל', 1, 2, 3, 4, 5, 6, 7, 8\]/);
  assert.match(editor, /id="seSideFilters"/);
  assert.match(editor, /class="se-side-filter/);
  assert.match(editor, /const sideCount = this\._selectedSideCount/);
  assert.match(editor, /\(s\.sides \|\| \[\]\)\.length === sideCount/);
});

test('shape editor defaults newly added 3D side bends to 90 degrees', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const addSideBlock = editor.match(new RegExp('_addSide\\(\\) \\{[\\s\\S]*?\\n  \\}'));

  assert.ok(addSideBlock, 'expected _addSide body');
  assert.match(addSideBlock[0], /this\.current\.angles\.push\(90\)/);
  assert.match(addSideBlock[0], /this\.current\.azAngles\.push\(90\)/);
  assert.doesNotMatch(addSideBlock[0], /this\.current\.azAngles\.push\(0\)/);
});


test('shape editor keeps default 90-degree 3D turns positive, not negative', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /angles\.map\(a => 180 - \(a \?\? 180\)\)/);
  assert.match(editor, /this\.current\.azAngles\[i \+ 1\] = 180 - a/);
  assert.match(editor, /const ang2d = 180 - az/);
  assert.doesNotMatch(editor, /-\(180 - \(a \?\? 180\)\)/);
  assert.doesNotMatch(editor, /azAngles\[i \+ 1\] = -\(180 - a\)/);
});

test('shape editor renders closed stirrup overlap instead of drawing the overlap as another polygon side', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /function detectClosedStirrupParts/);
  assert.match(editor, /function renderClosedStirrupEditor2D/);
  assert.match(editor, /data-shape-kind="closed-stirrup"/);
  assert.match(editor, /data-stirrup-marker="overlap"/);
  assert.match(editor, /const stirrupParts = detectClosedStirrupParts\(sides, angles\)/);
  assert.match(editor, /renderClosedStirrupEditor2D\(stirrupParts, sides, 300, 260/);
});

test('shape editor active segment selection does not recolor the drawn bar', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.doesNotMatch(editor, /stroke="\$\{isActive \? '#2979ff' : SEG_GRAY\}" stroke-width="4"/);
  assert.match(editor, /const color = bodyStroke/);
  assert.doesNotMatch(editor, /Active segment overlay/);
  assert.doesNotMatch(editor, /stroke="#2979ff" stroke-width="4"/);
  assert.doesNotMatch(editor, /stroke="rgba\(41,121,255,[^`]*stroke-width/);
  assert.doesNotMatch(editor, /drop-shadow\(0 0 [^)]*rgba\(41,121,255/);
  assert.doesNotMatch(editor, /barW\*4\.5/);
});

test('shape editor index loads a fresh shape editor asset version', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(index, /shape-editor\.js\?v=56/);
  assert.doesNotMatch(index, /shape-editor\.js\?v=55/);
});


test('shape editor summary weight stays per shape unit and does not multiply by order quantity', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /set\('seTotalWeight', weightKg\.toFixed\(2\)\)/);
  assert.doesNotMatch(editor, /set\('seTotalWeight', \(weightKg \* qty\)\.toFixed\(2\)\)/);
});

test('shape editor exposes editable order item quantity outside the shape contract', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /id="seQuantityInput"/);
  assert.match(editor, /_setQuantity\(value\)/);
  assert.match(editor, /orderItemQuantity/);
  assert.match(editor, /delete normalized\.quantity/);
  assert.match(editor, /delete normalized\.qty/);
});

test('new order item rows render a visible shape preview from length fallback', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(index, /function itemShapeSides\(item = \{\}\)/);
  assert.match(index, /item\.length \?\? item\.totalLengthMm \?\? item\.total_length_mm/);
  assert.match(index, /const sides = itemShapeSides\(item\);/);
  assert.match(index, /const sides = itemShapeSides\(item \|\| \{\}\);/);
  assert.match(index, /shapeSVGPath\(sides, angles, 68, 52, 7\)/);
});

test('manual add item opens the shape editor before creating an empty order row', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const addItemBlock = index.match(new RegExp('function addItem\\(palletId\\) \\{[\\s\\S]*?\\n\\}'));
  const shapeSelectedBlock = index.match(new RegExp('function shapeSelected\\(data\\) \\{[\\s\\S]*?\\n\\}'));

  assert.ok(addItemBlock, 'expected addItem body');
  assert.ok(shapeSelectedBlock, 'expected shapeSelected body');
  assert.match(addItemBlock[0], /pendingItem/);
  assert.match(addItemBlock[0], /shapeEditor\.open\(\{ quantity: pendingItem\.qty \}\)/);
  assert.doesNotMatch(addItemBlock[0], /pallet\.items\.push/);
  assert.match(shapeSelectedBlock[0], /pallet\.items\.push\(item\)/);
  assert.match(shapeSelectedBlock[0], /data\.orderItemQuantity/);
});

test('shape editor keeps true 3D angle fields in sync with visual bends', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /_init3DAnglesFrom2D\(render = true\)/);
  assert.match(editor, /isReal3D && angles\?\.length > 0 && \(!azAngles \|\| azAngles\.every/);
  assert.match(editor, /this\._init3DAnglesFrom2D\(false\);/);
  assert.match(editor, /\(\{ sides, angles, azAngles, elAngles \} = this\.current\);/);
});

test('ShapeEngineRouter renders ח 35/120/35 with PolylineBarEngine', () => {
  const { ShapeEngineRouter, PolylineBarEngine } = loadShapeEditorGeometry();
  const shape = { family: 'bars', sides: [350, 1200, 350], angles: [90, 90] };
  const svg = ShapeEngineRouter.render(shape, 300, 260, { view: '2d' });

  assert.equal(ShapeEngineRouter(shape), PolylineBarEngine);
  assert.match(svg, /data-engine="PolylineBarEngine"/);
  assert.match(svg, /M /);
  assert.match(svg, />350</);
  assert.match(svg, />1200</);
  assert.match(svg, />90°</);
});

test('ShapeEngineRouter renders Mesh 600x250 Ø8@20 as grid with MeshEngine', () => {
  const { ShapeEngineRouter, MeshEngine } = loadShapeEditorGeometry();
  const mesh = {
    family: 'mesh',
    length: 600,
    width: 250,
    longitudinalDiameter: 8,
    longitudinalSpacing: 20,
    transverseDiameter: 8,
    transverseSpacing: 20,
  };
  const svg = ShapeEngineRouter.render(mesh, 300, 260);

  assert.equal(ShapeEngineRouter(mesh), MeshEngine);
  assert.match(svg, /data-engine="MeshEngine"/);
  assert.match(svg, /data-family="mesh"/);
  assert.match(svg, /data-length="600"/);
  assert.match(svg, /data-width="250"/);
  assert.match(svg, /data-longitudinal="&#216;8@20"/);
  assert.match(svg, /data-transverse="&#216;8@20"/);
  assert.ok((svg.match(/<line /g) || []).length >= 40, 'expected mesh grid lines');
});


test('shape editor switches to a mesh editor without side or angle fields', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const block = editor.match(/_renderMeshEditor\(\) \{[\s\S]*?[\r\n]+  \}[\r\n]+[\r\n]+  _renderPileCageEditor/);

  assert.ok(block, 'expected mesh editor renderer');
  for (const field of ['length', 'width', 'longitudinalDiameter', 'longitudinalSpacing', 'transverseDiameter', 'transverseSpacing', 'edgeLeft', 'edgeRight', 'edgeTop', 'edgeBottom']) {
    assert.ok(block[0].includes(`'${field}'`));
  }
  assert.doesNotMatch(block[0], /data-side=/);
  assert.doesNotMatch(block[0], /data-angle=/);
  assert.match(editor, /this\.current\.family === 'mesh'\)\s+return this\._renderMeshEditor\(\)/);
});

test('shape editor switches to a pile cage editor with editable spiral zones', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const block = editor.match(/_renderPileCageEditor\(\) \{[\s\S]*?[\r\n]+  \}[\r\n]+[\r\n]+  _renderBarEditor/);

  assert.ok(block, 'expected pile cage editor renderer');
  for (const field of ['pileDiameter', 'pileLength', 'longitudinalBars', 'longitudinalDiameter', 'spiralDiameter', 'spiralType', 'hoopsEnabled', 'hoopDiameter', 'hoopSpacing', 'hoopStart', 'hoopEnd', 'barPattern', 'lHookLength']) {
    assert.ok(block[0].includes(`'${field}'`));
  }
  for (const field of ['name', 'length', 'pitch', 'noWrap']) {
    assert.match(block[0], new RegExp(`data-zone-field="${field}"`));
  }
  assert.match(editor, /_addSpiralZone\(\)/);
  assert.match(editor, /_deleteSpiralZone\(index\)/);
  assert.doesNotMatch(block[0], /data-side=/);
  assert.doesNotMatch(block[0], /data-angle=/);
  assert.match(editor, /this\.current\.family === 'piles'\)\s+return this\._renderPileCageEditor\(\)/);
});

test('pile cage editor refreshes derived hoops and gates longitudinal shape rows', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const start = editor.indexOf('_renderPileCageEditor() {');
  const end = editor.indexOf('_renderBarEditor', start);
  const block = editor.slice(start, end);

  assert.ok(start > 0 && end > start, 'expected pile cage editor block before longitudinal rows helper');
  assert.ok(block.includes('data-pile-derived="internalHoopDiameter"'));
  assert.ok(block.includes('${this._renderPileLongitudinalShapeRows(field)}'));
  assert.equal(block.includes("${field('lHookLength', 0)}</tr>"), false);
  assert.ok(editor.includes('_refreshPileDerived()'));
  assert.ok(editor.includes('data-pile-derived="internalHoopDiameter"'));
  assert.ok(editor.includes('out.textContent = out.classList'));
  assert.ok(editor.includes("pattern === 'straight'"));
  assert.ok(editor.includes("pattern === 'alternate'"));
  assert.ok(editor.includes('data-pile-bar-editor'));
  assert.ok(editor.includes('se-pile-compact-row'));
  assert.ok(editor.includes('se-pile-bar-override-row'));
  assert.ok(editor.includes('data-pile-bar-field="diameter"'));
  assert.ok(editor.includes('se-pile-hoop-grid'));
  assert.ok(editor.includes('hoopStartSide'));
  assert.ok(editor.includes('data-pile-elements-summary'));
  assert.ok(editor.includes('_renderPileElementsSummary()'));
  assert.ok(editor.includes('_refreshPileElementsSummary()'));
  assert.ok(editor.includes('_addPileBarOverride()'));
  assert.ok(editor.includes('_deletePileBarOverride(index)'));
  assert.doesNotMatch(block, /עריכה פרטנית תוגדר בהמשך/);
  assert.ok(editor.includes("field('lHookLength', 0) + '</div>'"));
  const barPatternBranch = editor.slice(editor.indexOf("key === 'barPattern'"), editor.indexOf("const parsed = key === 'longitudinalBars'"));
  assert.ok(barPatternBranch.includes('this._renderPileCageEditor()'));
});

test('PileCageEngine derives internal hoop diameter from cage diameter and bar diameter only', () => {
  const { PileCageEngine } = loadShapeEditorGeometry();
  const result = PileCageEngine.calculate({
    family: 'piles',
    pileDiameter: 50,
    pileLength: 2200,
    concreteCover: 18,
    longitudinalBars: 6,
    longitudinalDiameter: 46,
    spiralDiameter: 8,
    spiralZones: [{ name: 'Zone A', length: 2200, pitch: 20 }],
    hoopsEnabled: true,
    hoopDiameter: 14,
    hoopSpacing: 200,
    hoopStart: 0,
    hoopEnd: 2200,
  });

  assert.equal(result.calculated.internalHoopDiameterMm, 408);
  assert.equal(result.machineOutput.generic.internalHoopDiameterMm, 408);
});

test('PileCageEngine counts hoop spacing from the selected side', () => {
  const { PileCageEngine } = loadShapeEditorGeometry();
  const base = {
    family: 'piles',
    pileDiameter: 70,
    pileLength: 100,
    longitudinalBars: 6,
    longitudinalDiameter: 16,
    spiralDiameter: 8,
    spiralZones: [{ name: 'Zone A', length: 100, pitch: 20 }],
    hoopsEnabled: true,
    hoopDiameter: 14,
    hoopSpacing: 30,
    hoopStart: 0,
    hoopEnd: 100,
  };
  const fromStart = PileCageEngine.calculate({ ...base, hoopStartSide: 'start' });
  const fromEnd = PileCageEngine.calculate({ ...base, hoopStartSide: 'end' });
  const startHoops = fromStart.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');
  const endHoops = fromEnd.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');

  assert.deepEqual(startHoops.positionsMm, [0, 300, 600, 900]);
  assert.deepEqual(endHoops.positionsMm, [100, 400, 700, 1000]);
});
test('MeshEngine spacing changes grid count while diameter changes bar thickness', () => {
  const { ShapeEngineRouter } = loadShapeEditorGeometry();
  const base = { family: 'mesh', length: 600, width: 250, longitudinalDiameter: 8, longitudinalSpacing: 20, transverseDiameter: 8, transverseSpacing: 20 };
  const widerSpacing = { ...base, longitudinalSpacing: 30 };
  const thicker = { ...base, longitudinalDiameter: 16 };
  const baseSvg = ShapeEngineRouter.render(base, 300, 260);
  const spacingSvg = ShapeEngineRouter.render(widerSpacing, 300, 260);
  const thickSvg = ShapeEngineRouter.render(thicker, 300, 260);

  assert.match(baseSvg, /data-longitudinal-count="31"/);
  assert.match(spacingSvg, /data-longitudinal-count="21"/);
  assert.match(thickSvg, /stroke-width="3\.5"/);
  assert.match(thickSvg, /data-longitudinal-count="31"/);
});

test('PileCageEngine treats pile editor dimension fields as centimeters', () => {
  const { buildShapeDataContractV2 } = loadShapeEditorGeometry();
  const contract = buildShapeDataContractV2({
    family: 'piles',
    pileDiameter: 50,
    pileLength: 9800,
    longitudinalBars: 6,
    longitudinalDiameter: 16,
    longitudinalBarOverrides: [{ barIndex: 3, diameter: 20, barPattern: 'l', lHookLength: 25 }],
    spiralDiameter: 8,
    spiralZones: [
      { length: 80, pitch: 10, noWrap: true },
      { length: 200, pitch: 10 },
      { length: 700, pitch: 20 },
    ],
    hoopsEnabled: true,
    hoopDiameter: 8,
    hoopSpacing: 200,
    hoopStart: 0,
    hoopEnd: 2200,
  });

  assert.equal(contract.data.pileDiameter, 500);
  assert.equal(contract.data.pileLength, 98000);
  assert.deepEqual(contract.data.spiralZones.map(zone => [zone.length, zone.pitch]), [[800, 100], [2000, 100], [7000, 200]]);
  assert.deepEqual(contract.data.longitudinalBarOverrides, [{ barIndex: 3, diameter: 20, barPattern: 'l', lHookLength: 250 }]);
  assert.deepEqual(contract.machineOutput.generic.longitudinalBarOverrides, [{ barIndex: 3, diameter: 20, barPattern: 'l', lHookLength: 250 }]);
  assert.equal(contract.calculated.spiralCenterDiameterMm, 500);
  assert.equal(contract.calculated.internalHoopDiameterMm, 468);
  const hoopPart = contract.calculated.manufacturingBreakdown.find(part => part.componentType === 'hoop_ring');
  assert.equal(hoopPart.hoopDiameterMm, 468);
  assert.ok(contract.calculated.totalLengthMm < 1000000);
  assert.ok(contract.calculated.weightKg < 1000);
});

test('ShapeEngineRouter renders pile cage top and side views with PileCageEngine', () => {
  const { ShapeEngineRouter, PileCageEngine } = loadShapeEditorGeometry();
  const pile = {
    family: 'piles',
    pileDiameter: 70,
    pileLength: 2200,
    longitudinalBars: 26,
    longitudinalDiameter: 22,
    spiralZones: [
      { length: 70, pitch: 10 },
      { length: 200, pitch: 20 },
      { length: 1350, pitch: 20 },
    ],
  };
  const svg = ShapeEngineRouter.render(pile, 300, 260);

  assert.equal(ShapeEngineRouter(pile), PileCageEngine);
  assert.match(svg, /data-engine="PileCageEngine"/);
  assert.match(svg, /data-view="side"/);
  assert.match(svg, /data-view="top"/);
  assert.match(svg, /data-pile-diameter="700"/);
  assert.match(svg, /data-input-unit="cm"/);
  assert.match(svg, /data-pile-length="22000"/);
  assert.match(svg, /data-longitudinal-bars="26"/);
  assert.match(svg, /data-spiral-zones="700@100,2000@200,13500@200"/);
  assert.equal((svg.match(/class="pile-longitudinal-bar"/g) || []).length, 26);
  assert.match(svg, /class="pile-side-engineering-view"/);
  assert.match(svg, /class="pile-top-engineering-view"/);
  assert.match(svg, /class="pile-zone-dimension/);
  assert.match(svg, /class="pile-pitch-label"/);
  assert.match(svg, /class="pile-spiral-loop"/);
  assert.match(svg, /L 2200/);
  assert.match(svg, /D/);
  assert.match(svg, /d' 8/);
  assert.doesNotMatch(svg, /data-view="3d"/);
});


test('PileCageEngine pitch changes only the edited spiral zone', () => {
  const { ShapeEngineRouter } = loadShapeEditorGeometry();
  const pile = {
    family: 'piles',
    pileDiameter: 70,
    pileLength: 2200,
    longitudinalBars: 26,
    longitudinalDiameter: 22,
    spiralDiameter: 8,
    spiralZones: [
      { length: 70, pitch: 10 },
      { length: 200, pitch: 20 },
      { length: 1350, pitch: 20 },
    ],
  };
  const changed = {
    ...pile,
    spiralZones: [
      { length: 70, pitch: 10 },
      { length: 200, pitch: 10 },
      { length: 1350, pitch: 20 },
    ],
  };
  const countZone = (svg, zone) => (svg.match(new RegExp(`data-zone="${zone}"`, 'g')) || []).length;
  const baseSvg = ShapeEngineRouter.render(pile, 300, 260);
  const changedSvg = ShapeEngineRouter.render(changed, 300, 260);

  assert.equal(countZone(baseSvg, 0), countZone(changedSvg, 0));
  assert.notEqual(countZone(baseSvg, 1), countZone(changedSvg, 1));
  assert.equal(countZone(baseSvg, 2), countZone(changedSvg, 2));
  assert.match(changedSvg, /data-spiral-diameter="8"/);
  assert.doesNotMatch(changedSvg, /pile-pitch-control/);
});


test('PileCageEngine renders no-wrap zones, hoops, and L longitudinal bars', () => {
  const { ShapeEngineRouter } = loadShapeEditorGeometry();
  const pile = {
    family: 'piles',
    pileDiameter: 70,
    pileLength: 2200,
    longitudinalBars: 26,
    longitudinalDiameter: 22,
    spiralDiameter: 8,
    spiralZones: [
      { length: 70, pitch: 10 },
      { length: 200, pitch: 20, noWrap: true },
      { length: 1350, pitch: 20 },
    ],
    hoopsEnabled: true,
    hoopDiameter: 8,
    hoopSpacing: 200,
    hoopStart: 50,
    hoopEnd: 1800,
    barPattern: 'alternate',
    lHookLength: 250,
  };
  const svg = ShapeEngineRouter.render(pile, 300, 260);

  assert.match(svg, /class="pile-no-wrap-zone"/);
  assert.match(svg, /class="pile-hoop"/);
  assert.match(svg, /class="pile-l-bar"/);
  assert.match(svg, /data-hoop-count="9"/);
  assert.match(svg, /data-bar-pattern="alternate"/);
  assert.match(svg, /data-spiral-zones="700@100,2000@200:no-wrap,13500@200"/);
});


test('buildShapeDataContractV2 returns bars envelope without shape-owned quantity', () => {
  const { buildShapeDataContractV2 } = loadShapeEditorGeometry();
  const contract = buildShapeDataContractV2({
    family: 'bars',
    presetId: 'u_bar',
    presetName: 'U bar',
    sides: [350, 1200, 350],
    angles: [90, 90],
    diameter: 12,
    quantity: 99,
  });

  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.shapeVersion, 1);
  assert.ok(contract.shapeId);
  assert.equal(contract.shapeType, 'u_bar');
  assert.equal(contract.family, 'bars');
  assert.equal(contract.source, 'shape-editor');
  assert.deepEqual(contract.data, { sides: [350, 1200, 350], angles: [90, 90], diameter: 12 });
  assert.equal(contract.calculated.totalLengthMm, 1900);
  assert.equal(contract.calculated.bendCount, 2);
  assert.equal(contract.validation.valid, true);
  assert.equal(contract.machineOutput.generic.family, 'bars');
  assert.equal(contract.machineOutput.generic.segments.length, 3);
  assert.deepEqual(Object.keys(contract.machineOutput.machineProfiles).sort(), ['MEP', 'PEDAX', 'SCHNELL']);
  assert.equal('quantity' in contract, false);
  assert.equal('quantity' in contract.data, false);
  assert.equal('quantity' in contract.machineOutput.generic, false);
});


test('buildShapeDataContractV2 accepts closed bar shapes with a final bend angle', () => {
  const { buildShapeDataContractV2 } = loadShapeEditorGeometry();
  const contract = buildShapeDataContractV2({
    family: 'bars',
    presetId: 'closed_stirrup',
    sides: [400, 200, 400, 200],
    angles: [90, 90, 90, 90],
    diameter: 8,
  });

  assert.equal(contract.validation.valid, true);
  assert.equal(contract.calculated.bendCount, 4);
  assert.equal(contract.machineOutput.generic.segments[3].bendAfterDeg, 90);
});

test('buildShapeDataContractV2 returns mesh envelope with counts and machine profile placeholders', () => {
  const { buildShapeDataContractV2 } = loadShapeEditorGeometry();
  const contract = buildShapeDataContractV2({
    family: 'mesh',
    length: 600,
    width: 250,
    longitudinalDiameter: 8,
    longitudinalSpacing: 20,
    transverseDiameter: 8,
    transverseSpacing: 20,
    edgeLeft: 0,
    edgeRight: 0,
    edgeTop: 0,
    edgeBottom: 0,
    quantity: 4,
  });

  assert.equal(contract.shapeType, 'mesh_rectangular');
  assert.equal(contract.family, 'mesh');
  assert.equal(contract.data.length, 600);
  assert.equal(contract.data.width, 250);
  assert.equal(contract.calculated.longitudinalBarCount, 14);
  assert.equal(contract.calculated.transverseBarCount, 31);
  assert.equal(contract.calculated.totalLengthMm, 16150);
  assert.equal(contract.machineOutput.generic.longitudinalBarCount, 14);
  assert.equal(contract.machineOutput.generic.transverseBarCount, 31);
  assert.equal(contract.validation.valid, true);
  assert.equal('quantity' in contract.data, false);
  assert.deepEqual(Object.keys(contract.machineOutput.machineProfiles).sort(), ['MEP', 'PEDAX', 'SCHNELL']);
});

test('buildShapeDataContractV2 returns pile cage envelope with spiral zone machine output', () => {
  const { buildShapeDataContractV2 } = loadShapeEditorGeometry();
  const contract = buildShapeDataContractV2({
    family: 'piles',
    pileDiameter: 70,
    pileLength: 2200,
    longitudinalBars: 26,
    longitudinalDiameter: 22,
    spiralDiameter: 8,
    spiralZones: [
      { length: 70, pitch: 10 },
      { length: 200, pitch: 20 },
      { length: 1350, pitch: 20 },
    ],
    quantity: 2,
  });

  assert.equal(contract.shapeType, 'round_pile_cage');
  assert.equal(contract.family, 'piles');
  assert.equal(contract.data.longitudinalBars, 26);
  assert.equal(contract.data.spiralZones[0].name, 'Zone A');
  assert.equal(contract.calculated.totalLongitudinalLengthMm, 572000);
  assert.ok(contract.calculated.totalSpiralLengthMm > 0);
  assert.ok(contract.calculated.manufacturingBreakdown.length >= 2);
  assert.equal(contract.machineOutput.generic.spiralZones[1].startMm, 700);
  assert.equal(contract.machineOutput.generic.spiralZones[2].pitchMm, 200);
  assert.ok(contract.machineOutput.generic.manufacturingBreakdown.some(part => part.componentType === 'spiral_zone'));
  assert.ok(contract.machineOutput.generic.productionCards.some(card => card.cardType === 'pile_master'));
  assert.ok(contract.machineOutput.generic.productionCards.some(card => card.cardType === 'pile_component'));
  assert.equal(contract.validation.valid, true);
  assert.equal('quantity' in contract.data, false);
  assert.deepEqual(Object.keys(contract.machineOutput.machineProfiles).sort(), ['MEP', 'PEDAX', 'SCHNELL']);
});

test('shape editor approve path returns the SHAPE_DATA_CONTRACT_V2 envelope', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const confirmBlock = editor.match(/_confirm\(\) \{[\s\S]*?this\.close\(\);[\s\S]*?\n  \}/);

  assert.ok(confirmBlock, 'expected _confirm block');
  assert.match(confirmBlock[0], /delete normalized\.quantity/);
  assert.match(confirmBlock[0], /delete normalized\.qty/);
  assert.match(confirmBlock[0], /const contract = buildShapeDataContractV2\(normalized\)/);
  assert.match(confirmBlock[0], /\.\.\.contract/);
});



test('production card renders real spiral items from item fields instead of straight fallback', () => {
  const svg = itemShapeSvg({
    shape_name: 'spiral',
    spiral_diameter_mm: 300,
    spiral_turns: 30,
  });

  assert.match(svg, /data-shape-kind="spiral"/);
  assert.match(svg, /data-spiral-diameter-mm="300"/);
  assert.match(svg, /data-spiral-turns="30"/);
  assert.match(svg, /data-spiral-visual-labels="1"/);
  assert.match(svg, /\u05e7\u05d5\u05d8\u05e8 \u05e1\u05e4\u05d9\u05e8\u05d0\u05dc\u05d4/);
  assert.match(svg, /\u05de\u05e1\u05e4\u05e8 \u05db\u05e8\u05d9\u05db\u05d5\u05ea/);
  assert.doesNotMatch(svg, /data-shape-kind="straight-bar"/);
  assert.doesNotMatch(svg, /30 turns/);
});

test('production card renders legacy spiral snapshot retroactively', () => {
  const svg = itemShapeSvg({
    shape_snapshot_json: JSON.stringify({
      contract: 'ORDER_ITEM_SHAPE_SNAPSHOT',
      shapeName: 'ספיראלה',
      spiralDiameterMm: 250,
      spiralTurns: 18,
      segments: [],
    }),
    segments: JSON.stringify([]),
  });

  assert.match(svg, /data-shape-kind="spiral"/);
  assert.match(svg, /data-spiral-diameter-mm="250"/);
  assert.match(svg, /data-spiral-turns="18"/);
  assert.match(svg, /\u05de\u05e1\u05e4\u05e8 \u05db\u05e8\u05d9\u05db\u05d5\u05ea/);
  assert.doesNotMatch(svg, /18 turns/);
});

test('production card renders a single straight bar with readable centimeter dimension', () => {
  const svg = shapeSvg(JSON.stringify([
    { length_mm: 850, angle_deg: 0 },
  ]));

  assert.match(svg, /data-shape-kind="straight-bar"/);
  assert.match(svg, />85</);
  assert.match(svg, /stroke="#1a2332"/);
  assert.doesNotMatch(svg, /stroke="#ccc"/);
});

test('production card renders open U bars as a readable U shape, not a flattened line', () => {
  const svg = shapeSvg(JSON.stringify([
    { length_mm: 200, angle_deg: 90 },
    { length_mm: 1900, angle_deg: 90 },
    { length_mm: 200, angle_deg: 0 },
  ]));

  assert.match(svg, /data-shape-kind="open-u"/);
  assert.match(svg, /M 42,78 L 42,24 L 178,24 L 178,78/);
  assert.match(svg, />190</);
  assert.match(svg, />20</);
  assert.match(svg, /stroke="#a8b0ba"/);
  assert.match(svg, /<line x1="42\.0" y1="51\.0" x2="20\.0" y2="51\.0"/);
  assert.match(svg, /<line x1="110\.0" y1="24\.0" x2="110\.0" y2="4\.0"/);
  assert.match(svg, /<line x1="178\.0" y1="51\.0" x2="200\.0" y2="51\.0"/);
  assert.doesNotMatch(svg, /90&#176;/);
  assert.doesNotMatch(svg, /<circle/);
});

test('production card keeps short bent legs visually readable next to a long bar', () => {
  const svg = shapeSvg(JSON.stringify([
    { length_mm: 75, angle_deg: 90 },
    { length_mm: 2500, angle_deg: 90 },
    { length_mm: 300, angle_deg: 0 },
  ]));
  const pathMatch = svg.match(/<path d="M ([^"]+)"/);
  assert.ok(pathMatch, 'expected a drawn production-card path');
  const points = pathMatch[1].split(' L ').map(pair => pair.split(',').map(Number));
  const firstSegmentLength = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);

  assert.match(svg, /data-proportional-short-bends="1"/);
  assert.ok(firstSegmentLength >= 18, `expected short bent leg to remain readable, got ${firstSegmentLength}`);
  assert.match(svg, />7.5</);
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
  assert.match(svg, />30</);
  assert.match(svg, />95</);
  assert.match(svg, /stroke="#a8b0ba"/);
  assert.match(svg, /data-stirrup-marker="overlap"/);
  assert.doesNotMatch(svg, /data-tail=/);
  assert.doesNotMatch(svg, /end tails/);
  assert.doesNotMatch(svg, /<circle/);
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
  assert.match(svg, />30</);
  assert.match(svg, />95</);
  assert.match(svg, /stroke="#a8b0ba"/);
  assert.match(svg, /data-stirrup-marker="overlap"/);
  assert.doesNotMatch(svg, /data-tail=/);
  assert.doesNotMatch(svg, /end tails/);
  assert.doesNotMatch(svg, /<circle/);
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

