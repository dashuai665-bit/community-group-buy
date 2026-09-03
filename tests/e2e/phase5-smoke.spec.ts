import { test, expect } from '@playwright/test';

const routes = [
  '/',
  '/communities',
  '/orders',
  '/profile',
  '/profile/communities',
  '/profile/wishes',
  '/admin',
];

const viewports = [
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
];

for (const viewport of viewports) {
  test.describe(`${viewport.name}px responsive`, () => {
    test.use({
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    });

    for (const route of routes) {
      test(`${route} loads without horizontal overflow`, async ({ page }) => {
        const pageErrors: string[] = [];

        page.on('pageerror', error => {
          pageErrors.push(error.message);
        });

        const response = await page.goto(route, {
          waitUntil: 'networkidle',
        });

        expect(response, `${route} should return a response`).not.toBeNull();
        expect(
          response?.status(),
          `${route} returned HTTP ${response?.status()}`,
        ).toBeLessThan(500);

        await expect(page.locator('body')).toBeVisible();

        const overflow = await page.evaluate(() => {
          const root = document.documentElement;
          return root.scrollWidth - root.clientWidth;
        });

        expect(
          overflow,
          `${route} has ${overflow}px horizontal overflow at ${viewport.width}px`,
        ).toBeLessThanOrEqual(1);

        expect(
          pageErrors,
          `${route} produced browser page errors`,
        ).toEqual([]);
      });
    }
  });
}

test('首頁主要導覽存在', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('鄰里湊湊').first()).toBeVisible();
});

test('社區頁可以開啟', async ({ page }) => {
  const response = await page.goto('/communities');
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).toBeVisible();
});

test('會員功能頁可以開啟', async ({ page }) => {
  for (const route of [
    '/orders',
    '/profile',
    '/profile/communities',
    '/profile/wishes',
  ]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBeLessThan(500);
  }
});

test('管理入口可以開啟', async ({ page }) => {
  const response = await page.goto('/admin');
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).toBeVisible();
});
