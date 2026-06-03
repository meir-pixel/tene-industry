const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MACHINE_STATES,
  REBAR_KG_PER_M,
  REBAR_WEIGHTS,
  STATE_TRANSITIONS,
  rebarKgPerMeter,
} = require('../constants');

test('rebar weight constants expose canonical and extended kg-per-meter tables', () => {
  assert.equal(REBAR_WEIGHTS[12], 0.888);
  assert.equal(REBAR_KG_PER_M[12], 0.888);
  assert.equal(REBAR_KG_PER_M[50], 15.41);
  assert.equal(rebarKgPerMeter(12), 0.888);
  assert.equal(Number(rebarKgPerMeter(7).toFixed(5)), Number((7 * 7 * 0.00617).toFixed(5)));
});

test('machine state constants define allowed production transitions', () => {
  assert.ok(MACHINE_STATES.includes('ריצה'));
  assert.ok(MACHINE_STATES.includes('לא מחובר'));
  assert.deepEqual(STATE_TRANSITIONS['לא מחובר'], ['סרק']);
  assert.ok(STATE_TRANSITIONS['סרק'].includes('ריצה'));
  assert.equal(STATE_TRANSITIONS['ריצה'].includes('תחזוקה'), false);
});
