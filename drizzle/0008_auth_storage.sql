-- Better Auth internal storage only. Application identity remains users + user_identities.
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX auth_users_email_unique ON auth_users(email);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX auth_sessions_token_unique ON auth_sessions(token);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER, scope TEXT, password TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX auth_accounts_provider_account_unique ON auth_accounts(provider_id, account_id);
CREATE INDEX auth_accounts_user_idx ON auth_accounts(user_id);
CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);
