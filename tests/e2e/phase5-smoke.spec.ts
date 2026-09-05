import { test, expect } from './authenticated-fixture';

import type { Page } from '@playwright/test';

async function safeGoto(page: Page, route: string) {
  try {
    return await page.goto(route, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (!error.message.includes('ERR_ABORTED') &&
        !error.message.includes('interrupted by another navigation'))
    )
      throw error;
    await page.waitForLoadState('domcontentloaded');
    return null;
  }
}

const routes = [
  '/',
  '/communities',
  '/orders',
  '/profile',
  '/profile/communities',
  '/profile/wishes',
  '/admin',
  '/admin/communities/e2e-c1',
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
      test(`${route} loads without horizontal overflow`, async ({
        residentPage,
        adminPage,
      }) => {
        // Normal page rendering needs an identity; authorization failures have separate coverage.
        const page = route.startsWith('/admin') ? adminPage : residentPage;
        expect(page.viewportSize()).toEqual({
          width: viewport.width,
          height: viewport.height,
        });
        const pageErrors: string[] = [];

        page.on('pageerror', (error) => {
          pageErrors.push(error.message);
        });

        const response = await page.goto(route, {
          waitUntil: 'domcontentloaded',
        });

        expect(response, `${route} should return a response`).not.toBeNull();
        expect(
          response?.status(),
          `${route} returned HTTP ${response?.status()}`,
        ).toBeLessThan(500);

        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByRole('status')).toHaveCount(0);

        const overflow = await page.evaluate(() => {
          const root = document.documentElement;
          return root.scrollWidth - root.clientWidth;
        });

        expect(
          overflow,
          `${route} has ${overflow}px horizontal overflow at ${viewport.width}px`,
        ).toBeLessThanOrEqual(1);

        expect(pageErrors, `${route} produced browser page errors`).toEqual([]);
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

test('會員功能頁可以開啟', async ({ residentPage: page }) => {
  for (const route of [
    '/orders',
    '/profile',
    '/profile/communities',
    '/profile/wishes',
  ]) {
    const response = await safeGoto(page, route);
    if (response) expect(response.status(), route).toBeLessThan(500);
  }
});

test('管理入口可以開啟', async ({ adminPage: page }) => {
  const response = await page.goto('/admin');
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).toBeVisible();
});

test('管理頁在未授權或 fixture 不存在時安全呈現', async ({
  page,
  residentPage,
}) => {
  await safeGoto(residentPage, '/admin');
  await expect(
    residentPage.getByRole('heading', { name: '管理工作台' }),
  ).toBeVisible();
  await expect(residentPage.getByText(/沒有管理權限/)).toBeVisible();
  await safeGoto(page, '/admin/communities/fixture-community');
  await expect(
    page.getByText(
      /正在載入社區營運資料|找不到此社區|沒有此社區的管理權限|請先登入/,
    ),
  ).toBeVisible();
});
