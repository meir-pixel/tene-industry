'use strict';

function normalizeWebBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function requestPublicBaseUrl(req, settingsService = null) {
  const configured = normalizeWebBaseUrl(
    process.env.BASE_URL || settingsService?.get?.('BASE_URL', ''),
  );
  if (configured) return configured;

  const proto = String(req?.get?.('x-forwarded-proto') || req?.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = String(req?.get?.('x-forwarded-host') || req?.get?.('host') || '')
    .split(',')[0]
    .trim();
  if (!host || (proto !== 'http' && proto !== 'https')) return '';
  return normalizeWebBaseUrl(`${proto}://${host}`);
}

function customerScanUrl(req, internalCode, settingsService = null) {
  const baseUrl = requestPublicBaseUrl(req, settingsService);
  const path = `/customer-scan.html?code=${encodeURIComponent(String(internalCode || '').trim())}`;
  return `${baseUrl}${path}`;
}

module.exports = {
  customerScanUrl,
  normalizeWebBaseUrl,
  requestPublicBaseUrl,
};
