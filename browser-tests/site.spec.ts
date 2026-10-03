import { expect, test, type Page, type Response } from '@playwright/test';
import { mockFrontendNetwork, mockHomepageNetwork } from './fixtures.js';

function captureRuntimeFailures(page: Page, origin: string) {
  const errors: string[] = [];
  const brokenScripts: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('response', (response: Response) => {
    const url = response.url();
    if (url.startsWith(origin) && /\.(?:m?js)(?:\?|$)/.test(url) && !response.ok()) {
      brokenScripts.push(`${response.status()} ${url}`);
    }
  });
  return { errors, brokenScripts };
}

test('frontend loads its compiled modules at the site root', async ({ page }) => {
  await mockFrontendNetwork(page);
  const failures = captureRuntimeFailures(page, 'http://127.0.0.1:4173');

  await page.goto('/');
  await expect(page.locator('#about')).toBeVisible();
  await expect(page.locator('#about')).toContainText('Check out my GitHub to see');
  await expect(page.locator('#services-stats')).toHaveText('0 containers');

  expect(failures.brokenScripts).toEqual([]);
  expect(failures.errors).toEqual([]);
});

test('theme preference survives a reload', async ({ page }) => {
  await mockFrontendNetwork(page);
  await page.goto('/');

  await expect(page.locator('body')).not.toHaveClass(/dark-mode/);
  await page.locator('#theme-toggle').click();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
});

test('mobile navigation opens, follows an anchor, and closes', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await mockFrontendNetwork(page);
  await page.goto('/');

  const sidebar = page.locator('#left-sidebar');
  await expect(sidebar).not.toHaveClass(/mobile-open/);
  await page.locator('#mobile-menu-toggle').click();
  await expect(sidebar).toHaveClass(/mobile-open/);

  await page.locator('.nav-link[href="#experience"]').click();
  await expect(page).toHaveURL(/#experience$/);
  await expect(sidebar).not.toHaveClass(/mobile-open/);
});

test('visitor data renders on the globe and the log view is selectable', async ({ page }) => {
  await mockFrontendNetwork(page);
  await page.goto('/');

  await expect(page.locator('#visitor-stats')).toHaveText('1 active visitor');
  await expect(page.locator('#visitor-map-summary')).toHaveText('1 mapped visits | 0 without coordinates');
  await expect(page.locator('.world-visitor-marker')).toHaveCount(1);
  await expect(page.locator('#recent-visitor-list')).toContainText('Seattle');

  const logButton = page.locator('[data-visitor-view="list"]');
  await logButton.click();
  await expect(page.locator('#visitors')).toHaveAttribute('data-view', 'list');
  await expect(logButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-visitor-view="map"]')).toHaveAttribute('aria-pressed', 'false');
});

test('music controls initialize and update without network access', async ({ page }) => {
  await mockFrontendNetwork(page);
  const failures = captureRuntimeFailures(page, 'http://127.0.0.1:4173');
  await page.goto('/music/');

  await expect(page.locator('.white-key').first()).toHaveAttribute('data-midi', '48');
  await expect(page.locator('.white-key')).not.toHaveCount(0);
  await expect(page.locator('.chord-row-label')).toHaveText([
    'Current',
    'Diatonic',
    'Resolution',
    'Modal',
    'Substitution',
    'Random',
  ]);

  await page.locator('.chord-btn').first().click({ force: true });
  await expect(page.locator('#sheet-music svg')).toBeVisible();
  await expect(page.locator('#start-btn')).toHaveClass(/playing/);
  await expect(page.locator('#start-btn')).toHaveText('■');

  await page.locator('#bass-toggle').click({ force: true });
  await expect(page.locator('#bass-toggle')).toHaveClass(/active/);
  await page.locator('#keyboard-left').click({ force: true });
  await expect(page.locator('.white-key').first()).toHaveAttribute('data-midi', '36');
  await page.locator('#transpose-select').selectOption('2', { force: true });
  await expect(page.locator('#transpose-select')).toHaveValue('2');
  await page.locator('#start-btn').click({ force: true });
  await expect(page.locator('#start-btn')).not.toHaveClass(/playing/);
  await expect(page.locator('#start-btn')).toHaveText('▶');

  expect(failures.brokenScripts).toEqual([]);
  expect(failures.errors).toEqual([]);
});

test('standalone infrastructure homepage loads from its own server', async ({ page }) => {
  await mockHomepageNetwork(page);
  const failures = captureRuntimeFailures(page, 'http://127.0.0.1:4174');
  await page.goto('http://127.0.0.1:4174/');

  await expect(page).toHaveTitle('DevStack');
  await expect(page.locator('#service-list')).toBeVisible();
  await expect(page.locator('#health-text')).toHaveText('connected');

  expect(failures.brokenScripts).toEqual([]);
  expect(failures.errors).toEqual([]);
});
