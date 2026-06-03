'use strict';

/**
 * services/pricer.js — מנוע תמחור
 *
 * מרכז את כל לוגיקת התמחור במקום אחד.
 * routes/portal.js, routes/finance.js וכל route אחר — קוראים מכאן.
 *
 * תמיכה בעתיד: כשיגיע מודול עץ/אריזה — מוסיפים PRICERS['wood']
 * בלי לשנות שום route.
 *
 * מינוח:
 *   tier       — 'list' (מחיר מחירון) | 'customer' (מחיר לקוח קבוע)
 *   discountPct — 0–100, הנחה נוספת על גבי ה-tier
 *   pricePerKg  — ₪ לק"ג
 */

function createPricer(db) {
  if (!db) throw new Error('services/pricer missing dependency: db');

  // ── שליפת שורת מחירון לפי קוטר ──────────────────────────────
  function getPriceRow(diameter) {
    return db.prepare('SELECT * FROM price_list WHERE diameter=?').get(Number(diameter)) || null;
  }

  // ── כל שורות המחירון ─────────────────────────────────────────
  function getAllPriceRows() {
    return db.prepare('SELECT * FROM price_list ORDER BY diameter').all();
  }

  // ── מחיר ₪/ק"ג לקוטר + tier + הנחה ─────────────────────────
  function getPricePerKg(diameter, { tier = 'list', discountPct = 0 } = {}) {
    const row = getPriceRow(diameter);
    if (!row) return 0;
    const base = tier === 'customer' ? row.price_cust : row.price_list;
    return base * (1 - Number(discountPct) / 100);
  }

  // ── מפת מחירים לכל הקוטרים ──────────────────────────────────
  // מחזיר: { 8: 7.28, 10: 7.41, 12: 7.56, ... }
  function buildPriceMap({ tier = 'list', discountPct = 0 } = {}) {
    const rows = getAllPriceRows();
    const map  = {};
    rows.forEach(row => {
      const base = tier === 'customer' ? row.price_cust : row.price_list;
      map[row.diameter] = base * (1 - Number(discountPct) / 100);
    });
    return map;
  }

  // ── מחיר פריט יחיד ───────────────────────────────────────────
  // item: { diameter, totalWeight }
  function calcItemPrice(item, { tier = 'list', discountPct = 0 } = {}) {
    const ppu = getPricePerKg(item.diameter, { tier, discountPct });
    return Number((item.totalWeight * ppu).toFixed(2));
  }

  // ── מחיר הזמנה מלאה ──────────────────────────────────────────
  // items: [{ diameter, totalWeight }, ...]
  // מחזיר: { totalPrice, breakdown: [{ diameter, weight, pricePerKg, price }] }
  function calcOrderPrice(items, { tier = 'list', discountPct = 0, wastePct = 3 } = {}) {
    let totalWeight = 0;
    let totalPrice  = 0;

    const breakdown = (items || []).map(item => {
      const ppu   = getPricePerKg(item.diameter, { tier, discountPct });
      const price = item.totalWeight * ppu;
      totalWeight += item.totalWeight;
      totalPrice  += price;
      return {
        diameter:   item.diameter,
        weight:     +item.totalWeight.toFixed(3),
        pricePerKg: +ppu.toFixed(2),
        price:      +price.toFixed(2),
      };
    });

    const billingWeight = totalWeight * (1 + wastePct / 100);
    const billingPrice  = totalPrice  * (1 + wastePct / 100);

    return {
      breakdown,
      totalWeight:   +totalWeight.toFixed(2),
      billingWeight: +billingWeight.toFixed(2),
      totalPrice:    +totalPrice.toFixed(2),
      billingPrice:  +billingPrice.toFixed(2),
      currency:      '₪',
    };
  }

  // ── מחיר לפי לקוח (שולף tier/discount מה-DB) ────────────────
  // customer: { price_tier, discount_pct } או מזהה לקוח
  function calcOrderPriceForCustomer(items, customer, { wastePct = 3 } = {}) {
    const tier        = customer?.price_tier  || 'list';
    const discountPct = customer?.discount_pct ?? 0;
    return calcOrderPrice(items, { tier, discountPct, wastePct });
  }

  // ── מחיר ₪/ק"ג מהמחירון (ללא tier/הנחה) — לחישוב עלות פנימי
  function getBaseListPrice(diameter) {
    return getPriceRow(diameter)?.price_list ?? 0;
  }

  return {
    getPricePerKg,
    buildPriceMap,
    calcItemPrice,
    calcOrderPrice,
    calcOrderPriceForCustomer,
    getBaseListPrice,
    getAllPriceRows,
  };
}

module.exports = { createPricer };
