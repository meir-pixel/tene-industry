'use strict';

const { test, expect } = require('./support/reality-test');
const {
  TOKENS,
  openPortal,
  startOrder,
  editFirstShape,
  fillFirstOrderItem,
  fillDelivery,
} = require('./support/portal');

test('critical order journey runs at a 390px viewport', async ({ page, reality }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPortal(page, TOKENS.alphaApprover);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
  await editFirstShape(page, { firstSide: 900 });
  await fillFirstOrderItem(page, { diameter: '10', quantity: '4', note: 'R0 mobile journey' });
  await fillDelivery(page, { date: '2026-09-01', time: '08:30', address: 'היצירה 10, תל אביב' });
  await page.locator('#orderNotes').fill('R0 mobile journey');
  reality.allowHttp({ method: 'POST', url: '/api/c/order', status: 400 });
  reality.allowConsole('Failed to load resource');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
  await expect(page.locator('#toast')).toContainText(/הזמנה .* נשלחה/);
});
