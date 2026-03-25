import { test, expect } from '@playwright/test';
import { login, createTestSession, openManualForm } from './helpers.js';

test.describe('Votes', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('voter auto-inscrit le participant', async ({ page }) => {
    await createTestSession(page, `Test Vote ${Date.now()}`);
    await openManualForm(page, 'Catan Vote Test');
    await page.locator('[id^="mfadd_"]').first().click({ force: true });
    await page.waitForTimeout(500);

    // Quitter
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.leave-btn').waitFor({ state: 'visible' });
    await page.locator('.leave-btn').click();
    await page.waitForTimeout(500);

    // Voter sans être inscrit → doit auto-inscrire
    await page.locator('.tab').filter({ hasText: /^Voter$/i }).click();
    await page.waitForTimeout(500);
    const validateBtn = page.locator('button').filter({ hasText: /valider|soumettre/i }).first();
    if (await validateBtn.isVisible()) {
      await validateBtn.click();
      await page.waitForTimeout(800);
      await expect(page.locator('.participant-chip')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('l\'onglet vote est accessible', async ({ page }) => {
    await createTestSession(page, `Test Vote Access ${Date.now()}`);
    await page.locator('.tab').filter({ hasText: /^Voter$/i }).click();
    await expect(page.locator('#panel-vote')).toHaveClass(/active/);
  });

  test('l\'onglet résultats est accessible', async ({ page }) => {
    await createTestSession(page, `Test Results ${Date.now()}`);
    await page.locator('.tab').filter({ hasText: /^Résultats$/i }).click();
    await expect(page.locator('#panel-results')).toHaveClass(/active/);
  });

});
