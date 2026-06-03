function ensureOrderSequence(db, prefix) {
  const seqStartIndex = prefix.length + 2; // SQLite substr is 1-based; skip the dash after prefix.
  const row = db.prepare(`
    SELECT COALESCE(MAX(CAST(substr(order_num, ?) AS INTEGER)), 0) AS max_seq
    FROM orders
    WHERE order_num LIKE ?
  `).get(seqStartIndex, `${prefix}-%`);
  db.prepare(`
    INSERT INTO order_sequences (prefix,next_value,updated_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(prefix) DO NOTHING
  `).run(prefix, Number(row.max_seq || 0) + 1);
}

function createOrderNumberAllocator(db) {
  const nextOrderNumTx = db.transaction(prefix => {
    ensureOrderSequence(db, prefix);
    const row = db.prepare('SELECT next_value FROM order_sequences WHERE prefix=?').get(prefix);
    db.prepare(`
      UPDATE order_sequences
      SET next_value=next_value+1, updated_at=CURRENT_TIMESTAMP
      WHERE prefix=?
    `).run(prefix);
    return `${prefix}-${String(row.next_value).padStart(3, '0')}`;
  });

  return function generateOrderNum(now = new Date()) {
    const year = now.getFullYear();
    return nextOrderNumTx(`HZ-${year}`);
  };
}

module.exports = {
  createOrderNumberAllocator,
  ensureOrderSequence,
};
