const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-edge-smoke-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpRoot, 'smoke.db');
process.env.BACKUP_DIR = path.join(tmpRoot, 'backups');
process.env.AUTH_ENFORCEMENT = 'false';

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

const edgePath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(fs.existsSync);

if (!edgePath) {
  console.error('Microsoft Edge was not found');
  process.exit(1);
}

function seedUser(username, role, pin) {
  db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString());
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result || {});
    }
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      resolve({
        send(method, params = {}) {
          const callId = ++id;
          ws.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((res, rej) => pending.set(callId, { resolve: res, reject: rej }));
        },
        close() {
          ws.close();
        }
      });
    });
    ws.once('error', reject);
  });
}

async function createPage(debuggingPort, url) {
  const endpoint = `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(endpoint, { method: 'PUT' });
  if (!response.ok) response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not create browser page: ${response.status}`);
  return response.json();
}

async function capturePage(baseUrl, debuggingPort, urlPath, fileName, token) {
  const target = await createPage(debuggingPort, `${baseUrl}/login.html`);
  const page = await cdp(target.webSocketDebuggerUrl);
  const send = (method, params = {}) => page.send(method, params);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${baseUrl}/login.html` });
  await delay(700);
  await send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('ib_access_token', ${JSON.stringify(token)});
      localStorage.setItem('ib_role', 'admin');
      localStorage.setItem('ib_user', 'smoke-admin');
    `,
  });
  await send('Page.navigate', { url: `${baseUrl}${urlPath}` });
  await delay(1800);
  const metrics = await send('Page.getLayoutMetrics');
  const contentSize = metrics.contentSize || { width: 1440, height: 1100 };
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: 0,
      y: 0,
      width: Math.max(1, Math.ceil(contentSize.width || 1440)),
      height: Math.max(1, Math.ceil(contentSize.height || 1100)),
      scale: 1,
    },
  });
  const outPath = path.join(tmpRoot, fileName);
  fs.writeFileSync(outPath, Buffer.from(screenshot.data, 'base64'));
  await send('Page.close').catch(() => {});
  page.close();
  return outPath;
}

(async () => {
  let edge;
  try {
    seedUser('smoke-admin', 'admin', '9001');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smoke-admin', pin: '9001' }),
    });
    if (!login.ok) throw new Error(`Login failed: ${login.status}`);
    const { access_token } = await login.json();

    const debuggingPort = 9223;
    edge = spawn(edgePath, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${path.join(tmpRoot, 'edge-profile')}`,
      `--remote-debugging-port=${debuggingPort}`,
      '--window-size=1440,1100',
      'about:blank',
    ], { stdio: 'ignore' });

    const version = await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`);
    const shots = [];
    shots.push(await capturePage(baseUrl, debuggingPort, '/login.html', 'login.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/admin.html', 'admin.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/dashboard.html', 'dashboard.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/reports.html', 'reports.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/intake.html', 'intake.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/production-setup.html', 'production-setup.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/finance.html', 'finance.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/projects.html', 'projects.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/procurement.html', 'procurement.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/warroom.html', 'warroom.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/quality.html', 'quality.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/inventory.html', 'inventory.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/warehouse.html', 'warehouse.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/delivery-admin.html', 'delivery-admin.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/driver.html', 'driver.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/maintenance.html', 'maintenance.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/customers.html', 'customers.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/orders.html', 'orders.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/machine.html', 'machine.png', access_token));
    shots.push(await capturePage(baseUrl, debuggingPort, '/production-queue.html', 'production-queue.png', access_token));

    console.log(JSON.stringify({ ok: true, baseUrl, tmpRoot, screenshots: shots }, null, 2));
  } finally {
    if (edge) edge.kill();
    await new Promise(resolve => closeServer(resolve));
    db.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
