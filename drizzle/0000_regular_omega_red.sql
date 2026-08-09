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
	`on_date` text,
	`at_time` text,
	`status` text DEFAULT 'idea' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL
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
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`quiet_start_hour` integer DEFAULT 21 NOT NULL,
	`quiet_end_hour` integer DEFAULT 8 NOT NULL,
	`max_nudges_per_day` integer DEFAULT 3 NOT NULL,
	`min_nudge_gap_minutes` integer DEFAULT 180 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
