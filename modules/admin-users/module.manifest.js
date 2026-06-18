module.exports = {
  id: 'admin-users',
  title: 'ניהול משתמשים',
  type: 'core-product-module',
  licenseKey: 'core',
  status: 'specification',
  owner: 'codex-admin-system-licensing',
  owns: {
    routes: ['/api/admin/users'],
    tables: ['users', 'user_profile_history', 'user_invites'],
    screens: ['/admin/users.html', '/profile.html'],
  },
  consumes: [
    { type: 'service', module: 'core-auth', name: 'sessionLookup' },
    { type: 'service', module: 'core-auth', name: 'revokeSessions' },
    { type: 'service', module: 'core-permissions', name: 'listRoles' },
    { type: 'service', module: 'core-permissions', name: 'validateRole' },
    { type: 'service', module: 'core-licensing', name: 'userLimitStatus' },
    { type: 'service', module: 'core-audit', name: 'appendAudit' },
  ],
  produces: [
    { type: 'event', name: 'admin_users.user_created' },
    { type: 'event', name: 'admin_users.user_updated' },
    { type: 'event', name: 'admin_users.user_disabled' },
    { type: 'event', name: 'admin_users.user_enabled' },
    { type: 'event', name: 'admin_users.password_reset_requested' },
    { type: 'event', name: 'admin_users.sessions_revoked' },
  ],
  access: {
    default: 'hidden',
    roles: {
      admin: 'edit',
    },
  },
  screens: [
    {
      id: 'admin-users',
      path: '/admin/users.html',
      label: 'משתמשים',
      group: 'ניהול מערכת',
      defaultAccess: 'hidden',
    },
    {
      id: 'profile',
      path: '/profile.html',
      label: 'הפרופיל שלי',
      group: 'משתמש',
      defaultAccess: 'read',
    },
  ],
  risks: [
    'manager read-only access is not approved yet',
    'kiosk/PIN users require a separate auth mode decision',
    'customer and supplier identities must stay portal-scoped, not staff roles',
  ],
};