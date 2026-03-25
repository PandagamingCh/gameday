import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test.describe('Administration', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('#adminNavBtn');
    await page.waitForSelector('.admin-section');
  });

  test('la page admin est accessible pour un admin', async ({ page }) => {
    await expect(page.locator('#adminNavBtn')).toHaveClass(/nav-active/);
    await expect(page.locator('.admin-section').first()).toBeVisible();
  });

  test('les sections admin sont collapsibles', async ({ page }) => {
    // Trouver la première section collapsed et noter son titre
    const sections = page.locator('.admin-section');
    const count = await sections.count();
    let targetIdx = -1;
    for (let i = 0; i < count; i++) {
      const cls = await sections.nth(i).getAttribute('class');
      if (cls?.includes('collapsed')) { targetIdx = i; break; }
    }
    expect(targetIdx).toBeGreaterThan(-1);

    // Ouvrir via JS
    await sections.nth(targetIdx).evaluate(el => el.querySelector('.admin-section-title').click());
    await page.waitForTimeout(300);

    // Vérifier que cette section n'est plus collapsed
    const clsAfterOpen = await sections.nth(targetIdx).getAttribute('class');
    expect(clsAfterOpen).not.toContain('collapsed');

    // Refermer
    await sections.nth(targetIdx).evaluate(el => el.querySelector('.admin-section-title').click());
    await page.waitForTimeout(300);

    const clsAfterClose = await sections.nth(targetIdx).getAttribute('class');
    expect(clsAfterClose).toContain('collapsed');
  });

  test('générer un lien d\'invitation', async ({ page }) => {
    const inviteSection = page.locator('.admin-section').filter({ hasText: "Liens d'invitation" });
    if (await inviteSection.locator('.admin-section-body').isHidden()) {
      await inviteSection.evaluate(el => el.querySelector('.admin-section-title').click());
      await page.waitForTimeout(200);
    }
    await page.locator('button', { hasText: 'Générer un lien' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('#inviteResult')).not.toBeEmpty();
  });

  test('la liste des utilisateurs est visible', async ({ page }) => {
    const sections = page.locator('.admin-section');
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const text = await sections.nth(i).locator('.admin-section-title').textContent();
      if (text?.includes('Utilisateurs') && !text?.includes('Sélection')) {
        const cls = await sections.nth(i).getAttribute('class');
        if (cls?.includes('collapsed')) {
          await sections.nth(i).evaluate(el => el.querySelector('.admin-section-title').click());
          await page.waitForTimeout(300);
        }
        break;
      }
    }
    await expect(page.locator('#adminUsersList')).toBeVisible();
    await expect(page.locator('#adminUsersList')).not.toBeEmpty();
  });

});
