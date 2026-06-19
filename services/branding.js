'use strict';

/**
 * services/branding.js — מקור מיתוג יחיד (white-label).
 * מחזיר שם/לוגו/צבע/טלפון-תמיכה מתוך ה-settings של הלקוח, עם ברירות מחדל.
 * שום דבר רגיש כאן — רק מה שמותר להציג ללקוח החיצוני.
 */

function required(name, value) {
  if (!value) throw new Error(`services/branding missing dependency: ${name}`);
  return value;
}

const BRAND_DEFAULTS = {
  name: 'טנא תעשיות ברזל בע"מ',
  logoUrl: '/brand/tene-pdf-logo.jpg',
  primaryColor: '#2E75B6',
  supportPhone: '',
};

function createBrandingService(settingsService) {
  required('settingsService', settingsService);

  function normalizeLogoUrl(value) {
    const legacyLogoUrl = '/brand/tene-' + 'logo.svg';
    if (!value || value === legacyLogoUrl || value.endsWith(legacyLogoUrl)) {
      return BRAND_DEFAULTS.logoUrl;
    }
    return value;
  }

  function get() {
    return {
      name:         settingsService.get('BRAND_NAME',          BRAND_DEFAULTS.name)         || BRAND_DEFAULTS.name,
      logoUrl:      normalizeLogoUrl(settingsService.get('BRAND_LOGO_URL', BRAND_DEFAULTS.logoUrl)),
      primaryColor: settingsService.get('BRAND_PRIMARY_COLOR', BRAND_DEFAULTS.primaryColor) || BRAND_DEFAULTS.primaryColor,
      supportPhone: settingsService.get('BRAND_SUPPORT_PHONE', BRAND_DEFAULTS.supportPhone) || BRAND_DEFAULTS.supportPhone,
    };
  }

  return { get };
}

module.exports = { createBrandingService, BRAND_DEFAULTS };
