'use client';
import { AppLink as Link } from './app-link';
import {
  Building2,
  ClipboardList,
  PackageCheck,
  ShoppingCart,
  Truck,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ClientApiError, loginPath } from '@/lib/client-api';
import { ErrorState, LoadingState } from './states';
type Dashboard = {
  isPlatformAdmin: boolean;
  manageableCommunities: number;
  collecting: number;
  groupedReady: number;
  pendingPurchase: number;
  pendingPickup: number;
  unfinishedOrders: number;
  communities: Array<{ id: string; name: string; status: string }>;
};
const metrics = [
  ['可管理社區', 'manageableCommunities', Building2],
  ['待集單', 'collecting', UsersRound],
  ['已成團待處理', 'groupedReady', PackageCheck],
  ['待採購', 'pendingPurchase', ShoppingCart],
  ['待面交', 'pendingPickup', Truck],
  ['未完成訂單', 'unfinishedOrders', ClipboardList],
] as const;
export function AdminLanding() {
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<Dashboard>('/api/admin/summary')
      .then(setData)
      .catch((e) => {
        if (e instanceof ClientApiError && e.status === 401) {
          location.href = loginPath('/admin');
          return;
        }
        setError(
          e instanceof ClientApiError && e.status === 403
            ? '你的帳戶沒有管理權限。'
            : e instanceof Error
              ? e.message
              : '載入失敗',
        );
      });
  }, []);
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="正在整理營運資料…" />;
  return (
    <>
      <div className="admin-metrics">
        {metrics.map(([label, key, Icon]) => (
          <article key={key}>
            <Icon />
            <span>{label}</span>
            <strong>{data[key]}</strong>
          </article>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <p className="eyebrow">管理範圍</p>
          <h2>{data.isPlatformAdmin ? '所有社區' : '我的社區'}</h2>
        </div>
      </div>
      <div className="admin-grid">
        {data.communities.map((c) => (
          <article key={c.id}>
            <span className="status-pill">
              {c.status === 'active' ? '營運中' : '已停用'}
            </span>
            <h2>{c.name}</h2>
            <p>
              {c.status === 'active'
                ? '查看集單、採購與面交摘要。'
                : '仍可查看歷史營運資料。'}
            </p>
            <Link
              className="button-link secondary"
              href={`/admin/communities/${c.id}`}
            >
              進入營運工作台
            </Link>
          </article>
        ))}
      </div>
      {!data.communities.length && (
        <p className="admin-empty">目前沒有可管理的社區。</p>
      )}
    </>
  );
}
