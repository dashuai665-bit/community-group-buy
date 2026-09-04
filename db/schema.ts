import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  communityId: text('community_id').references(() => communities.id, { onDelete: 'restrict' }),
  actionType: text('action_type').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt),
  index('audit_logs_community_created_idx').on(table.communityId, table.createdAt),
  check('audit_logs_action_type_check', sql`${table.actionType} IN ('community_join', 'community_leave', 'default_community_change', 'identity_link', 'identity_unlink', 'admin_member_contact_access', 'product_created', 'offering_created', 'offering_updated', 'batch_formed', 'wish_created', 'wish_status_changed', 'order_created', 'order_cancelled', 'admin_order_cancelled', 'order_status_changed', 'pickup_created', 'pickup_ready', 'pickup_completed')`),
]);

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sourceType: text('source_type').notNull().default('manual'),
  sourceReference: text('source_reference'),
  unitLabel: text('unit_label').notNull(),
  imageUrl: text('image_url'),
  status: text('status').notNull().default('active'),
  ...timestamps,
}, (table) => [
  check('products_source_type_check', sql`${table.sourceType} IN ('manual', 'costco', 'supplier', 'overseas', 'other')`),
  check('products_status_check', sql`${table.status} IN ('active', 'inactive', 'archived')`),
]);

export const communityProductOfferings = sqliteTable('community_product_offerings', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'restrict' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('active'),
  priceMinor: integer('price_minor').notNull(),
  currency: text('currency').notNull().default('TWD'),
  batchThreshold: integer('batch_threshold').notNull(),
  minQuantityPerOrder: integer('min_quantity_per_order').notNull().default(1),
  maxQuantityPerOrder: integer('max_quantity_per_order'),
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  ...timestamps,
}, (table) => [
  uniqueIndex('community_product_offerings_community_product_unique').on(table.communityId, table.productId),
  index('community_product_offerings_community_status_idx').on(table.communityId, table.status),
  check('community_product_offerings_status_check', sql`${table.status} IN ('active', 'paused', 'ended')`),
  check('community_product_offerings_price_check', sql`${table.priceMinor} > 0`),
  check('community_product_offerings_threshold_check', sql`${table.batchThreshold} > 0`),
  check('community_product_offerings_min_check', sql`${table.minQuantityPerOrder} > 0`),
  check('community_product_offerings_max_check', sql`${table.maxQuantityPerOrder} IS NULL OR ${table.maxQuantityPerOrder} >= ${table.minQuantityPerOrder}`),
]);

export const groupBuyBatches = sqliteTable('group_buy_batches', {
  id: text('id').primaryKey(),
  offeringId: text('offering_id').notNull().references(() => communityProductOfferings.id, { onDelete: 'restrict' }),
  sequenceNumber: integer('sequence_number').notNull(),
  status: text('status').notNull().default('open'),
  thresholdQuantity: integer('threshold_quantity').notNull(),
  committedQuantity: integer('committed_quantity').notNull().default(0),
  openedAt: text('opened_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  formedAt: text('formed_at'),
  closedAt: text('closed_at'),
  ...timestamps,
}, (table) => [
  uniqueIndex('group_buy_batches_offering_sequence_unique').on(table.offeringId, table.sequenceNumber),
  index('group_buy_batches_offering_status_idx').on(table.offeringId, table.status),
  check('group_buy_batches_status_check', sql`${table.status} IN ('open', 'formed', 'locked', 'closed', 'cancelled')`),
  check('group_buy_batches_sequence_check', sql`${table.sequenceNumber} > 0`),
  check('group_buy_batches_threshold_check', sql`${table.thresholdQuantity} > 0`),
  check('group_buy_batches_committed_check', sql`${table.committedQuantity} >= 0 AND ${table.committedQuantity} <= ${table.thresholdQuantity}`),
]);

export const productWishes = sqliteTable('product_wishes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'restrict' }),
  productId: text('product_id').references(() => products.id, { onDelete: 'restrict' }),
  wishText: text('wish_text'),
  status: text('status').notNull().default('open'),
  ...timestamps,
}, (table) => [
  index('product_wishes_user_status_idx').on(table.userId, table.status),
  index('product_wishes_community_status_idx').on(table.communityId, table.status),
  check('product_wishes_status_check', sql`${table.status} IN ('open', 'reviewing', 'fulfilled', 'rejected')`),
  check('product_wishes_content_check', sql`${table.productId} IS NOT NULL OR COALESCE(length(trim(${table.wishText})), 0) > 0`),
]);

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('submitted'),
  currency: text('currency').notNull().default('TWD'),
  estimatedTotalMinor: integer('estimated_total_minor').notNull(),
  actualTotalMinor: integer('actual_total_minor'),
  idempotencyKey: text('idempotency_key').notNull(),
  contactNameSnapshot: text('contact_name_snapshot').notNull(),
  contactPhoneSnapshot: text('contact_phone_snapshot').notNull(),
  submittedAt: text('submitted_at').default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: text('cancelled_at'),
  cancelReason: text('cancel_reason'),
  cancelledByUserId: text('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  completedAt: text('completed_at'),
  ...timestamps,
}, (table) => [
  uniqueIndex('orders_user_idempotency_unique').on(table.userId, table.idempotencyKey),
  index('orders_user_created_idx').on(table.userId, table.createdAt),
  index('orders_community_status_idx').on(table.communityId, table.status),
  check('orders_status_check', sql`${table.status} IN ('pending', 'submitted', 'partially_formed', 'formed', 'ready_for_pickup', 'completed', 'cancelled')`),
  check('orders_estimated_total_check', sql`${table.estimatedTotalMinor} > 0`),
  check('orders_actual_total_check', sql`${table.actualTotalMinor} IS NULL OR ${table.actualTotalMinor} >= 0`),
]);

export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  offeringId: text('offering_id').notNull().references(() => communityProductOfferings.id, { onDelete: 'restrict' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  unitLabelSnapshot: text('unit_label_snapshot').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  quantity: integer('quantity').notNull(),
  estimatedSubtotalMinor: integer('estimated_subtotal_minor').notNull(),
  actualUnitPriceMinor: integer('actual_unit_price_minor'),
  actualSubtotalMinor: integer('actual_subtotal_minor'),
  ...timestamps,
}, (table) => [
  uniqueIndex('order_items_order_offering_unique').on(table.orderId, table.offeringId),
  index('order_items_order_idx').on(table.orderId),
  check('order_items_price_check', sql`${table.unitPriceMinor} > 0`),
  check('order_items_quantity_check', sql`${table.quantity} > 0`),
  check('order_items_subtotal_check', sql`${table.estimatedSubtotalMinor} = ${table.unitPriceMinor} * ${table.quantity}`),
]);

export const batchCommitments = sqliteTable('batch_commitments', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  batchId: text('batch_id').notNull().references(() => groupBuyBatches.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  sourceType: text('source_type').notNull().default('reservation'),
  sourceReference: text('source_reference'),
  orderItemId: text('order_item_id').references(() => orderItems.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('active'),
  cancelledAt: text('cancelled_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex('batch_commitments_request_batch_unique').on(table.requestId, table.batchId),
  index('batch_commitments_batch_idx').on(table.batchId),
  index('batch_commitments_order_item_status_idx').on(table.orderItemId, table.status),
  check('batch_commitments_quantity_check', sql`${table.quantity} > 0`),
  check('batch_commitments_source_check', sql`${table.sourceType} IN ('reservation', 'order_item')`),
  check('batch_commitments_status_check', sql`${table.status} IN ('active', 'cancelled')`),
  check('batch_commitments_order_item_check', sql`(${table.sourceType} = 'order_item' AND ${table.orderItemId} IS NOT NULL) OR (${table.sourceType} = 'reservation' AND ${table.orderItemId} IS NULL)`),
]);

export const purchaseBatches = sqliteTable('purchase_batches', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('ready'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  purchasingStartedByUserId: text('purchasing_started_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  purchasingStartedAt: text('purchasing_started_at'),
  ...timestamps,
}, (table) => [
  uniqueIndex('purchase_batches_community_idempotency_unique').on(table.communityId, table.idempotencyKey),
  index('purchase_batches_community_status_idx').on(table.communityId, table.status),
  check('purchase_batches_status_check', sql`${table.status} IN ('ready', 'purchasing')`),
]);

export const purchaseBatchGroups = sqliteTable('purchase_batch_groups', {
  purchaseBatchId: text('purchase_batch_id').notNull().references(() => purchaseBatches.id, { onDelete: 'restrict' }),
  groupBuyBatchId: text('group_buy_batch_id').primaryKey().references(() => groupBuyBatches.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('purchase_batch_groups_purchase_batch_idx').on(table.purchaseBatchId),
]);

export const pickupRecords = sqliteTable('pickup_records', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('pending'),
  scheduledAt: text('scheduled_at'),
  readyAt: text('ready_at'),
  pickedUpAt: text('picked_up_at'),
  ...timestamps,
}, (table) => [
  uniqueIndex('pickup_records_order_unique').on(table.orderId),
  index('pickup_records_community_status_idx').on(table.communityId, table.status),
  check('pickup_records_status_check', sql`${table.status} IN ('pending', 'ready', 'picked_up', 'cancelled')`),
]);
