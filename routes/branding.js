const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/branding missing dependency: ${name}`);
  return value;
}

module.exports = function createBrandingRouter(deps) {
  const branding = required('branding', deps.branding);

  // ── מיתוג ציבורי (ללא auth) — שם/לוגו/צבע בלבד ──────────────────
  // נטען על ידי כל דף דרך public/brand-client.js לפני התחברות.
  router.get('/branding', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(branding.get());
  });

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  id: 'branding',
  label: 'מיתוג',
  consumes: [{ table: 'settings' }],
  produces: [],
};
