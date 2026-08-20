'use strict';

const { test, expect } = require('./support/reality-test');
const { TOKENS, openPortal, openOrderByNumber } = require('./support/portal');

const cases = [
  ['draft', 'טיוטה', 'טיוטה'],
  ['submitted_review', 'נשלחה לבדיקה', 'נשלחה לבדיקה'],
  ['needs_info', 'נדרשת השלמה', 'נדרשת השלמה'],
  ['awaiting_customer_approval', 'ממתינה לאישורך', 'ממתינה לאישורך'],
  ['approved', 'אושרה', 'אושרה'],
  ['in_production', 'בייצור', 'בייצור'],
  ['ready_for_delivery', 'מוכנה לאספקה', 'מוכנה לאספקה'],
  ['delivered', 'סופקה', 'סופקה'],
  ['cancelled', 'בוטלה', 'בוטלה'],
];

test.describe('semantic customer status timeline', () => {
  for (const [semanticStatus, expectedBadge, expectedActiveStep] of cases) {
    test(`${semanticStatus} has a valid customer timeline`, async ({ page }) => {
      const orderNum = `R0-TIMELINE-${semanticStatus.toUpperCase().replaceAll('_', '-')}`;
      await openPortal(page, TOKENS.alphaApprover);
      await openOrderByNumber(page, orderNum);
      await expect(page.locator('#detailContent .card').first().locator('.status-badge')).toHaveText(expectedBadge);
      await expect(page.locator('.timeline .tl-step.active')).toHaveCount(1);
      await expect(page.locator('.timeline .tl-step.active')).toContainText(expectedActiveStep);
    });
  }
});
