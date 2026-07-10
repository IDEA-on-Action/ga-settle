CREATE TABLE `incentive_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`insurer_id` text,
	`settlement_month` text,
	`file_name` text NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`ocr_status` text NOT NULL,
	`ocr_avg_confidence` real,
	`ocr_field_count` integer,
	`low_confidence_count` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_incentive_plans_sha` ON `incentive_plans` (`sha256`);