-- Offline canonical schema at ca7c42b. Not a production migration.
-- Extracted from sqlite_master after unmodified historical 0000 through 0007.
-- No seed data; do not copy into drizzle/.
PRAGMA foreign_keys = ON;

CREATE TABLE "audit_logs" (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`community_id` text,
	`action_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audit_logs_action_type_check" CHECK("audit_logs"."action_type" IN ('community_join', 'community_leave', 'default_community_change', 'identity_link', 'identity_unlink', 'admin_member_contact_access', 'product_created', 'offering_created', 'offering_updated', 'batch_formed', 'wish_created', 'wish_status_changed', 'order_created', 'order_cancelled', 'admin_order_cancelled', 'order_status_changed', 'pickup_created', 'pickup_ready', 'pickup_completed'))
);

CREATE TABLE "batch_commitments" (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`source_type` text DEFAULT 'reservation' NOT NULL,
	`source_reference` text,
	`order_item_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`cancelled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `group_buy_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "batch_commitments_quantity_check" CHECK("batch_commitments"."quantity" > 0),
	CONSTRAINT "batch_commitments_source_check" CHECK("batch_commitments"."source_type" IN ('reservation', 'order_item')),
	CONSTRAINT "batch_commitments_status_check" CHECK("batch_commitments"."status" IN ('active', 'cancelled')),
	CONSTRAINT "batch_commitments_order_item_check" CHECK(("batch_commitments"."source_type" = 'order_item' AND "batch_commitments"."order_item_id" IS NOT NULL) OR ("batch_commitments"."source_type" = 'reservation' AND "batch_commitments"."order_item_id" IS NULL))
);

CREATE TABLE `cash_payments` (
  `order_id` text PRIMARY KEY NOT NULL,
  `community_id` text NOT NULL,
  `amount_minor` integer NOT NULL CHECK(`amount_minor` > 0),
  `method` text NOT NULL DEFAULT 'cash' CHECK(`method` = 'cash'),
  `status` text NOT NULL DEFAULT 'paid' CHECK(`status` = 'paid'),
  `confirmed_by_user_id` text NOT NULL,
  `confirmed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);

CREATE TABLE `communities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`join_policy` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "communities_status_check" CHECK("communities"."status" IN ('active', 'inactive')),
	CONSTRAINT "communities_join_policy_check" CHECK("communities"."join_policy" IN ('open', 'approval_required', 'invite_only'))
);

CREATE TABLE `community_members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`community_id` text NOT NULL,
	`role` text DEFAULT 'resident' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "community_members_role_check" CHECK("community_members"."role" IN ('resident', 'community_admin')),
	CONSTRAINT "community_members_status_check" CHECK("community_members"."status" IN ('active', 'inactive'))
);

CREATE TABLE `community_product_offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`product_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'TWD' NOT NULL,
	`batch_threshold` integer NOT NULL,
	`min_quantity_per_order` integer DEFAULT 1 NOT NULL,
	`max_quantity_per_order` integer,
	`starts_at` text,
	`ends_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "community_product_offerings_status_check" CHECK("community_product_offerings"."status" IN ('active', 'paused', 'ended')),
	CONSTRAINT "community_product_offerings_price_check" CHECK("community_product_offerings"."price_minor" > 0),
	CONSTRAINT "community_product_offerings_threshold_check" CHECK("community_product_offerings"."batch_threshold" > 0),
	CONSTRAINT "community_product_offerings_min_check" CHECK("community_product_offerings"."min_quantity_per_order" > 0),
	CONSTRAINT "community_product_offerings_max_check" CHECK("community_product_offerings"."max_quantity_per_order" IS NULL OR "community_product_offerings"."max_quantity_per_order" >= "community_product_offerings"."min_quantity_per_order")
);

CREATE TABLE "group_buy_batches" (
	`id` text PRIMARY KEY NOT NULL,
	`offering_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`threshold_quantity` integer NOT NULL,
	`committed_quantity` integer DEFAULT 0 NOT NULL,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`formed_at` text,
	`closed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `community_product_offerings`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "group_buy_batches_status_check" CHECK("group_buy_batches"."status" IN ('open', 'formed', 'locked', 'closed', 'cancelled')),
	CONSTRAINT "group_buy_batches_sequence_check" CHECK("group_buy_batches"."sequence_number" > 0),
	CONSTRAINT "group_buy_batches_threshold_check" CHECK("group_buy_batches"."threshold_quantity" > 0),
	CONSTRAINT "group_buy_batches_committed_check" CHECK("group_buy_batches"."committed_quantity" >= 0 AND "group_buy_batches"."committed_quantity" <= "group_buy_batches"."threshold_quantity")
);

CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`offering_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`unit_label_snapshot` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`estimated_subtotal_minor` integer NOT NULL,
	`actual_unit_price_minor` integer,
	`actual_subtotal_minor` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`offering_id`) REFERENCES `community_product_offerings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_items_price_check" CHECK("order_items"."unit_price_minor" > 0),
	CONSTRAINT "order_items_quantity_check" CHECK("order_items"."quantity" > 0),
	CONSTRAINT "order_items_subtotal_check" CHECK("order_items"."estimated_subtotal_minor" = "order_items"."unit_price_minor" * "order_items"."quantity")
);

CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`community_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`currency` text DEFAULT 'TWD' NOT NULL,
	`estimated_total_minor` integer NOT NULL,
	`actual_total_minor` integer,
	`idempotency_key` text NOT NULL,
	`contact_name_snapshot` text NOT NULL,
	`contact_phone_snapshot` text NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP,
	`cancelled_at` text,
	`cancel_reason` text,
	`cancelled_by_user_id` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" IN ('pending', 'submitted', 'partially_formed', 'formed', 'ready_for_pickup', 'completed', 'cancelled')),
	CONSTRAINT "orders_estimated_total_check" CHECK("orders"."estimated_total_minor" > 0),
	CONSTRAINT "orders_actual_total_check" CHECK("orders"."actual_total_minor" IS NULL OR "orders"."actual_total_minor" >= 0)
);

CREATE TABLE `pickup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`community_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_at` text,
	`ready_at` text,
	`picked_up_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `pickup_location_snapshot` text, `pickup_window_snapshot` text, `handed_over_by_user_id` text REFERENCES `users`(`id`) ON DELETE RESTRICT,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pickup_records_status_check" CHECK("pickup_records"."status" IN ('pending', 'ready', 'picked_up', 'cancelled'))
);

CREATE TABLE `platform_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "platform_roles_role_check" CHECK("platform_roles"."role" IN ('platform_admin'))
);

CREATE TABLE `product_wishes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`community_id` text NOT NULL,
	`product_id` text,
	`wish_text` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "product_wishes_status_check" CHECK("product_wishes"."status" IN ('open', 'reviewing', 'fulfilled', 'rejected')),
	CONSTRAINT "product_wishes_content_check" CHECK("product_wishes"."product_id" IS NOT NULL OR COALESCE(length(trim("product_wishes"."wish_text")), 0) > 0)
);

CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_reference` text,
	`unit_label` text NOT NULL,
	`image_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "products_source_type_check" CHECK("products"."source_type" IN ('manual', 'costco', 'supplier', 'overseas', 'other')),
	CONSTRAINT "products_status_check" CHECK("products"."status" IN ('active', 'inactive', 'archived'))
);

CREATE TABLE `purchase_allocations` (
  `batch_commitment_id` text PRIMARY KEY NOT NULL,
  `purchase_batch_id` text NOT NULL,
  `group_buy_batch_id` text NOT NULL,
  `order_item_id` text NOT NULL,
  `committed_quantity_snapshot` integer NOT NULL CHECK(`committed_quantity_snapshot` > 0),
  `fulfilled_quantity` integer NOT NULL CHECK(`fulfilled_quantity` >= 0 AND `fulfilled_quantity` <= `committed_quantity_snapshot`),
  `shortage_quantity` integer NOT NULL CHECK(`shortage_quantity` = `committed_quantity_snapshot` - `fulfilled_quantity`),
  `final_amount_minor` integer NOT NULL CHECK(`final_amount_minor` >= 0),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`purchase_batch_id`) REFERENCES `purchase_batch_finalizations`(`purchase_batch_id`) ON DELETE RESTRICT,
  FOREIGN KEY (`group_buy_batch_id`) REFERENCES `purchase_group_results`(`group_buy_batch_id`) ON DELETE RESTRICT,
  FOREIGN KEY (`batch_commitment_id`) REFERENCES `batch_commitments`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT
);

CREATE TABLE `purchase_batch_finalizations` (
  `purchase_batch_id` text PRIMARY KEY NOT NULL,
  `idempotency_key` text NOT NULL,
  `canonical_payload` text NOT NULL,
  `receipt_id` text,
  `committed_quantity` integer NOT NULL CHECK(`committed_quantity` >= 0),
  `purchased_quantity` integer NOT NULL CHECK(`purchased_quantity` >= 0 AND `purchased_quantity` <= `committed_quantity`),
  `shortage_quantity` integer NOT NULL CHECK(`shortage_quantity` = `committed_quantity` - `purchased_quantity`),
  `estimated_total_minor` integer NOT NULL CHECK(`estimated_total_minor` >= 0),
  `actual_total_minor` integer NOT NULL CHECK(`actual_total_minor` >= 0),
  `finalized_by_user_id` text NOT NULL,
  `finalized_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`purchase_batch_id`) REFERENCES `purchase_batches`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`receipt_id`) REFERENCES `purchase_receipts`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`finalized_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);

CREATE TABLE `purchase_batch_groups` (
  `purchase_batch_id` text NOT NULL,
  `group_buy_batch_id` text PRIMARY KEY NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`purchase_batch_id`) REFERENCES `purchase_batches`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`group_buy_batch_id`) REFERENCES `group_buy_batches`(`id`) ON DELETE RESTRICT
);

CREATE TABLE `purchase_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `community_id` text NOT NULL,
  `status` text DEFAULT 'ready' NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_by_user_id` text NOT NULL,
  `purchasing_started_by_user_id` text,
  `purchasing_started_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`purchasing_started_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `purchase_batches_status_check` CHECK(`status` IN ('ready','purchasing'))
);

CREATE TABLE `purchase_group_results` (
  `group_buy_batch_id` text PRIMARY KEY NOT NULL,
  `purchase_batch_id` text NOT NULL,
  `committed_quantity_snapshot` integer NOT NULL CHECK(`committed_quantity_snapshot` >= 0),
  `purchased_quantity` integer NOT NULL CHECK(`purchased_quantity` >= 0 AND `purchased_quantity` <= `committed_quantity_snapshot`),
  `shortage_quantity` integer NOT NULL CHECK(`shortage_quantity` = `committed_quantity_snapshot` - `purchased_quantity`),
  `actual_unit_price_minor` integer NOT NULL CHECK(`actual_unit_price_minor` >= 0),
  `estimated_subtotal_minor` integer NOT NULL CHECK(`estimated_subtotal_minor` >= 0),
  `actual_subtotal_minor` integer NOT NULL CHECK(`actual_subtotal_minor` = `purchased_quantity` * `actual_unit_price_minor`),
  FOREIGN KEY (`purchase_batch_id`) REFERENCES `purchase_batch_finalizations`(`purchase_batch_id`) ON DELETE RESTRICT,
  FOREIGN KEY (`group_buy_batch_id`) REFERENCES `purchase_batch_groups`(`group_buy_batch_id`) ON DELETE RESTRICT
);

CREATE TABLE `purchase_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `purchase_batch_id` text NOT NULL UNIQUE,
  `storage_key` text NOT NULL UNIQUE,
  `original_filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL CHECK(`size_bytes` > 0 AND `size_bytes` <= 10485760),
  `uploaded_by_user_id` text NOT NULL,
  `uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`purchase_batch_id`) REFERENCES `purchase_batches`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);

CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`verified` text DEFAULT 'false' NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "user_identities_provider_check" CHECK("user_identities"."provider" IN ('phone', 'line', 'google', 'email', 'chatgpt')),
	CONSTRAINT "user_identities_verified_check" CHECK("user_identities"."verified" IN ('true', 'false'))
);

CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`phone` text,
	`phone_verified` text DEFAULT 'false' NOT NULL,
	`email` text,
	`email_verified` text DEFAULT 'false' NOT NULL,
	`default_community_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`default_community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`default_community_id`) REFERENCES `community_members`(`user_id`,`community_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_profiles_phone_verified_check" CHECK("user_profiles"."phone_verified" IN ('true', 'false')),
	CONSTRAINT "user_profiles_email_verified_check" CHECK("user_profiles"."email_verified" IN ('true', 'false'))
);

CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_status_check" CHECK("users"."status" IN ('active', 'suspended', 'deleted'))
);

CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);

CREATE INDEX `audit_logs_community_created_idx` ON `audit_logs` (`community_id`,`created_at`);

CREATE INDEX `batch_commitments_batch_idx` ON `batch_commitments` (`batch_id`);

CREATE INDEX `batch_commitments_order_item_status_idx` ON `batch_commitments` (`order_item_id`,`status`);

CREATE UNIQUE INDEX `batch_commitments_request_batch_unique` ON `batch_commitments` (`request_id`,`batch_id`);

CREATE INDEX `cash_payments_community_status_idx` ON `cash_payments` (`community_id`,`status`);

CREATE UNIQUE INDEX `communities_slug_unique` ON `communities` (`slug`);

CREATE INDEX `community_members_community_status_idx` ON `community_members` (`community_id`,`status`);

CREATE UNIQUE INDEX `community_members_user_community_unique` ON `community_members` (`user_id`,`community_id`);

CREATE UNIQUE INDEX `community_product_offerings_community_product_unique` ON `community_product_offerings` (`community_id`,`product_id`);

CREATE INDEX `community_product_offerings_community_status_idx` ON `community_product_offerings` (`community_id`,`status`);

CREATE UNIQUE INDEX `group_buy_batches_offering_sequence_unique` ON `group_buy_batches` (`offering_id`,`sequence_number`);

CREATE INDEX `group_buy_batches_offering_status_idx` ON `group_buy_batches` (`offering_id`,`status`);

CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);

CREATE UNIQUE INDEX `order_items_order_offering_unique` ON `order_items` (`order_id`,`offering_id`);

CREATE INDEX `orders_community_status_idx` ON `orders` (`community_id`,`status`);

CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);

CREATE UNIQUE INDEX `orders_user_idempotency_unique` ON `orders` (`user_id`,`idempotency_key`);

CREATE INDEX `pickup_records_community_status_idx` ON `pickup_records` (`community_id`,`status`);

CREATE UNIQUE INDEX `pickup_records_order_unique` ON `pickup_records` (`order_id`);

CREATE INDEX `product_wishes_community_status_idx` ON `product_wishes` (`community_id`,`status`);

CREATE INDEX `product_wishes_user_status_idx` ON `product_wishes` (`user_id`,`status`);

CREATE INDEX `purchase_allocations_order_item_idx` ON `purchase_allocations` (`order_item_id`);

CREATE UNIQUE INDEX `purchase_batch_finalizations_idempotency_unique` ON `purchase_batch_finalizations` (`purchase_batch_id`,`idempotency_key`);

CREATE INDEX `purchase_batch_groups_purchase_batch_idx` ON `purchase_batch_groups` (`purchase_batch_id`);

CREATE UNIQUE INDEX `purchase_batches_community_idempotency_unique` ON `purchase_batches` (`community_id`,`idempotency_key`);

CREATE INDEX `purchase_batches_community_status_idx` ON `purchase_batches` (`community_id`,`status`);

CREATE INDEX `purchase_group_results_purchase_batch_idx` ON `purchase_group_results` (`purchase_batch_id`);

CREATE UNIQUE INDEX `user_identities_provider_user_unique` ON `user_identities` (`provider`,`provider_user_id`);

CREATE INDEX `user_identities_user_idx` ON `user_identities` (`user_id`);

CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE');
END;

CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE');
END;

CREATE TRIGGER `cash_payments_immutable_delete`
BEFORE DELETE ON `cash_payments`
BEGIN SELECT RAISE(ABORT,'CASH_PAYMENT_IMMUTABLE'); END;

CREATE TRIGGER `cash_payments_immutable_update`
BEFORE UPDATE ON `cash_payments`
BEGIN SELECT RAISE(ABORT,'CASH_PAYMENT_IMMUTABLE'); END;

CREATE TRIGGER `cash_payments_validate_order_community`
BEFORE INSERT ON `cash_payments`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.order_id AND community_id=NEW.community_id
  ) THEN RAISE(ABORT,'PAYMENT_ORDER_COMMUNITY_INVALID') END;
END;

CREATE TRIGGER `cash_payments_validate_procurement`
BEFORE INSERT ON `cash_payments`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.order_id AND community_id=NEW.community_id
  ) THEN RAISE(ABORT,'PAYMENT_ORDER_COMMUNITY_INVALID') END;
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=NEW.order_id
  ) <> (
    SELECT COALESCE(SUM(pa.committed_quantity_snapshot),0)
    FROM purchase_allocations pa JOIN order_items oi ON oi.id=pa.order_item_id
    WHERE oi.order_id=NEW.order_id
  ) THEN RAISE(ABORT,'PAYMENT_PROCUREMENT_NOT_FINALIZED') END;
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(pa.fulfilled_quantity),0)
    FROM purchase_allocations pa JOIN order_items oi ON oi.id=pa.order_item_id
    WHERE oi.order_id=NEW.order_id
  ) <= 0 THEN RAISE(ABORT,'NO_PICKUP_REQUIRED') END;
  SELECT CASE WHEN NEW.amount_minor <> (
    SELECT COALESCE(SUM(pa.final_amount_minor),0)
    FROM purchase_allocations pa JOIN order_items oi ON oi.id=pa.order_item_id
    WHERE oi.order_id=NEW.order_id
  ) THEN RAISE(ABORT,'PAYMENT_AMOUNT_MISMATCH') END;
END;

CREATE TRIGGER `pickup_records_handover_immutable`
BEFORE UPDATE ON `pickup_records`
WHEN OLD.status='picked_up'
BEGIN SELECT RAISE(ABORT,'HANDOVER_IMMUTABLE'); END;

CREATE TRIGGER `pickup_records_require_paid_handover`
BEFORE UPDATE OF `status` ON `pickup_records`
WHEN NEW.status='picked_up'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_payments WHERE order_id=NEW.order_id AND status='paid'
  ) THEN RAISE(ABORT,'PAYMENT_REQUIRED_BEFORE_HANDOVER') END;
  SELECT CASE WHEN NEW.picked_up_at IS NULL OR NEW.handed_over_by_user_id IS NULL
    THEN RAISE(ABORT,'HANDOVER_ACTOR_TIME_REQUIRED') END;
END;

CREATE TRIGGER `pickup_records_validate_inserted_handover`
BEFORE INSERT ON `pickup_records`
WHEN NEW.status='picked_up'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM cash_payments WHERE order_id=NEW.order_id AND status='paid'
  ) THEN RAISE(ABORT,'PAYMENT_REQUIRED_BEFORE_HANDOVER') END;
  SELECT CASE WHEN NEW.picked_up_at IS NULL OR NEW.handed_over_by_user_id IS NULL
    THEN RAISE(ABORT,'HANDOVER_ACTOR_TIME_REQUIRED') END;
END;

CREATE TRIGGER `pickup_records_validate_order_community`
BEFORE INSERT ON `pickup_records`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.order_id AND community_id=NEW.community_id
  ) THEN RAISE(ABORT,'PICKUP_ORDER_COMMUNITY_INVALID') END;
END;

CREATE TRIGGER `purchase_allocations_immutable_delete`
BEFORE DELETE ON `purchase_allocations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_ALLOCATION_IMMUTABLE'); END;

CREATE TRIGGER `purchase_allocations_immutable_update`
BEFORE UPDATE ON `purchase_allocations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_ALLOCATION_IMMUTABLE'); END;

CREATE TRIGGER `purchase_allocations_validate_relationships`
BEFORE INSERT ON `purchase_allocations`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_group_results
    WHERE group_buy_batch_id=NEW.group_buy_batch_id AND purchase_batch_id=NEW.purchase_batch_id
  ) OR NOT EXISTS (
    SELECT 1 FROM batch_commitments
    WHERE id=NEW.batch_commitment_id AND batch_id=NEW.group_buy_batch_id
      AND order_item_id=NEW.order_item_id AND status='active'
  ) THEN RAISE(ABORT,'PURCHASE_ALLOCATION_RELATION_INVALID') END;
END;

CREATE TRIGGER `purchase_batch_finalizations_immutable_delete`
BEFORE DELETE ON `purchase_batch_finalizations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_FINALIZATION_IMMUTABLE'); END;

CREATE TRIGGER `purchase_batch_finalizations_immutable_update`
BEFORE UPDATE ON `purchase_batch_finalizations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_FINALIZATION_IMMUTABLE'); END;

CREATE TRIGGER `purchase_batch_groups_immutable_delete`
BEFORE DELETE ON `purchase_batch_groups`
BEGIN
  SELECT RAISE(ABORT,'PURCHASE_BATCH_MEMBERSHIP_IMMUTABLE');
END;

CREATE TRIGGER `purchase_batch_groups_immutable_update`
BEFORE UPDATE ON `purchase_batch_groups`
BEGIN
  SELECT RAISE(ABORT,'PURCHASE_BATCH_MEMBERSHIP_IMMUTABLE');
END;

CREATE TRIGGER `purchase_batch_groups_lock_insert`
AFTER INSERT ON `purchase_batch_groups`
BEGIN
  UPDATE group_buy_batches SET status='locked',updated_at=CURRENT_TIMESTAMP
  WHERE id=NEW.group_buy_batch_id AND status='formed';
END;

CREATE TRIGGER `purchase_batch_groups_validate_insert`
BEFORE INSERT ON `purchase_batch_groups`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM group_buy_batches g
    JOIN community_product_offerings o ON o.id=g.offering_id
    JOIN purchase_batches p ON p.id=NEW.purchase_batch_id
    WHERE g.id=NEW.group_buy_batch_id AND g.status='formed' AND o.community_id=p.community_id
  ) THEN RAISE(ABORT,'PURCHASE_BATCH_GROUP_INELIGIBLE') END;
END;

CREATE TRIGGER `purchase_group_results_immutable_delete`
BEFORE DELETE ON `purchase_group_results`
BEGIN SELECT RAISE(ABORT,'PURCHASE_RESULT_IMMUTABLE'); END;

CREATE TRIGGER `purchase_group_results_immutable_update`
BEFORE UPDATE ON `purchase_group_results`
BEGIN SELECT RAISE(ABORT,'PURCHASE_RESULT_IMMUTABLE'); END;

CREATE TRIGGER `purchase_group_results_validate_membership`
BEFORE INSERT ON `purchase_group_results`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_batch_groups
    WHERE purchase_batch_id=NEW.purchase_batch_id AND group_buy_batch_id=NEW.group_buy_batch_id
  ) THEN RAISE(ABORT,'PURCHASE_RESULT_GROUP_NOT_IN_BATCH') END;
END;
