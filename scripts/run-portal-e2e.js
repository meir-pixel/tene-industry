'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const resultsDir = path.join(rootDir, 'test-results', 'portal-e2e');

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function main() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironbend-portal-e2e-'));
  const port = await reservePort();
  const env = {
    ...process.env,
    E2E_PORT: String(port),
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    E2E_DB_PATH: path.join(runDir, 'portal-e2e.db'),
    E2E_BACKUP_DIR: path.join(runDir, 'backups'),
    E2E_RESULTS_DIR: resultsDir,
    E2E_SERVER_LOG: path.join(resultsDir, 'server.log'),
    E2E_SEED_MANIFEST: path.join(resultsDir, 'seed-manifest.json'),
    NODE_ENV: 'test',
    SKIP_STARTUP_DB_SNAPSHOT: 'true',
    JWT_SECRET: process.env.JWT_SECRET || 'portal-e2e-jwt-secret',
    LICENSE_KEY: '',
  };

  fs.mkdirSync(resultsDir, { recursive: true });
  let exitCode = 1;
  try {
    const seed = await run(process.execPath, ['test/e2e/support/seed-portal-db.js'], env);
    if (seed.code !== 0) throw new Error(`Portal E2E seed failed with exit code ${seed.code}`);

    const cli = require.resolve('@playwright/test/cli');
    const playwright = await run(process.execPath, [cli, 'test', '--config=playwright.config.js', ...process.argv.slice(2)], env);
    exitCode = playwright.code;
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
