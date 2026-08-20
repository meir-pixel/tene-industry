'use strict';

const { expect } = require('@playwright/test');
const { dbGet } = require('./db');

const TOKENS = Object.freeze({
  alphaOrderer: 'e2ealphaorderer001',
  alphaApprover: 'e2ealphaapprover01',
  alphaBoth: 'e2ealphabothuser001',
  alphaFinance: 'e2ealphafinance001',
  alphaFieldManager: 'e2ealphafieldmgr01',
  alphaAdmin: 'e2ealphaadminuser01',
  betaOrderer: 'e2ebetaorderer0001',
  betaApprover: 'e2ebetaapprover001',
  expired: 'e2eexpiredtoken0001',
});

const PASSWORD = 'Portal123!';

async function openPortal(page, token) {
  await page.goto(`/customer.html?token=${encodeURIComponent(token)}`);
  await expect(page.locator('#screenHome')).toHaveClass(/active/);
  await expect(page.locator('#welcomeName')).not.toHaveText('שלום 👋');
}

async function openOrderByNumber(page, orderNum) {
  const card = page.locator('.order-card').filter({ hasText: orderNum });
  if (await card.count()) {
    await card.first().click();
  } else {
    const order = dbGet('SELECT id FROM orders WHERE order_num=?', orderNum);
    if (!order) throw new Error(`Seeded order not found: ${orderNum}`);
    await page.evaluate(id => openOrder(id), order.id);
  }
  await expect(page.locator('#screenDetail')).toHaveClass(/active/);
  await expect(page.locator('#detailContent')).toContainText(orderNum);
}

async function startOrder(page, { siteName = null } = {}) {
  await page.getByRole('button', { name: '+ הזמנה חדשה' }).click();
  await expect(page.locator('#screenOrder')).toHaveClass(/active/);
  await expect(page.locator('.item-row')).toHaveCount(1);
  if (siteName) {
    const option = page.locator('#orderSiteId option').filter({ hasText: siteName });
    await expect(option).toHaveCount(1);
    await page.locator('#orderSiteId').selectOption(await option.getAttribute('value'));
  }
}

async function editFirstShape(page, { firstSide = 1250 } = {}) {
  await page.locator('#item-1 .portal-shape-primary').click();
  await expect(page.locator('#seOverlay')).toHaveClass(/show/);
  // The editor labels its side field in centimetres while persisting millimetres.
  // Target the semantic side field rather than the first generic numeric control.
  const firstLength = page.locator('#seTableBody input[data-side="0"]');
  await expect(firstLength).toBeVisible();
  await firstLength.fill(String(firstSide / 10));
  const editorDiameter = page.locator('#seDiameterSelect');
  const editorQuantity = page.locator('#seQuantityInput');
  if (await editorDiameter.isVisible()) await editorDiameter.selectOption('12');
  if (await editorQuantity.isVisible()) await editorQuantity.fill('1');
  await page.locator('#seOk').click();
  await expect(page.locator('#seOverlay')).not.toHaveClass(/show/);
}

async function fillFirstOrderItem(page, { diameter = '12', quantity = '7', note = 'קיר צפוני קומה 2' } = {}) {
  const item = page.locator('#item-1');
  await item.locator('select').nth(1).selectOption(diameter);
  const quantityInput = item.locator('.item-fields .field').nth(0).locator('input');
  await quantityInput.fill(quantity);
  await quantityInput.blur();
  await item.locator('.item-fields .field').nth(1).locator('input').fill(note);
}

async function fillDelivery(page, { date = '2026-08-30', time = '10:30', address = 'היצירה 10, תל אביב' } = {}) {
  await page.locator('#delivDate').fill(date);
  await page.locator('#delivTime').fill(time);
  await page.locator('#delivAddr').fill(address);
}

async function forceSupportedShapeTypeForIsolation(page, shapeType = 'custom_bar') {
  await page.evaluate(type => {
    orderItems[0].shapeName = type;
    orderItems[0].shapeSnapshot = null;
    renderItems();
  }, shapeType);
}

module.exports = {
  TOKENS,
  PASSWORD,
  openPortal,
  openOrderByNumber,
  startOrder,
  editFirstShape,
  fillFirstOrderItem,
  fillDelivery,
  forceSupportedShapeTypeForIsolation,
};
