'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { ensureCoreSchema } = require('../db/coreSchema');
const { createOrderQuoteService } = require('../services/orderQuotes');

function quotePayload() {
  return {
    customer: { name: 'לקוח הצעה', phone: '0500000000', address: 'רחוב הבדיקה 1' },
    order: { deliveryDate: '2026-09-05', deliveryAddress: 'רחוב הבדיקה 1', totalWeight: 23.5 },
    pallets: [{ items: [{ shapeName: 'ישר', diameter: 12, length: 6000, qty: 2 }] }],
  };
}

test('quote is stored separately and creates an order only upon approval', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  ensureCoreSchema(db);
  const receivedPayloads = [];
  const service = createOrderQuoteService(db, {
    createOrderFromPayload(payload) {
      receivedPayloads.push(payload);
      const result = db.prepare("INSERT INTO orders (order_num, quote_id, quote_num, total_weight, sale_price) VALUES (?,?,?,?,?)")
        .run(`ORD-${receivedPayloads.length}`, payload.order.quoteId, payload.order.quoteNum, payload.order.totalWeight, payload.order.quoteTotal);
      return { success: true, orderId: Number(result.lastInsertRowid), orderNum: `ORD-${receivedPayloads.length}` };
    },
  });

  const quote = service.createQuoteTransaction({
    payload: quotePayload(),
    pricingSnapshot: { totals: { total: 113.49 } },
    createdBy: 17,
  });
  assert.equal(quote.status, 'pending_approval');
  assert.match(quote.quote_num, /^QT-\d{6}$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM orders').get().c, 0);
  assert.equal(quote.total_price, 113.49);

  const converted = service.approveQuoteTransaction({ quoteId: quote.id, approvedBy: 23 });
  assert.equal(converted.success, true);
  assert.equal(converted.orderNum, 'ORD-1');
  assert.equal(receivedPayloads.length, 1);
  assert.equal(receivedPayloads[0].order.quoteId, quote.id);
  assert.equal(receivedPayloads[0].order.quoteNum, quote.quote_num);
  assert.equal(receivedPayloads[0].order.quoteTotal, 113.49);
  assert.match(receivedPayloads[0].order.generalNotes, new RegExp(quote.quote_num));

  const persisted = service.getQuote(quote.id);
  assert.equal(persisted.status, 'converted');
  assert.equal(persisted.converted_order_id, converted.orderId);
  assert.equal(db.prepare('SELECT quote_id,quote_num,sale_price FROM orders WHERE id=?').get(converted.orderId).quote_num, quote.quote_num);
  assert.equal(service.approveQuoteTransaction({ quoteId: quote.id }).alreadyConverted, true);
  assert.equal(receivedPayloads.length, 1, 'repeated approval is idempotent');
});
