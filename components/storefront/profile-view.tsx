'use client';
import { AppLink as Link } from './app-link';
import { BadgeCheck, Building2, Heart, Phone, ShieldAlert, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ClientApiError, loginPath } from '@/lib/client-api';
import { ErrorState, LoadingState } from './states';

type Profile = {
  displayName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  defaultCommunityId: string | null;
};

export function ProfileView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<{ profile: Profile }>('/api/me/profile')
    .then(({ profile: next }) => {
      setProfile(next);
      setDisplayName(next.displayName ?? '');
      setPhone(next.phone ?? '');
    })
    .catch((reason) => {
      if (reason instanceof ClientApiError && reason.status === 401) {
        location.href = loginPath('/profile');
        return;
      }
      setError(reason instanceof Error ? reason.message : '載入失敗');
    });

  useEffect(() => { void load(); }, []);
  if (error) return <ErrorState message={error} />;
  if (!profile) return <LoadingState label="正在載入會員資料…" />;

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      await api('/api/me/profile/display-name', { method: 'PUT', body: JSON.stringify({ displayName }) });
      await load();
      setMessage('姓名已更新。');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '更新失敗');
    } finally { setBusy(false); }
  };

  const savePhone = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      await api('/api/me/profile/phone', { method: 'PUT', body: JSON.stringify({ phone }) });
      await load();
      setMessage('電話已更新；若號碼有變更，需重新完成驗證。');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '更新失敗');
    } finally { setBusy(false); }
  };

  return <>
    <article className="profile-card">
      <div className="avatar-large">{profile.displayName?.slice(0, 1) || '鄰'}</div>
      <div>
        <p className="eyebrow">會員資料</p>
        <h2>{profile.displayName || '尚未填寫姓名'}</h2>
        <p>{profile.email || '以平台身份登入'}</p>
        <span className={`status-pill ${profile.phoneVerified ? 'verified' : 'unverified'}`}>
          {profile.phoneVerified ? <><BadgeCheck /> 電話已驗證</> : <><ShieldAlert /> 電話尚未驗證</>}
        </span>
      </div>
    </article>

    {!profile.displayName && <p className="info-note" role="status">完成姓名與聯絡電話後即可下單。</p>}

    <form className="settings-card" onSubmit={saveName}>
      <label htmlFor="display-name"><UserRound /> 姓名／顯示名稱</label>
      <div className="inline-form">
        <input id="display-name" autoComplete="name" minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        <button disabled={busy}>{busy ? '儲存中…' : '更新姓名'}</button>
      </div>
    </form>

    <form className="settings-card" onSubmit={savePhone}>
      <label htmlFor="phone"><Phone /> 聯絡電話</label>
      <div className="inline-form">
        <input id="phone" inputMode="tel" autoComplete="tel" pattern="0[0-9]{8,9}" value={phone} onChange={(event) => setPhone(event.target.value)} required />
        <button disabled={busy}>{busy ? '儲存中…' : '更新電話'}</button>
      </div>
    </form>

    {message && <p role="status" className="form-message">{message}</p>}

    <div className="profile-links">
      <Link href="/profile/communities"><Building2 /><span><strong>我的社區</strong><small>目前瀏覽與預設社區設定</small></span></Link>
      <Link href="/profile/wishes"><Heart /><span><strong>我的願望</strong><small>查看希望社區上架的商品</small></span></Link>
    </div>
  </>;
}
