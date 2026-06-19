/**
 * brand-client.js — הזרקת מיתוג פר-לקוח בזמן ריצה (white-label).
 * כל דף טוען את הקובץ הזה. הוא מושך /api/branding ומחיל שם/לוגו/צבע,
 * כך שאין צורך לקבע "IronBend" בכל קובץ. עם cache מקומי כדי שלא יהבהב.
 *
 * נקודות עיגון אופציונליות ב-HTML:
 *   <element data-brand-name>   ← יוחלף בשם המותג
 *   <img data-brand-logo>       ← src יוחלף בלוגו
 *   CSS: var(--brand-primary)   ← הצבע הראשי
 */
(function () {
  'use strict';
  var CACHE_KEY = 'ib_brand_v2';
  var LEGACY_CACHE_KEYS = ['ib_brand_v1'];
  var LEGACY_LOGO_URL = '/brand/tene-' + 'logo.svg';
  var CURRENT_LOGO_URL = '/brand/tene-pdf-logo.jpg';

  function normalizeLogoUrl(value) {
    if (!value || value === LEGACY_LOGO_URL || value.indexOf(LEGACY_LOGO_URL) >= 0) {
      return CURRENT_LOGO_URL;
    }
    return value;
  }

  function apply(b) {
    if (!b) return;
    try {
      if (b.name) {
        var t = document.title || '';
        var idx = t.indexOf('–'); // פורמט "שם מסך – מותג"
        document.title = idx >= 0 ? (t.slice(0, idx).trim() + ' – ' + b.name) : b.name;
      }
      if (b.primaryColor) {
        document.documentElement.style.setProperty('--brand-primary', b.primaryColor);
      }
      b.logoUrl = normalizeLogoUrl(b.logoUrl);
      var nameEl = document.querySelector('[data-brand-name]');
      if (nameEl && b.name) nameEl.textContent = b.name;
      var logoEl = document.querySelector('[data-brand-logo]');
      if (logoEl && b.logoUrl) logoEl.setAttribute('src', b.logoUrl);
      window.IronBendBrand = b;
    } catch (e) { /* no-op */ }
  }

  // 1) החלת cache מיידית — מונע הבהוב מותג
  try {
    LEGACY_CACHE_KEYS.forEach(function (key) { localStorage.removeItem(key); });
    var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached) apply(cached);
  } catch (e) { /* no-op */ }

  // 2) רענון מהשרת
  fetch('/api/branding')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b) return;
      apply(b);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch (e) { /* no-op */ }
    })
    .catch(function () { /* offline — נשארים עם ה-cache */ });
})();
