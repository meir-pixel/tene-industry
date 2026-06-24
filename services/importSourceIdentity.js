'use strict';

function normalizeSourceSystem(value, fallback = '') {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  return raw.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function normalizeExternalId(value) {
  const raw = String(value || '').trim();
  return raw ? raw.slice(0, 160) : '';
}

function normalizeSourceIdentity(input = {}, fallbackSystem = '') {
  const sourceSystem = normalizeSourceSystem(
    input.source_system ?? input.sourceSystem ?? input.source ?? input.channel,
    fallbackSystem
  );
  const externalId = normalizeExternalId(
    input.external_id ?? input.externalId ?? input.source_external_id ?? input.sourceExternalId
  );
  if (!sourceSystem || !externalId) return null;
  return { source_system: sourceSystem, external_id: externalId };
}

function sourceIdentityFromRequest(req, fallbackSystem = '') {
  return normalizeSourceIdentity({ ...(req.query || {}), ...(req.body || {}) }, fallbackSystem);
}

function parseOrderIdsJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function assertKnownTable(table) {
  if (!['intake_log', 'order_imports'].includes(table)) {
    throw new Error('unsupported source identity table: ' + table);
  }
}

function findSourceIdentityDuplicate(db, table, identity, options = {}) {
  assertKnownTable(table);
  if (!identity?.source_system || !identity?.external_id) return null;
  const excludeId = Number(options.excludeId || 0);
  const params = [identity.source_system, identity.external_id];
  let sql = 'SELECT * FROM ' + table + ' WHERE source_system=? AND external_id=?';
  if (excludeId > 0) {
    sql += ' AND id<>?';
    params.push(excludeId);
  }
  sql += " ORDER BY CASE WHEN status='approved' THEN 0 ELSE 1 END, id LIMIT 1";
  return db.prepare(sql).get(...params) || null;
}

function sourceIdentityConflictPayload(kind, row) {
  const orderIds = parseOrderIdsJson(row.order_ids_json);
  return {
    success: false,
    code: 'source_identity_conflict',
    reviewRequired: true,
    error: 'Duplicate source identity requires review; existing approved import/order will not be overwritten.',
    conflict: {
      kind,
      existingId: row.id,
      status: row.status || null,
      orderId: row.order_id || null,
      orderIds,
      source_system: row.source_system || null,
      external_id: row.external_id || null,
    },
  };
}

function sourceIdentityConflictError(kind, row) {
  const error = new Error('Duplicate source identity requires review; existing approved import/order will not be overwritten.');
  error.statusCode = 409;
  error.payload = sourceIdentityConflictPayload(kind, row);
  return error;
}

module.exports = {
  findSourceIdentityDuplicate,
  normalizeExternalId,
  normalizeSourceIdentity,
  normalizeSourceSystem,
  sourceIdentityConflictError,
  sourceIdentityConflictPayload,
  sourceIdentityFromRequest,
};
