import { ApiError, errorResponse } from '../api-error.ts';
import type { Repositories } from '../repositories/index.ts';
import {
  IdentityService,
  isProfileComplete,
  requireActiveUser,
  type AuthenticatedProviderIdentity,
} from '../services/index.ts';
import { safeEmailContinuationReturnTo } from './redirect.ts';

export interface ContinuationAuthentication {
  authenticate(request: Request): Promise<AuthenticatedProviderIdentity | null>;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function loginPath(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function onboardingPath(returnTo: string): string {
  return `/onboarding?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function handleEmailContinuation(
  request: Request,
  repositories: Repositories,
  authentication: ContinuationAuthentication,
): Promise<Response> {
  const returnTo = safeEmailContinuationReturnTo(
    new URL(request.url).searchParams.get('returnTo'),
  );
  const identity = await authentication.authenticate(request);
  if (!identity) return redirect(loginPath(returnTo));

  try {
    const userId = await new IdentityService(repositories).resolveAppUser(identity);
    const actor = await requireActiveUser(repositories, userId);
    const profile = await repositories.profiles.findByUserId(actor.id);
    if (!profile) {
      throw new ApiError(404, 'PROFILE_NOT_FOUND', '找不到會員資料');
    }
    return redirect(
      isProfileComplete(profile) ? returnTo : onboardingPath(returnTo),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
