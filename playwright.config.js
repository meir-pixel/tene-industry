'use strict';

const path = require('path');
const { defineConfig } = require('@playwright/test');

const port = Number(process.env.E2E_PORT || 43173);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;
const resultsRoot = process.env.E2E_RESULTS_DIR || path.join(__dirname, 'test-results', 'portal-e2e');

module.exports = defineConfig({
  testDir: path.join(__dirname, 'test', 'e2e'),
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: path.join(resultsRoot, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(resultsRoot, 'results.json') }],
    ['html', { outputFolder: path.join(resultsRoot, 'html'), open: 'never' }],
  ],
  use: {
    baseURL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node test/e2e/support/start-portal-server.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: process.env.E2E_DB_PATH || '',
      BACKUP_DIR: process.env.E2E_BACKUP_DIR || '',
      E2E_SERVER_LOG: process.env.E2E_SERVER_LOG || '',
      NODE_ENV: 'test',
      SKIP_STARTUP_DB_SNAPSHOT: 'true',
      JWT_SECRET: process.env.JWT_SECRET || 'portal-e2e-jwt-secret',
      LICENSE_KEY: '',
      AI_ENABLED: 'false',
      INTAKE_AI_ENABLED: 'false',
      PRIORITY_ENABLED: 'false',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1366, height: 900 },
      },
    },
  ],
});
