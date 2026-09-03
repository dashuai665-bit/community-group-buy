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
export function CommunityOperations({ communityId }: { communityId: string }) {
  const [data, setData] = useState<{
      summary: Summary;
      orders: Order[];
      wishes: Wish[];
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api<Summary>(`/api/admin/communities/${communityId}/summary`),
      api<{ orders: Order[] }>(`/api/admin/communities/${communityId}/orders`),
      api<{ wishes: Wish[] }>(`/api/admin/communities/${communityId}/wishes`),
    ])
      .then(([summary, orders, wishes]) =>
        setData({ summary, orders: orders.orders, wishes: wishes.wishes }),
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
