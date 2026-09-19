CREATE TABLE credentials (memberId TEXT PRIMARY KEY REFERENCES members(id), passwordHash TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (tokenHash TEXT PRIMARY KEY, memberId TEXT NOT NULL REFERENCES members(id), expiresAt INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sessions_expiry ON sessions(expiresAt);
--> statement-breakpoint
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, windowStart INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE sync_tasks (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, dedupeKey TEXT NOT NULL UNIQUE,
 productId TEXT, state TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL DEFAULT '{}',
 attempts INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, nextAt INTEGER NOT NULL DEFAULT 0,
 leaseToken TEXT, leaseUntil INTEGER NOT NULL DEFAULT 0,
 lastError TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX sync_tasks_due ON sync_tasks(state,nextAt,kind);
--> statement-breakpoint
CREATE TABLE webhook_receipts (id TEXT PRIMARY KEY, receivedAt INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE sync_product_locks (productId TEXT PRIMARY KEY, token TEXT NOT NULL, until INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE product_tombstones (productId TEXT PRIMARY KEY, deletedAt TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX products_shopify_product ON products(shopifyProductId);
--> statement-breakpoint
CREATE TABLE sync_seen (scanId TEXT NOT NULL, productId TEXT NOT NULL, PRIMARY KEY(scanId,productId));
