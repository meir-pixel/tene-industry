module.exports = {
  id: 'core-auth',
  title: 'Core Auth',
  type: 'platform-core',
  licenseKey: 'core',
  status: 'specification',
  owner: 'codex-admin-system-licensing',
  owns: {
    routes: ['/api/auth'],
    tables: ['auth_sessions', 'auth_login_attempts'],
    screens: ['/login.html'],
  },
  consumes: [
    { type: 'service', module: 'admin-users', name: 'findUserForLogin' },
    { type: 'service', module: 'admin-users', name: 'getUserAuthProfile' },
    { type: 'service', module: 'core-audit', name: 'appendAudit' },
    { type: 'service', module: 'core-events', name: 'publish' },
  ],
  produces: [
    { type: 'service', name: 'authenticateCredentials' },
    { type: 'service', name: 'verifyAccessToken' },
    { type: 'service', name: 'refreshSession' },
    { type: 'service', name: 'revokeSessions' },
    { type: 'event', name: 'auth.login_succeeded' },
    { type: 'event', name: 'auth.login_failed' },
    { type: 'event', name: 'auth.session_refreshed' },
    { type: 'event', name: 'auth.session_revoked' },
  ],
  access: {
    default: 'hidden',
    roles: {
      admin: 'edit',
    },
  },
  risks: [
    'JWT secret must be mandatory outside dev/test',
    'AUTH_BYPASS must not exist in production runtime',
    'WebSocket auth must use the same identity model as HTTP',
  ],
};