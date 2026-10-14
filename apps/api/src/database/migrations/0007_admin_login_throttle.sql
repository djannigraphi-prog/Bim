CREATE TABLE "admin_login_throttle" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "failed_login_count";--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "locked_until";