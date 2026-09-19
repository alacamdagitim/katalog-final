ALTER TABLE sync_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX sync_tasks_priority ON sync_tasks(kind,state,priority,nextAt);
