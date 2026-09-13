import { expect, test, type Page } from '@playwright/test';

function observeBrowserFailures(page: Page) {
  const pageErrors: string[] = [];
  const prefetchErrors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('RSC prefetch setup error'))
      prefetchErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (response.status() === 401 && url.pathname.startsWith('/api/me/')) return;
    unexpectedResponses.push(`${response.status()} ${url.pathname}`);
  });
  return { pageErrors, prefetchErrors, unexpectedResponses };
}

test('production artifact navigates from home to communities by click', async ({ page }) => {
  const failures = observeBrowserFailures(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '鄰里湊湊' })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, '__productionNavigationMarker', true));

  await page.getByRole('link', { name: /瀏覽社區/ }).first().click();

  await expect(page).toHaveURL(/\/communities$/);
  await expect(page.getByRole('heading', { name: '瀏覽社區' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__productionNavigationMarker'))).toBeUndefined();
  expect(failures).toEqual({ pageErrors: [], prefetchErrors: [], unexpectedResponses: [] });
});

test('production artifact brand link performs a full document navigation', async ({ page }) => {
  const failures = observeBrowserFailures(page);
  await page.goto('/communities');
  await expect(page.getByRole('heading', { name: '瀏覽社區' })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, '__productionNavigationMarker', true));

  await page.getByRole('link', { name: '鄰里湊湊首頁' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '鄰里湊湊' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__productionNavigationMarker'))).toBeUndefined();
  expect(failures).toEqual({ pageErrors: [], prefetchErrors: [], unexpectedResponses: [] });
});

test('production artifact renders the onboarding UI without browser errors', async ({ page }) => {
  const failures = observeBrowserFailures(page);
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          displayName: null,
          phone: null,
          phoneVerified: false,
          email: 'artifact@example.test',
          emailVerified: true,
          profileComplete: false,
          defaultCommunityId: null,
        },
        isPlatformAdmin: false,
      }),
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/onboarding?returnTo=%2Forders');
  await expect(page.getByRole('heading', { name: '完成會員資料' })).toBeVisible();
  await expect(page.getByLabel('登入 Email')).toHaveValue('artifact@example.test');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(failures).toEqual({ pageErrors: [], prefetchErrors: [], unexpectedResponses: [] });
});

test('production artifact completed profile skips hostile onboarding destination safely', async ({
  page,
}) => {
  const failures = observeBrowserFailures(page);
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          displayName: '完整會員',
          phone: '0912345678',
          phoneVerified: false,
          email: 'artifact@example.test',
          emailVerified: true,
          profileComplete: true,
          defaultCommunityId: null,
        },
        isPlatformAdmin: false,
      }),
    }),
  );

  await page.goto(
    '/onboarding?returnTo=%2Fauth%2F%2565mail%2Fcontinue',
  );
  await expect(page).toHaveURL('http://127.0.0.1:3222/');
  expect(failures).toEqual({ pageErrors: [], prefetchErrors: [], unexpectedResponses: [] });
});
