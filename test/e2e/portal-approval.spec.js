'use strict';

const { test, expect } = require('./support/reality-test');
const { dbGet } = require('./support/db');
const { TOKENS, openPortal, openOrderByNumber } = require('./support/portal');

test.describe('customer approval', () => {
  test('authorized approver advances persisted status and loses the CTA', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await openOrderByNumber(page, 'R0-AWAITING-001');
    const button = page.getByRole('button', { name: /אשר פרטים ושלח לבדיקה/ });
    await expect(button).toBeVisible();

    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/c/approve') && response.request().method() === 'POST');
    await button.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect.poll(() => dbGet("SELECT status FROM orders WHERE order_num='R0-AWAITING-001'").status).toBe('ממתינה לאישור');
    expect(dbGet("SELECT confirm_token FROM orders WHERE order_num='R0-AWAITING-001'").confirm_token).toBeNull();

    await expect(page.locator('#detailContent')).toContainText('נשלחה לבדיקה', { timeout: 5_000 });
    await expect(page.getByRole('button', { name: /אשר פרטים ושלח לבדיקה/ })).toHaveCount(0);
    await page.reload();
    await openOrderByNumber(page, 'R0-AWAITING-001');
    await expect(page.getByRole('button', { name: /אשר פרטים ושלח לבדיקה/ })).toHaveCount(0);
  });

  test('approval CTA is absent when customerCanApprove is false', async ({ page, reality }) => {
    await openPortal(page, TOKENS.alphaOrderer);
    const orderId = dbGet("SELECT id FROM orders WHERE order_num='R0-AWAITING-NO-PERM-001'").id;
    const apiProjection = await page.evaluate(async ({ id, token }) => {
      const response = await fetch(`/api/c/orders/${id}?token=${token}`);
      return response.json();
    }, { id: orderId, token: TOKENS.alphaOrderer });
    expect(apiProjection.customerCanApprove).toBe(false);

    await openOrderByNumber(page, 'R0-AWAITING-NO-PERM-001');
    expect.soft(await page.getByRole('button', { name: /אשר פרטים ושלח לבדיקה/ }).count(), 'unauthorized CTA count').toBe(0);

    reality.allowHttp({ method: 'POST', url: '/api/c/approve', status: 403 });
    reality.allowConsole('Failed to load resource');
    const denied = await page.evaluate(async ({ id, token }) => {
      const response = await fetch('/api/c/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, orderId: id }),
      });
      return { status: response.status, body: await response.json() };
    }, { id: orderId, token: TOKENS.alphaOrderer });
    expect(denied.status).toBe(403);
    expect(dbGet("SELECT status FROM orders WHERE order_num='R0-AWAITING-NO-PERM-001'").status).toBe('ממתינה לאישור לקוח');
  });
});
