import { expect, test } from '@playwright/test';
import { mockFrontendNetwork } from './fixtures.js';

const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('street-level dragging tracks the pointer and culls remote markers', async ({ page }) => {
  const timestamp = new Date().toISOString();
  const visitors = [
    { ip: '203.0.113.1', location: { city: 'London', country: 'United Kingdom', lat: 51.5072, lon: -0.1276 }, timestamp },
    { ip: '203.0.113.2', location: { city: 'New York', country: 'United States', lat: 40.7128, lon: -74.006 }, timestamp },
    { ip: '203.0.113.3', location: { city: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503 }, timestamp },
    { ip: '203.0.113.4', location: { city: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093 }, timestamp },
    { ip: '203.0.113.5', location: { city: 'Cape Town', country: 'South Africa', lat: -33.9249, lon: 18.4241 }, timestamp },
  ];

  await mockFrontendNetwork(page);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TILE_PNG,
  }));
  await page.route('https://api.elimelt.com/visitors', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ active_count: visitors.length, active_visitors: [], recent_visits: visitors }),
    });
  });

  await page.goto('/');

  const map = page.locator('#visitor-map');
  const canvas = map.locator('canvas.maplibregl-canvas');
  const markers = map.locator('.world-visitor-marker');
  const londonMarker = map.locator('.world-visitor-marker[aria-label="1 visits near London"]');

  await expect(canvas).toBeVisible();
  await expect(page.locator('#visitor-map-summary')).toHaveText('5 mapped visits | 0 without coordinates');
  await expect(markers).toHaveCount(visitors.length);

  await londonMarker.click();
  await map.locator('.maplibregl-popup').getByRole('button', { name: 'Explore streets here' }).click();

  await expect(markers).toHaveCount(1, { timeout: 15_000 });
  await expect(londonMarker).toBeVisible();
  await londonMarker.evaluate(element => { element.dataset.testIdentity = 'london'; });

  await canvas.scrollIntoViewIfNeeded();
  const before = await londonMarker.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(before).not.toBeNull();
  expect(canvasBox).not.toBeNull();

  const startX = canvasBox!.x + canvasBox!.width * 0.2;
  const startY = canvasBox!.y + canvasBox!.height * 0.75;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    await page.mouse.move(startX + 100, startY, { steps: 20 });
    let markerTravel = 0;
    await expect.poll(async () => {
      const duringDrag = await londonMarker.boundingBox();
      if (!duringDrag) return 0;
      markerTravel = Math.hypot(duringDrag.x - before!.x, duringDrag.y - before!.y);
      return markerTravel;
    }).toBeGreaterThanOrEqual(80);
    expect(markerTravel).toBeLessThanOrEqual(125);
  } finally {
    await page.mouse.up();
  }
  await expect(londonMarker).toHaveAttribute('data-test-identity', 'london');

  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(markers).toHaveCount(visitors.length, { timeout: 15_000 });
});
