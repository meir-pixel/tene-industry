'use strict';

const { test, expect } = require('./support/reality-test');
const { dbGet } = require('./support/db');
const {
  TOKENS,
  openPortal,
  startOrder,
  fillFirstOrderItem,
  fillDelivery,
  forceSupportedShapeTypeForIsolation,
} = require('./support/portal');

test.describe('adversarial customer portal baseline', () => {
  test('empty and zero quantity are rejected without silently changing customer input', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
    await fillDelivery(page);
    await page.locator('#orderNotes').fill('R0 zero quantity marker');
    const quantity = page.locator('#item-1 .item-fields .field').nth(0).locator('input');
    await quantity.fill('');
    await quantity.blur();
    expect.soft(await quantity.inputValue(), 'the UI must preserve empty input until it explains the validation error').toBe('');
    await quantity.fill('0');
    await quantity.blur();
    expect.soft(await quantity.inputValue(), 'the UI must preserve invalid input until it explains the validation error').toBe('0');
    await forceSupportedShapeTypeForIsolation(page);

    const before = dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 zero quantity marker'").count;
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    await page.waitForTimeout(1_000);
    expect(dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 zero quantity marker'").count).toBe(before);
    await expect(page.locator('#toast')).toContainText(/כמות|quantity/);
  });

  test('quantity above the server limit is rejected and not persisted', async ({ page, reality }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
    await fillFirstOrderItem(page, { quantity: '100001', note: 'R0 huge quantity item' });
    await fillDelivery(page);
    await page.locator('#orderNotes').fill('R0 huge quantity marker');
    await forceSupportedShapeTypeForIsolation(page);
    reality.allowHttp({ method: 'POST', url: '/api/c/order', status: 400 });
    reality.allowConsole('Failed to load resource');

    const before = dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 huge quantity marker'").count;
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    await expect(page.locator('#toast')).toContainText('quantity is too large');
    expect(dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 huge quantity marker'").count).toBe(before);
  });

  test('custom bar with thirteen sides is rejected and not persisted', async ({ page, reality }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
    await fillFirstOrderItem(page, { quantity: '2', note: 'R0 unusual shape item' });
    await fillDelivery(page);
    await page.locator('#orderNotes').fill('R0 unusual shape marker');
    // Deliberately create a boundary-breaking draft in browser state, then keep
    // the real customer UI submit handler, API validation and DB in the path.
    await page.evaluate(() => {
      orderItems[0].shapeName = 'custom_bar';
      orderItems[0].shapeSnapshot = null;
      orderItems[0].sides = Array.from({ length: 13 }, () => 100);
      orderItems[0].angles = Array.from({ length: 12 }, () => 90);
      renderItems();
    });
    reality.allowHttp({ method: 'POST', url: '/api/c/order', status: 400 });
    reality.allowConsole('Failed to load resource');

    const before = dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 unusual shape marker'").count;
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    await expect(page.locator('#toast')).toContainText('too many sides');
    expect(dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 unusual shape marker'").count).toBe(before);
  });

  test('rapid double submit creates exactly one persisted order', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
    await fillFirstOrderItem(page, { quantity: '3', note: 'R0 double submit item' });
    await fillDelivery(page);
    await page.locator('#orderNotes').fill('R0 double submit marker');
    await forceSupportedShapeTypeForIsolation(page);

    const before = dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 double submit marker'").count;
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).dblclick({ delay: 20 });
    await expect.poll(() => dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 double submit marker'").count).toBeGreaterThan(before);
    const created = dbGet("SELECT COUNT(*) AS count FROM orders WHERE general_notes='R0 double submit marker'").count - before;
    expect(created, 'one user intent must create exactly one order').toBe(1);
  });

  test('source document attachment persists file content with the order', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
    await fillFirstOrderItem(page, { quantity: '2', note: 'R0 source document item' });
    await fillDelivery(page);
    await page.locator('#orderNotes').fill('R0 source document marker');
    await forceSupportedShapeTypeForIsolation(page);
    await page.locator('#portalSourceFiles').setInputFiles({
      name: 'customer-source-order.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% deterministic E2E source document\n'),
    });
    await expect(page.locator('#portalFileList')).toContainText('customer-source-order.pdf');

    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/c/order') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const submitted = await response.json();
    const sourceRecord = dbGet(`
      SELECT id,original_filename,original_mime,original_data_url
      FROM intake_log
      WHERE original_filename='customer-source-order.pdf'
      ORDER BY id DESC LIMIT 1
    `);
    expect(sourceRecord, `order ${submitted.orderId} must retain uploaded source bytes, not only a filename`).toBeTruthy();
    expect(sourceRecord?.original_data_url || '').toContain('data:application/pdf;base64,');
  });

  test('refresh and browser Back preserve an authenticated order context', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await page.goto('/customer.html');
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
    await page.reload();
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
    await page.locator('.order-card').filter({ hasText: 'R0-PRODUCTION-001' }).click();
    await expect(page.locator('#detailContent')).toContainText('R0-PRODUCTION-001');
    await page.goBack();
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
  });

  test('missing diameter price returns a visible actionable API error', async ({ page, reality }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await startOrder(page, { siteName: 'אלפא – מגדל צפון' });
    await fillFirstOrderItem(page, { diameter: '22', quantity: '2', note: 'R0 missing price' });
    await fillDelivery(page);
    await forceSupportedShapeTypeForIsolation(page);
    reality.allowHttp({ method: 'POST', url: '/api/c/order', status: 409 });
    reality.allowConsole('Failed to load resource');
    await page.getByRole('button', { name: 'שלח הזמנה ✓' }).click();
    await expect(page.locator('#toast')).toContainText('מחירון דורש עדכון');
  });
});
