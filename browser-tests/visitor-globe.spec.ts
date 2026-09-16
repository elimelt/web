import { expect, test } from '@playwright/test';

const LOCAL_ORIGIN = 'http://127.0.0.1:3000';
const MAPLIBRE_WORKER = '/frontend/js/vendor/maplibre-gl/maplibre-gl-worker.mjs';
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('visitor globe uses the complete local MapLibre runtime and remains interactive', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('diceRolled', 'true'));
  const timestamp = new Date().toISOString();
  const visitor = {
    ip: '203.0.113.7',
    location: { city: 'London', country: 'Testland', lat: 51.5072, lon: -0.1276 },
    timestamp,
  };
  const pageErrors: string[] = [];
  const failedLocalAssets: string[] = [];
  const maplibreConsoleErrors: string[] = [];
  const unpkgRequests: string[] = [];
  const tileZooms: number[] = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /maplibre|worker/i.test(message.text())) {
      maplibreConsoleErrors.push(message.text());
    }
  });
  page.on('response', response => {
    if (response.url().startsWith(LOCAL_ORIGIN) && !response.ok()) {
      failedLocalAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(LOCAL_ORIGIN)) {
      failedLocalAssets.push(`${request.failure()?.errorText ?? 'request failed'} ${request.url()}`);
    }
  });
  page.on('request', request => {
    const match = new URL(request.url()).pathname.match(/^\/(\d+)\/\d+\/\d+\.png$/);
    if (request.url().startsWith('https://tile.openstreetmap.org/') && match) {
      tileZooms.push(Number(match[1]));
    }
  });

  // Keep unrelated third-party widgets out of this globe regression.
  await page.route('https://**', route => route.abort());
  await page.route('https://unpkg.com/maplibre-gl@*/**', route => {
    unpkgRequests.push(route.request().url());
    return route.abort();
  });
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TILE_PNG,
  }));
  await page.route('https://api.elimelt.com/**', route => {
    const { pathname } = new URL(route.request().url());
    let body: object = {};
    if (pathname === '/health') {
      body = { status: 'ok' };
    } else if (pathname === '/visitors') {
      body = { active_count: 1, active_visitors: [], recent_visits: [visitor] };
    } else if (pathname === '/events') {
      body = { events: [], next_before: null };
    } else if (pathname === '/visitor-analytics') {
      body = {
        count: 1,
        filters: {},
        visitors: [{
          visitor_ip: visitor.ip,
          total_visits: 1,
          total_time_seconds: 30,
          avg_session_duration_seconds: 30,
          is_recurring: false,
          visit_frequency_per_day: 1,
          location_city: visitor.location.city,
          location_country: visitor.location.country,
        }],
      };
    } else if (pathname === '/system') {
      body = { services: [], total_containers: 0 };
    } else if (pathname.includes('/chat/') && pathname.endsWith('/history')) {
      body = { messages: [], next_before: null };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket('wss://api.elimelt.com/**', socket => socket.close());

  await page.goto('/frontend/');

  const map = page.locator('#visitor-map');
  const workerUrl = `${LOCAL_ORIGIN}${MAPLIBRE_WORKER}`;
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => page.workers().map(worker => worker.url())).toContain(workerUrl);
  await expect(map.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();
  await expect(map.locator('.maplibregl-ctrl-zoom-out')).toBeVisible();
  await expect(map.locator('.maplibregl-ctrl-compass')).toBeVisible();
  await expect(page.locator('#visitor-map-summary')).toHaveText('1 mapped visits | 0 without coordinates');

  const marker = map.locator('.world-visitor-marker');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('aria-label', '1 visits near London');

  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(map).toBeHidden();
  await expect(page.locator('#recent-visitor-list')).toBeVisible();
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible();

  const markerPosition = () => marker.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const mapBounds = element.closest('#visitor-map')!.getBoundingClientRect();
    return { x: bounds.x - mapBounds.x, y: bounds.y - mapBounds.y };
  });
  const initialPosition = await markerPosition();
  const distanceFromInitial = async () => {
    const current = await markerPosition();
    return Math.hypot(current.x - initialPosition.x, current.y - initialPosition.y);
  };
  tileZooms.length = 0;
  await map.locator('.maplibregl-ctrl-zoom-in').click();
  await expect.poll(() => tileZooms.some(zoom => zoom >= 2)).toBe(true);
  await expect.poll(distanceFromInitial).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect.poll(distanceFromInitial).toBeLessThan(3);

  await marker.click();
  const popup = map.locator('.maplibregl-popup');
  await expect(popup).toContainText('London, Testland');
  tileZooms.length = 0;
  await popup.getByRole('button', { name: 'Explore streets here' }).click();
  await expect(popup).toHaveCount(0);
  await expect.poll(() => tileZooms.some(zoom => zoom >= 15)).toBe(true);

  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(marker).toBeVisible();
  await marker.click();
  await popup.getByRole('button', { name: visitor.ip }).click();
  await expect(page.locator('#visitor-modal-overlay')).toHaveClass(/active/);
  await expect(page.locator('#visitor-modal-title')).toHaveText(`Activity for ${visitor.ip}`);
  await expect(page.locator('#visitor-analytics-summary')).toContainText('Analytics Visits');

  expect(unpkgRequests).toEqual([]);
  expect(failedLocalAssets).toEqual([]);
  expect(maplibreConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
