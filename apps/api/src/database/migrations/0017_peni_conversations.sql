CREATE TABLE "peni_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"engine" varchar(20) NOT NULL,
	"state" jsonb NOT NULL,
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peni_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" varchar(8) NOT NULL,
	"text" varchar(1000) NOT NULL,
	"choice" varchar(60),
	"quick_replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"pose" varchar(8),
	"safety" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peni_conversations" ADD CONSTRAINT "peni_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peni_messages" ADD CONSTRAINT "peni_messages_conversation_id_peni_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."peni_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peni_messages" ADD CONSTRAINT "peni_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peni_conversations_user_idx" ON "peni_conversations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "peni_messages_conversation_seq_uq" ON "peni_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "peni_messages_user_idx" ON "peni_messages" USING btree ("user_id","role","created_at");--> statement-breakpoint
-- Peni (lot 3) : discussion guidée sans modèle de langage. Limites provisoires, modifiables dans l'administration.
-- peni.llm_enabled reste à false : aucune donnée n'est envoyée à un fournisseur d'IA sans l'accord du fondateur.
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('peni.daily_message_limit', '100', 'Messages qu''une personne peut envoyer à Peni en 24 heures (protection contre les abus et, plus tard, les coûts d''IA).', 'provisional', 'T-031', 'migration'),
  ('peni.conversation_max_messages', '60', 'Messages d''une personne dans une même discussion avec Peni.', 'provisional', 'T-031', 'migration'),
  ('peni.llm_enabled', 'false', 'Utilisation d''un fournisseur d''IA pour Peni. Reste à false tant que le fondateur n''a pas autorisé le fournisseur, son coût et l''envoi de données (ARTCI).', 'pending', 'T-031', 'migration')
ON CONFLICT ("key") DO NOTHING;
