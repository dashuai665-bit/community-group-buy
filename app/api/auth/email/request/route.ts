import { handleEmailMagicLinkRequest } from '@/server/auth/email-magic-link.ts';
import { getEmailMagicLinkService } from '@/server/auth/runtime.ts';

export async function POST(request: Request) {
  return handleEmailMagicLinkRequest(request, getEmailMagicLinkService());
}
