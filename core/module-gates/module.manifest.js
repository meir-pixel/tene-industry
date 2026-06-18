module.exports = {
  id: 'core-module-gates',
  title: 'Core Module Gates',
  type: 'platform-core',
  licenseKey: 'core',
  status: 'implementation',
  owner: 'codex-admin-system-licensing',
  owns: {
    routes: [],
    tables: [],
    screens: [],
    services: ['createModuleGate', 'requireModule'],
  },
  consumes: [
    { type: 'service', module: 'core-licensing', name: 'isModuleEnabled' },
    { type: 'service', module: 'core-module-registry', name: 'listModules' },
  ],
  produces: [
    { type: 'service', name: 'checkModule' },
    { type: 'service', name: 'requireModule' },
    { type: 'service', name: 'listModuleStatus' },
  ],
  access: {
    default: 'hidden',
    roles: {
      admin: 'edit',
    },
  },
  risks: [
    'Core modules must not be blocked by customer entitlements',
    'Open/free mode must never be confused with production entitlement enforcement',
    'Module gates do not replace role and capability checks inside route modules',
  ],
};
