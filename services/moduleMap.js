'use strict';

function normalizeLink(link = {}) {
  if (typeof link === 'string') return { event: link };
  return { ...link };
}

function eventKey(link) {
  return normalizeLink(link).event || null;
}

function flowStatus(stat, staleMs) {
  if (!stat?.lastSeen) return 'never_seen';
  const ageMs = Date.now() - Date.parse(stat.lastSeen);
  if (!Number.isFinite(ageMs)) return 'unknown';
  return ageMs > staleMs ? 'stale' : 'active';
}

function createModuleMapService({ routeModules = [], getEventStats, staleMs = 24 * 60 * 60 * 1000 } = {}) {
  if (typeof getEventStats !== 'function') {
    throw new Error('services/moduleMap missing dependency: getEventStats');
  }

  function manifests() {
    return routeModules
      .map(({ file, factory }) => ({ file, manifest: factory?.manifest || null }))
      .filter(row => row.manifest)
      .map(({ file, manifest }) => ({
        id: manifest.id,
        label: manifest.label || manifest.id,
        file,
        consumes: (manifest.consumes || []).map(normalizeLink),
        produces: (manifest.produces || []).map(normalizeLink),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function snapshot() {
    const stats = getEventStats();
    const statByEvent = new Map(stats.map(stat => [stat.type, stat]));
    const modules = manifests();
    const consumersByEvent = new Map();

    for (const module of modules) {
      for (const link of module.consumes) {
        const event = eventKey(link);
        if (!event) continue;
        if (!consumersByEvent.has(event)) consumersByEvent.set(event, []);
        consumersByEvent.get(event).push(module.id);
      }
    }

    const flows = [];
    for (const module of modules) {
      for (const link of module.produces) {
        const event = eventKey(link);
        if (!event) continue;
        const stat = statByEvent.get(event);
        const targets = consumersByEvent.get(event) || [];
        const base = {
          from: module.id,
          event,
          count: stat?.count || 0,
          lastSeen: stat?.lastSeen || null,
          status: flowStatus(stat, staleMs),
        };
        if (!targets.length) {
          flows.push({ ...base, to: null });
        } else {
          targets.forEach(to => flows.push({ ...base, to }));
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      modules: modules.map(module => ({
        ...module,
        inputCount: module.consumes.length,
        outputCount: module.produces.length,
      })),
      flows,
      events: stats,
    };
  }

  return { manifests, snapshot };
}

module.exports = { createModuleMapService };
