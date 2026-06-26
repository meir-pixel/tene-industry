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
test('shape editor bypasses the legacy shape selection screen', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');
  const goToSelect = editor.match(new RegExp("_goToSelect\\(\\) \\{[\\s\\S]*?\\n  \\}"));
  const openFallback = editor.match(/No existing shape: open the editor directly[\s\S]*?this\._startDefaultEdit\('bars'\)/);

  assert.ok(goToSelect, 'expected _goToSelect body');
  assert.match(goToSelect[0], /this\._startDefaultEdit\(this\._selectedFamily \|\| 'bars'\)/);
  assert.doesNotMatch(goToSelect[0], /sePageSelect'\)\.style\.display\s*=\s*'flex'/);
  assert.ok(openFallback, 'expected new shapes to open directly in edit mode');
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

test('shape editor includes synchronized engineering helper views', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /class="se-engineer-helper"/);
  assert.match(editor, /data-view="side"/);
  assert.match(editor, /data-view="top"/);
  assert.match(editor, /data-view="3d"/);
  assert.match(editor, /data-se-focus="mesh-longitudinal-spacing mesh-transverse-spacing"/);
  assert.match(editor, /data-se-focus="pile-length pile-diameter pile-longitudinal-bars pile-spiral-pitch pile-hoops"/);
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
  assert.match(editor, /saved\.filter\(s => s\.sides\.length === sideCount\)/);
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

  assert.match(index, /shape-editor\.js\?v=54/);
  assert.doesNotMatch(index, /shape-editor\.js\?v=53/);
});

test('shape editor exposes editable order item quantity outside the shape contract', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'shape-editor.js'), 'utf8');

  assert.match(editor, /id="seQuantityInput"/);
  assert.match(editor, /_setQuantity\(value\)/);
  assert.match(editor, /orderItemQuantity/);
  assert.match(editor, /delete normalized\.quantity/);
  assert.match(editor, /delete normalized\.qty/);
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
  assert.match(editor, /this\.current\.family === 'mesh'\) return this\._renderMeshEditor\(\)/);
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
  assert.match(editor, /this\.current\.family === 'piles'\) return this\._renderPileCageEditor\(\)/);
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
  assert.match(svg, /data-pile-diameter="70"/);
  assert.match(svg, /data-pile-length="2200"/);
  assert.match(svg, /data-longitudinal-bars="26"/);
  assert.match(svg, /data-spiral-zones="70@10,200@20,1350@20"/);
  assert.equal((svg.match(/class="pile-longitudinal-bar"/g) || []).length, 26);
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
  assert.match(svg, /data-spiral-zones="70@10,200@20:no-wrap,1350@20"/);
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
  assert.equal(contract.calculated.totalLongitudinalLengthMm, 57200);
  assert.ok(contract.calculated.totalSpiralLengthMm > 0);
  assert.equal(contract.machineOutput.generic.spiralZones[1].startMm, 70);
  assert.equal(contract.machineOutput.generic.spiralZones[2].pitchMm, 20);
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

