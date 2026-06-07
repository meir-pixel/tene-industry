'use strict';

/**
 * Selects the active industry module through settings.
 * Replacing the active module should be a setting change, not a server rewrite.
 */

function required(name, value) {
  if (!value) throw new Error(`services/moduleLoader missing dependency: ${name}`);
  return value;
}

const AVAILABLE = {
  'steel-rebar': () => require('../modules/steel-rebar'),
};

function assertContract(id, mod) {
  [
    'id',
    'name',
    'kgPerMeter',
    'assignResource',
    'normalizeSegments',
    'normalizeShapeName',
    'weightPerUnit',
  ].forEach(key => {
    if (mod[key] === undefined) {
      throw new Error(`Industry module "${id}" missing contract member: ${key}`);
    }
  });
}

function createModuleLoader(settingsService) {
  required('settingsService', settingsService);

  function active() {
    const id = settingsService.get('ACTIVE_INDUSTRY_MODULE', 'steel-rebar');
    const factory = AVAILABLE[id];
    if (!factory) {
      throw new Error(`Unknown industry module: ${id}. Available: ${Object.keys(AVAILABLE).join(', ')}`);
    }

    const mod = factory();
    assertContract(id, mod);
    return mod;
  }

  return {
    active,
    listAvailable: () => Object.keys(AVAILABLE),
  };
}

module.exports = { createModuleLoader };
