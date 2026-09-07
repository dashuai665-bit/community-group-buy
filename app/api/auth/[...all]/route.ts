import { handleProductionAuth } from '@/server/auth/better-auth.ts';
import { getProductionAuth } from '@/server/auth/runtime.ts';

export const GET = (request: Request) => handleProductionAuth(getProductionAuth(), request);
export const POST = (request: Request) => handleProductionAuth(getProductionAuth(), request);
