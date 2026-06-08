'use strict';

/**
 * test/module-catalog.test.js
 *
 * שומר שמונע "נפילת מודולים":
 * shared/module-catalog.json הוא מקור האמת היחיד למודולים.
 * הבדיקות מוודאות שהוא תקין ועקבי מול הקוד בפועל.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'module-catalog.json'), 'utf8'));

test('catalog: core, modules and packages exist', () => {
  assert.ok(Array.isArray(catalog.core), 'core must be an array');
  assert.ok(Array.isArray(catalog.modules), 'modules must be an array');
  assert.ok(catalog.packages && typeof catalog.packages === 'object', 'packages object required');
});

test('catalog: module keys are unique and lowercase', () => {
  const keys = catalog.modules.map(m => m.key);
  assert.strictEqual(keys.length, new Set(keys).size, 'duplicate module keys found');
  keys.forEach(k => assert.match(k, /^[a-z][a-z0-9_]*$/, `bad module key: ${k}`));
});

test('catalog: every module has label + category', () => {
  catalog.modules.forEach(m => {
    assert.ok(m.label, `module ${m.key} missing label`);
    assert.ok(m.category, `module ${m.key} missing category`);
  });
});

test('catalog: every routeFile referenced actually exists (no fallen modules)', () => {
  catalog.modules.forEach(m => {
    if (m.routeFile) {
      const p = path.join(ROOT, m.routeFile);
      assert.ok(fs.existsSync(p), `module "${m.key}" points to missing file: ${m.routeFile}`);
    } else {
      // routeFile=null מותר רק אם מסומן planned
      assert.ok(m.planned, `module "${m.key}" has no routeFile and is not marked planned`);
    }
  });
});

test('catalog: packages reference only valid module keys', () => {
  const valid = new Set(catalog.modules.map(m => m.key));
  for (const [pkg, list] of Object.entries(catalog.packages)) {
    assert.ok(Array.isArray(list), `package ${pkg} must be an array`);
    list.forEach(k => assert.ok(valid.has(k), `package "${pkg}" references unknown module: ${k}`));
  }
});

test('catalog: quality and maintenance are separate sellable modules', () => {
  const modules = new Map(catalog.modules.map(m => [m.key, m]));
  assert.ok(modules.has('quality'), 'quality module missing');
  assert.ok(modules.has('maintenance'), 'maintenance module missing');
  assert.strictEqual(modules.get('quality').routeFile, 'routes/quality.js');
  assert.strictEqual(modules.get('maintenance').routeFile, 'routes/maintenance.js');
  assert.doesNotMatch(modules.get('quality').label, /תחזוקה|אחזקה/);
});

test('catalog: core keys do not collide with module keys', () => {
  const modKeys = new Set(catalog.modules.map(m => m.key));
  catalog.core.forEach(k => assert.ok(!modKeys.has(k), `core key "${k}" must not also be a toggleable module`));
});

test('catalog: fleet and logistics are separate sellable modules', () => {
  const modules = new Map(catalog.modules.map((m) => [m.key, m]));
  assert.equal(modules.get('fleet')?.routeFile, 'routes/fleet.js');
  assert.equal(modules.get('logistics')?.routeFile, 'routes/logistics.js');
  assert.doesNotMatch(modules.get('fleet')?.label || '', /משלוחים/);
  assert.match(modules.get('logistics')?.label || '', /משלוחים|לוגיסטיקה/);
});