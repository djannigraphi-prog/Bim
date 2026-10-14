CREATE TABLE "program_template_tips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"day" smallint,
	"text" varchar(240) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_measurements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"value_tenths" integer NOT NULL,
	"unit" varchar(12) NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_measurements_value_ck" CHECK ("project_measurements"."value_tenths" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"taken_day" date NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "project_photos_kind_ck" CHECK ("project_photos"."kind" IN ('before', 'after'))
);
--> statement-breakpoint
CREATE TABLE "project_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"task_id" uuid,
	"reason" varchar(16) NOT NULL,
	"message" varchar(500),
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"resolution" varchar(500),
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_reports_reason_ck" CHECK ("project_reports"."reason" IN ('unavailable', 'too_hard', 'health', 'content', 'other')),
	CONSTRAINT "project_reports_status_ck" CHECK ("project_reports"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "program_templates" ADD COLUMN "mode" varchar(8) DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE "program_template_tips" ADD CONSTRAINT "program_template_tips_template_id_program_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."program_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_measurements" ADD CONSTRAINT "project_measurements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_template_tips_template_idx" ON "program_template_tips" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "project_measurements_project_idx" ON "project_measurements" USING btree ("project_id","day");--> statement-breakpoint
CREATE INDEX "project_photos_project_idx" ON "project_photos" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "project_reports_status_idx" ON "project_reports" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "program_templates" ADD CONSTRAINT "program_templates_mode_ck" CHECK ("program_templates"."mode" IN ('any', 'eco', 'premium'));