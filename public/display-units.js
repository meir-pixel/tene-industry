(function exposeIronBendDisplayUnits(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.IronBendDisplayUnits = api;
}(typeof window !== 'undefined' ? window : globalThis, function buildDisplayUnits() {
  'use strict';

  function finiteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function millimetersToCentimeters(value) {
    const number = finiteNumber(value);
    return number === null ? null : number / 10;
  }

  function centimetersToMillimeters(value) {
    const number = finiteNumber(value);
    return number === null ? null : number * 10;
  }

  function formatNumber(value, options = {}) {
    const number = finiteNumber(value);
    if (number === null) return options.fallback ?? '—';
    return number.toLocaleString(options.locale || 'he-IL', {
      minimumFractionDigits: options.minimumFractionDigits ?? 0,
      maximumFractionDigits: options.maximumFractionDigits ?? 3,
      useGrouping: options.useGrouping !== false,
    });
  }

  function formatLengthCmFromMm(value, options = {}) {
    const centimeters = millimetersToCentimeters(value);
    if (centimeters === null) return options.fallback ?? '—';
    const number = formatNumber(centimeters, options);
    return options.withUnit === false ? number : `${number} ס״מ`;
  }

  function formatSteelDiameterMm(value, options = {}) {
    const number = finiteNumber(value);
    if (number === null) return options.fallback ?? '—';
    const formatted = formatNumber(number, { ...options, maximumFractionDigits: options.maximumFractionDigits ?? 1 });
    return options.withUnit === false ? formatted : `Ø${formatted} מ״מ`;
  }

  return Object.freeze({
    finiteNumber,
    millimetersToCentimeters,
    centimetersToMillimeters,
    formatNumber,
    formatLengthCmFromMm,
    formatSteelDiameterMm,
  });
}));
