import { expect, test } from '@playwright/test';
import { maliciousIdentity, mockFrontendNetwork } from './fixtures.js';

test('historical chat identity and Markdown payloads cannot execute code', async ({ page }) => {
  await mockFrontendNetwork(page);
  await page.goto('/');

  const message = page.locator('#chat-messages .chat-msg').filter({ hasText: 'bold' });
  await expect(message).toHaveCount(1);
  await expect(message.locator('.chat-meta')).toContainText(maliciousIdentity);
  await expect(message.locator('.chat-text strong')).toHaveText('bold');
  await expect(message.locator('.chat-text a[href="https://example.com"]')).toHaveText('safe');
  await expect(message.locator('img, a[href^="javascript:"]')).toHaveCount(0);

  const xssGlobals = await page.evaluate(() => ({
    identity: (window as typeof window & { __identityXss?: number }).__identityXss,
    markdown: (window as typeof window & { __markdownXss?: number }).__markdownXss,
    link: (window as typeof window & { __linkXss?: number }).__linkXss,
  }));
  expect(xssGlobals).toEqual({ identity: undefined, markdown: undefined, link: undefined });
});
