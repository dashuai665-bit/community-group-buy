CREATE TABLE `batch_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`source_type` text DEFAULT 'reservation' NOT NULL,
	`source_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `group_buy_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "batch_commitments_quantity_check" CHECK("batch_commitments"."quantity" > 0),
	CONSTRAINT "batch_commitments_source_check" CHECK("batch_commitments"."source_type" IN ('reservation', 'order_item'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_commitments_request_batch_unique` ON `batch_commitments` (`request_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `batch_commitments_batch_idx` ON `batch_commitments` (`batch_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `community_product_offerings_community_product_unique` ON `community_product_offerings` (`community_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `community_product_offerings_community_status_idx` ON `community_product_offerings` (`community_id`,`status`);--> statement-breakpoint
CREATE TABLE `group_buy_batches` (
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
	CONSTRAINT "group_buy_batches_status_check" CHECK("group_buy_batches"."status" IN ('open', 'formed', 'closed', 'cancelled')),
	CONSTRAINT "group_buy_batches_sequence_check" CHECK("group_buy_batches"."sequence_number" > 0),
	CONSTRAINT "group_buy_batches_threshold_check" CHECK("group_buy_batches"."threshold_quantity" > 0),
	CONSTRAINT "group_buy_batches_committed_check" CHECK("group_buy_batches"."committed_quantity" >= 0 AND "group_buy_batches"."committed_quantity" <= "group_buy_batches"."threshold_quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_buy_batches_offering_sequence_unique` ON `group_buy_batches` (`offering_id`,`sequence_number`);--> statement-breakpoint
CREATE INDEX `group_buy_batches_offering_status_idx` ON `group_buy_batches` (`offering_id`,`status`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `product_wishes_user_status_idx` ON `product_wishes` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `product_wishes_community_status_idx` ON `product_wishes` (`community_id`,`status`);--> statement-breakpoint
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
--> statement-breakpoint
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
	CONSTRAINT "audit_logs_action_type_check" CHECK("__new_audit_logs"."action_type" IN ('community_join', 'community_leave', 'default_community_change', 'identity_link', 'identity_unlink', 'admin_member_contact_access', 'product_created', 'offering_created', 'offering_updated', 'batch_formed', 'wish_created', 'wish_status_changed'))
);
--> statement-breakpoint
INSERT INTO `__new_audit_logs`("id", "actor_user_id", "community_id", "action_type", "target_type", "target_id", "metadata", "created_at") SELECT "id", "actor_user_id", "community_id", "action_type", "target_type", "target_id", "metadata", "created_at" FROM `audit_logs`;--> statement-breakpoint
DROP TABLE `audit_logs`;--> statement-breakpoint
ALTER TABLE `__new_audit_logs` RENAME TO `audit_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_community_created_idx` ON `audit_logs` (`community_id`,`created_at`);
