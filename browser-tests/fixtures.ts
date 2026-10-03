import type { Page, Route } from '@playwright/test';

const maliciousIdentity = '<img src=x onerror="window.__identityXss=1">';
const maliciousMarkdown = [
  '<img src=x onerror="window.__markdownXss=1">',
  '[unsafe](javascript:window.__linkXss=1)',
  '[safe](https://example.com)',
  '**bold**',
].join('\n\n');

const visit = {
  ip: '203.0.113.42',
  type: 'join',
  timestamp: new Date(Date.now() - 60_000).toISOString(),
  location: {
    city: 'Seattle',
    region: 'Washington',
    country: 'United States',
    lat: 47.6062,
    lon: -122.3321,
  },
  userAgent: 'Playwright fixture',
};

async function fulfillApi(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const json = (body: unknown) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  if (url.pathname === '/health') return json({ status: 'ok' });
  if (url.pathname === '/system') return json({ services: [], total_containers: 0 });
  if (url.pathname === '/visitors') {
    return json({ visitors: [visit], active_count: 1, recent_visits: [visit] });
  }
  if (url.pathname === '/events') return json({ events: [], next_before: null, total: 0 });
  if (url.pathname === '/visitor-analytics') return json({ visitors: [] });
  if (url.pathname === '/chat/general/history') {
    return json({
      messages: [{
        sender: maliciousIdentity,
        text: maliciousMarkdown,
        timestamp: new Date(Date.now() - 30_000).toISOString(),
      }],
      next_before: null,
    });
  }
  if (url.pathname === '/chat/general/analytics') return json({ messages: 1, senders: 1 });
  if (url.pathname === '/clicks/analytics') return route.fulfill({ status: 204 });
  if (url.pathname === '/notes/search') return json({ results: [] });
  return json({});
}

export async function mockFrontendNetwork(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('diceRolled', 'true');
    } catch {
      // Sandboxed frames can deny storage access.
    }
  });

  await page.routeWebSocket('wss://api.elimelt.com/**', socket => {
    socket.onMessage(message => {
      if (message === 'ping') socket.send('pong');
    });
  });

  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'api.elimelt.com') return fulfillApi(route);
    if (url.hostname === 'notes.elimelt.com' && url.pathname === '/index.xml') {
      return route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: '<?xml version="1.0"?><rss><channel></channel></rss>',
      });
    }
    return route.abort('blockedbyclient');
  });
}

export async function mockHomepageNetwork(page: Page): Promise<void> {
  await page.route('**/api/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok' }),
  }));
}

export { maliciousIdentity };
