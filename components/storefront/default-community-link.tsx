'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client-api';

export function DefaultCommunityLink() {
  const [communityId, setCommunityId] = useState<string | null>(null);

  useEffect(() => {
    api<{ profile: { defaultCommunityId: string | null } }>('/api/me/profile')
      .then(({ profile }) => setCommunityId(profile.defaultCommunityId))
      .catch(() => undefined);
  }, []);

  if (!communityId) return null;
  return <Link className="quiet-link" href={`/communities/${communityId}`}>前往我的預設社區</Link>;
}
