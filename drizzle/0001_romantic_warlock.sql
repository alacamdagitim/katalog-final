CREATE TABLE `carts` (
	`actor` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`actorName` text NOT NULL,
	`customerName` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`total` integer NOT NULL,
	`payload` text NOT NULL,
	`history` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orders_actor_time` ON `orders` (`actor`,`createdAt`);--> statement-breakpoint
CREATE INDEX `orders_time` ON `orders` (`createdAt`);