-- Lot 6-B (16/10/2026) — Messagerie des boutiques : migration additive (colonnes facultatives, nouvelle table).
-- Les conversations et messages existants (kind direct) ne changent pas ; la règle sur kind accepte en plus 'shop'.
CREATE TABLE "shop_quick_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"text" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_kind_ck";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "shop_last_read_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "shop_archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "shop_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "context_product_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "context_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_shop_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_quick_replies" ADD CONSTRAINT "shop_quick_replies_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_quick_replies_shop_idx" ON "shop_quick_replies" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_context_product_id_products_id_fk" FOREIGN KEY ("context_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_context_offer_id_project_offers_id_fk" FOREIGN KEY ("context_offer_id") REFERENCES "public"."project_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_shop_id_shops_id_fk" FOREIGN KEY ("sender_shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_shop_idx" ON "conversations" USING btree ("shop_id","last_message_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_ck" CHECK (("conversations"."kind" = 'direct' AND "conversations"."shop_id" IS NULL) OR ("conversations"."kind" = 'shop' AND "conversations"."shop_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_ck" CHECK ("conversations"."kind" IN ('direct', 'shop'));