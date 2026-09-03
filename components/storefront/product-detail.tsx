'use client';
import Link from 'next/link';
import { Minus, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ClientApiError, loginPath } from '@/lib/client-api';
import { createIdempotencyKey, formatMoney } from '@/lib/storefront';
import { BatchProgress } from './batch-progress';
import { ErrorState, LoadingState } from './states';
import type { Offering } from './product-card';

type Profile = { displayName: string | null; phone: string | null };

export function ProductDetail({ offeringId, communityId }: { offeringId: string; communityId: string }) {
  const [item, setItem] = useState<Offering | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [member, setMember] = useState<boolean | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(createIdempotencyKey());

  useEffect(() => {
    api<{ offering: Offering }>(`/api/communities/${communityId}/products/${offeringId}`)
      .then(({ offering }) => { setItem(offering); setQuantity(offering.min_quantity_per_order); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '載入失敗'));
    Promise.all([
      api<{ profile: Profile }>('/api/me/profile'),
      api<{ memberships: { community: { id: string } }[] }>('/api/me/communities'),
    ]).then(([profileResult, membershipResult]) => {
      setProfile(profileResult.profile);
      setMember(membershipResult.memberships.some(({ community }) => community.id === communityId));
    }).catch(() => setMember(false));
  }, [communityId, offeringId]);

  if (error) return <ErrorState message={error} />;
  if (!item) return <LoadingState label="正在載入商品…" />;
  const maximum = item.max_quantity_per_order ?? 99;
  const order = async () => {
    if (profile === null) { location.href = loginPath(`/products/${offeringId}?community=${communityId}`); return; }
    if (!member) { setError('請先加入這個社區，再開始湊單。'); return; }
    if (!profile.displayName || !profile.phone) { location.href = '/profile?complete=1'; return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ order: { id: string } }>('/api/orders', { method: 'POST', body: JSON.stringify({ communityId, idempotencyKey: key.current, items: [{ offeringId, quantity }] }) });
      location.href = `/orders/${result.order.id}/success`;
    } catch (reason) {
      setError(reason instanceof ClientApiError ? reason.message : '下單暫時失敗，請使用相同頁面重試。');
      setBusy(false);
    }
  };
  return <div className="detail-layout"><div className="detail-image">{item.image_url ? <img src={item.image_url} alt={item.name} /> : <span aria-hidden="true">湊</span>}</div><article className="detail-card"><p className="eyebrow">社區限定供應</p><h1>{item.name}</h1><p className="detail-description">{item.description || '社區一起湊，份量剛好、取貨方便。'}</p><p className="price">{formatMoney(item.price_minor, item.currency)} <small>/ {item.unit_label}</small></p><BatchProgress sequence={item.sequence_number} committed={item.committed_quantity} threshold={item.threshold_quantity} status={item.batch_status} /><div className="quantity-field"><span id="quantity-label">數量</span><div className="stepper" role="group" aria-labelledby="quantity-label"><button aria-label="減少數量" onClick={() => setQuantity(Math.max(item.min_quantity_per_order, quantity - 1))}><Minus /></button><input aria-label="購買數量" type="number" value={quantity} min={item.min_quantity_per_order} max={maximum} onChange={(event) => setQuantity(Math.min(maximum, Math.max(item.min_quantity_per_order, Number(event.target.value))))} /><button aria-label="增加數量" onClick={() => setQuantity(Math.min(maximum, quantity + 1))}><Plus /></button></div><small>每次 {item.min_quantity_per_order}–{maximum} {item.unit_label}</small></div><div className="checkout-summary"><span>預估小計</span><strong>{formatMoney(item.price_minor * quantity, item.currency)}</strong></div>{profile && <div className="contact-preview"><ShieldCheck /><span>聯絡人：{profile.displayName || '尚未填寫'} · {profile.phone || '尚未填寫'}</span></div>}<button className="primary-action" disabled={busy} onClick={() => void order()}>{busy ? '訂單建立中…' : '加入湊單'}</button><p className="payment-note">此步驟只建立預估訂單，尚未付款。</p><Link className="quiet-link" href={`/communities/${communityId}`}>返回社區商品</Link></article></div>;
}
