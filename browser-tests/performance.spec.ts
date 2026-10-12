import { expect, test } from '@playwright/test';
import { mockFrontendNetwork } from './fixtures.js';

test('mobile keeps photos and Live Photos off the network until requested', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFrontendNetwork(page);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#about')).toBeVisible();
  await expect(page.locator('#right-sidebar img')).toHaveCount(0);
  expect(requests.filter(url => /\/assets\/album\/|apple-livephotoskit/.test(url))).toEqual([]);

  await page.locator('#right-menu-toggle').click();
  await expect(page.locator('#right-sidebar img')).toHaveCount(9);
  await expect.poll(() => requests.some(url => /\/album\/thumbs\/.*\.webp/.test(url))).toBe(true);
  expect(requests.some(url => /\.MOV|apple-livephotoskit|\/album\/[^/]+\.jpg/.test(url))).toBe(false);
  await expect(page.getByRole('button', { name: 'Play Live Photo' })).toHaveCount(2);
  await page.locator('#right-menu-toggle').click();
  await expect(page.locator('#right-sidebar')).toHaveAttribute('inert', '');
});

test('first-time visitors opt into the dice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFrontendNetwork(page);
  await page.addInitScript(() => localStorage.removeItem('diceRolled'));
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#about')).toBeVisible();
  expect(requests.some(url => /background-animation|three\.module|html2canvas/.test(url))).toBe(false);
  await expect(page.locator('#dice-overlay')).not.toBeVisible();
  await page.locator('#mobile-menu-toggle').click();
  await page.locator('#dice-toggle').click();
  await expect(page.locator('#dice-overlay')).toBeVisible();
});

test('desktop opens the photo gallery without downloading original media', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFrontendNetwork(page);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#right-sidebar img')).toHaveCount(9);
  await expect(page.locator('#right-sidebar img').first()).toBeVisible();
  const photo = await page.locator('#right-sidebar img').first().boundingBox();
  expect(photo).not.toBeNull();
  expect(Math.abs(photo!.width - photo!.height)).toBeLessThan(1);
  await expect.poll(() => requests.some(url => /\/album\/thumbs\/.*\.webp/.test(url))).toBe(true);
  expect(requests.some(url => /\.MOV|apple-livephotoskit|\/album\/[^/]+\.jpg/.test(url))).toBe(false);

  // A failed optional player must leave the thumbnail and an actionable retry.
  await page.getByRole('button', { name: 'Play Live Photo' }).first().click();
  await expect(page.getByRole('button', { name: 'Retry Live Photo' })).toBeEnabled();
  await expect(page.locator('#right-sidebar img')).toHaveCount(9);
});
