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

  function normalizeTier(tier) {
    return tier === 'customer' ? 'customer' : 'list';
  }

  function priceLabel(tier) {
    return normalizeTier(tier) === 'customer' ? 'מחירון אישי' : 'מחירון כללי';
  }

  function normalizeDiscount(discountPct) {
    const n = Number(discountPct);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function isUsablePrice(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  function missingPriceResult(diameter, tier, reason = 'missing_price') {
    const normalizedTier = normalizeTier(tier);
    return {
      diameter: Number(diameter),
      pricePerKg: null,
      price_per_kg: null,
      basePrice: null,
      pricingSource: normalizedTier === 'customer' ? 'customer' : 'general',
      pricingLabel: priceLabel(normalizedTier),
      status: 'price_list_requires_update',
      requiresPriceListUpdate: true,
      warning: 'מחירון דורש עדכון',
      reason,
    };
  }

  function resolveDiameterPrice(diameter, { tier = 'list', discountPct = 0 } = {}) {
    const normalizedTier = normalizeTier(tier);
    const row = getPriceRow(diameter);
    if (!row) return missingPriceResult(diameter, normalizedTier, 'missing_diameter');

    const base = normalizedTier === 'customer' ? row.price_cust : row.price_list;
    if (!isUsablePrice(base)) return missingPriceResult(diameter, normalizedTier, 'missing_selected_price');

    const discount = normalizeDiscount(discountPct);
    const pricePerKg = Number((Number(base) * (1 - discount / 100)).toFixed(3));
    return {
      diameter: Number(diameter),
      pricePerKg,
      price_per_kg: pricePerKg,
      basePrice: Number(base),
      pricingSource: normalizedTier === 'customer' ? 'customer' : 'general',
      pricingLabel: priceLabel(normalizedTier),
      discountPct: discount,
      status: 'priced',
      requiresPriceListUpdate: false,
    };
  }

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
    return resolveDiameterPrice(diameter, { tier, discountPct }).pricePerKg;
  }

  // ── מפת מחירים לכל הקוטרים ──────────────────────────────────
  // מחזיר: { 8: 7.28, 10: 7.41, 12: 7.56, ... }
  function buildPriceMap({ tier = 'list', discountPct = 0 } = {}) {
    const rows = getAllPriceRows();
    const map  = {};
    rows.forEach(row => {
      map[row.diameter] = resolveDiameterPrice(row.diameter, { tier, discountPct }).pricePerKg;
    });
    return map;
  }

  function listCustomerPrices(customer = {}) {
    return getAllPriceRows().map(row => resolveDiameterPrice(row.diameter, {
      tier: customer.price_tier || 'list',
      discountPct: customer.discount_pct || 0,
    }));
  }

  // ── מחיר פריט יחיד ───────────────────────────────────────────
  // item: { diameter, totalWeight }
  function calcItemPrice(item, { tier = 'list', discountPct = 0 } = {}) {
    const ppu = getPricePerKg(item.diameter, { tier, discountPct });
    if (ppu === null) return null;
    return Number((item.totalWeight * ppu).toFixed(2));
  }

  // ── מחיר הזמנה מלאה ──────────────────────────────────────────
  // items: [{ diameter, totalWeight }, ...]
  // מחזיר: { totalPrice, breakdown: [{ diameter, weight, pricePerKg, price }] }
  function calcOrderPrice(items, { tier = 'list', discountPct = 0, wastePct = 3 } = {}) {
    let totalWeight = 0;
    let totalPrice = 0;
    const warnings = [];

    const breakdown = (items || []).map(item => {
      const resolved = resolveDiameterPrice(item.diameter, { tier, discountPct });
      const ppu = resolved.pricePerKg;
      const price = ppu === null ? 0 : item.totalWeight * ppu;
      totalWeight += item.totalWeight;
      totalPrice += price;
      if (resolved.requiresPriceListUpdate) warnings.push(resolved);
      return {
        diameter:   item.diameter,
        weight:     +item.totalWeight.toFixed(3),
        pricePerKg: ppu === null ? null : +ppu.toFixed(2),
        price_per_kg: ppu === null ? null : +ppu.toFixed(2),
        price:      +price.toFixed(2),
        pricingSource: resolved.pricingSource,
        pricingLabel: resolved.pricingLabel,
        status: resolved.status,
        requiresPriceListUpdate: resolved.requiresPriceListUpdate,
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
      status: warnings.length ? 'price_list_requires_update' : 'priced',
      requiresPriceListUpdate: Boolean(warnings.length),
      warnings,
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
    resolveDiameterPrice,
    getPricePerKg,
    buildPriceMap,
    listCustomerPrices,
    calcItemPrice,
    calcOrderPrice,
    calcOrderPriceForCustomer,
    getBaseListPrice,
    getAllPriceRows,
  };
}

module.exports = { createPricer };
