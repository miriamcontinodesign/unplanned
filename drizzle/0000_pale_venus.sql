CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`product_code` text NOT NULL,
	`product_title` text NOT NULL,
	`option_code` text,
	`option_title` text,
	`travel_date` text NOT NULL,
	`start_time` text,
	`party_size` integer DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`hold_ref` text,
	`booking_ref` text,
	`booking_url` text,
	`cancellation_policy` text,
	`hold_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`stay_id` integer,
	`kind` text DEFAULT 'note' NOT NULL,
	`text` text NOT NULL,
	`photo_path` text,
	`occurred_on` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `link_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`proactive` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nudges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`text` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`day_index` integer,
	`on_date` text,
	`at_time` text,
	`provider` text,
	`product_code` text,
	`price_amount` real,
	`currency` text,
	`duration_minutes` integer,
	`status` text DEFAULT 'idea' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`source` text DEFAULT 'chat' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`city` text NOT NULL,
	`region` text,
	`country` text,
	`country_code` text,
	`latitude` real,
	`longitude` real,
	`timezone` text,
	`lodging_name` text,
	`lodging_area` text,
	`arrival_date` text,
	`departure_date` text,
	`nights` integer,
	`budget_level` text,
	`party_size` integer,
	`party_kind` text,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`telegram_chat_id` text,
	`quiet_start_hour` integer DEFAULT 21 NOT NULL,
	`quiet_end_hour` integer DEFAULT 8 NOT NULL,
	`max_nudges_per_day` integer DEFAULT 3 NOT NULL,
	`min_nudge_gap_minutes` integer DEFAULT 180 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_chat_id_idx` ON `users` (`telegram_chat_id`);