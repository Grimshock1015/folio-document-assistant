CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`page` integer NOT NULL,
	`section` text NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_document_idx` ON `chunks` (`document_id`);--> statement-breakpoint
CREATE INDEX `chunks_owner_idx` ON `chunks` (`owner_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`version` text NOT NULL,
	`filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`page_count` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_owner_idx` ON `documents` (`owner_id`);