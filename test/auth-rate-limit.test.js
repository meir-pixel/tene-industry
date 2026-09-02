const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  LOGIN_CLIENT_COOKIE,
  configureTrustedProxy,
  createAuthLoginLimiters,
  getClientNetworkKey,
  getLoginCredentialKey,
} = require('../services/authRateLimit');

async function withLoginServer(options, run) {
  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', createAuthLoginLimiters(options), (req, res) => {
    if (String(req.body?.pin) !== '1234') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.append('Set-Cookie', 'refresh_token=test; HttpOnly; Path=/api/auth');
    return res.json({ ok: true });
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function login(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('production config trusts one proxy hop by default and leaves development unchanged', () => {
  const productionApp = express();
  assert.equal(configureTrustedProxy(productionApp, { environment: 'production' }), 1);
  assert.equal(productionApp.get('trust proxy'), 1);

  const configuredApp = express();
  assert.equal(configureTrustedProxy(configuredApp, { environment: 'staging', hops: '2' }), 2);
  assert.equal(configuredApp.get('trust proxy'), 2);

  const developmentApp = express();
  assert.equal(configureTrustedProxy(developmentApp, { environment: 'development' }), false);
  assert.equal(developmentApp.get('trust proxy'), false);
});

test('credential keys isolate usernames and never expose the username', () => {
  const first = getLoginCredentialKey({ body: { username: ' Worker-A ' } });
  const normalized = getLoginCredentialKey({ body: { username: 'worker-a' } });
  const other = getLoginCredentialKey({ body: { username: 'worker-b' } });

  assert.equal(first, normalized);
  assert.notEqual(first, other);
  assert.equal(first.includes('worker-a'), false);
});

test('PIN-only credential keys isolate browser clients instead of sharing the factory IP', () => {
  const first = getLoginCredentialKey({ body: { pin: '1111' }, authRateLimitClientId: 'client_A_123456789' });
  const sameClient = getLoginCredentialKey({ body: { pin: '9999' }, authRateLimitClientId: 'client_A_123456789' });
  const otherClient = getLoginCredentialKey({ body: { pin: '1111' }, authRateLimitClientId: 'client_B_123456789' });

  assert.equal(first, sameClient);
  assert.notEqual(first, otherClient);
  assert.equal(first.includes('1111'), false);
});

test('network key uses the Cloudflare client address when it is valid', () => {
  const req = {
    get: name => name === 'cf-connecting-ip' ? '203.0.113.25' : '',
    ip: '10.0.0.5',
  };
  assert.equal(getClientNetworkKey(req), '203.0.113.25');
});

test('successful logins do not consume the login limits', async () => {
  await withLoginServer({ credentialLimit: 2, networkLimit: 3, windowMs: 60_000 }, async baseUrl => {
    for (let index = 0; index < 6; index += 1) {
      const response = await login(baseUrl, { username: 'worker-a', pin: '1234' });
      assert.equal(response.status, 200);
    }
  });
});

test('failed username logins are limited per username, not for all workers', async () => {
  await withLoginServer({ credentialLimit: 3, networkLimit: 20, windowMs: 60_000 }, async baseUrl => {
    for (let index = 0; index < 3; index += 1) {
      const response = await login(baseUrl, { username: 'worker-a', pin: '0000' });
      assert.equal(response.status, 401);
    }
    const blocked = await login(baseUrl, { username: 'worker-a', pin: '0000' });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'auth_credential_rate_limited');

    const otherWorker = await login(baseUrl, { username: 'worker-b', pin: '0000' });
    assert.equal(otherWorker.status, 401);
  });
});

test('PIN-only failures are isolated per browser cookie', async () => {
  await withLoginServer({ credentialLimit: 2, networkLimit: 20, windowMs: 60_000 }, async baseUrl => {
    const clientA = { Cookie: `${LOGIN_CLIENT_COOKIE}=client_A_123456789` };
    const clientB = { Cookie: `${LOGIN_CLIENT_COOKIE}=client_B_123456789` };

    assert.equal((await login(baseUrl, { pin: '0000' }, clientA)).status, 401);
    assert.equal((await login(baseUrl, { pin: '0000' }, clientA)).status, 401);
    const blocked = await login(baseUrl, { pin: '0000' }, clientA);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'auth_credential_rate_limited');
    assert.equal((await login(baseUrl, { pin: '0000' }, clientB)).status, 401);
  });
});

test('a broad per-network ceiling remains in place across different usernames', async () => {
  await withLoginServer({ credentialLimit: 10, networkLimit: 3, windowMs: 60_000 }, async baseUrl => {
    const firstNetwork = { 'CF-Connecting-IP': '203.0.113.40' };
    for (let index = 0; index < 3; index += 1) {
      const response = await login(baseUrl, { username: `unknown-${index}`, pin: '0000' }, firstNetwork);
      assert.equal(response.status, 401);
    }
    const blocked = await login(baseUrl, { username: 'unknown-3', pin: '0000' }, firstNetwork);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'auth_network_rate_limited');

    const otherNetwork = await login(
      baseUrl,
      { username: 'unknown-4', pin: '0000' },
      { 'CF-Connecting-IP': '203.0.113.41' }
    );
    assert.equal(otherNetwork.status, 401);
  });
});

test('the anonymous client cookie is created without replacing the refresh cookie', async () => {
  await withLoginServer({ credentialLimit: 3, networkLimit: 10, windowMs: 60_000 }, async baseUrl => {
    const response = await login(baseUrl, { pin: '1234' });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.some(value => value.startsWith(`${LOGIN_CLIENT_COOKIE}=`)), true);
    assert.equal(cookies.some(value => value.startsWith('refresh_token=')), true);
  });
});
