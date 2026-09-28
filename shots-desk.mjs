import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
for (const s of (process.env.SLUGS || 'tools,tools/split').split(',')) {
  await page.goto(`http://localhost:3300/platform/${s}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/claude-0/shots/desk_${s.replace(/\//g, '_')}.png`, fullPage: !!process.env.FULL });
}
await browser.close();
