CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(200) NOT NULL,
	"kind" varchar(20) DEFAULT 'task_reminder' NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"day" varchar(10),
	"attempt" integer DEFAULT 0 NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"reason" varchar(40),
	"send_tries" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claimed_by" varchar(80),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_status_ck" CHECK ("notification_deliveries"."status" IN ('pending', 'sending', 'sent', 'skipped', 'stale', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"name" varchar(80) PRIMARY KEY NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"details" varchar(400)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_key_uq" ON "notification_deliveries" USING btree ("key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","fire_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notification_deliveries" USING btree ("user_id","created_at");