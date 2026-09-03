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
};
export function CommunityOperations({ communityId }: { communityId: string }) {
  const [data, setData] = useState<{
      summary: Summary;
      orders: Order[];
      wishes: Wish[];
      groupings: Grouping[];
    } | null>(null),
    [error, setError] = useState(''),
    [formationReason, setFormationReason] = useState<Record<string, string>>(
      {},
    ),
    [forming, setForming] = useState('');
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
    ])
      .then(([summary, orders, wishes, groupings]) =>
        setData({
          summary,
          orders: orders.orders,
          wishes: wishes.wishes,
          groupings: groupings.groupings,
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
