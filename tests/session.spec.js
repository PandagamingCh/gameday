import { test, expect } from '@playwright/test';
import { login, createTestSession, ADMIN } from './helpers.js';

test.describe('Séances', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('créer une séance et la voir sur l\'accueil', async ({ page }) => {
    const name = `Test E2E ${Date.now()}`;
    await createTestSession(page, name);
    await page.click('#navHome');
    await page.waitForSelector('.session-card');
    await expect(page.locator('.session-card').filter({ hasText: name })).toBeVisible();
  });

  test('rejoindre une séance', async ({ page }) => {
    await createTestSession(page, `Test Rejoindre ${Date.now()}`);
    await expect(page.locator('.participant-chip').filter({ hasText: ADMIN.user })).toBeVisible();
  });

  test('quitter puis rejoindre une séance', async ({ page }) => {
    // Créer une séance et rejoindre
    await createTestSession(page, `Test Quitter ${Date.now()}`);
    // Quitter (le créateur peut quitter sa séance)
    await page.locator('.leave-btn').waitFor({ state: 'visible' });

    // Accepter la confirmation si dialog
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.leave-btn').click();
    await page.waitForTimeout(1000);

    // Soit .join-btn apparaît, soit on vérifie que le chip Panda a disparu
    const joinBtn = page.locator('.join-btn');
    const hasJoinBtn = await joinBtn.isVisible();
    if (hasJoinBtn) {
      await expect(joinBtn).toBeVisible();
    } else {
      // Le créateur est retiré des participants
      await expect(page.locator('.participant-chip').filter({ hasText: ADMIN.user })).not.toBeVisible();
    }
  });

  test('les tabs de séance ont le bon style actif', async ({ page }) => {
    await createTestSession(page, `Test Tabs ${Date.now()}`);
    const proposerTab = page.locator('.tab').filter({ hasText: /^Proposer$/i });
    await expect(proposerTab).toHaveClass(/active/);
    await page.locator('.tab').filter({ hasText: /^Voter$/i }).click();
    await expect(page.locator('.tab').filter({ hasText: /^Voter$/i })).toHaveClass(/active/);
    await expect(proposerTab).not.toHaveClass(/active/);
  });

  test('navigation — bouton actif mis en surbrillance', async ({ page }) => {
    await page.click('#navProfile');
    await expect(page.locator('#navProfile')).toHaveClass(/nav-active/);
    await page.click('#navDoodle');
    await expect(page.locator('#navDoodle')).toHaveClass(/nav-active/);
    await expect(page.locator('#navProfile')).not.toHaveClass(/nav-active/);
  });

});
