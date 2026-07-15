CREATE TABLE `incentive_payout_records` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`row_no` integer NOT NULL,
	`settlement_month` text NOT NULL,
	`insurer_id` text NOT NULL,
	`contract_no` text NOT NULL,
	`agent_id` text,
	`product_name` text,
	`perf_date` text,
	`incentive_label` text,
	`rate` real,
	`premium_enc` text,
	`payout_enc` text,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ipr_month` ON `incentive_payout_records` (`settlement_month`,`insurer_id`);--> statement-breakpoint
CREATE INDEX `idx_ipr_trace` ON `incentive_payout_records` (`upload_id`,`row_no`);--> statement-breakpoint
ALTER TABLE `uploads` ADD `doc_type` text DEFAULT 'commission' NOT NULL;