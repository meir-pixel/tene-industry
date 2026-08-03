'use strict';

const { CustomerQuotationError } = require('../services/customerQuotationV1');
const quotationPrintPage = require('../services/quotationPrintPage');

const READ_ROLES = ['sales', 'office', 'finance', 'manager', 'admin'];
const DRAFT_ROLES = ['sales', 'office', 'manager', 'admin'];
const ISSUE_ROLES = ['office', 'manager', 'admin'];
const DECIDE_ROLES = ['manager', 'admin'];

function sendError(res, error) {
  const status = error instanceof CustomerQuotationError
    ? error.statusCode
    : Number(error.statusCode || 400);
  return res.status(status).json({ error: error.code || 'quotation_operation_failed' });
}

module.exports = function createQuotationsRouter({ quotationService, requireAnyRole }) {
  if (!quotationService) throw new Error('routes/quotations missing dependency: quotationService');
  if (!requireAnyRole) throw new Error('routes/quotations missing dependency: requireAnyRole');
  const router = require('express').Router();

  router.get('/quotations', requireAnyRole(READ_ROLES), (req, res) => {
    res.json(quotationService.listQuotations(req.query || {}));
  });

  router.get('/quotations/:id/revisions/:revisionNumber', requireAnyRole(READ_ROLES), (req, res) => {
    const revision = quotationService.getRevision(req.params.id, req.params.revisionNumber);
    return revision ? res.json(revision) : res.status(404).json({ error: 'quotation_revision_not_found' });
  });

  router.get('/quotations/:id/pdf', requireAnyRole(READ_ROLES), (req, res) => {
    try {
      const quotation = quotationService.getQuotation(req.params.id);
      if (!quotation) return res.status(404).json({ error: 'quotation_not_found' });
      const revision = quotationService.getRevision(req.params.id, req.query.revision);
      if (!revision) return res.status(404).json({ error: 'quotation_revision_not_found' });
      const html = quotationPrintPage.renderQuotationPrintPage({ quotation, revision });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="quotation-${quotation.quotation_num || quotation.id}-r${revision.revision_number}.html"`);
      return res.send(html);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/quotations/:id', requireAnyRole(READ_ROLES), (req, res) => {
    const quotation = quotationService.getQuotation(req.params.id);
    return quotation ? res.json(quotation) : res.status(404).json({ error: 'quotation_not_found' });
  });

  router.post('/quotations', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try {
      return res.status(201).json(quotationService.createDraft({ ...req.body, created_by: req.auth?.sub }));
    } catch (error) { return sendError(res, error); }
  });

  router.patch('/quotations/:id/draft', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try {
      return res.json(quotationService.updateDraft({ ...req.body, quotation_id: req.params.id, updated_by: req.auth?.sub }));
    } catch (error) { return sendError(res, error); }
  });

  router.delete('/quotations/:id/draft', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try {
      return res.json(quotationService.deleteUnusedDraft({ ...req.body, quotation_id: req.params.id, actor_id: req.auth?.sub }));
    } catch (error) { return sendError(res, error); }
  });

  router.post('/quotations/:id/issue', requireAnyRole(ISSUE_ROLES), (req, res) => {
    try {
      return res.json(quotationService.issue({ ...req.body, quotation_id: req.params.id, issued_by: req.auth?.sub }));
    } catch (error) { return sendError(res, error); }
  });

  router.post('/quotations/:id/revisions', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try {
      return res.status(201).json(quotationService.createNewRevision({ ...req.body, quotation_id: req.params.id, created_by: req.auth?.sub }));
    } catch (error) { return sendError(res, error); }
  });

  for (const action of ['accept', 'reject', 'expire', 'cancel', 'archive']) {
    router.post(`/quotations/:id/${action}`, requireAnyRole(DECIDE_ROLES), (req, res) => {
      try {
        return res.json(quotationService[action]({ ...req.body, quotation_id: req.params.id, actor_id: req.auth?.sub }));
      } catch (error) { return sendError(res, error); }
    });
  }

  return router;
};

module.exports.manifest = {
  module: 'customers',
  label: 'Customer quotations V1',
  title: 'Customer quotations V1',
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'edit', sales: 'edit', finance: 'read' },
  },
  consumes: [
    { table: 'customers' },
    { table: 'projects' },
    { table: 'customer_sites' },
    { table: 'catalog_items' },
    { table: 'product_masters' },
    { table: 'price_books' },
  ],
  produces: [
    { table: 'customer_quotations' },
    { table: 'customer_quotation_revisions' },
    { table: 'customer_quotation_lines' },
    { table: 'customer_quotation_events' },
  ],
};
