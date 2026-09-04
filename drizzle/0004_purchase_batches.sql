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
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_batches_community_idempotency_unique` ON `purchase_batches` (`community_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `purchase_batches_community_status_idx` ON `purchase_batches` (`community_id`,`status`);
--> statement-breakpoint
CREATE TABLE `purchase_batch_groups` (
  `purchase_batch_id` text NOT NULL,
  `group_buy_batch_id` text PRIMARY KEY NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`purchase_batch_id`) REFERENCES `purchase_batches`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`group_buy_batch_id`) REFERENCES `group_buy_batches`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `purchase_batch_groups_purchase_batch_idx` ON `purchase_batch_groups` (`purchase_batch_id`);
--> statement-breakpoint
CREATE TRIGGER `purchase_batch_groups_immutable_update`
BEFORE UPDATE ON `purchase_batch_groups`
BEGIN
  SELECT RAISE(ABORT,'PURCHASE_BATCH_MEMBERSHIP_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_batch_groups_immutable_delete`
BEFORE DELETE ON `purchase_batch_groups`
BEGIN
  SELECT RAISE(ABORT,'PURCHASE_BATCH_MEMBERSHIP_IMMUTABLE');
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `purchase_batch_groups_lock_insert`
AFTER INSERT ON `purchase_batch_groups`
BEGIN
  UPDATE group_buy_batches SET status='locked',updated_at=CURRENT_TIMESTAMP
  WHERE id=NEW.group_buy_batch_id AND status='formed';
END;
