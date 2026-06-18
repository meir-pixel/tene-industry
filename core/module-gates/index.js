const DEFAULT_CORE_MODULES = Object.freeze([
  'core-auth',
  'core-permissions',
  'admin-users',
  'core-licensing',
  'core-module-registry',
  'core-module-gates',
  'system-settings',
  'system-health',
  'admin-audit',
]);

const OPEN_LICENSE_MODES = new Set(['dev', 'development', 'test', 'free']);

function required(name, value) {
  if (value === undefined || value === null) {
    throw new Error(`core/module-gates missing dependency: ${name}`);
  }
  return value;
}

function normalizeModuleId(moduleId) {
  const id = String(moduleId || '').trim();
  if (!id) throw new Error('moduleId is required');
  return id;
}

function createModuleGate(deps = {}) {
  const isModuleEnabled = required('isModuleEnabled', deps.isModuleEnabled);
  const defaultLicenseMode = deps.defaultLicenseMode || 'production';
  const coreModules = new Set(deps.coreModules || DEFAULT_CORE_MODULES);

  function isCoreModule(moduleId) {
    return coreModules.has(normalizeModuleId(moduleId));
  }

  function licenseMode(context = {}) {
    return String(context.licenseMode || context.mode || defaultLicenseMode).toLowerCase();
  }

  function isOpenMode(context = {}) {
    return OPEN_LICENSE_MODES.has(licenseMode(context));
  }

  function checkModule(moduleId, context = {}) {
    const id = normalizeModuleId(moduleId);
    if (isCoreModule(id)) {
      return { allowed: true, moduleId: id, core: true, reason: 'core_module' };
    }
    if (isOpenMode(context)) {
      return { allowed: true, moduleId: id, core: false, reason: 'open_mode' };
    }
    if (Boolean(isModuleEnabled(id, context))) {
      return { allowed: true, moduleId: id, core: false, reason: 'licensed' };
    }
    return { allowed: false, moduleId: id, core: false, reason: 'module_not_licensed' };
  }

  function requireModule(moduleId) {
    const id = normalizeModuleId(moduleId);
    return (req, res, next) => {
      const decision = checkModule(id, {
        licenseMode: req.licenseMode,
        customerId: req.customerId,
        tenantId: req.tenantId,
        auth: req.auth,
      });
      if (decision.allowed) return next();
      return res.status(403).json({
        error: 'Module is not included in this license',
        code: decision.reason,
        module: id,
      });
    };
  }

  function listModuleStatus(moduleIds, context = {}) {
    if (!Array.isArray(moduleIds)) throw new Error('moduleIds must be an array');
    return moduleIds.map(moduleId => checkModule(moduleId, context));
  }

  return {
    checkModule,
    isCoreModule,
    isOpenMode,
    listModuleStatus,
    requireModule,
  };
}

module.exports = {
  DEFAULT_CORE_MODULES,
  OPEN_LICENSE_MODES,
  createModuleGate,
};
