import { expect, test } from '@playwright/test';

for (const path of ['/frontend/', '/frontend/music/', '/infra/homepage/']) {
  test(`${path} loads its compiled modules`, async ({ page }) => {
    const errors: string[] = [];
    const brokenScripts: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('http://127.0.0.1:3000') && response.url().includes('.js') && !response.ok()) {
        brokenScripts.push(response.url());
      }
    });
    await page.goto(path);
    await page.waitForTimeout(3000);
    expect(brokenScripts).toEqual([]);
    expect(errors).toEqual([]);
    if (path.includes('/music/')) {
      await expect(page.locator('.white-key').first()).toBeVisible();
      await expect(page.locator('.white-key')).not.toHaveCount(0);
    }
  });
}
