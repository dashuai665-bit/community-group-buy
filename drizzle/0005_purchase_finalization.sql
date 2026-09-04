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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_batch_finalizations_idempotency_unique` ON `purchase_batch_finalizations` (`purchase_batch_id`,`idempotency_key`);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `purchase_group_results_purchase_batch_idx` ON `purchase_group_results` (`purchase_batch_id`);
--> statement-breakpoint
CREATE TRIGGER `purchase_group_results_validate_membership`
BEFORE INSERT ON `purchase_group_results`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_batch_groups
    WHERE purchase_batch_id=NEW.purchase_batch_id AND group_buy_batch_id=NEW.group_buy_batch_id
  ) THEN RAISE(ABORT,'PURCHASE_RESULT_GROUP_NOT_IN_BATCH') END;
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `purchase_allocations_order_item_idx` ON `purchase_allocations` (`order_item_id`);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `purchase_batch_finalizations_immutable_update`
BEFORE UPDATE ON `purchase_batch_finalizations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_FINALIZATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_batch_finalizations_immutable_delete`
BEFORE DELETE ON `purchase_batch_finalizations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_FINALIZATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_group_results_immutable_update`
BEFORE UPDATE ON `purchase_group_results`
BEGIN SELECT RAISE(ABORT,'PURCHASE_RESULT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_group_results_immutable_delete`
BEFORE DELETE ON `purchase_group_results`
BEGIN SELECT RAISE(ABORT,'PURCHASE_RESULT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_allocations_immutable_update`
BEFORE UPDATE ON `purchase_allocations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_ALLOCATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_allocations_immutable_delete`
BEFORE DELETE ON `purchase_allocations`
BEGIN SELECT RAISE(ABORT,'PURCHASE_ALLOCATION_IMMUTABLE'); END;
