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
--> statement-breakpoint
CREATE INDEX `cash_payments_community_status_idx` ON `cash_payments` (`community_id`,`status`);
--> statement-breakpoint
CREATE TRIGGER `cash_payments_validate_order_community`
BEFORE INSERT ON `cash_payments`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.order_id AND community_id=NEW.community_id
  ) THEN RAISE(ABORT,'PAYMENT_ORDER_COMMUNITY_INVALID') END;
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `cash_payments_immutable_update`
BEFORE UPDATE ON `cash_payments`
BEGIN SELECT RAISE(ABORT,'CASH_PAYMENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_payments_immutable_delete`
BEFORE DELETE ON `cash_payments`
BEGIN SELECT RAISE(ABORT,'CASH_PAYMENT_IMMUTABLE'); END;
--> statement-breakpoint
ALTER TABLE `pickup_records` ADD COLUMN `pickup_location_snapshot` text;
--> statement-breakpoint
ALTER TABLE `pickup_records` ADD COLUMN `pickup_window_snapshot` text;
--> statement-breakpoint
ALTER TABLE `pickup_records` ADD COLUMN `handed_over_by_user_id` text REFERENCES `users`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TRIGGER `pickup_records_validate_order_community`
BEFORE INSERT ON `pickup_records`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.order_id AND community_id=NEW.community_id
  ) THEN RAISE(ABORT,'PICKUP_ORDER_COMMUNITY_INVALID') END;
END;
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `pickup_records_handover_immutable`
BEFORE UPDATE ON `pickup_records`
WHEN OLD.status='picked_up'
BEGIN SELECT RAISE(ABORT,'HANDOVER_IMMUTABLE'); END;
