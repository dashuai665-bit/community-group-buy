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
--> statement-breakpoint
CREATE UNIQUE INDEX `communities_slug_unique` ON `communities` (`slug`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `community_members_user_community_unique` ON `community_members` (`user_id`,`community_id`);--> statement-breakpoint
CREATE INDEX `community_members_community_status_idx` ON `community_members` (`community_id`,`status`);--> statement-breakpoint
CREATE TABLE `platform_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "platform_roles_role_check" CHECK("platform_roles"."role" IN ('platform_admin'))
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_provider_user_unique` ON `user_identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `user_identities_user_idx` ON `user_identities` (`user_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_status_check" CHECK("users"."status" IN ('active', 'suspended', 'deleted'))
);
