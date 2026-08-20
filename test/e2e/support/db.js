'use strict';

const Database = require('better-sqlite3');

function withDb(callback) {
  if (!process.env.E2E_DB_PATH) throw new Error('E2E_DB_PATH is required for direct persistence assertions');
  const db = new Database(process.env.E2E_DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function dbGet(sql, ...params) {
  return withDb(db => db.prepare(sql).get(...params));
}

function dbAll(sql, ...params) {
  return withDb(db => db.prepare(sql).all(...params));
}

function orderSnapshot(orderId) {
  return withDb(db => {
    const order = db.prepare(`
      SELECT id,order_num,customer_id,site_id,status,delivery_date,delivery_time,delivery_address,
             general_notes,total_weight,billing_weight,portal_price,confirm_token
      FROM orders WHERE id=?
    `).get(orderId);
    const items = db.prepare(`
      SELECT id,item_uid,order_id,pallet_id,shape_id,shape_name,diameter,segments,total_length_mm,
             quantity,weight_per_unit,total_weight,struct_element,note
      FROM items WHERE order_id=? ORDER BY id
    `).all(orderId);
    return { order, items };
  });
}

module.exports = { dbGet, dbAll, orderSnapshot };
