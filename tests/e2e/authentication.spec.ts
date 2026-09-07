import { test as base, expect } from '@playwright/test';
import { test } from './authenticated-fixture';

base('unauthenticated protected journey enters the formal login route', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForURL(/\/auth\/login\?returnTo=/);
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/orders');
});

test('test-only server session authenticates and logout revokes it', async ({ residentPage }) => {
  expect((await residentPage.goto('/api/me/profile'))?.status()).toBe(200);
  await residentPage.goto('/profile');
  await residentPage.getByRole('button', { name: '登出' }).click();
  await residentPage.waitForURL('/');
  expect((await residentPage.request.get('/api/me/profile')).status()).toBe(401);
});
