CREATE TABLE "store_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(8) NOT NULL,
	"product_id" varchar(100) NOT NULL,
	"transaction_id" varchar(120) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"coins" integer,
	"expires_at" timestamp with time zone,
	"test_purchase" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_purchases_platform_ck" CHECK ("store_purchases"."platform" IN ('google', 'apple')),
	CONSTRAINT "store_purchases_kind_ck" CHECK (("store_purchases"."kind" = 'coins' AND "store_purchases"."coins" > 0) OR ("store_purchases"."kind" = 'premium' AND "store_purchases"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "coin_purchases" DROP CONSTRAINT "coin_purchases_channel_ck";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_channel_ck";--> statement-breakpoint
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_purchases_tx_uq" ON "store_purchases" USING btree ("platform","transaction_id");--> statement-breakpoint
CREATE INDEX "store_purchases_user_idx" ON "store_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_channel_ck" CHECK ("coin_purchases"."channel" IN ('demo', 'google', 'apple'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_channel_ck" CHECK ("subscriptions"."channel" IN ('demo', 'google', 'apple'));
--> statement-breakpoint
-- V1 : catalogue des produits du magasin (identifiants à créer dans Google Play Console et App Store Connect). Proposé.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('store.products', '{"bim.coins.100":{"kind":"coins","coins":100},"bim.coins.500":{"kind":"coins","coins":500},"bim.coins.1000":{"kind":"coins","coins":1000},"bim.coins.5000":{"kind":"coins","coins":5000},"bim.premium.month":{"kind":"premium","days":30}}', 'Produits vendus dans l''app (Google Play, App Store) : pièces ou Premium (proposé)', 'provisional', 'V1-1810', 'migration')
ON CONFLICT (key) DO NOTHING;
