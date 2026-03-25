import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

export const ADMIN = {
  user: process.env.TEST_ADMIN_USER || 'Panda',
  pass: process.env.TEST_ADMIN_PASS || 'test',
};

export const TEST_PREFIX = '[TEST]';

export async function login(page, { user, pass } = ADMIN) {
  await page.goto('/');
  await page.waitForSelector('#loginUser');
  await page.fill('#loginUser', user);
  await page.fill('#loginPass', pass);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#navUsername');
}

export async function logout(page) {
  await page.locator('button', { hasText: 'Déconnexion' }).click();
  await page.waitForSelector('#loginUser');
}

export async function createTestSession(page, name, { noJoin = false } = {}) {
  const fullName = name.startsWith(TEST_PREFIX) ? name : `${TEST_PREFIX} ${name}`;
  await page.locator('#newSessionBtn').click();
  await page.waitForSelector('#nsName');
  await page.fill('#nsName', fullName);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  await page.fill('#nsDate', tomorrow.toISOString().split('T')[0]);
  if (noJoin) {
    await page.locator('#nsNoJoin').check();
  }
  await page.click('text=Créer');
  await page.waitForSelector('#sessTitle');
  return fullName;
}

// Ferme la collection BGG si ouverte, ouvre le formulaire manuel, remplit le nom
export async function openManualForm(page, name) {
  // Fermer collection BGG si ouverte (▾ = ouverte)
  const collToggle = page.locator('.manual-toggle').filter({ hasText: 'Collections BGG' }).first();
  const indicator = collToggle.locator('[id^="ca_"]');
  if (await indicator.count() > 0 && (await indicator.textContent()) === '▾') {
    await collToggle.click();
    await page.waitForTimeout(200);
  }
  // Ouvrir "Ajout manuel"
  await page.locator('.manual-toggle').filter({ hasText: 'Ajout manuel' }).first().click();
  await page.waitForTimeout(200);
  // Remplir le nom avec force (le formulaire peut être partiellement obscuré)
  await page.locator('[id^="mfn_"]').first().fill(name, { force: true });
}
