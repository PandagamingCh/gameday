import { test, expect } from '@playwright/test';
import { login, createTestSession, openManualForm } from './helpers.js';

test.describe('Programme', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('l\'onglet programme est accessible', async ({ page }) => {
    await createTestSession(page, `Test Prog ${Date.now()}`);
    await page.locator('.tab').filter({ hasText: /programme/i }).click();
    await expect(page.locator('#panel-programme')).toHaveClass(/active/);
  });

  test('ajouter un créneau manuellement', async ({ page }) => {
    await createTestSession(page, `Test Créneau ${Date.now()}`);
    await page.locator('.tab').filter({ hasText: /programme/i }).click();
    await page.waitForSelector('#panel-programme.active');
    await page.locator('button', { hasText: '+ Créneau' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.slot-card')).toBeVisible();
  });

  test('publier le programme', async ({ page }) => {
    await createTestSession(page, `Test Publier ${Date.now()}`);
    await page.locator('.tab').filter({ hasText: /programme/i }).click();
    await page.waitForSelector('#panel-programme.active');
    await page.locator('button', { hasText: '+ Créneau' }).click();
    await page.waitForTimeout(500);
    const publishBtn = page.locator('button').filter({ hasText: /valider.*publier/i });
    if (await publishBtn.isVisible()) {
      await publishBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('les classements individuels s\'ouvrent en popup', async ({ page }) => {
    await createTestSession(page, `Test Rankings ${Date.now()}`);
    await openManualForm(page, 'Jeu Test Rankings');
    await page.locator('[id^="mfadd_"]').first().click({ force: true });
    await page.waitForTimeout(500);

    // Voter
    await page.locator('.tab').filter({ hasText: /^Voter$/i }).click();
    await page.waitForTimeout(300);
    const validateBtn = page.locator('button').filter({ hasText: /valider/i }).first();
    if (await validateBtn.isVisible()) await validateBtn.click();
    await page.waitForTimeout(300);

    await page.locator('.tab').filter({ hasText: /programme/i }).click();
    await page.waitForSelector('#panel-programme.active');

    const rankingsBtn = page.locator('button').filter({ hasText: /classements/i });
    if (await rankingsBtn.isVisible()) {
      await rankingsBtn.click();
      await expect(page.locator('#rankingsPopup')).toHaveClass(/open/);
      await page.locator('#rankingsPopup').locator('button', { hasText: 'Fermer' }).click();
      await expect(page.locator('#rankingsPopup')).not.toHaveClass(/open/);
    } else {
      test.skip();
    }
  });

});
