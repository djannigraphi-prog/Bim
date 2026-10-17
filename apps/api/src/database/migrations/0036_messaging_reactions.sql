CREATE TABLE "message_reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid,
	"emoji" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_emoji_ck" CHECK (emoji IN ('❤️', '😂', '😮', '😢', '🙏', '👍'))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_reactions_person_uq" ON "message_reactions" USING btree ("message_id","user_id") WHERE "message_reactions"."shop_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "message_reactions_shop_uq" ON "message_reactions" USING btree ("message_id","shop_id") WHERE "message_reactions"."shop_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 6-C : une réponse citée ne cite qu'un message de la même conversation (garanti par la base, en plus du serveur).
CREATE OR REPLACE FUNCTION messages_reply_same_conversation() RETURNS trigger AS $$
BEGIN
  IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM messages q WHERE q.id = NEW.reply_to_id AND q.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'reply_to_id must reference a message of the same conversation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER messages_reply_same_conversation_trg BEFORE INSERT OR UPDATE OF reply_to_id, conversation_id ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_reply_same_conversation();
