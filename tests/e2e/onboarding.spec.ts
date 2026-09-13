import { test as base, expect } from '@playwright/test';
import { expectNoOverflow, test } from './authenticated-fixture';

base('anonymous onboarding safely returns to the login entry', async ({ page }) => {
  let loginUrl = '';
  await page.route('**/auth/login?**', async (route) => {
    loginUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'login' });
  });

  await page.goto('/onboarding?returnTo=%2Forders');
  await expect.poll(() => loginUrl).not.toBe('');
  expect(new URL(loginUrl).searchParams.get('returnTo')).toBe(
    '/onboarding?returnTo=%2Forders',
  );
});

test('incomplete member can complete onboarding with readonly verified email', async ({
  onboardingPage: page,
}) => {
  await page.goto('/onboarding?returnTo=%2Forders');
  await expect(page.getByRole('heading', { name: '完成會員資料' })).toBeVisible();

  const email = page.getByLabel('登入 Email');
  await expect(email).toHaveValue('new@example.test');
  await expect(email).toHaveAttribute('readonly', '');
  await expect(page.getByText('Email 已驗證')).toBeVisible();

  await page.getByLabel('姓名／顯示名稱').fill('   ');
  await page.getByLabel('聯絡電話').fill('0912345678');
  await page.getByRole('button', { name: '完成會員資料' }).click();
  await expect(page.getByRole('alert')).toContainText('請輸入 1 至 80 個字');

  await page.getByLabel('姓名／顯示名稱').fill('新會員');
  await page.getByLabel('聯絡電話').fill('123');
  await page.getByRole('button', { name: '完成會員資料' }).click();
  await expect(page.getByRole('alert')).toContainText('有效的 9 至 10 位數');

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    let failOnce = true;
    window.fetch = (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        failOnce &&
        init?.method === 'PUT' &&
        url.endsWith('/api/me/profile/onboarding')
      ) {
        failOnce = false;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: '目前暫時無法儲存',
              },
            }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return originalFetch(input, init);
    };
  });
  await page.getByLabel('聯絡電話').fill('0912345678');
  await page.getByRole('button', { name: '完成會員資料' }).click();
  await expect(page.getByRole('alert')).toContainText('目前暫時無法儲存');
  await expect(page).toHaveURL(/\/onboarding/);

  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let signalIntercepted = () => {};
  const intercepted = new Promise<void>((resolve) => {
    signalIntercepted = resolve;
  });
  let submittedBody: Record<string, unknown> | null = null;
  let submittedCount = 0;
  await page.route('**/api/me/profile/onboarding', async (route) => {
    submittedCount += 1;
    submittedBody = route.request().postDataJSON();
    signalIntercepted();
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, profileComplete: true }),
    });
  });
  const submit = page.getByRole('button', { name: '完成會員資料' });
  const submitAction = submit.click();
  await intercepted;
  await expect(page.locator('form.onboarding-card button[type="submit"]')).toBeDisabled();
  await page.locator('form.onboarding-card').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  releaseResponse();
  await submitAction;
  await expect(page).toHaveURL(/\/orders$/);
  expect(submittedCount).toBe(1);
  expect(submittedBody).toEqual({ displayName: '新會員', phone: '0912345678' });
});

test('completed profile skips onboarding and uses a safe destination', async ({
  residentPage: page,
}) => {
  await page.goto('/onboarding?returnTo=https%3A%2F%2Fevil.example');
  await expect(page).toHaveURL(/\/$/);
});

base('browser returnTo matrix never leaves the application origin', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          displayName: '完整會員',
          phone: '0912345678',
          phoneVerified: false,
          email: 'complete@example.test',
          emailVerified: true,
          profileComplete: true,
          defaultCommunityId: null,
        },
        isPlatformAdmin: false,
      }),
    }),
  );
  await page.route('**/api/orders', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }),
  );

  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/%2f%2fevil.example',
    '/%5cevil',
    '/%6fnboarding',
    '/onboarding%2Ffoo',
    '/auth/%65mail/continue',
    'javascript:alert(1)',
    '%',
  ]) {
    await page.goto(`/onboarding?returnTo=${encodeURIComponent(value)}`);
    await expect(page).toHaveURL('http://127.0.0.1:3211/');
  }

  for (const value of ['/', '/orders', '/products/abc?x=1']) {
    await page.goto(`/onboarding?returnTo=${encodeURIComponent(value)}`);
    await expect(page).toHaveURL(
      new URL(value, 'http://127.0.0.1:3211').href,
    );
  }
  expect(pageErrors).toEqual([]);
});

for (const width of [375, 390, 430, 768, 1280]) {
  test(`onboarding has no overflow at ${width}px`, async ({ onboardingPage: page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto('/onboarding?returnTo=%2Forders');
    await expect(page.getByRole('heading', { name: '完成會員資料' })).toBeVisible();
    await expectNoOverflow(page);
  });
}
