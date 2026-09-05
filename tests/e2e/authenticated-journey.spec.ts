import { expectForbidden } from './support/authorization-assertions';
import { expectOrderTail } from './support/database-assertions';
import type { Page } from '@playwright/test';
import { test, expect, expectNoOverflow } from './authenticated-fixture';

function pickupRow(page: Page, orderId: string) {
  return page
    .locator('section.ops-card')
    .filter({
      has: page.getByRole('heading', { name: '待面交／取貨', exact: true }),
    })
    .locator('article')
    .filter({
      has: page.getByRole('heading', {
        name: '測試住戶 · ' + orderId.slice(0, 8),
        exact: true,
      }),
    });
}

async function startPurchase(page: Page, product: string) {
  await page.getByRole('checkbox', { name: new RegExp(product) }).check();
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          '/api/admin/communities/e2e-c1/purchase-batches',
    ),
    page.getByRole('button', { name: /建立採購批次/ }).click(),
  ]);
  expect(created.status()).toBe(201);
  const { purchaseBatch } = await created.json();
  expect(purchaseBatch.id).toEqual(expect.any(String));
  const row = page.locator('article').filter({
    has: page.getByRole('heading', { name: purchaseBatch.id, exact: true }),
  });
  await expect(
    page.getByText('採購批次已建立。', { exact: true }),
  ).toBeVisible();
  await row.getByRole('button', { name: '開始採購', exact: true }).click();
  await expect(row.getByText('採購中', { exact: true })).toBeVisible();
  await page.reload();
  await expect(row.getByText('採購中', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: '查看明細', exact: true }).click();
  await expect(
    page.locator('.purchase-detail').getByText(product, { exact: true }),
  ).toBeVisible();
  return purchaseBatch.id as string;
}

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 } });

test('authenticated resident and admin complete shortage transaction and audit journey', async ({
  residentPage,
  adminPage,
  otherAdminPage,
}) => {
  test.setTimeout(90_000);
  await residentPage.goto('/products/e2e-offer-1?community=e2e-c1');
  await expect(
    residentPage.getByRole('heading', { name: '測試白米' }),
  ).toBeVisible();
  await residentPage.getByLabel('購買數量').fill('10');
  await Promise.all([
    residentPage.waitForURL(/\/orders\/[^/]+\/success$/),
    residentPage.getByRole('button', { name: '加入湊單' }).click(),
  ]);
  const orderId = /\/orders\/([^/]+)\/success$/.exec(residentPage.url())?.[1];
  if (!orderId) throw new Error('Order success URL is missing an order ID');
  await expect(residentPage.getByText('NT$1 × 10 包')).toBeVisible();
  await expect(residentPage.getByText('採購處理中／尚未確認')).toBeVisible();

  await adminPage.goto('/admin/communities/e2e-c1');
  await expect(adminPage.getByText(/10 \/ 10 包/)).toBeVisible();
  await expect(adminPage.getByText('已成團').first()).toBeVisible();
  const purchaseBatchId = await startPurchase(adminPage, '測試白米');
  await adminPage.getByLabel('實際數量').fill('7');
  await adminPage.getByLabel('實際單價（最小貨幣單位）').fill('120');
  await adminPage.getByRole('button', { name: '確認採購結果' }).click();
  await expect(adminPage.getByText('採購結果已完成並固定。')).toBeVisible();
  await expect(adminPage.getByText(/實際合計 NT\$8.*缺貨 3 件/)).toBeVisible();

  await residentPage.goto(`/orders/${orderId}`);
  await expect(
    residentPage.getByText(/可取得 7、缺貨 3、最終應付 NT\$8/),
  ).toBeVisible();
  await expect(residentPage.getByText(/storage|管理員 ID/i)).toHaveCount(0);

  await adminPage.goto('/admin/communities/e2e-c1');
  expectOrderTail(orderId, purchaseBatchId, 7, 3, 'finalized');
  await otherAdminPage.goto('/admin/communities/e2e-c1');
  await expect(
    otherAdminPage.getByText('你沒有此社區的管理權限。', { exact: true }),
  ).toBeVisible();
  for (const deniedPage of [residentPage, otherAdminPage]) {
    for (const action of ['confirm-payment', 'confirm-handover']) {
      await expectForbidden(
        deniedPage,
        '/api/admin/communities/e2e-c1/pickups/' + orderId + '/' + action,
        'POST',
      );
    }
    await expectForbidden(
      deniedPage,
      '/api/admin/communities/e2e-c1/purchase-batches/' +
        purchaseBatchId +
        '/start',
      'POST',
    );
  }
  // Rejections must not create payment, pickup or audit facts for this actual browser order.
  expectOrderTail(orderId, purchaseBatchId, 7, 3, 'finalized');
  const pickup = pickupRow(adminPage, orderId);
  await pickup
    .getByRole('button', { name: '確認收到現金', exact: true })
    .click();
  await expect(
    pickup.getByRole('button', { name: '確認已交付', exact: true }),
  ).toBeVisible();
  await adminPage.reload();
  await expect(pickup.getByText('已付款待領取', { exact: true })).toBeVisible();
  expectOrderTail(orderId, purchaseBatchId, 7, 3, 'paid');
  await pickup.getByRole('button', { name: '確認已交付', exact: true }).click();
  await expect(pickup.getByText('已完成取貨', { exact: true })).toBeVisible();
  await adminPage.reload();
  await expect(pickup.getByText('已完成取貨', { exact: true })).toBeVisible();

  await residentPage.goto(`/orders/${orderId}`);
  await expect(residentPage.getByText('已完成取貨').first()).toBeVisible();
  await expect(
    residentPage.getByText(/可取得 7、缺貨 3、最終應付 NT\$8/),
  ).toBeVisible();

  await adminPage.goto('/admin/communities/e2e-c1');
  for (const event of [
    'batch_formed',
    'PURCHASE_BATCH_CREATED',
    'PURCHASE_BATCH_STARTED',
    'PURCHASE_BATCH_FINALIZED',
    'CASH_PAYMENT_CONFIRMED',
    'ORDER_HANDED_OVER',
  ])
    await expect(adminPage.getByText(event, { exact: true })).toHaveCount(1);
  expectOrderTail(orderId, purchaseBatchId, 7, 3, 'completed');
  await expectNoOverflow(adminPage);
});

test('zero fulfillment has no payment or handover actions', async ({
  residentPage,
  adminPage,
}) => {
  test.setTimeout(60_000);
  await residentPage.goto('/products/e2e-offer-0?community=e2e-c1');
  await residentPage.getByLabel('購買數量').fill('5');
  await Promise.all([
    residentPage.waitForURL(/\/orders\/[^/]+\/success$/),
    residentPage.getByRole('button', { name: '加入湊單' }).click(),
  ]);
  const orderId = /\/orders\/([^/]+)\/success$/.exec(residentPage.url())?.[1];
  if (!orderId) throw new Error('Order success URL is missing an order ID');
  await adminPage.goto('/admin/communities/e2e-c1');
  const purchaseBatchId = await startPurchase(adminPage, '零履約麵條');
  await adminPage.getByLabel('實際數量').fill('0');
  await adminPage.getByLabel('實際單價（最小貨幣單位）').fill('120');
  await adminPage.getByRole('button', { name: '確認採購結果' }).click();
  await expect(
    adminPage.getByText('採購結果已完成並固定。', { exact: true }),
  ).toBeVisible();
  await residentPage.goto(`/orders/${orderId}`);
  await expect(
    residentPage.getByText(/可取得 0、缺貨 5、最終應付 NT\$0/),
  ).toBeVisible();
  await adminPage.reload();
  const row = pickupRow(adminPage, orderId);
  await expect(row.getByText('全數缺貨／無需取貨')).toBeVisible();
  await expect(
    row.getByRole('button', { name: /確認收到現金|確認已交付/ }),
  ).toHaveCount(0);
  expectOrderTail(orderId, purchaseBatchId, 0, 5, 'finalized');
  await expectNoOverflow(adminPage);
  await expectNoOverflow(residentPage);
});
