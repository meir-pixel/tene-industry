'use strict';

const crypto = require('crypto');

const FINGERPRINT_PREFIX = 'physical-spec:v1:sha256:';

function stableCanonicalStringify(value) {
  const active = new Set();

  function serialize(entry) {
    if (entry === null) return 'null';

    const type = typeof entry;
    if (type === 'string' || type === 'boolean') return JSON.stringify(entry);
    if (type === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError('non-finite numbers are not supported');
      return JSON.stringify(Object.is(entry, -0) ? 0 : entry);
    }
    if (['undefined', 'function', 'symbol', 'bigint'].includes(type)) {
      throw new TypeError(`${type} values are not supported`);
    }
    if (type !== 'object') throw new TypeError(`unsupported value type: ${type}`);
    if (active.has(entry)) throw new TypeError('cyclic values are not supported');

    active.add(entry);
    let serialized;
    if (Array.isArray(entry)) {
      const values = [];
      for (let index = 0; index < entry.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(entry, index)) {
          active.delete(entry);
          throw new TypeError('sparse arrays are not supported');
        }
        values.push(serialize(entry[index]));
      }
      serialized = `[${values.join(',')}]`;
    } else {
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) {
        active.delete(entry);
        throw new TypeError('only plain objects are supported');
      }
      if (Object.getOwnPropertySymbols(entry).length) {
        active.delete(entry);
        throw new TypeError('symbol keys are not supported');
      }
      const keys = Object.keys(entry).sort();
      serialized = `{${keys.map(key => `${JSON.stringify(key)}:${serialize(entry[key])}`).join(',')}}`;
    }
    active.delete(entry);
    return serialized;
  }

  return serialize(value);
}

function buildPhysicalSpecFingerprint(matchabilityResult) {
  if (
    !matchabilityResult
    || matchabilityResult.status !== 'exact_matchable'
    || !matchabilityResult.canonicalSpec
  ) {
    return null;
  }
  const serialized = stableCanonicalStringify(matchabilityResult.canonicalSpec);
  const digest = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
  return `${FINGERPRINT_PREFIX}${digest}`;
}

module.exports = {
  stableCanonicalStringify,
  buildPhysicalSpecFingerprint,
};
