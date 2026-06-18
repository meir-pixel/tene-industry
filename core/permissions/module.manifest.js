module.exports = {
  id: 'core-permissions',
  title: 'Core Permissions',
  type: 'platform-core',
  licenseKey: 'core',
  status: 'specification',
  owner: 'codex-admin-system-licensing',
  owns: {
    routes: ['/api/permissions'],
    tables: ['permission_overrides', 'permission_audit'],
    screens: ['/admin/permissions.html'],
  },
  consumes: [
    { type: 'service', module: 'core-auth', name: 'currentIdentity' },
    { type: 'service', module: 'core-module-registry', name: 'listActiveManifests' },
    { type: 'service', module: 'core-licensing', name: 'isModuleEnabled' },
    { type: 'service', module: 'core-audit', name: 'appendAudit' },
  ],
  produces: [
    { type: 'service', name: 'requireRole' },
    { type: 'service', name: 'requireAnyRole' },
    { type: 'service', name: 'requireCapability' },
    { type: 'service', name: 'effectiveAccess' },
    { type: 'service', name: 'screensForRole' },
    { type: 'event', name: 'permissions.matrix_updated' },
    { type: 'event', name: 'permissions.access_denied' },
  ],
  access: {
    default: 'hidden',
    roles: {
      admin: 'edit',
    },
  },
  risks: [
    'overrides must only reduce access and never bypass route guards',
    'customer and supplier must remain portal identities, not staff roles',
    'license-disabled modules must not appear in navigation or matrix output',
  ],
};