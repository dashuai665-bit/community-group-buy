import { expect, test } from '@playwright/test';

const email = 'browser-flow@example.test';

async function browserApi<T>(
  page: import('@playwright/test').Page,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        method: requestInit?.method,
        headers: requestInit?.body
          ? { 'content-type': 'application/json' }
          : undefined,
        body: requestInit?.body
          ? JSON.stringify(requestInit.body)
          : undefined,
      });
      return { status: response.status, body: await response.json() };
    },
    { requestPath: path, requestInit: init },
  );
}

test('real magic link session completes onboarding and preserves canonical profile state', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const requested = await page.context().request.post('/api/auth/email/request', {
    data: { email, returnTo: '/orders' },
    headers: { Origin: 'http://127.0.0.1:3211' },
  });
  expect(requested.ok()).toBe(true);

  const delivery = await page.context().request.get('/__test/email/latest');
  expect(delivery.ok()).toBe(true);
  const magicLink = new URL((await delivery.json()).url);
  expect(magicLink.pathname).toBe('/api/auth/magic-link/verify');
  expect(magicLink.searchParams.get('callbackURL')).toBe(
    '/auth/email/continue?returnTo=%2Forders',
  );

  await page.goto(magicLink.href);
  await expect(page).toHaveURL(/\/onboarding\?returnTo=%2Forders$/);
  await expect(page.getByLabel('登入 Email')).toHaveValue(email);
  await expect(page.getByLabel('登入 Email')).toHaveAttribute('readonly', '');
  await expect(page.getByText('Email 已驗證')).toBeVisible();
  await expect(page.getByText('目前僅作為訂單聯絡使用，不進行手機驗證')).toBeVisible();

  const beforeOrder = await browserApi<{ error: { code: string } }>(page, '/api/orders', {
    method: 'POST',
    body: {
      communityId: 'e2e-c1',
      idempotencyKey: 'browser-before-onboarding',
      items: [{ offeringId: 'e2e-offer-1', quantity: 1 }],
    },
  });
  expect(beforeOrder.status).toBe(422);
  expect(beforeOrder.body.error.code).toBe('PROFILE_INCOMPLETE');

  let submittedBody: Record<string, unknown> | null = null;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/me/profile/onboarding')) {
      submittedBody = request.postDataJSON();
    }
  });
  await page.getByLabel('姓名／顯示名稱').fill('瀏覽器會員');
  await page.getByLabel('聯絡電話').fill('0912345678');
  await page.getByRole('button', { name: '完成會員資料' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  expect(submittedBody).toEqual({
    displayName: '瀏覽器會員',
    phone: '0912345678',
  });

  const profileResponse = await browserApi<{
    profile: Record<string, unknown>;
  }>(page, '/api/me/profile');
  expect(profileResponse.status).toBe(200);
  expect(profileResponse.body.profile).toMatchObject({
    displayName: '瀏覽器會員',
    phone: '0912345678',
    phoneVerified: false,
    email,
    emailVerified: true,
    profileComplete: true,
  });

  const afterOrder = await browserApi<{ error: { code: string } }>(page, '/api/orders', {
    method: 'POST',
    body: {
      communityId: 'e2e-c1',
      idempotencyKey: 'browser-after-onboarding',
      items: [{ offeringId: 'e2e-offer-1', quantity: 1 }],
    },
  });
  expect(afterOrder.body.error.code).toBe('MEMBERSHIP_REQUIRED');

  await page.goto('/auth/email/continue?returnTo=%2Forders');
  await expect(page).toHaveURL(/\/orders$/);
  await page.goto('/onboarding?returnTo=%2Forders');
  await expect(page).toHaveURL(/\/orders$/);
  expect(pageErrors).toEqual([]);
});
