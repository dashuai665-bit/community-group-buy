'use client';

import { BadgeCheck, Mail, Phone, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ClientApiError, loginPath } from '@/lib/client-api';
import { safeOnboardingReturnTo } from '@/server/auth/redirect.ts';
import { ErrorState, LoadingState } from './states';

type Profile = {
  displayName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  profileComplete: boolean;
};

function currentReturnTo(): string {
  return safeOnboardingReturnTo(
    new URLSearchParams(window.location.search).get('returnTo'),
  );
}

function onboardingLoginPath(returnTo: string): string {
  const onboarding = `/onboarding?returnTo=${encodeURIComponent(returnTo)}`;
  return loginPath(onboarding);
}

export function OnboardingView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const returnTo = typeof window === 'undefined' ? '/' : currentReturnTo();

  useEffect(() => {
    api<{ profile: Profile }>('/api/me/profile')
      .then(({ profile: loaded }) => {
        if (loaded.profileComplete) {
          window.location.replace(returnTo);
          return;
        }
        setProfile(loaded);
        setDisplayName(loaded.displayName ?? '');
        setPhone(loaded.phone ?? '');
      })
      .catch((reason) => {
        if (reason instanceof ClientApiError && reason.status === 401) {
          window.location.replace(onboardingLoginPath(returnTo));
          return;
        }
        setError(
          reason instanceof Error ? reason.message : '目前無法載入會員資料',
        );
      });
  }, [returnTo]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;

    const normalizedName = displayName.trim();
    const normalizedPhone = phone.trim();
    if (!normalizedName || normalizedName.length > 80) {
      setError('請輸入 1 至 80 個字的姓名。');
      return;
    }
    if (!/^0[0-9]{8,9}$/.test(normalizedPhone)) {
      setError('請輸入有效的 9 至 10 位數聯絡電話。');
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/api/me/profile/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: normalizedName,
          phone: normalizedPhone,
        }),
      });
      window.location.assign(returnTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目前無法完成會員資料');
      submitting.current = false;
      setBusy(false);
    }
  };

  if (error && !profile) return <ErrorState message={error} />;
  if (!profile) return <LoadingState label="正在確認會員資料…" />;

  return (
    <form className="onboarding-card" onSubmit={submit} noValidate>
      <div className="onboarding-field">
        <label htmlFor="onboarding-email">
          <Mail aria-hidden="true" /> 登入 Email
        </label>
        <input
          id="onboarding-email"
          type="email"
          value={profile.email ?? ''}
          readOnly
          aria-readonly="true"
        />
        {profile.emailVerified && (
          <span className="verified-note">
            <BadgeCheck aria-hidden="true" /> Email 已驗證
          </span>
        )}
      </div>

      <div className="onboarding-field">
        <label htmlFor="onboarding-display-name">
          <UserRound aria-hidden="true" /> 姓名／顯示名稱
        </label>
        <input
          id="onboarding-display-name"
          autoComplete="name"
          maxLength={80}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
        <small>供取貨與訂單辨識使用。</small>
      </div>

      <div className="onboarding-field">
        <label htmlFor="onboarding-phone">
          <Phone aria-hidden="true" /> 聯絡電話
        </label>
        <input
          id="onboarding-phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="例如：0912345678"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
        <small>目前僅作為訂單聯絡使用，不進行手機驗證。</small>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button className="primary-action" type="submit" disabled={busy}>
        {busy ? '儲存中…' : '完成會員資料'}
      </button>
    </form>
  );
}
