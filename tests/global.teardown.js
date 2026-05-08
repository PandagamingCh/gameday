import { request } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

async function globalTeardown() {
  const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const ctx = await request.newContext({ baseURL });

  try {
    // Login
    const loginRes = await ctx.post('/api/login', {
      data: {
        username: process.env.TEST_ADMIN_USER || 'Panda',
        password: process.env.TEST_ADMIN_PASS || 'test',
      }
    });

    if (!loginRes.ok()) {
      console.log(`\n⚠ Cleanup: login échoué (${loginRes.status()})`);
      return;
    }

    // Supprimer les séances [TEST]
    const res = await ctx.delete('/api/admin/test-cleanup');
    const contentType = res.headers()['content-type'] || '';

    if (contentType.includes('application/json')) {
      const data = await res.json();
      console.log(`\n🧹 Cleanup: ${data.count} séance(s) de test supprimée(s)`);
    } else {
      const body = await res.text();
      console.log(`\n⚠ Cleanup: réponse inattendue (${res.status()}) — ${body.slice(0, 100)}`);
    }
  } catch(e) {
    console.log(`\n⚠ Cleanup échoué: ${e.message}`);
  } finally {
    await ctx.dispose();
  }
}

export default globalTeardown;
