import { test, expect, expectNoOverflow } from './authenticated-fixture';

test.use({ viewport: { width: 390, height: 844 } });

test('Audit browser shows sanitized newest-first pages and resets pagination on filtering', async ({
  otherAdminPage,
  platformAdminPage,
}) => {
  await otherAdminPage.goto('/admin/communities/e2e-c2');
  const audit = otherAdminPage.locator('section.ops-card').filter({
    has: otherAdminPage.getByRole('heading', {
      name: '操作紀錄',
      exact: true,
    }),
  });
  const rows = audit.locator('article');
  await expect(rows).toHaveCount(20);
  await expect(rows.locator('time')).toHaveText(
    Array.from(
      { length: 20 },
      (_, i) => '2026-01-01 00:00:' + String(22 - i).padStart(2, '0'),
    ),
  );
  await expect(
    rows.getByRole('heading', { name: '其他管理員', exact: true }),
  ).toHaveCount(20);
  await expect(audit).not.toContainText(/audit-private|storageKey|token|phone/);
  await expect(audit.getByRole('button', { name: '上一頁' })).toBeDisabled();
  await audit.getByRole('button', { name: '下一頁' }).click();
  await expect(audit.getByText('第 2 頁', { exact: true })).toBeVisible();
  await expect(rows.locator('time')).toHaveText([
    '2026-01-01 00:00:02',
    '2026-01-01 00:00:01',
    '2026-01-01 00:00:00',
  ]);
  await expect(audit.getByRole('button', { name: '下一頁' })).toBeDisabled();
  await audit.getByLabel('事件篩選').selectOption('ORDER_HANDED_OVER');
  await expect(audit.getByText('第 1 頁', { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.status-pill')).toHaveText([
    'ORDER_HANDED_OVER',
    'ORDER_HANDED_OVER',
  ]);
  await expect(audit.getByRole('button', { name: '上一頁' })).toBeDisabled();
  await expect(audit.getByRole('button', { name: '下一頁' })).toBeDisabled();
  await audit.getByLabel('事件篩選').selectOption('PURCHASE_BATCH_FINALIZED');
  await expect(
    audit.getByText('目前沒有操作紀錄', { exact: true }),
  ).toBeVisible();
  await expect(rows).toHaveCount(0);
  await audit.getByLabel('事件篩選').selectOption('');
  await expect(rows).toHaveCount(20);
  await otherAdminPage.reload();
  await expect(rows).toHaveCount(20);
  await expectNoOverflow(otherAdminPage);

  await platformAdminPage.goto('/admin/communities/e2e-c2');
  await expect(
    platformAdminPage.getByRole('heading', {
      name: '其他測試社區',
      exact: true,
    }),
  ).toBeVisible();
  const result = await platformAdminPage.evaluate(async () => {
    const response = await fetch(
      '/api/admin/audit-logs?communityId=e2e-c2&event=ORDER_HANDED_OVER',
    );
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    total: 2,
    auditLogs: Array.from({ length: 2 }, () =>
      expect.objectContaining({
        community: { id: 'e2e-c2', name: '其他測試社區' },
        event: 'ORDER_HANDED_OVER',
      }),
    ),
  });
  expect(JSON.stringify(result.body)).not.toMatch(
    /audit-private|storageKey|token|phone/,
  );
});
