import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Use the authenticated browser's cookies; do not inject identities or mock API responses.
export async function expectForbidden(
  page: Page,
  path: string,
  method = 'GET',
  code = 'COMMUNITY_ADMIN_REQUIRED',
) {
  const result = await page.evaluate(
    async ({ path, method }) => {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method },
  );
  expect(result.status, method + ' ' + path).toBe(403);
  expect(result.body).toEqual({ error: { code, message: expect.any(String) } });
}
