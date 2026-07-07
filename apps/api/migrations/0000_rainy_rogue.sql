CREATE TABLE `adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`amount_enc` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `settlement_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_adj_run` ON `adjustments` (`run_id`);--> statement-breakpoint
CREATE TABLE `agent_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`org_unit_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_unit_id`) REFERENCES `org_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_asg_agent` ON `agent_assignments` (`agent_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`birth_date_enc` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_code` ON `agents` (`code`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`summary_json` text,
	`ip` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `commission_records` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`row_no` integer NOT NULL,
	`settlement_month` text NOT NULL,
	`insurer_id` text NOT NULL,
	`contract_no` text NOT NULL,
	`installment` integer,
	`agent_id` text,
	`product_name` text,
	`contract_date` text,
	`premium_enc` text,
	`commission_enc` text,
	`clawback_enc` text,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cr_month` ON `commission_records` (`settlement_month`,`insurer_id`);--> statement-breakpoint
CREATE INDEX `idx_cr_trace` ON `commission_records` (`upload_id`,`row_no`);--> statement-breakpoint
CREATE TABLE `family_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_no` text NOT NULL,
	`agent_id` text NOT NULL,
	`matched_name_enc` text,
	`status` text NOT NULL,
	`confirmed_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_family_contract` ON `family_flags` (`contract_no`);--> statement-breakpoint
CREATE TABLE `incentive_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`condition_json` text NOT NULL,
	`action_json` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_priority` ON `incentive_rules` (`active`,`priority`);--> statement-breakpoint
CREATE TABLE `insurers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`status` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `org_units` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_org_parent` ON `org_units` (`parent_id`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`org_unit_id` text NOT NULL,
	`total_enc` text NOT NULL,
	`detail_r2_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `settlement_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_unit_id`) REFERENCES `org_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_slip_run` ON `payslips` (`run_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`insurer_id` text NOT NULL,
	`insurer_total_enc` text NOT NULL,
	`calculated_total_enc` text NOT NULL,
	`diff_enc` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `settlement_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_recon_run` ON `reconciliations` (`run_id`);--> statement-breakpoint
CREATE TABLE `settlement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`commission_record_id` text NOT NULL,
	`rule_id` text,
	`agent_id` text NOT NULL,
	`org_unit_id` text NOT NULL,
	`amount_enc` text NOT NULL,
	`breakdown_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `settlement_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commission_record_id`) REFERENCES `commission_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `incentive_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_unit_id`) REFERENCES `org_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_line_run` ON `settlement_lines` (`run_id`);--> statement-breakpoint
CREATE TABLE `settlement_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_month` text NOT NULL,
	`status` text NOT NULL,
	`snapshot_r2_key` text,
	`closed_at` text,
	`closed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_run_month` ON `settlement_runs` (`settlement_month`);--> statement-breakpoint
CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`insurer_id` text NOT NULL,
	`version` integer NOT NULL,
	`header_signature` text NOT NULL,
	`column_map_json` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tv_sig` ON `template_versions` (`header_signature`);--> statement-breakpoint
CREATE TABLE `upload_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`upload_id` text NOT NULL,
	`row_no` integer NOT NULL,
	`field` text NOT NULL,
	`reason` text NOT NULL,
	`raw_value` text,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`insurer_id` text NOT NULL,
	`template_version_id` text,
	`r2_key` text NOT NULL,
	`file_hash` text NOT NULL,
	`status` text NOT NULL,
	`settlement_month` text NOT NULL,
	`row_count` integer,
	`ok_count` integer,
	`error_count` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_uploads_hash` ON `uploads` (`file_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`org_unit_id` text,
	`password_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_unit_id`) REFERENCES `org_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_email` ON `users` (`email`);