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
