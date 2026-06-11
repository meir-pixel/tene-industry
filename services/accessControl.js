'use strict';

/**
 * services/accessControl.js — Module-based permission matrix
 *
 * effective(role, screenId) = override (from settings) ?? manifest.access.roles[role] ?? manifest.access.default ?? 'hidden'
 *
 * Overrides can only restrict, never elevate beyond what requireRole/requireAnyRole in routes allows.
 * Storage key: ROLE_SCREEN_ACCESS (JSON in settings table — only deviations from manifest defaults)
 */

const VALID_LEVELS = new Set(['hidden', 'read', 'edit']);
const SETTING_KEY = 'ROLE_SCREEN_ACCESS';
const ALL_ROLES = ['admin', 'manager', 'office', 'finance', 'production', 'quality', 'maintenance', 'warehouse', 'driver', 'sales', 'kiosk', 'viewer'];

function createAccessControl({ routeManifests, settingsService }) {
  if (!routeManifests) throw new Error('accessControl missing dependency: routeManifests');
  if (!settingsService) throw new Error('accessControl missing dependency: settingsService');

  function getOverrides() {
    try {
      const raw = settingsService.get(SETTING_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveOverrides(overrides) {
    settingsService.set(SETTING_KEY, JSON.stringify(overrides));
  }

  // All screens declared across active route manifests
  function listScreens() {
    const screens = [];
    for (const manifest of routeManifests) {
      if (!manifest || !Array.isArray(manifest.screens)) continue;
      for (const screen of manifest.screens) {
        screens.push({ ...screen, moduleId: manifest.id, moduleLabel: manifest.label, _access: manifest.access });
      }
    }
    return screens;
  }

  function effective(role, screenId) {
    const screens = listScreens();
    const screen = screens.find(s => s.id === screenId);
    if (!screen) return 'hidden';

    const overrides = getOverrides();
    const screenOverride = overrides[screenId];
    if (screenOverride && screenOverride[role] !== undefined) return screenOverride[role];

    const acc = screen._access || {};
    if (acc.roles && acc.roles[role] !== undefined) return acc.roles[role];
    return acc.default || 'hidden';
  }

  function screensForRole(role) {
    return listScreens()
      .filter(s => effective(role, s.id) !== 'hidden')
      .map(s => ({ id: s.id, path: s.path, label: s.label, icon: s.icon, group: s.group, access: effective(role, s.id) }));
  }

  function matrix() {
    const screens = listScreens();
    const accessMap = {};
    for (const s of screens) {
      accessMap[s.id] = {};
      for (const r of ALL_ROLES) {
        accessMap[s.id][r] = effective(r, s.id);
      }
    }
    return {
      screens: screens.map(({ _access, ...rest }) => rest),
      roles: ALL_ROLES,
      access: accessMap,
    };
  }

  function applyOverride(screenId, role, level) {
    if (!VALID_LEVELS.has(level)) throw new Error(`Invalid access level: ${level}`);
    if (!ALL_ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
    const screens = listScreens();
    if (!screens.find(s => s.id === screenId)) throw new Error(`Unknown screen: ${screenId}`);
    const overrides = getOverrides();
    if (!overrides[screenId]) overrides[screenId] = {};
    overrides[screenId][role] = level;
    saveOverrides(overrides);
  }

  function canRead(role, screenId) { return effective(role, screenId) !== 'hidden'; }
  function canEdit(role, screenId) { return effective(role, screenId) === 'edit'; }

  return { listScreens, effective, screensForRole, canRead, canEdit, matrix, applyOverride };
}

module.exports = { createAccessControl, ALL_ROLES };
