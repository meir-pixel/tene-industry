'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const createMobileAppLinksRouter = require('../services/mobileAppLinks');

test('mobile association files are public only when release identifiers are configured', async (t) => {
  const app = express();
  app.use(createMobileAppLinksRouter({ env: {
    BASE_URL: 'https://factory.example',
    WORKER_ANDROID_PACKAGE_ID: 'il.co.tene.work',
    WORKER_ANDROID_CERT_SHA256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    WORKER_IOS_TEAM_ID: 'ABCDEF1234',
    WORKER_IOS_BUNDLE_ID: 'il.co.tene.work',
  } }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const android = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(android.status, 200);
  assert.equal(android.headers.get('content-type')?.startsWith('application/json'), true);
  assert.deepEqual(await android.json(), [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app', package_name: 'il.co.tene.work',
      sha256_cert_fingerprints: ['AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'],
    },
  }]);

  const ios = await fetch(`${base}/.well-known/apple-app-site-association`);
  assert.equal(ios.status, 200);
  const iosBody = await ios.json();
  assert.equal(iosBody.applinks.details[0].appID, 'ABCDEF1234.il.co.tene.work');
  assert.equal(iosBody.applinks.details[0].components[0]['/'], '/customer-scan.html');
});

test('mobile association files do not publish placeholder app identities', async (t) => {
  const app = express();
  app.use(createMobileAppLinksRouter({ env: { BASE_URL: 'https://factory.example' } }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/.well-known/assetlinks.json`)).status, 404);
  assert.equal((await fetch(`${base}/.well-known/apple-app-site-association`)).status, 404);
});
