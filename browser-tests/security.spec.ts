import { expect, test } from '@playwright/test';

test('historical identity HTML and Markdown URLs cannot execute code', async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('https://api.elimelt.com/**', route => route.abort());
  await page.goto('/frontend/');
  const results = await page.evaluate(async () => {
    const modulePath = '/frontend/js/safe-content.js';
    const { renderMarkdown, setIdentityText } = await import(modulePath);
    const container = document.createElement('div');
    document.body.append(container);
    setIdentityText(container, '<img src=x onerror="window.__xss=1">', ' connected');
    const identityWasText = container.querySelector('img') === null && container.textContent!.includes('<img');
    const markdown = document.createElement('div');
    markdown.innerHTML = renderMarkdown('[click](javascript:window.__xss=1)\n\n[good](https://example.com)\n\n**bold**');
    document.body.append(markdown);
    return {
      identityWasText,
      unsafeLinks: markdown.querySelectorAll('a[href^="javascript:"]').length,
      safeLink: markdown.querySelector('a[href="https://example.com"]') !== null,
      bold: markdown.querySelector('strong')?.textContent,
      images: markdown.querySelectorAll('img').length,
    };
  });
  expect(results).toEqual({ identityWasText: true, unsafeLinks: 0, safeLink: true, bold: 'bold', images: 0 });
});
