CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "conversation_members_status_ck" CHECK ("conversation_members"."status" IN ('active', 'request', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(10) DEFAULT 'direct' NOT NULL,
	"direct_key" varchar(80),
	"created_by" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_kind_ck" CHECK ("conversations"."kind" IN ('direct'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"kind" varchar(8) DEFAULT 'text' NOT NULL,
	"text" varchar(2000),
	"media_key" varchar(200),
	"media_width" integer,
	"media_height" integer,
	"status" varchar(10) DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_kind_ck" CHECK ("messages"."kind" IN ('text', 'photo')),
	CONSTRAINT "messages_status_ck" CHECK ("messages"."status" IN ('published', 'deleted', 'hidden')),
	CONSTRAINT "messages_content_ck" CHECK (("messages"."kind" = 'text' AND "messages"."text" IS NOT NULL) OR ("messages"."kind" = 'photo' AND "messages"."media_key" IS NOT NULL) OR "messages"."status" <> 'published')
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_ck";--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_uq" ON "conversations" USING btree ("direct_key");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id","created_at");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_ck" CHECK ("content_reports"."target_type" IN ('post', 'comment', 'user', 'story', 'message'));--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('messages.daily_limit', '500', 'Messages envoyés par personne sur 24 heures glissantes (protection contre le spam).', 'provisional', 'LOT6', 'migration'),
  ('messages.new_conversations_daily_limit', '20', 'Nouvelles conversations (dont demandes) ouvertes par personne sur 24 heures (anti-démarchage).', 'provisional', 'LOT6', 'migration'),
  ('messages.retention_days', 'null', 'Durée de conservation des messages privés, après décision. Null : aucune suppression automatique. À valider (juridique, ARTCI).', 'pending', 'LOT6', 'migration')
ON CONFLICT ("key") DO NOTHING;
