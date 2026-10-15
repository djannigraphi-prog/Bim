ALTER TABLE "project_reports" DROP CONSTRAINT "project_reports_reason_ck";--> statement-breakpoint
ALTER TABLE "project_reports" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_reports" ALTER COLUMN "day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_reports" ALTER COLUMN "message" SET DATA TYPE varchar(1000);--> statement-breakpoint
ALTER TABLE "project_reports" ADD COLUMN "context" varchar(8) DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_reports" ADD COLUMN "attachment_key" varchar(200);--> statement-breakpoint
ALTER TABLE "project_reports" ADD COLUMN "attachment_width" integer;--> statement-breakpoint
ALTER TABLE "project_reports" ADD COLUMN "attachment_height" integer;--> statement-breakpoint
ALTER TABLE "project_reports" ADD COLUMN "attachment_bytes" integer;--> statement-breakpoint
CREATE INDEX "project_reports_user_idx" ON "project_reports" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_context_ck" CHECK (("project_reports"."context" = 'project' AND "project_reports"."project_id" IS NOT NULL AND "project_reports"."day" IS NOT NULL) OR ("project_reports"."context" = 'general' AND "project_reports"."project_id" IS NULL AND "project_reports"."task_id" IS NULL AND "project_reports"."message" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_reason_ck" CHECK ("project_reports"."reason" IN ('unavailable', 'too_hard', 'health', 'content', 'other', 'app', 'product'));