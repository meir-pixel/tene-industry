const ROLE_PERMISSIONS = {
  admin:       { level: 100, canApprove: true,  canDelete: true,  finance: true,  config: true  },
  manager:     { level:  90, canApprove: true,  canDelete: false, finance: true,  config: false },
  office:      { level:  70, canApprove: true,  canDelete: false, finance: false, config: false },
  finance:     { level:  65, canApprove: true,  canDelete: false, finance: true,  config: false },
  production:  { level:  50, canApprove: false, canDelete: false, finance: false, config: false },
  quality:     { level:  50, canApprove: true,  canDelete: false, finance: false, config: false },
  maintenance: { level:  50, canApprove: false, canDelete: false, finance: false, config: false },
  warehouse:   { level:  30, canApprove: false, canDelete: false, finance: false, config: false },
  driver:      { level:  30, canApprove: false, canDelete: false, finance: false, config: false },
  sales:       { level:  20, canApprove: false, canDelete: false, finance: false, config: false },
  kiosk:       { level:  15, canApprove: false, canDelete: false, finance: false, config: false },
  viewer:      { level:  10, canApprove: false, canDelete: false, finance: false, config: false },
};

const ROLE_ALIASES = {
  operator: 'kiosk',
};

function normalizeRole(role) {
  if (!role) return null;
  return ROLE_ALIASES[role] || role;
}

function getRolePermission(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return null;
  const permission = ROLE_PERMISSIONS[normalized];
  return permission ? { role: normalized, permission } : null;
}

function roleMeetsMinimum(role, minRole) {
  const actual = getRolePermission(role);
  const required = getRolePermission(minRole);
  if (!actual || !required) return false;
  return actual.permission.level >= required.permission.level;
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const actual = getRolePermission(req.auth.role);
    const required = getRolePermission(minRole);
    if (!actual) return res.status(403).json({ error: 'Unknown role', role: req.auth.role });
    if (!required) return res.status(500).json({ error: 'Required role is not configured', required_role: minRole });

    if (actual.permission.level < required.permission.level) {
      return res.status(403).json({
        error: 'Forbidden',
        required_role: minRole,
        your_role: actual.role,
        appeal: 'Contact the system administrator to request access'
      });
    }

    req.userRole = actual.role;
    req.userId = req.auth.sub || null;
    req.userPerm = actual.permission;
    next();
  };
}

function requireAnyRole(allowedRoles) {
  const allowed = new Set(allowedRoles.map(normalizeRole));
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const actual = getRolePermission(req.auth.role);
    if (!actual) return res.status(403).json({ error: 'Unknown role', role: req.auth.role });
    if (!allowed.has(actual.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        allowed_roles: [...allowed],
        your_role: actual.role,
        appeal: 'Contact the system administrator to request access'
      });
    }

    req.userRole = actual.role;
    req.userId = req.auth.sub || null;
    req.userPerm = actual.permission;
    next();
  };
}

module.exports = {
  ROLE_ALIASES,
  ROLE_PERMISSIONS,
  getRolePermission,
  normalizeRole,
  requireAnyRole,
  requireRole,
  roleMeetsMinimum,
};
