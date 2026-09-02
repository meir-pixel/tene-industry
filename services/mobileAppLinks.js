'use strict';

function cleanDomain(value) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.port ? url.hostname.toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

function androidFingerprints(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(item => /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(item));
}

function validPackageName(value) {
  return /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(String(value || ''));
}

// Both association documents must be public, HTTPS-only and unredirected.
// The app identifiers are deliberately supplied at deployment time: a test
// certificate/fingerprint must never be accidentally published in production.
module.exports = function createMobileAppLinksRouter({ env = process.env } = {}) {
  const router = require('express').Router();
  const domain = cleanDomain(env.BASE_URL);
  const androidPackage = String(env.WORKER_ANDROID_PACKAGE_ID || '').trim();
  const fingerprints = androidFingerprints(env.WORKER_ANDROID_CERT_SHA256);
  const iosTeamId = String(env.WORKER_IOS_TEAM_ID || '').trim();
  const iosBundleId = String(env.WORKER_IOS_BUNDLE_ID || '').trim();

  function sendJson(res, body) {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').json(body);
  }

  function assetLinks(_req, res) {
    if (!domain || !validPackageName(androidPackage) || !fingerprints.length) {
      return res.status(404).json({ error: 'android_app_links_not_configured' });
    }
    return sendJson(res, [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: androidPackage,
        sha256_cert_fingerprints: fingerprints,
      },
    }]);
  }

  function appleAssociation(_req, res) {
    if (!domain || !/^[A-Z0-9]{10}$/i.test(iosTeamId) || !validPackageName(iosBundleId)) {
      return res.status(404).json({ error: 'ios_universal_links_not_configured' });
    }
    return sendJson(res, {
      applinks: {
        apps: [],
        details: [{
          appID: `${iosTeamId}.${iosBundleId}`,
          components: [{
            '/': '/customer-scan.html',
            comment: 'Only printed work-card QR URLs are delivered to the worker app.',
          }],
        }],
      },
    });
  }

  router.get('/.well-known/assetlinks.json', assetLinks);
  router.get('/.well-known/apple-app-site-association', appleAssociation);
  router.get('/apple-app-site-association', appleAssociation);
  return router;
};

module.exports.cleanDomain = cleanDomain;
module.exports.androidFingerprints = androidFingerprints;
