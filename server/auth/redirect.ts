export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const parsed = new URL(value, 'https://local.invalid');
    return parsed.origin === 'https://local.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/';
  } catch {
    return '/';
  }
}

const emailContinuationPathname = '/auth/email/continue';

function safeReturnToWithoutLoops(
  value: string | null | undefined,
  blockedPathnames: readonly string[],
): string {
  const returnTo = safeReturnTo(value);
  let decoded: string;
  try {
    decoded = decodeURIComponent(returnTo);
    if (decoded.includes('\\') || decoded.startsWith('//')) return '/';
  } catch {
    return '/';
  }
  const pathname = new URL(decoded, 'https://local.invalid').pathname;
  return blockedPathnames.some(
    (blocked) => pathname === blocked || pathname.startsWith(`${blocked}/`),
  )
    ? '/'
    : returnTo;
}

export function safeEmailContinuationReturnTo(
  value: string | null | undefined,
): string {
  return safeReturnToWithoutLoops(value, [emailContinuationPathname]);
}

export function safeOnboardingReturnTo(
  value: string | null | undefined,
): string {
  return safeReturnToWithoutLoops(value, [
    '/onboarding',
    emailContinuationPathname,
  ]);
}

export function emailContinuationPath(returnTo: string): string {
  return `${emailContinuationPathname}?returnTo=${encodeURIComponent(
    safeEmailContinuationReturnTo(returnTo),
  )}`;
}
