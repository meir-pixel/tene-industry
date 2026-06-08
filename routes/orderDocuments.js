const router = require('express').Router();
const createOrderDeliveryCertificateRouter = require('./orderDeliveryCertificate');
const createOrderPrintA4Router = require('./orderPrintA4');

function required(name, value) {
  if (!value) throw new Error(`routes/orderDocuments missing dependency: ${name}`);
  return value;
}

module.exports = function createOrderDocumentsRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const industry = required('industry', deps.industry);
  const tryParseJSON = required('tryParseJSON', deps.tryParseJSON);

  router.use(createOrderDeliveryCertificateRouter({
    db,
    requireAnyRole,
    industry,
  }));

  router.use(createOrderPrintA4Router({
    db,
    requireAnyRole,
    tryParseJSON,
  }));

  return router;
};

module.exports.manifest = {
  "id": "order-documents",
  "label": "Order Documents",
  "consumes": [
    {
      "table": "orders"
    },
    {
      "table": "items"
    }
  ],
  "produces": []
};
