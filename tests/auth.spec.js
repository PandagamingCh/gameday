import { test, expect } from '@playwright/test';
import { login, logout, ADMIN } from './helpers.js';

test.describe('Authentification', () => {

  test('login avec credentials valides', async ({ page }) => {
    await login(page);
    await expect(page.locator('#navUsername')).toHaveText(ADMIN.user);
    await expect(page.locator('#global-nav')).toBeVisible();
  });

  test('login avec mauvais mot de passe', async ({ page }) => {
    await page.goto('/');
    await page.fill('#loginUser', ADMIN.user);
    await page.fill('#loginPass', 'mauvais-mot-de-passe');
    await page.click('button[type="submit"]');
    await expect(page.locator('#loginErr')).toBeVisible();
    await expect(page.locator('#loginErr')).toContainText(/incorrect|invalide|erreur/i);
  });

  test('login avec utilisateur inexistant', async ({ page }) => {
    await page.goto('/');
    await page.fill('#loginUser', 'utilisateur-inexistant-xyz');
    await page.fill('#loginPass', 'nimporte');
    await page.click('button[type="submit"]');
    await expect(page.locator('#loginErr')).toBeVisible();
  });

  test('logout redirige vers la page de connexion', async ({ page }) => {
    await login(page);
    await logout(page);
    await expect(page.locator('#loginUser')).toBeVisible();
    await expect(page.locator('#global-nav')).not.toBeVisible();
  });

  test('accès direct à / sans session redirige vers login', async ({ page }) => {
    await page.goto('/');
    // Si pas de session, la page login doit être active
    await expect(page.locator('#loginUser')).toBeVisible();
  });

  test('la nav affiche le bon bouton actif après login', async ({ page }) => {
    await login(page);
    // Sur l'accueil, le bouton Accueil doit être actif
    await expect(page.locator('#navHome')).toHaveClass(/nav-active/);
  });

});
