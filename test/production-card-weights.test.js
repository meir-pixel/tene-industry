const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('production cards can save actual weight per printed card', () => {
  const route = read('routes/productionCards.js');
  const page = read('services/productionCardPrintPage.js');
  const coreSchema = read('db/coreSchema.js');
  const startup = read('db/startup.js');

  assert.ok(coreSchema.includes('CREATE TABLE IF NOT EXISTS production_card_weights'));
  assert.ok(startup.includes('CREATE TABLE IF NOT EXISTS production_card_weights'));
  assert.ok(route.includes("router.patch('/orders/:orderId/production-card-weight'"));
  assert.ok(route.includes('ON CONFLICT(item_id, card_index, card_total) DO UPDATE'));
  assert.ok(route.includes('UPDATE items SET actual_weight_kg=?, weight_deviation_pct=?'));
  assert.ok(page.includes('function saveCardWeight('));
  assert.ok(page.includes("'/api/orders/' + ORDER_ID + '/production-card-weight'"));
  assert.ok(page.includes('pc-weight-entry'));
  assert.ok(page.includes('משקל מצוי'));
  assert.ok(page.includes('שמור משקל'));
  assert.ok(page.includes('cardWeightFor(item, cardTotal, cardIdx)'));
});
