import { getProductionAuth } from '@/server/auth/runtime.ts';
import { safeReturnTo } from '@/server/auth/redirect.ts';

export async function GET(request: Request): Promise<Response> {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
  const response = await getProductionAuth().api.signInSocial({
    body: { provider: 'google', callbackURL: returnTo, errorCallbackURL: '/' },
    headers: request.headers,
    asResponse: true,
  });
  return response;
}
