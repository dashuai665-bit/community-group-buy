import { test, expect, expectNoOverflow } from './authenticated-fixture';
test('resident, community admin and platform admin identities are isolated', async ({residentPage,adminPage,platformAdminPage}) => {
  await residentPage.goto('/profile'); await expect(residentPage.getByLabel('姓名／顯示名稱')).toHaveValue('測試住戶');
  await residentPage.goto('/admin/communities/e2e-c1'); await expect(residentPage.getByText('你沒有此社區的管理權限。')).toBeVisible();
  await adminPage.goto('/admin/communities/e2e-c1'); await expect(adminPage.getByRole('heading',{name:'瀏覽器測試社區'})).toBeVisible();
  await adminPage.goto('/admin/communities/e2e-c2'); await expect(adminPage.getByText('你沒有此社區的管理權限。')).toBeVisible();
  expect((await platformAdminPage.goto('/api/admin/audit-logs'))?.status()).toBe(200);
  await expectNoOverflow(adminPage);
});
