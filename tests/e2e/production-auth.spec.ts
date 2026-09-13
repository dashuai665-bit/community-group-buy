import { expect, test, type APIResponse } from '@playwright/test';

const forbiddenRouteErrors = ['Invalid URL: [object Request]', '[vinext] Route handler error'];

async function expectAuthRouteHandled(response: APIResponse) {
  const body = await response.text();
  expect(response.status()).not.toBe(500);
  for (const error of forbiddenRouteErrors) expect(body).not.toContain(error);
  return body;
}

test('production artifact handles an unauthenticated get-session request', async ({ request }) => {
  const response = await request.get('/api/auth/get-session');

  const body = await expectAuthRouteHandled(response);
  expect(response.ok()).toBe(true);
  expect(JSON.parse(body)).toBeNull();
});

test('production artifact lets Better Auth handle its error route', async ({ request }) => {
  const response = await request.get('/api/auth/error?error=production_e2e');

  await expectAuthRouteHandled(response);
});

test('production artifact preserves a POST body through request reconstruction', async ({ request }) => {
  const response = await request.post('/api/auth/sign-in/social', {
    data: { provider: 'google', callbackURL: '/' },
    headers: { Origin: 'http://127.0.0.1:3222' },
  });

  const body = await expectAuthRouteHandled(response);
  expect(response.ok()).toBe(true);
  expect(JSON.parse(body)).toMatchObject({ redirect: true });
});

test('production artifact handles anonymous email continuation without a route error', async ({
  request,
}) => {
  const response = await request.get('/auth/email/continue?returnTo=%2Forders', {
    maxRedirects: 0,
  });

  const body = await expectAuthRouteHandled(response);
  expect(body).toBe('');
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/auth/login?returnTo=%2Forders');
});

test('production artifact exposes onboarding PUT through the formal auth boundary', async ({
  request,
}) => {
  const response = await request.put('/api/me/profile/onboarding', {
    data: { displayName: '測試住戶', phone: '0912345678' },
    headers: { Origin: 'http://127.0.0.1:3222' },
  });

  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
});
