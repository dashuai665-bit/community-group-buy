import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  if (request.nextUrl.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = { matcher: '/:path*' };
