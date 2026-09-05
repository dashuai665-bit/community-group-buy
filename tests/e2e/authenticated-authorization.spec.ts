import { test, expect } from './authenticated-fixture';
import { expectForbidden } from './support/authorization-assertions';

test('authorization browser failures hide community operations and reject audit access', async ({
  residentPage,
  adminPage,
  otherAdminPage,
}) => {
  for (const [page, community] of [
    [residentPage, 'e2e-c1'],
    [adminPage, 'e2e-c2'],
    [otherAdminPage, 'e2e-c1'],
  ] as const) {
    await page.goto('/admin/communities/' + community);
    await expect(
      page.getByText('你沒有此社區的管理權限。', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '操作紀錄', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: /確認收到現金|確認已交付|建立採購批次/,
      }),
    ).toHaveCount(0);
    await expectForbidden(
      page,
      '/api/admin/communities/' + community + '/audit-logs',
    );
    await expectForbidden(
      page,
      '/api/admin/audit-logs',
      'GET',
      'PLATFORM_ADMIN_REQUIRED',
    );
  }
});
