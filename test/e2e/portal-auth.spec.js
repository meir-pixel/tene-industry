'use strict';

const { test, expect } = require('./support/reality-test');
const { TOKENS, PASSWORD, openPortal } = require('./support/portal');

test.describe('customer authentication', () => {
  test('valid customer token opens the real portal', async ({ page }) => {
    await openPortal(page, TOKENS.alphaApprover);
    await expect(page.locator('#welcomeName')).toContainText('אלפא');
    await expect(page).toHaveURL(new RegExp(`token=${TOKENS.alphaApprover}`));
  });

  test('password login issues a portal session', async ({ page }) => {
    await page.goto('/customer.html');
    // Use a dedicated role so token rotation cannot invalidate later journey fixtures.
    await page.locator('#authPhone').fill('0501000004');
    await page.locator('#authPassword').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה עם סיסמה' }).click();
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
    await expect(page.locator('#welcomeName')).toContainText('אלפא');
    expect(new URL(page.url()).searchParams.get('token')).toMatch(/^[a-f0-9]{24}$/);
  });

  test('OTP login uses the real test-mode OTP route', async ({ page }) => {
    await page.goto('/customer.html');
    await page.locator('#authPhone').fill('0501000003');
    await page.getByRole('button', { name: 'כניסה ←' }).click();
    await expect(page.locator('#authOtpField')).toBeVisible();
    await expect(page.locator('#authOtp')).toHaveValue(/^\d{6}$/);
    await page.getByRole('button', { name: 'כניסה ←' }).click();
    await expect(page.locator('#screenHome')).toHaveClass(/active/);
    await expect(page.locator('#welcomeName')).toContainText('אלפא');
  });

  for (const [name, token] of [['invalid', 'definitelyinvalidtoken'], ['expired', TOKENS.expired]]) {
    test(`${name} token explains why access was rejected`, async ({ page, reality }) => {
      reality.allowHttp({ method: 'GET', url: '/api/c/me', status: 401 });
      reality.allowConsole('Failed to load resource');
      await page.goto(`/customer.html?token=${token}`);
      await expect(page.locator('#screenAuth')).toHaveClass(/active/);
      await expect(page.locator('#toast')).toHaveClass(/show/);
      await expect(page.locator('#toast')).toContainText(/קישור|קוד.*(לא תקין|פג)|פג תוקף/);
    });
  }
});
