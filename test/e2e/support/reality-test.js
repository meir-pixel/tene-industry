'use strict';

const fs = require('fs');
const { test: base, expect } = require('@playwright/test');

function shortBody(value, limit = 2000) {
  const text = String(value || '');
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function responseTextWithDeadline(response, timeoutMs = 1500) {
  return Promise.race([
    response.text().catch(() => ''),
    new Promise(resolve => setTimeout(() => resolve('[response body capture timed out]'), timeoutMs)),
  ]);
}

function matchesRule(entry, rule) {
  if (rule.status !== undefined && Number(rule.status) !== Number(entry.status)) return false;
  if (rule.method && String(rule.method).toUpperCase() !== entry.method) return false;
  if (rule.url instanceof RegExp) return rule.url.test(entry.url);
  return entry.url.includes(String(rule.url || ''));
}

const test = base.extend({
  reality: [async ({ page }, use, testInfo) => {
    const evidence = {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      apiResponses: [],
      expectedHttp: [],
      expectedConsole: [],
    };
    const pendingResponses = [];

    const onConsole = message => {
      if (message.type() !== 'error') return;
      evidence.consoleErrors.push({ text: message.text(), location: message.location() });
    };
    const onPageError = error => evidence.pageErrors.push({ message: error.message, stack: error.stack || '' });
    const onRequestFailed = request => evidence.failedRequests.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText || 'unknown request failure',
    });
    const onResponse = response => {
      const url = response.url();
      const isApi = /\/api\/c(?:\/|$)/.test(new URL(url).pathname);
      if (!isApi && response.status() < 500) return;
      const capture = (async () => {
        let body = '';
        try { body = shortBody(await responseTextWithDeadline(response)); } catch {}
        evidence.apiResponses.push({
          method: response.request().method(),
          url,
          status: response.status(),
          requestId: response.headers()['x-request-id'] || null,
          body,
        });
      })();
      pendingResponses.push(capture);
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);

    const reality = {
      evidence,
      allowHttp(rule) {
        evidence.expectedHttp.push(rule);
      },
      allowConsole(pattern) {
        evidence.expectedConsole.push(String(pattern));
      },
    };

    await use(reality);
    await Promise.allSettled(pendingResponses);

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);

    const unexpectedHttp = evidence.apiResponses.filter(entry => (
      entry.status >= 400 && !evidence.expectedHttp.some(rule => matchesRule(entry, rule))
    ));
    const failedCoreRequests = evidence.failedRequests.filter(entry => /\/api\/c(?:\/|$)/.test(new URL(entry.url).pathname));
    const failures = [
      ...evidence.consoleErrors
        .filter(entry => !evidence.expectedConsole.some(pattern => new RegExp(pattern).test(entry.text)))
        .map(entry => `console.error: ${entry.text}`),
      ...evidence.pageErrors.map(entry => `uncaught page error: ${entry.message}`),
      ...failedCoreRequests.map(entry => `failed portal request: ${entry.method} ${entry.url} (${entry.failure})`),
      ...unexpectedHttp.map(entry => `unexpected HTTP ${entry.status}: ${entry.method} ${entry.url} (${entry.body})`),
    ];

    const evidencePath = testInfo.outputPath('network-evidence.json');
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('network-evidence.json', { path: evidencePath, contentType: 'application/json' });
    if (failures.length) {
      const failuresPath = testInfo.outputPath('reality-guard-failures.txt');
      fs.writeFileSync(failuresPath, `${failures.join('\n')}\n`);
      await testInfo.attach('reality-guard-failures.txt', { path: failuresPath, contentType: 'text/plain' });
    }
    expect.soft(failures, 'Reality guard failures').toEqual([]);
  }, { auto: true }],
});

module.exports = { test, expect };
