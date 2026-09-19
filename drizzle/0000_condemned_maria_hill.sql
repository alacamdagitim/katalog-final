CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch` text NOT NULL,
	`actor` text NOT NULL,
	`productId` text NOT NULL,
	`title` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`afterVersion` integer NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_batch` ON `audit` (`batch`);--> statement-breakpoint
CREATE INDEX `audit_time` ON `audit` (`createdAt`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`state` text DEFAULT 'staged' NOT NULL,
	`payload` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`leaseUntil` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_state` ON `jobs` (`kind`,`state`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`authId` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_auth` ON `members` (`authId`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`shopifyProductId` text,
	`shopifyVariantId` text,
	`handle` text NOT NULL,
	`title` text NOT NULL,
	`vendor` text DEFAULT '' NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`barcode` text DEFAULT '' NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`catalogPrice` integer,
	`comparePrice` integer,
	`stock` integer,
	`visible` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'csv' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`search` text DEFAULT '' NOT NULL,
	`raw` text DEFAULT '{}' NOT NULL,
	`lastActor` text DEFAULT 'system' NOT NULL,
	`lastBatch` text DEFAULT 'sync' NOT NULL,
	`seenAt` text DEFAULT '' NOT NULL,
	`updatedAt` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_variant` ON `products` (`shopifyVariantId`);--> statement-breakpoint
CREATE INDEX `products_handle` ON `products` (`handle`);--> statement-breakpoint
CREATE INDEX `products_catalog` ON `products` (`visible`,`status`,`title`);--> statement-breakpoint
CREATE INDEX `products_vendor_type` ON `products` (`vendor`,`type`);--> statement-breakpoint
CREATE INDEX `products_barcode` ON `products` (`barcode`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE product_search USING fts5(product_id UNINDEXED, search, tokenize='unicode61 remove_diacritics 2', prefix='2 3 4');
--> statement-breakpoint
CREATE TRIGGER products_search_insert AFTER INSERT ON products BEGIN
 INSERT INTO product_search(product_id,search) VALUES(new.id,new.search);
END;
--> statement-breakpoint
CREATE TRIGGER products_search_update AFTER UPDATE OF search ON products BEGIN
 DELETE FROM product_search WHERE product_id=old.id;
 INSERT INTO product_search(product_id,search) VALUES(new.id,new.search);
END;
--> statement-breakpoint
CREATE TRIGGER products_search_delete AFTER DELETE ON products BEGIN
 DELETE FROM product_search WHERE product_id=old.id;
END;
--> statement-breakpoint
CREATE TRIGGER products_audit AFTER UPDATE ON products WHEN new.lastActor <> 'system' AND new.version<>old.version BEGIN
 INSERT INTO audit(batch,actor,productId,title,before,after,afterVersion,createdAt)
 VALUES(new.lastBatch,new.lastActor,new.id,new.title,
 json_object('title',old.title,'type',old.type,'tags',old.tags,'catalogPrice',old.catalogPrice,'visible',old.visible),
 json_object('title',new.title,'type',new.type,'tags',new.tags,'catalogPrice',new.catalogPrice,'visible',new.visible),new.version,new.updatedAt);
END;
