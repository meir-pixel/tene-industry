'use strict';

const { test, expect } = require('./support/reality-test');
const { dbGet, orderSnapshot } = require('./support/db');
const {
  TOKENS,
  openPortal,
  startOrder,
  editFirstShape,
  fillFirstOrderItem,
  fillDelivery,
  forceSupportedShapeTypeForIsolation,
} = require('./support/portal');

test.describe('new customer order and round-trip persistence', () => {
  test('normal browser journey quotes and submits a shaped bar', async ({ page, reality }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל דרום' });
    await editFirstShape(page, { firstSide: 1250 });
    await fillFirstOrderItem(page, { diameter: '12', quantity: '7', note: 'R0 normal browser journey' });
    await fillDelivery(page);
    await page.locator('#orderNotes').fill('R0 normal browser journey');
    reality.allowHttp({ method: 'POST', url: '/api/c/quote', status: 400 });
    reality.allowHttp({ method: 'POST', url: '/api/c/order', status: 400 });
    reality.allowConsole('Failed to load resource');

    await page.getByRole('button', { name: 'קבל הצעת מחיר' }).click();
    await expect.soft(page.locator('#priceBox')).toBeVisible();
    await expect.soft(page.locator('#priceBreakdown')).toContainText('סה"כ לתשלום');

    const before = dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes LIKE '%R0 normal browser journey%'").count;
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    await expect(page.locator('#toast')).toContainText(/הזמנה .* נשלחה/);
    await expect.poll(() => dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes LIKE '%R0 normal browser journey%'").count).toBe(before + 1);
  });

  test('UI -> API -> DB -> UI values agree after submission', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל דרום' });
    await fillFirstOrderItem(page, { diameter: '12', quantity: '9', note: 'R0 round trip marker' });
    await fillDelivery(page, { date: '2026-08-31', time: '11:15', address: 'היצירה 12, תל אביב' });

    // Isolate persistence from the separately asserted current Hebrew shape-name bug.
    // This changes browser state only; the real UI submit handler, API, server and DB remain in the path.
    await forceSupportedShapeTypeForIsolation(page, 'custom_bar');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/c/order') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const submitted = await response.json();
    expect(submitted.success).toBe(true);

    const persisted = orderSnapshot(submitted.orderId);
    expect(persisted.order).toMatchObject({
      order_num: submitted.orderNum,
      site_id: 2,
      delivery_date: '2026-08-31',
      delivery_time: '11:15',
      status: 'ממתינה לאישור לקוח',
    });
    expect(persisted.order.delivery_address).toContain('היצירה 12, תל אביב');
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0]).toMatchObject({ diameter: 12, quantity: 9, note: 'R0 round trip marker' });
    expect(persisted.items[0].order_id).toBe(submitted.orderId);
    expect(persisted.items[0].item_uid).toBeTruthy();

    await expect(page.locator('#detailContent')).toContainText(submitted.orderNum, { timeout: 8_000 });
    await expect(page.locator('#detailContent')).toContainText('R0 round trip marker');
    await expect(page.locator('#detailContent')).toContainText('Ø12');
    await expect(page.locator('#detailContent')).toContainText('כמות: 9');
    await page.reload();
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
    await page.locator('.order-card').filter({ hasText: submitted.orderNum }).click();
    await expect(page.locator('#detailContent')).toContainText('R0 round trip marker');
  });
});
