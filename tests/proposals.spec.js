import { test, expect } from '@playwright/test';
import { login, createTestSession, openManualForm } from './helpers.js';

test.describe('Propositions', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('proposer un jeu manuellement', async ({ page }) => {
    await createTestSession(page, `Test Proposer ${Date.now()}`);
    await openManualForm(page, 'Catan');
    await page.locator('[id^="mfadd_"]').first().click({ force: true });
    await page.waitForTimeout(800);
    await expect(page.locator('.prop-item').filter({ hasText: 'Catan' })).toBeVisible();
  });

  test('modifier une proposition', async ({ page }) => {
    await createTestSession(page, `Test Modifier ${Date.now()}`);
    await openManualForm(page, 'Catan Original');
    await page.locator('[id^="mfadd_"]').first().click({ force: true });
    await page.waitForTimeout(800);
    await page.locator('.prop-item').filter({ hasText: 'Catan Original' }).locator('.prop-edit').click();
    await page.waitForSelector('#epName');
    await page.fill('#epName', 'Catan Modifié');
    await page.locator('#editPropModal button.btn-sm.accent').click();
    await page.waitForTimeout(800);
    await expect(page.locator('.prop-item').filter({ hasText: 'Catan Modifié' })).toBeVisible();
  });

  test('supprimer une proposition', async ({ page }) => {
    await createTestSession(page, `Test Supprimer ${Date.now()}`);
    await openManualForm(page, 'Jeu à Supprimer');
    await page.locator('[id^="mfadd_"]').first().click({ force: true });
    await page.waitForTimeout(800);
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.prop-item').filter({ hasText: 'Jeu à Supprimer' }).locator('.prop-del').click();
    await page.waitForTimeout(800);
    await expect(page.locator('.prop-item').filter({ hasText: 'Jeu à Supprimer' })).not.toBeVisible();
  });

});
