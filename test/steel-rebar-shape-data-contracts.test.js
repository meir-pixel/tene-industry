const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractPath = path.join(__dirname, '..', 'docs', 'modules', 'steel-rebar-shape-data-contracts.md');

function contractText() {
  return fs.readFileSync(contractPath, 'utf8');
}

function familySection(text, family) {
  const rx = new RegExp(`## Family: ${family}[\\s\\S]*?(?=\\n## Family:|\\n## Migration|$)`);
  const match = text.match(rx);
  assert.ok(match, `missing ${family} family section`);
  return match[0];
}

test('steel rebar shape data contracts define the three required families', () => {
  const text = contractText();

  for (const family of ['bars', 'mesh', 'piles']) {
    const section = familySection(text, family);
    assert.match(section, /### 1\. Database Schema/);
    assert.match(section, /### 2\. Saved JSON Format/);
    assert.match(section, /### 3\. Machine Output Format/);
    assert.match(section, /### 4\. Validation Rules/);
    assert.match(section, new RegExp(`"family": "${family}"`));
  }
});

test('mesh and pile contracts explicitly reject side-angle payloads', () => {
  const text = contractText();
  const mesh = familySection(text, 'mesh');
  const piles = familySection(text, 'piles');

  assert.match(mesh, /does not use `sides\[\]` or `angles\[\]`/);
  assert.match(mesh, /Payload must not contain `sides`, `angles`, `azAngles`, or `elAngles`/);
  assert.match(piles, /does not use `sides\[\]` or `angles\[\]`/);
  assert.match(piles, /Payload must not contain `sides`, `angles`, `azAngles`, or `elAngles`/);
});

test('machine output contracts include family-specific production data', () => {
  const text = contractText();
  const bars = familySection(text, 'bars');
  const mesh = familySection(text, 'mesh');
  const piles = familySection(text, 'piles');

  assert.match(bars, /"machineType": "polyline_bar"/);
  assert.match(bars, /"segments"/);
  assert.match(mesh, /"machineType": "mesh_grid"/);
  assert.match(mesh, /"barCount"/);
  assert.match(mesh, /Changing spacing changes only count and grid positions/);
  assert.match(piles, /"machineType": "pile_cage"/);
  assert.match(piles, /"spiralZones"/);
  assert.match(piles, /Changing one zone pitch changes only that zone/);
});
