'use strict';

function createQuotationNumberAllocator(db) {
  if (!db) throw new Error('services/quotationNumbers missing dependency: db');

  const allocate = db.transaction(prefix => {
    db.prepare(`
      INSERT INTO quotation_sequences (prefix,next_value,updated_at)
      VALUES (?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(prefix) DO NOTHING
    `).run(prefix);
    const row = db.prepare('SELECT next_value FROM quotation_sequences WHERE prefix=?').get(prefix);
    db.prepare(`
      UPDATE quotation_sequences
      SET next_value=next_value+1, updated_at=CURRENT_TIMESTAMP
      WHERE prefix=?
    `).run(prefix);
    return `${prefix}-${String(row.next_value).padStart(4, '0')}`;
  });

  return function generateQuotationNumber(now = new Date()) {
    return allocate.immediate(`QT-${now.getFullYear()}`);
  };
}

module.exports = { createQuotationNumberAllocator };
