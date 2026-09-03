export type DomainErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'USER_INACTIVE'
  | 'COMMUNITY_INACTIVE'
  | 'MEMBERSHIP_REQUIRED'
  | 'COMMUNITY_ADMIN_REQUIRED'
  | 'PLATFORM_ADMIN_REQUIRED'
  | 'MEMBERSHIP_EXISTS'
  | 'JOIN_REQUIRES_APPROVAL'
  | 'JOIN_REQUIRES_INVITE'
  | 'LEAVE_BLOCKED'
  | 'IDENTITY_EXISTS'
  | 'LAST_LOGIN_IDENTITY'
  | 'IDENTITY_NOT_OWNED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DomainError';
  }
}
