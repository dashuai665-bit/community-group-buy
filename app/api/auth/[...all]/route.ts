import { handleProductionAuth } from '@/server/auth/better-auth.ts';
import { getProductionAuth } from '@/server/auth/runtime.ts';

export const GET = (request: Request) => handleProductionAuth(getProductionAuth(), request);
export const POST = (request: Request) => {
  if (new URL(request.url).pathname === '/api/auth/sign-in/magic-link') {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return handleProductionAuth(getProductionAuth(), request);
};
