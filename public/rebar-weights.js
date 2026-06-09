(function(global) {
  'use strict';

  const REBAR_KG_PER_M = Object.freeze({
    5: 0.154,
    6: 0.222,
    8: 0.395,
    10: 0.617,
    12: 0.888,
    14: 1.21,
    16: 1.58,
    18: 2.00,
    20: 2.47,
    22: 2.98,
    24: 3.55,
    25: 3.85,
    26: 4.17,
    28: 4.83,
    30: 5.55,
    32: 6.31,
    34: 7.13,
    36: 7.99,
    38: 8.90,
    40: 9.86,
    45: 12.48,
    50: 15.41,
  });

  function kgPerMeter(diameter) {
    const d = Number(diameter);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return REBAR_KG_PER_M[d] ?? (d * d * 0.00617);
  }

  function itemWeightKg(item) {
    const sides = Array.isArray(item?.sides)
      ? item.sides
      : Array.isArray(item?.shapeSides)
        ? item.shapeSides
        : item?.length
          ? [item.length]
          : [];
    const totalMm = sides.reduce((sum, length) => sum + Number(length || 0), 0);
    return (totalMm / 1000) * kgPerMeter(item?.diameter) * (Number(item?.qty ?? item?.quantity) || 1);
  }

  global.IronBendRebar = Object.freeze({
    kgPerMeter,
    itemWeightKg,
    kgPerMeterTable: REBAR_KG_PER_M,
  });
})(window);
