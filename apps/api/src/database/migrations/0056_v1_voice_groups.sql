ALTER TABLE "conversation_members" DROP CONSTRAINT "conversation_members_status_ck";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_kind_ck";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_shop_ck";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_kind_ck";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_ck";--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "role" varchar(8) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title" varchar(60);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_role_ck" CHECK ("conversation_members"."role" IN ('admin', 'member'));--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_status_ck" CHECK ("conversation_members"."status" IN ('active', 'request', 'declined', 'withheld', 'left'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_ck" CHECK (("conversations"."kind" = 'group') = ("conversations"."title" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_ck" CHECK ("conversations"."kind" IN ('direct', 'shop', 'group'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_ck" CHECK (("conversations"."kind" IN ('direct', 'group') AND "conversations"."shop_id" IS NULL) OR ("conversations"."kind" = 'shop' AND "conversations"."shop_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_ck" CHECK ("messages"."kind" IN ('text', 'photo', 'order', 'voice', 'system'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_ck" CHECK (("messages"."kind" IN ('text', 'system') AND "messages"."text" IS NOT NULL) OR ("messages"."kind" = 'photo' AND "messages"."media_key" IS NOT NULL) OR ("messages"."kind" = 'voice' AND "messages"."media_key" IS NOT NULL AND "messages"."media_duration_ms" IS NOT NULL) OR ("messages"."kind" = 'order' AND "messages"."order_id" IS NOT NULL) OR "messages"."status" <> 'published');--> statement-breakpoint
-- Décisions du fondateur (18/10/2026, 15 h 10) : vocaux de 2 minutes au plus ; groupes de 32 personnes au plus.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('messages.voice_max_seconds', '120', 'Durée maximale d''un message vocal, en secondes (décidé : 120)', 'decided', 'V1-1810', 'migration'),
  ('messages.group_max_members', '32', 'Personnes au plus dans un groupe, créateur compris (décidé : 32)', 'decided', 'V1-1810', 'migration')
ON CONFLICT (key) DO NOTHING;
