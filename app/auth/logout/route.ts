import { getProductionAuth } from '@/server/auth/runtime.ts';

export async function POST(request: Request): Promise<Response> {
  const signedOut = await getProductionAuth().api.signOut({ headers: request.headers, asResponse: true });
  const response = new Response(null, { status: 303, headers: { location: '/' } });
  for (const value of signedOut.headers.getSetCookie()) response.headers.append('set-cookie', value);
  return response;
}
