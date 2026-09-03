import { sql } from 'drizzle-orm';
import { check, foreignKey, index, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('active'),
  ...timestamps,
}, (table) => [
  check('users_status_check', sql`${table.status} IN ('active', 'suspended', 'deleted')`),
]);

export const communities = sqliteTable('communities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('active'),
  joinPolicy: text('join_policy').notNull().default('open'),
  ...timestamps,
}, (table) => [
  uniqueIndex('communities_slug_unique').on(table.slug),
  check('communities_status_check', sql`${table.status} IN ('active', 'inactive')`),
  check('communities_join_policy_check', sql`${table.joinPolicy} IN ('open', 'approval_required', 'invite_only')`),
]);

export const communityMembers = sqliteTable('community_members', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'restrict' }),
  role: text('role').notNull().default('resident'),
  status: text('status').notNull().default('active'),
  joinedAt: text('joined_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  ...timestamps,
}, (table) => [
  uniqueIndex('community_members_user_community_unique').on(table.userId, table.communityId),
  index('community_members_community_status_idx').on(table.communityId, table.status),
  check('community_members_role_check', sql`${table.role} IN ('resident', 'community_admin')`),
  check('community_members_status_check', sql`${table.status} IN ('active', 'inactive')`),
]);

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'restrict' }),
  displayName: text('display_name'),
  phone: text('phone'),
  phoneVerified: text('phone_verified').notNull().default('false'),
  email: text('email'),
  emailVerified: text('email_verified').notNull().default('false'),
  defaultCommunityId: text('default_community_id').references(() => communities.id, { onDelete: 'restrict' }),
  ...timestamps,
}, (table) => [
  foreignKey({
    name: 'user_profiles_default_membership_fk',
    columns: [table.userId, table.defaultCommunityId],
    foreignColumns: [communityMembers.userId, communityMembers.communityId],
  }),
  check('user_profiles_phone_verified_check', sql`${table.phoneVerified} IN ('true', 'false')`),
  check('user_profiles_email_verified_check', sql`${table.emailVerified} IN ('true', 'false')`),
]);

export const userIdentities = sqliteTable('user_identities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  verified: text('verified').notNull().default('false'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text('last_login_at'),
}, (table) => [
  uniqueIndex('user_identities_provider_user_unique').on(table.provider, table.providerUserId),
  index('user_identities_user_idx').on(table.userId),
  check('user_identities_provider_check', sql`${table.provider} IN ('phone', 'line', 'google', 'email', 'chatgpt')`),
  check('user_identities_verified_check', sql`${table.verified} IN ('true', 'false')`),
]);

export const platformRoles = sqliteTable('platform_roles', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: text('role').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.role] }),
  check('platform_roles_role_check', sql`${table.role} IN ('platform_admin')`),
]);
