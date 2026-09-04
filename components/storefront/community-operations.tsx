'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ClientApiError } from '@/lib/client-api';
import { formatMoney, formatOrderStatus } from '@/lib/storefront';
import { EmptyState, ErrorState, LoadingState } from './states';
type Summary = {
  community: { name: string; status: string; joinPolicy: string };
  summary: {
    collecting: number;
    groupedReady: number;
    pendingPurchase: number;
    pendingPickup: number;
    unfinishedOrders: number;
  };
};
type Order = {
  id: string;
  status: string;
  currency: string;
  estimatedTotalMinor: number;
  contact: { name: string | null; phone: string | null };
  items: Array<{ product_name_snapshot: string; quantity: number }>;
};
type Wish = { id: string; wish_text: string | null; status: string };
type Grouping = {
  id: string;
  product_name: string;
  unit_label: string;
  status: string;
  committed_quantity: number;
  threshold_quantity: number;
  member_order_count: number;
  estimated_amount_minor: number;
  currency: string;
  oldest_order_time: string | null;
  purchased_quantity?: number | null;
  shortage_quantity?: number | null;
  actual_unit_price_minor?: number | null;
};
type PurchaseBatch = {
  id: string;
  status: 'ready' | 'purchasing' | 'finalized';
  display_status?: 'ready' | 'purchasing' | 'finalized';
  group_count: number;
  total_quantity: number;
  estimated_total_minor: number;
  created_at: string;
  purchasing_started_at: string | null;
};
type PurchaseOperations = {
  eligibleGroups: Grouping[];
  purchaseBatches: PurchaseBatch[];
};
type PurchaseBatchDetail = PurchaseBatch & {
  created_by_name: string | null;
  purchasing_started_by_name: string | null;
  groups: Grouping[];
  groupCount: number;
  totalQuantity: number;
  estimatedTotalMinor: number;
  finalization: null | {
    purchasedQuantity: number;
    shortageQuantity: number;
    actualTotalMinor: number;
    finalizedAt: string;
  };
};
type Pickup = {
  orderId: string;
  memberDisplayName: string | null;
  currency: string;
  fulfilledQuantity: number;
  shortageQuantity: number;
  finalPayableMinor: number;
  paymentStatus: 'unpaid' | 'paid';
  pickupStatus: 'pending' | 'handed_over';
  completionState: 'procurement_pending' | 'no_pickup_required' | 'ready_for_payment' | 'paid_pending_pickup' | 'completed';
  items: Array<{ product_name_snapshot: string; fulfilled_quantity: number }>;
};
export function CommunityOperations({ communityId }: { communityId: string }) {
  const [data, setData] = useState<{
      summary: Summary;
      orders: Order[];
      wishes: Wish[];
      groupings: Grouping[];
      purchases: PurchaseOperations;
      pickups: Pickup[];
    } | null>(null),
    [error, setError] = useState(''),
    [formationReason, setFormationReason] = useState<Record<string, string>>(
      {},
    ),
    [forming, setForming] = useState(''),
    [selectedGroups, setSelectedGroups] = useState<string[]>([]),
    [purchaseAction, setPurchaseAction] = useState(''),
    [purchaseMessage, setPurchaseMessage] = useState(''),
    [purchaseDetail, setPurchaseDetail] = useState<PurchaseBatchDetail | null>(
      null,
    ),
    [purchaseResults, setPurchaseResults] = useState<
      Record<string, { purchasedQuantity: string; actualUnitPriceMinor: string }>
    >({}),
    [pickupAction, setPickupAction] = useState('');
  async function reloadPickups() {
    const result = await api<{ pickups: Pickup[] }>(`/api/admin/communities/${communityId}/pickups`);
    setData((current) => current ? { ...current, pickups: result.pickups } : current);
  }
  async function updatePickup(orderId: string, action: 'confirm-payment' | 'confirm-handover') {
    setPickupAction(`${orderId}-${action}`);
    try {
      await api(`/api/admin/communities/${communityId}/pickups/${orderId}/${action}`, { method: 'POST', body: '{}' });
      await reloadPickups();
    } catch (cause) {
      setPurchaseMessage(cause instanceof Error ? cause.message : '取貨作業失敗');
    } finally {
      setPickupAction('');
    }
  }
  async function showPurchaseBatch(id: string) {
    setPurchaseAction(`detail-${id}`);
    try {
      const result = await api<{ purchaseBatch: PurchaseBatchDetail }>(
        `/api/admin/communities/${communityId}/purchase-batches/${id}`,
      );
      setPurchaseDetail(result.purchaseBatch);
      setPurchaseResults(
        Object.fromEntries(
          result.purchaseBatch.groups.map((group) => [
            group.id,
            {
              purchasedQuantity: String(group.committed_quantity),
              actualUnitPriceMinor: String(
                Math.round(group.estimated_amount_minor / group.committed_quantity),
              ),
            },
          ]),
        ),
      );
    } catch (cause) {
      setPurchaseMessage(
        cause instanceof Error ? cause.message : '載入採購批次失敗',
      );
    } finally {
      setPurchaseAction('');
    }
  }
  async function reloadPurchases() {
    const purchases = await api<PurchaseOperations>(
      `/api/admin/communities/${communityId}/purchase-batches`,
    );
    setData((current) => (current ? { ...current, purchases } : current));
  }
  async function createPurchaseBatch() {
    if (!selectedGroups.length)
      return setPurchaseMessage('請先選擇至少一個已成團集單。');
    setPurchaseAction('creating');
    setPurchaseMessage('');
    try {
      await api(`/api/admin/communities/${communityId}/purchase-batches`, {
        method: 'POST',
        body: JSON.stringify({
          groupingIds: selectedGroups,
          idempotencyKey: `purchase-${crypto.randomUUID()}`,
        }),
      });
      setSelectedGroups([]);
      setPurchaseMessage('採購批次已建立。');
      await reloadPurchases();
    } catch (cause) {
      setPurchaseMessage(
        cause instanceof Error ? cause.message : '建立採購批次失敗',
      );
    } finally {
      setPurchaseAction('');
    }
  }
  async function startPurchasing(id: string) {
    setPurchaseAction(id);
    setPurchaseMessage('');
    try {
      await api(
        `/api/admin/communities/${communityId}/purchase-batches/${id}/start`,
        { method: 'POST' },
      );
      setPurchaseMessage('已開始採購。');
      await reloadPurchases();
    } catch (cause) {
      setPurchaseMessage(
        cause instanceof Error ? cause.message : '無法開始採購',
      );
    } finally {
      setPurchaseAction('');
    }
  }
  async function finalizePurchaseBatch() {
    if (!purchaseDetail) return;
    setPurchaseAction(`finalize-${purchaseDetail.id}`);
    setPurchaseMessage('');
    try {
      const result = await api<{ purchaseBatch: PurchaseBatchDetail }>(
        `/api/admin/communities/${communityId}/purchase-batches/${purchaseDetail.id}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: `finalize-${crypto.randomUUID()}`,
            receiptId: null,
            results: purchaseDetail.groups.map((group) => ({
              groupingId: group.id,
              purchasedQuantity: Number(purchaseResults[group.id]?.purchasedQuantity),
              actualUnitPriceMinor: Number(purchaseResults[group.id]?.actualUnitPriceMinor),
            })),
          }),
        },
      );
      setPurchaseDetail(result.purchaseBatch);
      setPurchaseMessage('採購結果已完成並固定。');
      await reloadPurchases();
    } catch (cause) {
      setPurchaseMessage(cause instanceof Error ? cause.message : '無法完成採購結果');
    } finally {
      setPurchaseAction('');
    }
  }
  async function formGrouping(grouping: Grouping) {
    const reason = formationReason[grouping.id]?.trim();
    if (!reason) return setError('請填寫手動成團原因。');
    if (!window.confirm(`確定要將「${grouping.product_name}」手動成團？`))
      return;
    setForming(grouping.id);
    try {
      const result = await api<{ grouping: Grouping }>(
        `/api/admin/communities/${communityId}/groupings/${grouping.id}/form`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      );
      setData((current) =>
        current
          ? {
              ...current,
              groupings: current.groupings.map((item) =>
                item.id === grouping.id ? result.grouping : item,
              ),
            }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手動成團失敗');
    } finally {
      setForming('');
    }
  }
  useEffect(() => {
    Promise.all([
      api<Summary>(`/api/admin/communities/${communityId}/summary`),
      api<{ orders: Order[] }>(`/api/admin/communities/${communityId}/orders`),
      api<{ wishes: Wish[] }>(`/api/admin/communities/${communityId}/wishes`),
      api<{ groupings: Grouping[] }>(
        `/api/admin/communities/${communityId}/groupings`,
      ),
      api<PurchaseOperations>(
        `/api/admin/communities/${communityId}/purchase-batches`,
      ),
      api<{ pickups: Pickup[] }>(`/api/admin/communities/${communityId}/pickups`),
    ])
      .then(([summary, orders, wishes, groupings, purchases, pickups]) =>
        setData({
          summary,
          orders: orders.orders,
          wishes: wishes.wishes,
          groupings: groupings.groupings,
          purchases,
          pickups: pickups.pickups,
        }),
      )
      .catch((e) =>
        setError(
          e instanceof ClientApiError && e.status === 403
            ? '你沒有此社區的管理權限。'
            : e instanceof ClientApiError && e.status === 404
              ? '找不到此社區。'
              : e instanceof Error
                ? e.message
                : '載入失敗',
        ),
      );
  }, [communityId]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="正在載入社區營運資料…" />;
  const s = data.summary.summary;
  const sections = [
    ['目前集單', s.collecting],
    ['待採購', s.pendingPurchase],
    ['待面交', s.pendingPickup],
    ['未完成訂單', s.unfinishedOrders],
  ];
  return (
    <>
      <div className="operations-title">
        <div>
          <p className="eyebrow">社區營運</p>
          <h1>{data.summary.community.name}</h1>
          <p>
            {data.summary.community.status === 'active'
              ? '營運中'
              : '已停用 · 歷史資料仍可查看'}
          </p>
        </div>
        <Link href="/admin">返回總覽</Link>
      </div>
      <section className="ops-card">
        <h2>待面交／取貨</h2>
        {!data.pickups.length ? <EmptyState title="目前沒有取貨作業" description="採購結果全部確認後會顯示在這裡。" /> : (
          <div className="admin-order-list">{data.pickups.map((pickup) => <article key={pickup.orderId}><div><span className="status-pill">{pickup.completionState === 'no_pickup_required' ? '全數缺貨／無需取貨' : pickup.pickupStatus === 'handed_over' ? '已完成取貨' : pickup.paymentStatus === 'paid' ? '已付款待領取' : pickup.completionState === 'procurement_pending' ? '採購尚未確認' : '可取貨'}</span><h3>{pickup.memberDisplayName ?? '住戶'} · {pickup.orderId.slice(0, 8)}</h3><p>{pickup.items.map((item) => `${item.product_name_snapshot} ${item.fulfilled_quantity}`).join('、') || '無履約商品'}</p><small>實配 {pickup.fulfilledQuantity} · 缺貨 {pickup.shortageQuantity}</small></div><div><strong>{formatMoney(pickup.finalPayableMinor, pickup.currency)}</strong>{pickup.completionState === 'ready_for_payment' ? <button disabled={Boolean(pickupAction)} onClick={() => void updatePickup(pickup.orderId, 'confirm-payment')}>確認收到現金</button> : pickup.completionState === 'paid_pending_pickup' ? <button disabled={Boolean(pickupAction)} onClick={() => void updatePickup(pickup.orderId, 'confirm-handover')}>確認已交付</button> : null}</div></article>)}</div>
        )}
      </section>
      <section className="ops-card">
        <h2>目前集單</h2>
        {!data.groupings.length ? (
          <EmptyState
            title="目前沒有集單"
            description="居民下單後會依規格建立集單。"
          />
        ) : (
          <div className="admin-order-list">
            {data.groupings.map((grouping) => (
              <article key={grouping.id}>
                <div>
                  <span className="status-pill">
                    {grouping.status === 'open' ? '集單中' : '已成團'}
                  </span>
                  <h3>{grouping.product_name}</h3>
                  <p>
                    {grouping.committed_quantity} /{' '}
                    {grouping.threshold_quantity} {grouping.unit_label} ·{' '}
                    {grouping.member_order_count} 筆訂單
                  </p>
                  <progress
                    max={grouping.threshold_quantity}
                    value={Math.min(
                      grouping.committed_quantity,
                      grouping.threshold_quantity,
                    )}
                  />
                  {grouping.status === 'open' &&
                  grouping.committed_quantity > 0 ? (
                    <div className="manual-form-controls">
                      <label htmlFor={`formation-reason-${grouping.id}`}>
                        手動成團原因
                      </label>
                      <input
                        id={`formation-reason-${grouping.id}`}
                        maxLength={500}
                        value={formationReason[grouping.id] ?? ''}
                        onChange={(event) =>
                          setFormationReason((current) => ({
                            ...current,
                            [grouping.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={forming === grouping.id}
                        onClick={() => formGrouping(grouping)}
                      >
                        {forming === grouping.id ? '處理中…' : '手動成團'}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div>
                  <strong>
                    {formatMoney(
                      grouping.estimated_amount_minor,
                      grouping.currency,
                    )}
                  </strong>
                  <small>
                    {grouping.oldest_order_time
                      ? `最早 ${grouping.oldest_order_time}`
                      : '尚無訂單'}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="ops-card">
        <h2>待建立採購批次</h2>
        {!data.purchases.eligibleGroups.length ? (
          <EmptyState
            title="目前沒有待採購集單"
            description="新的已成團集單會顯示在這裡。"
          />
        ) : (
          <div className="purchase-selection">
            {data.purchases.eligibleGroups.map((group) => (
              <label key={group.id}>
                <input
                  type="checkbox"
                  checked={selectedGroups.includes(group.id)}
                  onChange={(event) =>
                    setSelectedGroups((current) =>
                      event.target.checked
                        ? [...current, group.id]
                        : current.filter((id) => id !== group.id),
                    )
                  }
                />
                <span>
                  <strong>{group.product_name}</strong>
                  <small>
                    {group.committed_quantity} {group.unit_label} ·{' '}
                    {formatMoney(group.estimated_amount_minor, group.currency)}
                  </small>
                </span>
              </label>
            ))}
            <button
              type="button"
              disabled={purchaseAction === 'creating'}
              onClick={createPurchaseBatch}
            >
              {purchaseAction === 'creating'
                ? '建立中…'
                : `建立採購批次（${selectedGroups.length}）`}
            </button>
          </div>
        )}
        {purchaseMessage ? (
          <p className="form-message">{purchaseMessage}</p>
        ) : null}
      </section>
      <section className="ops-card">
        <h2>採購批次</h2>
        {!data.purchases.purchaseBatches.length ? (
          <EmptyState
            title="尚無採購批次"
            description="選擇已成團集單後建立。"
          />
        ) : (
          <div className="admin-order-list">
            {data.purchases.purchaseBatches.map((batch) => (
              <article key={batch.id}>
                <div>
                  <span className="status-pill">
                    {(batch.display_status ?? batch.status) === 'ready'
                      ? '待採購'
                      : (batch.display_status ?? batch.status) === 'finalized'
                        ? '採購結果已確認'
                        : '採購中'}
                  </span>
                  <h3>{batch.id}</h3>
                  <p>
                    {batch.group_count} 團 · {batch.total_quantity} 件 ·{' '}
                    {batch.created_at}
                  </p>
                  {batch.status === 'ready' ? (
                    <button
                      type="button"
                      disabled={purchaseAction === batch.id}
                      onClick={() => startPurchasing(batch.id)}
                    >
                      {purchaseAction === batch.id ? '開始中…' : '開始採購'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => showPurchaseBatch(batch.id)}
                  >
                    {purchaseAction === `detail-${batch.id}`
                      ? '載入中…'
                      : '查看明細'}
                  </button>
                </div>
                <strong>
                  {formatMoney(batch.estimated_total_minor, 'TWD')}
                </strong>
              </article>
            ))}
          </div>
        )}
        {purchaseDetail ? (
          <div className="purchase-detail">
            <h3>採購批次明細</h3>
            <p>
              由 {purchaseDetail.created_by_name ?? '管理員'} 建立 ·{' '}
              {purchaseDetail.groupCount} 團 · {purchaseDetail.totalQuantity} 件
            </p>
            {purchaseDetail.groups.map((group) => (
              <div key={group.id} className="purchase-result-row">
                <p>
                  <strong>{group.product_name}</strong> · 需求 {group.committed_quantity}{' '}
                  {group.unit_label} · 預估{' '}
                  {formatMoney(group.estimated_amount_minor, group.currency)}
                </p>
                {purchaseDetail.status === 'purchasing' ? (
                  <div className="purchase-result-inputs">
                    <label>
                      實際數量
                      <input type="number" min="0" max={group.committed_quantity}
                        value={purchaseResults[group.id]?.purchasedQuantity ?? ''}
                        onChange={(event) => setPurchaseResults((current) => ({ ...current, [group.id]: { ...current[group.id], purchasedQuantity: event.target.value } }))} />
                    </label>
                    <label>
                      實際單價（最小貨幣單位）
                      <input type="number" min="0"
                        value={purchaseResults[group.id]?.actualUnitPriceMinor ?? ''}
                        onChange={(event) => setPurchaseResults((current) => ({ ...current, [group.id]: { ...current[group.id], actualUnitPriceMinor: event.target.value } }))} />
                    </label>
                    <small>缺貨預覽：{Math.max(0, group.committed_quantity - Number(purchaseResults[group.id]?.purchasedQuantity || 0))} {group.unit_label}</small>
                  </div>
                ) : group.purchased_quantity != null ? (
                  <p>實際 {group.purchased_quantity} · 缺貨 {group.shortage_quantity} · 單價 {formatMoney(group.actual_unit_price_minor ?? 0, group.currency)}</p>
                ) : null}
              </div>
            ))}
            <strong>
              預估合計 {formatMoney(purchaseDetail.estimatedTotalMinor, 'TWD')}
            </strong>
            {purchaseDetail.status === 'purchasing' ? (
              <>
                <p className="info-note">收據檔案儲存尚待部署 storage adapter；目前只保存管理員專用 metadata。</p>
                <button type="button" disabled={purchaseAction === `finalize-${purchaseDetail.id}`} onClick={finalizePurchaseBatch}>
                  {purchaseAction === `finalize-${purchaseDetail.id}` ? '確認中…' : '確認採購結果'}
                </button>
              </>
            ) : purchaseDetail.finalization ? (
              <p>實際合計 {formatMoney(purchaseDetail.finalization.actualTotalMinor, 'TWD')} · 缺貨 {purchaseDetail.finalization.shortageQuantity} 件 · {purchaseDetail.finalization.finalizedAt}</p>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="ops-card">
        <h2>社區基本資訊</h2>
        <p>
          加入政策：
          {data.summary.community.joinPolicy === 'open'
            ? '開放加入'
            : data.summary.community.joinPolicy}
        </p>
      </section>
      <div className="ops-summary">
        {sections.map(([label, value]) => (
          <section className="ops-card" key={label}>
            <h2>{label}</h2>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <section className="ops-card">
        <h2>最近訂單</h2>
        {!data.orders.length ? (
          <EmptyState title="尚無訂單" description="居民下單後會出現在這裡。" />
        ) : (
          <div className="admin-order-list">
            {data.orders.slice(0, 10).map((o) => (
              <article key={o.id}>
                <div>
                  <span className="status-pill">
                    {formatOrderStatus(o.status)}
                  </span>
                  <h3>
                    {o.items.map((i) => i.product_name_snapshot).join('、')}
                  </h3>
                  <p>
                    {o.contact.name ?? '未填姓名'} ·{' '}
                    {o.contact.phone ?? '未填電話'}
                  </p>
                </div>
                <div>
                  <strong>
                    {formatMoney(o.estimatedTotalMinor, o.currency)}
                  </strong>
                  <small>
                    {o.items.reduce((n, i) => n + i.quantity, 0)} 件
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="ops-card">
        <h2>商品願望</h2>
        {!data.wishes.length ? (
          <EmptyState
            title="目前沒有願望"
            description="居民提出商品願望後會顯示在此。"
          />
        ) : (
          <div className="wish-admin-list">
            {data.wishes.map((w) => (
              <article key={w.id}>
                <strong>{w.wish_text ?? '指定商品願望'}</strong>
                <span>{w.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
