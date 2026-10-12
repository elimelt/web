import { expect, test, type Page, type Route } from '@playwright/test';
import { mockFrontendNetwork } from './fixtures.js';

const livePhotosKitStub = `
  window.__livePhotoEvents = [];
  window.LivePhotosKit = {
    Player(element) {
      element.style.position = 'relative';
      element.play = function () {
        window.__livePhotoEvents.push({
          type: 'play',
          photoSrc: this.photoSrc,
          videoSrc: this.videoSrc,
          showsNativeControls: this.showsNativeControls,
        });
      };
      element.pause = function () { window.__livePhotoEvents.push({ type: 'pause' }); };
      element.stop = function () { window.__livePhotoEvents.push({ type: 'stop' }); };
      window.__livePhotoEvents.push({ type: 'create' });
      return element;
    },
  };
`;

const kitUrl = 'https://cdn.apple-livephotoskit.com/lpk/1/livephotoskit.js';

async function fulfillLivePhotosKit(route: Route): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: livePhotosKitStub });
}

async function livePhotoEvents(page: Page): Promise<Array<{ type: string }>> {
  return page.evaluate(() => (
    window as typeof window & { __livePhotoEvents?: Array<{ type: string }> }
  ).__livePhotoEvents ?? []);
}

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
  await expect(page.locator('.live-photo[role="button"][aria-label="Play Live Photo"][tabindex="0"]')).toHaveCount(2);
  await expect(page.locator('.live-photo button')).toHaveCount(0);
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

test('desktop plays Live Photos on hover and stops them on exit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFrontendNetwork(page);
  await page.route(kitUrl, fulfillLivePhotosKit);
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

  const livePhoto = page.locator('.live-photo').first();
  const heightBefore = await livePhoto.evaluate(element => element.getBoundingClientRect().height);
  await livePhoto.hover();
  await expect(livePhoto.locator('.live-photo-player')).toHaveCount(1);
  await expect.poll(async () => livePhotoEvents(page)).toContainEqual({
    type: 'play',
    photoSrc: '/assets/album/IMG_8875.jpg',
    videoSrc: '/assets/album/IMG_8875.MOV',
    showsNativeControls: false,
  });
  await expect(livePhoto.locator('.live-photo-player')).toHaveCSS('position', 'absolute');
  expect(await livePhoto.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(heightBefore, 0);

  await page.mouse.move(1, 1);
  await expect.poll(async () => (await livePhotoEvents(page)).map(event => event.type)).toEqual([
    'create',
    'play',
    'pause',
    'stop',
  ]);
  await expect(page.locator('#right-sidebar img')).toHaveCount(9);
});

test('leaving while the Live Photos SDK loads does not start playback later', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFrontendNetwork(page);
  let releaseKit!: () => void;
  const kitGate = new Promise<void>(resolve => { releaseKit = resolve; });
  await page.route(kitUrl, async route => {
    await kitGate;
    await fulfillLivePhotosKit(route);
  });
  await page.goto('/');

  const livePhoto = page.locator('.live-photo').first();
  await livePhoto.hover();
  await expect(livePhoto).toHaveAttribute('aria-busy', 'true');
  await page.mouse.move(1, 1);
  releaseKit();
  await expect(livePhoto).not.toHaveAttribute('aria-busy', 'true');
  await expect(livePhoto.locator('.live-photo-player')).toHaveCount(0);
  expect(await livePhotoEvents(page)).toEqual([]);

  await livePhoto.hover();
  await expect.poll(async () => (await livePhotoEvents(page)).map(event => event.type)).toEqual(['create', 'play']);
});

test('hover retries the Live Photos SDK after a failed load', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFrontendNetwork(page);
  let attempts = 0;
  await page.route(kitUrl, async route => {
    attempts += 1;
    if (attempts === 1) await route.abort('failed');
    else await fulfillLivePhotosKit(route);
  });
  await page.goto('/');

  const livePhoto = page.locator('.live-photo').first();
  await livePhoto.hover();
  await expect.poll(() => attempts).toBe(1);
  await expect(livePhoto).not.toHaveAttribute('aria-busy', 'true');
  await expect(livePhoto.locator('.live-photo-player')).toHaveCount(0);

  await page.mouse.move(1, 1);
  await livePhoto.hover();
  await expect.poll(() => attempts).toBe(2);
  await expect.poll(async () => (await livePhotoEvents(page)).map(event => event.type)).toEqual(['create', 'play']);
});
