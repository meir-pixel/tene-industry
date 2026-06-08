const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/license missing dependency: ${name}`);
  return value;
}

module.exports = function createLicenseRouter(deps) {
  const readLicensedModules = required('readLicensedModules', deps.readLicensedModules);
  const moduleCatalog = required('moduleCatalog', deps.moduleCatalog);

  router.get('/license/modules', (req, res) => {
    const enabled = readLicensedModules();
    const allModules = (moduleCatalog.modules || []).map(m => ({
      key: m.key,
      label: m.label,
      category: m.category,
    }));
    res.json({
      restricted: Boolean(enabled),
      modules: enabled ? [...enabled] : allModules.map(m => m.key),
      core: moduleCatalog.core || [],
      catalog: allModules,
    });
  });

  return router;
};