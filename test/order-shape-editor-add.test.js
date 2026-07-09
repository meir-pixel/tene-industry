const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ordersPath = path.join(__dirname, '..', 'public', 'orders.html');
const orders = () => fs.readFileSync(ordersPath, 'utf8');

test('orders manual add uses the shared shape editor, not the legacy manual form', () => {
  const html = orders();
  assert.match(html, /src="\/shape-editor\.js\?v=56"/);
  assert.match(html, /new ShapeEditorModal\(shapeSelectedFromOrder\)/);
  assert.match(html, /function openAddManualItem\(event\) \{[\s\S]*openOrderShapeEditorForAdd\(event, orderId\);[\s\S]*?\n\}/);
  assert.doesNotMatch(html, /openManualItemAdd/);
  assert.doesNotMatch(html, /itemEditOverlay/);
  assert.doesNotMatch(html, /saveItemEdit/);
  assert.doesNotMatch(html, /prompt\('/);
  assert.match(html, /function openOrderShapeEditorForAdd\(event, orderId\) \{[\s\S]*editor\.open\(\{[\s\S]*quantity: 1,[\s\S]*?\n  \}\);[\s\S]*?\n\}/);
});

test('orders item shape edits go through the shared shape editor', () => {
  const html = orders();
  assert.match(html, /function openItemEdit\(event, orderId, itemId\) \{[\s\S]*ensureOrderShapeEditor\(\)[\s\S]*editor\.open\(\{ \.\.\.orderShapeDataFromItem\(item\), quantity: Number\(item\.quantity\) \|\| 1 \}\);[\s\S]*?\n\}/);
  assert.match(html, /async function shapeSelectedFromOrder\(data\) \{[\s\S]*method: isNewItem \? 'POST' : 'PATCH'[\s\S]*openDetail\(ctx\.orderId\)/);
  assert.match(html, /orderItemQuantity = Math\.max\(1, Number\(data\?\.orderItemQuantity/);
  assert.match(html, /shapeSnapshot: data && data\.contractVersion === 2 \? data : null/);
});

test('orders missing intake source add flow offers a manual shape editor fallback', () => {
  const html = orders();
  assert.match(html, /sourceParsed'\)\.innerHTML = mode === 'add'/);
  assert.match(html, /openOrderShapeEditorForAdd\(event, \$\{Number\(orderId\) \|\| 0\}\)/);
});

test('orders items can be deleted from the order detail screen', () => {
  const html = orders();
  assert.match(html, /deleteOrderItem\(event, \$\{o\.id\}, \$\{item\.id\}\)/);
  assert.match(html, /fetch\(`\/api\/orders\/\$\{orderId\}\/items\/\$\{itemId\}`,[\s\S]*method: 'DELETE'/);
  assert.match(html, /confirm\('/);
});
