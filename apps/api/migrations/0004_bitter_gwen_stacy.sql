CREATE TABLE `incentive_plan_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`insurer_id` text NOT NULL,
	`base_month` text NOT NULL,
	`line_type` text,
	`product` text NOT NULL,
	`pay_term` text,
	`pay_timing` text,
	`channel` text,
	`branch` text,
	`cond1` text,
	`cond2` text,
	`cond3` text,
	`rate_type` text NOT NULL,
	`rate_value` real NOT NULL,
	`note` text,
	`source_type` text NOT NULL,
	`source_ref` text,
	`plan_image_key` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_def_insurer_month` ON `incentive_plan_definitions` (`insurer_id`,`base_month`);