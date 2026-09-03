export interface PrivateCommunityMemberRecord {
  id: string;
  userId: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  identityMetadata: Record<string, unknown> | null;
}

export interface PublicCommunityMember { id: string; userId: string; displayName: string | null }

export function serializePublicCommunityMember(member: PrivateCommunityMemberRecord): PublicCommunityMember {
  return { id: member.id, userId: member.userId, displayName: member.displayName };
}

export function maskPhone(phone: string): string {
  const normalized = phone.trim();
  if (normalized.length <= 4) return '*'.repeat(normalized.length);
  if (normalized.length <= 7) return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  return `${normalized.slice(0, 4)}***${normalized.slice(-3)}`;
}

const forbiddenLogKeys = new Set([
  'accesstoken', 'refreshtoken', 'oauthtoken', 'otp', 'sessiontoken', 'identitymetadata',
]);

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
    const normalizedKey = key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
    if (forbiddenLogKeys.has(normalizedKey)) return [];
    if (normalizedKey === 'phone' && typeof value === 'string') return [[key, maskPhone(value)]];
    return [[key, value]];
  }));
}
