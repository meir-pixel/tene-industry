const crypto = require('crypto');
const net = require('net');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_CLIENT_COOKIE = 'ib_login_client';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeUsername(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function parseCookie(req, name) {
  const cookieHeader = String(req.headers?.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function isValidLoginClientId(value) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(String(value || ''));
}

function ensureLoginClientId(req, res, next) {
  const existing = parseCookie(req, LOGIN_CLIENT_COOKIE);
  const clientId = isValidLoginClientId(existing)
    ? existing
    : crypto.randomBytes(18).toString('base64url');

  req.authRateLimitClientId = clientId;
  if (clientId !== existing) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append(
      'Set-Cookie',
      `${LOGIN_CLIENT_COOKIE}=${encodeURIComponent(clientId)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=31536000${secure}`
    );
  }
  next();
}

function getClientNetworkKey(req) {
  const cloudflareIp = String(req.get?.('cf-connecting-ip') || '').trim();
  const address = net.isIP(cloudflareIp)
    ? cloudflareIp
    : String(req.ip || req.socket?.remoteAddress || 'unknown');
  return ipKeyGenerator(address);
}

function getLoginCredentialKey(req) {
  const username = normalizeUsername(req.body?.username);
  if (username) return `user:${sha256(username)}`;

  const clientId = isValidLoginClientId(req.authRateLimitClientId)
    ? req.authRateLimitClientId
    : getClientNetworkKey(req);
  return `client:${sha256(clientId)}`;
}

function retryAfterSeconds(req, propertyName, windowMs) {
  const resetTime = req[propertyName]?.resetTime;
  if (resetTime instanceof Date) {
    return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
  }
  return Math.max(1, Math.ceil(windowMs / 1000));
}

function limiterHandler({ code, error, propertyName, windowMs }) {
  return (req, res) => res.status(429).json({
    error,
    code,
    retry_after_seconds: retryAfterSeconds(req, propertyName, windowMs),
  });
}

function createAuthLoginLimiters({
  isTest = false,
  windowMs = DEFAULT_WINDOW_MS,
  credentialLimit = isTest ? 100 : 5,
  networkLimit = isTest ? 1000 : 60,
} = {}) {
  const common = {
    windowMs,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
  };

  const networkProperty = 'authNetworkRateLimit';
  const credentialProperty = 'authCredentialRateLimit';
  const networkLimiter = rateLimit({
    ...common,
    limit: networkLimit,
    requestPropertyName: networkProperty,
    keyGenerator: req => getClientNetworkKey(req),
    handler: limiterHandler({
      code: 'auth_network_rate_limited',
      error: 'יותר מדי ניסיונות התחברות מהרשת. נסה שוב בעוד מספר דקות.',
      propertyName: networkProperty,
      windowMs,
    }),
  });
  const credentialLimiter = rateLimit({
    ...common,
    limit: credentialLimit,
    requestPropertyName: credentialProperty,
    keyGenerator: req => getLoginCredentialKey(req),
    handler: limiterHandler({
      code: 'auth_credential_rate_limited',
      error: 'יותר מדי ניסיונות התחברות שגויים. נסה שוב בעוד מספר דקות.',
      propertyName: credentialProperty,
      windowMs,
    }),
  });

  return [ensureLoginClientId, networkLimiter, credentialLimiter];
}

function configureTrustedProxy(app, {
  environment = process.env.NODE_ENV,
  hops = process.env.TRUST_PROXY_HOPS,
} = {}) {
  if (!new Set(['production', 'staging']).has(environment)) return false;
  const parsedHops = Number.parseInt(hops, 10);
  const trustedHops = Number.isSafeInteger(parsedHops) && parsedHops > 0 ? parsedHops : 1;
  app.set('trust proxy', trustedHops);
  return trustedHops;
}

module.exports = {
  LOGIN_CLIENT_COOKIE,
  configureTrustedProxy,
  createAuthLoginLimiters,
  ensureLoginClientId,
  getClientNetworkKey,
  getLoginCredentialKey,
  normalizeUsername,
};
