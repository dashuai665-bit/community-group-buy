'use client';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ClientApiError, loginPath } from '@/lib/client-api';
import { EmptyState, ErrorState, LoadingState } from './states';

type Community = { id: string; name: string; status: string; joinPolicy: string };

export function AdminLanding() {
  const [items, setItems] = useState<Community[] | null>(null);
  const [platform, setPlatform] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ isPlatformAdmin: boolean; communities: Community[] }>('/api/admin/communities')
      .then((result) => { setPlatform(result.isPlatformAdmin); setItems(result.communities); })
      .catch((reason) => {
        if (reason instanceof ClientApiError && reason.status === 401) {
          location.href = loginPath('/admin');
          return;
        }
        setError(reason instanceof Error ? reason.message : '載入失敗');
      });
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!items) return <LoadingState />;
  if (!items.length && !platform) return <ErrorState message="你的帳戶沒有社區管理權限。" />;

  return <>
    {platform && <div className="platform-banner"><Settings2 /><div><strong>平台管理員</strong><p>以下列出平台目前所有社區；完整採購管理將在後續階段提供。</p></div></div>}
    <div className="admin-grid">
      {items.map((community) => <article key={community.id}>
        <p className="eyebrow">{platform ? '平台可管理社區' : '可管理社區'}</p>
        <h2>{community.name}</h2>
        <p>{community.status === 'active' ? '查看訂單、願望與取貨狀態。' : '此社區目前已停用。'}</p>
        {community.status === 'active' ? <Link className="button-link secondary" href={`/communities/${community.id}`}>查看社區前台</Link> : <span className="status-pill">已停用</span>}
      </article>)}
    </div>
    {!items.length && platform && <EmptyState title="目前沒有社區" description="建立社區後會顯示在這裡。" />}
  </>;
}
