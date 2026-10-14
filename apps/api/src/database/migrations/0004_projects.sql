CREATE TYPE "public"."project_availability" AS ENUM('morning', 'noon', 'afternoon');--> statement-breakpoint
CREATE TYPE "public"."project_budget" AS ENUM('small', 'medium', 'boosted');--> statement-breakpoint
CREATE TYPE "public"."project_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."project_mode" AS ENUM('eco', 'premium');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."program_template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "program_template_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"title" varchar(80) NOT NULL,
	"detail" varchar(200),
	"icon" varchar(40) DEFAULT 'check' NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"weekdays" smallint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_code" varchar(40) NOT NULL,
	"goal_code" varchar(40),
	"title" varchar(120) NOT NULL,
	"duration_days" smallint NOT NULL,
	"status" "program_template_status" DEFAULT 'draft' NOT NULL,
	"validated_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_templates_duration_ck" CHECK ("program_templates"."duration_days" BETWEEN 7 AND 365),
	CONSTRAINT "program_templates_published_validated_ck" CHECK ("program_templates"."status" <> 'published' OR "program_templates"."validated_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "project_categories" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(60) NOT NULL,
	"icon" varchar(40) NOT NULL,
	"tint" varchar(7) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_goals" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"category_code" varchar(40) NOT NULL,
	"label" varchar(60) NOT NULL,
	"quantity_unit" varchar(12),
	"quantity_min" integer,
	"quantity_max" integer,
	"title_pattern" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"start_day" date NOT NULL,
	"end_day" date NOT NULL,
	"ended_early_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_pauses_range_ck" CHECK ("project_pauses"."end_day" >= "project_pauses"."start_day")
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(80) NOT NULL,
	"detail" varchar(200),
	"icon" varchar(40) DEFAULT 'check' NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"weekdays" smallint NOT NULL,
	"origin" varchar(10) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_tasks_weekdays_ck" CHECK ("project_tasks"."weekdays" BETWEEN 1 AND 127),
	CONSTRAINT "project_tasks_time_ck" CHECK ("project_tasks"."time_of_day" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "project_tasks_origin_ck" CHECK ("project_tasks"."origin" IN ('template', 'answers', 'user'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category_code" varchar(40) NOT NULL,
	"goal_code" varchar(40),
	"template_id" uuid,
	"title" varchar(80) NOT NULL,
	"description" varchar(500),
	"target_quantity" integer,
	"mode" "project_mode" NOT NULL,
	"budget" "project_budget",
	"receive_merchant_offers" boolean DEFAULT false NOT NULL,
	"height_cm" smallint,
	"weight_kg" smallint,
	"level" "project_level",
	"availability" "project_availability",
	"sessions_per_week" smallint,
	"health_note" varchar(300),
	"is_public" boolean DEFAULT false NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"duration_days" smallint NOT NULL,
	"planned_end_date" date NOT NULL,
	"paused_until" date,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_duration_ck" CHECK ("projects"."duration_days" BETWEEN 7 AND 365),
	CONSTRAINT "projects_sessions_ck" CHECK ("projects"."sessions_per_week" IS NULL OR "projects"."sessions_per_week" BETWEEN 1 AND 7),
	CONSTRAINT "projects_budget_mode_ck" CHECK ("projects"."mode" = 'premium' OR "projects"."budget" IS NULL),
	CONSTRAINT "projects_height_ck" CHECK ("projects"."height_cm" IS NULL OR "projects"."height_cm" BETWEEN 50 AND 250),
	CONSTRAINT "projects_weight_ck" CHECK ("projects"."weight_kg" IS NULL OR "projects"."weight_kg" BETWEEN 20 AND 400),
	CONSTRAINT "projects_dates_ck" CHECK ("projects"."planned_end_date" >= "projects"."start_date")
);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"task_id" uuid NOT NULL,
	"day" date NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_completions_task_id_day_pk" PRIMARY KEY("task_id","day")
);
--> statement-breakpoint
ALTER TABLE "program_template_tasks" ADD CONSTRAINT "program_template_tasks_template_id_program_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."program_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_templates" ADD CONSTRAINT "program_templates_category_code_project_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."project_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_templates" ADD CONSTRAINT "program_templates_goal_code_project_goals_code_fk" FOREIGN KEY ("goal_code") REFERENCES "public"."project_goals"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_category_code_project_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."project_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pauses" ADD CONSTRAINT "project_pauses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_category_code_project_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."project_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_goal_code_project_goals_code_fk" FOREIGN KEY ("goal_code") REFERENCES "public"."project_goals"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_id_program_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."program_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_templates_lookup_idx" ON "program_templates" USING btree ("category_code","goal_code","status");--> statement-breakpoint
CREATE INDEX "project_events_project_idx" ON "project_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_goals_category_idx" ON "project_goals" USING btree ("category_code","sort_order");--> statement-breakpoint
CREATE INDEX "project_pauses_project_idx" ON "project_pauses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_user_status_idx" ON "projects" USING btree ("user_id","status");