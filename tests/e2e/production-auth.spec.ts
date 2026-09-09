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
