import { test, expect, expectNoOverflow } from './authenticated-fixture';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 } });

test('authenticated resident and admin complete shortage transaction and audit journey', async ({ residentPage, adminPage }) => {
  test.setTimeout(90_000);
  await residentPage.goto('/products/e2e-offer-1?community=e2e-c1');
  await expect(residentPage.getByRole('heading', { name: '測試白米' })).toBeVisible();
  await residentPage.getByLabel('購買數量').fill('10');
  await Promise.all([
    residentPage.waitForURL(/\/orders\/[^/]+\/success$/),
    residentPage.getByRole('button', { name: '加入湊單' }).click(),
  ]);
  const orderId = /\/orders\/([^/]+)\/success$/.exec(residentPage.url())?.[1];
  expect(orderId).toBeTruthy();
  await expect(residentPage.getByText('NT$1 × 10 包')).toBeVisible();
  await expect(residentPage.getByText('採購處理中／尚未確認')).toBeVisible();

  await adminPage.goto('/admin/communities/e2e-c1');
  await expect(adminPage.getByText(/10 \/ 10 包/)).toBeVisible();
  await expect(adminPage.getByText('已成團').first()).toBeVisible();
  await adminPage.getByRole('checkbox').first().check();
  await adminPage.getByRole('button', { name: /建立採購批次/ }).click();
  await expect(adminPage.getByText('採購批次已建立。')).toBeVisible();
  await adminPage.getByRole('button', { name: '開始採購' }).click();
  await expect(adminPage.getByText('已開始採購。')).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.getByText('採購中').first()).toBeVisible();
  await adminPage.getByRole('button', { name: '查看明細' }).first().click();
  await adminPage.getByLabel('實際數量').fill('7');
  await adminPage.getByLabel('實際單價（最小貨幣單位）').fill('120');
  await adminPage.getByRole('button', { name: '確認採購結果' }).click();
  await expect(adminPage.getByText('採購結果已完成並固定。')).toBeVisible();
  await expect(adminPage.getByText(/實際合計 NT\$8.*缺貨 3 件/)).toBeVisible();

  await residentPage.goto(`/orders/${orderId}`);
  await expect(residentPage.getByText(/可取得 7、缺貨 3、最終應付 NT\$8/)).toBeVisible();
  await expect(residentPage.getByText(/storage|管理員 ID/i)).toHaveCount(0);

  await adminPage.goto('/admin/communities/e2e-c1');
  await adminPage.getByRole('button', { name: '確認收到現金' }).click();
  await expect(adminPage.getByRole('button', { name: '確認已交付' })).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.getByText('已付款待領取')).toBeVisible();
  await adminPage.getByRole('button', { name: '確認已交付' }).click();
  await expect(adminPage.getByText('已完成取貨')).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.getByText('已完成取貨')).toBeVisible();

  await residentPage.goto(`/orders/${orderId}`);
  await expect(residentPage.getByText('已完成取貨').first()).toBeVisible();
  await expect(residentPage.getByText(/可取得 7、缺貨 3、最終應付 NT\$8/)).toBeVisible();

  await adminPage.goto('/admin/communities/e2e-c1');
  for (const event of ['batch_formed','PURCHASE_BATCH_CREATED','PURCHASE_BATCH_STARTED','PURCHASE_BATCH_FINALIZED','CASH_PAYMENT_CONFIRMED','ORDER_HANDED_OVER'])
    await expect(adminPage.getByText(event, { exact: true })).toHaveCount(1);
  await expectNoOverflow(adminPage);
});

test('zero fulfillment has no payment or handover actions', async ({ residentPage, adminPage }) => {
  test.setTimeout(60_000);
  await residentPage.goto('/products/e2e-offer-0?community=e2e-c1');
  await residentPage.getByLabel('購買數量').fill('5');
  await Promise.all([residentPage.waitForURL(/\/orders\/[^/]+\/success$/), residentPage.getByRole('button', { name: '加入湊單' }).click()]);
  const orderId = /\/orders\/([^/]+)\/success$/.exec(residentPage.url())?.[1];
  await adminPage.goto('/admin/communities/e2e-c1');
  await adminPage.getByRole('checkbox').first().check();
  await adminPage.getByRole('button', { name: /建立採購批次/ }).click();
  await adminPage.getByRole('button', { name: '開始採購' }).click();
  await adminPage.getByRole('button', { name: '查看明細' }).filter({ visible: true }).last().click();
  await adminPage.getByLabel('實際數量').fill('0');
  await adminPage.getByLabel('實際單價（最小貨幣單位）').fill('120');
  await adminPage.getByRole('button', { name: '確認採購結果' }).click();
  await residentPage.goto(`/orders/${orderId}`);
  await expect(residentPage.getByText(/可取得 0、缺貨 5、最終應付 NT\$0/)).toBeVisible();
  await adminPage.reload();
  const row = adminPage.getByText(orderId?.slice(0, 8) ?? '').locator('..').locator('..');
  await expect(row.getByText('全數缺貨／無需取貨')).toBeVisible();
  await expect(row.getByRole('button', { name: /確認收到現金|確認已交付/ })).toHaveCount(0);
});
