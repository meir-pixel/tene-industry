'use strict';

const { test, expect } = require('./support/reality-test');
const { dbGet } = require('./support/db');
const { TOKENS, openPortal, openOrderByNumber } = require('./support/portal');

test.describe('customer permissions and tenant isolation', () => {
  test('orderer cannot see prices or finance-only information', async ({ page }) => {
    await openPortal(page, TOKENS.alphaOrderer);
    await expect(page.locator('#homeTabFinance')).toBeHidden();
    await expect(page.locator('#homeTabPriceList')).toBeHidden();
    await expect(page.locator('#customerFinanceDashboard')).toBeEmpty();
    await openOrderByNumber(page, 'R0-APPROVED-001');
    await expect(page.locator('#detailContent')).not.toContainText('₪');
    const api = await page.evaluate(async token => {
      const response = await fetch(`/api/c/price-list?token=${token}`);
      return response.json();
    }, TOKENS.alphaOrderer);
    expect(api.priceHidden).toBe(true);
    expect(api.items).toEqual([]);
  });

  test('customer A cannot access customer B order or site', async ({ page, reality }) => {
    await openPortal(page, TOKENS.alphaApprover);
    const betaOrder = dbGet("SELECT id FROM orders WHERE order_num='R0-BETA-PRIVATE-001'").id;
    const betaSite = dbGet("SELECT id FROM customer_sites WHERE name='בטא – אתר יחיד'").id;

    reality.allowHttp({ method: 'GET', url: `/api/c/orders/${betaOrder}`, status: 404 });
    reality.allowHttp({ method: 'POST', url: '/api/c/order', status: 403 });
    reality.allowConsole('Failed to load resource');
    const result = await page.evaluate(async ({ orderId, siteId, token }) => {
      const orderResponse = await fetch(`/api/c/orders/${orderId}?token=${token}`);
      const siteResponse = await fetch('/api/c/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          siteId,
          items: [{ shapeType: 'custom_bar', shapeName: 'custom_bar', diameter: 12, sides: [1000], angles: [], qty: 1 }],
        }),
      });
      return {
        order: { status: orderResponse.status, body: await orderResponse.json() },
        site: { status: siteResponse.status, body: await siteResponse.json() },
      };
    }, { orderId: betaOrder, siteId: betaSite, token: TOKENS.alphaApprover });

    expect(result.order.status).toBe(404);
    expect(result.site.status).toBe(403);
    expect(dbGet("SELECT COUNT(*) AS count FROM orders WHERE customer_id=1 AND site_id=?", betaSite).count).toBe(0);
  });

  test('one-site user gets a fixed project while multi-site user gets a scoped picker', async ({ page }) => {
    await openPortal(page, TOKENS.betaOrderer);
    await page.getByRole('button', { name: '+ הזמנה חדשה' }).click();
    await expect(page.locator('#orderSiteId')).toBeHidden();
    await expect(page.locator('#orderSiteFixed')).toContainText('בטא – אתר יחיד');

    await page.goto(`/customer.html?token=${TOKENS.alphaApprover}`);
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
    await page.getByRole('button', { name: '+ הזמנה חדשה' }).click();
    await expect(page.locator('#orderSiteId')).toBeVisible();
    await expect(page.locator('#orderSiteId option')).toHaveCount(2);
    await expect(page.locator('#orderSiteId')).not.toContainText('בטא');
  });
});
