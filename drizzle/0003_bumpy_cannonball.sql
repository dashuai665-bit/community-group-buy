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
--> statement-breakpoint
CREATE UNIQUE INDEX `order_items_order_offering_unique` ON `order_items` (`order_id`,`offering_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_user_idempotency_unique` ON `orders` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_community_status_idx` ON `orders` (`community_id`,`status`);--> statement-breakpoint
CREATE TABLE `pickup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`community_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_at` text,
	`ready_at` text,
	`picked_up_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pickup_records_status_check" CHECK("pickup_records"."status" IN ('pending', 'ready', 'picked_up', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pickup_records_order_unique` ON `pickup_records` (`order_id`);--> statement-breakpoint
CREATE INDEX `pickup_records_community_status_idx` ON `pickup_records` (`community_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_logs` (
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
	CONSTRAINT "audit_logs_action_type_check" CHECK("__new_audit_logs"."action_type" IN ('community_join', 'community_leave', 'default_community_change', 'identity_link', 'identity_unlink', 'admin_member_contact_access', 'product_created', 'offering_created', 'offering_updated', 'batch_formed', 'wish_created', 'wish_status_changed', 'order_created', 'order_cancelled', 'admin_order_cancelled', 'order_status_changed', 'pickup_created', 'pickup_ready', 'pickup_completed'))
);
--> statement-breakpoint
INSERT INTO `__new_audit_logs`("id", "actor_user_id", "community_id", "action_type", "target_type", "target_id", "metadata", "created_at") SELECT "id", "actor_user_id", "community_id", "action_type", "target_type", "target_id", "metadata", "created_at" FROM `audit_logs`;--> statement-breakpoint
DROP TABLE `audit_logs`;--> statement-breakpoint
ALTER TABLE `__new_audit_logs` RENAME TO `audit_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_community_created_idx` ON `audit_logs` (`community_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_group_buy_batches` (
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
	CONSTRAINT "group_buy_batches_status_check" CHECK("__new_group_buy_batches"."status" IN ('open', 'formed', 'locked', 'closed', 'cancelled')),
	CONSTRAINT "group_buy_batches_sequence_check" CHECK("__new_group_buy_batches"."sequence_number" > 0),
	CONSTRAINT "group_buy_batches_threshold_check" CHECK("__new_group_buy_batches"."threshold_quantity" > 0),
	CONSTRAINT "group_buy_batches_committed_check" CHECK("__new_group_buy_batches"."committed_quantity" >= 0 AND "__new_group_buy_batches"."committed_quantity" <= "__new_group_buy_batches"."threshold_quantity")
);
--> statement-breakpoint
INSERT INTO `__new_group_buy_batches`("id", "offering_id", "sequence_number", "status", "threshold_quantity", "committed_quantity", "opened_at", "formed_at", "closed_at", "created_at", "updated_at") SELECT "id", "offering_id", "sequence_number", "status", "threshold_quantity", "committed_quantity", "opened_at", "formed_at", "closed_at", "created_at", "updated_at" FROM `group_buy_batches`;--> statement-breakpoint
DROP TABLE `group_buy_batches`;--> statement-breakpoint
ALTER TABLE `__new_group_buy_batches` RENAME TO `group_buy_batches`;--> statement-breakpoint
CREATE UNIQUE INDEX `group_buy_batches_offering_sequence_unique` ON `group_buy_batches` (`offering_id`,`sequence_number`);--> statement-breakpoint
CREATE INDEX `group_buy_batches_offering_status_idx` ON `group_buy_batches` (`offering_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_batch_commitments` (
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
	CONSTRAINT "batch_commitments_quantity_check" CHECK("__new_batch_commitments"."quantity" > 0),
	CONSTRAINT "batch_commitments_source_check" CHECK("__new_batch_commitments"."source_type" IN ('reservation', 'order_item')),
	CONSTRAINT "batch_commitments_status_check" CHECK("__new_batch_commitments"."status" IN ('active', 'cancelled')),
	CONSTRAINT "batch_commitments_order_item_check" CHECK(("__new_batch_commitments"."source_type" = 'order_item' AND "__new_batch_commitments"."order_item_id" IS NOT NULL) OR ("__new_batch_commitments"."source_type" = 'reservation' AND "__new_batch_commitments"."order_item_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_batch_commitments`("id", "request_id", "batch_id", "quantity", "source_type", "source_reference", "order_item_id", "status", "cancelled_at", "created_at") SELECT "id", "request_id", "batch_id", "quantity", "source_type", "source_reference", NULL, 'active', NULL, "created_at" FROM `batch_commitments`;--> statement-breakpoint
DROP TABLE `batch_commitments`;--> statement-breakpoint
ALTER TABLE `__new_batch_commitments` RENAME TO `batch_commitments`;--> statement-breakpoint
CREATE UNIQUE INDEX `batch_commitments_request_batch_unique` ON `batch_commitments` (`request_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `batch_commitments_batch_idx` ON `batch_commitments` (`batch_id`);--> statement-breakpoint
CREATE INDEX `batch_commitments_order_item_status_idx` ON `batch_commitments` (`order_item_id`,`status`);
