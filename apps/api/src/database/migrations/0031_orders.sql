-- 7-B : numéros de commande lisibles CMD-000001, attribués par la base, jamais réattribués.
CREATE SEQUENCE "order_number_seq" AS bigint START WITH 1 MINVALUE 1;--> statement-breakpoint
CREATE OR REPLACE FUNCTION bim_order_number(n bigint) RETURNS varchar AS $$
  SELECT 'CMD-' || lpad(n::text, greatest(6, length(n::text)), '0');
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"actor_type" varchar(10) NOT NULL,
	"actor_id" uuid,
	"from_status" varchar(14),
	"to_status" varchar(14),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_actor_ck" CHECK ("order_events"."actor_type" IN ('customer', 'shop', 'system', 'admin', 'courier'))
);
--> statement-breakpoint
CREATE TABLE "order_handover_codes" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"code_encrypted" varchar(200) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	CONSTRAINT "order_handover_codes_status_ck" CHECK ("order_handover_codes"."status" IN ('active', 'used', 'blocked', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"reference" varchar(20) NOT NULL,
	"content_version" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"title" varchar(120) NOT NULL,
	"variant_id" uuid NOT NULL,
	"variant_label" varchar(60) NOT NULL,
	"quantity" integer NOT NULL,
	"catalog_price_fcfa" integer NOT NULL,
	"applied_price_fcfa" integer NOT NULL,
	"photo_key" varchar(200),
	CONSTRAINT "order_items_quantity_ck" CHECK ("order_items"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "order_items_price_ck" CHECK ("order_items"."applied_price_fcfa" > 0 AND "order_items"."applied_price_fcfa" <= "order_items"."catalog_price_fcfa")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" varchar(20) DEFAULT bim_order_number(nextval('order_number_seq')) NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"source" varchar(12) NOT NULL,
	"conversation_id" uuid,
	"status" varchar(14) NOT NULL,
	"delivery_mode" varchar(10),
	"payment_method" varchar(12),
	"shop_commune_code" varchar(80),
	"delivery_commune_code" varchar(80),
	"delivery_address" varchar(300),
	"delivery_fee_fcfa" integer,
	"tariff_id" uuid,
	"tariff_version" integer,
	"estimated_minutes" integer,
	"fee_details" jsonb,
	"items_total_fcfa" integer NOT NULL,
	"idempotency_key" varchar(64),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"ended_by_type" varchar(10),
	"ended_by_id" uuid,
	"end_reason" varchar(300),
	"ended_from_status" varchar(14),
	"stock_committed" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "orders_source_ck" CHECK ("orders"."source" IN ('bimshop', 'conversation')),
	CONSTRAINT "orders_status_ck" CHECK ("orders"."status" IN ('proposed', 'pending_shop', 'confirmed', 'preparing', 'ready', 'delivered', 'declined', 'expired', 'cancelled')),
	CONSTRAINT "orders_mode_ck" CHECK ("orders"."delivery_mode" IS NULL OR "orders"."delivery_mode" IN ('pickup', 'express', 'economy')),
	CONSTRAINT "orders_payment_ck" CHECK ("orders"."payment_method" IS NULL OR "orders"."payment_method" IN ('mobile_money', 'cash')),
	CONSTRAINT "orders_cash_ck" CHECK ("orders"."payment_method" IS DISTINCT FROM 'cash' OR "orders"."delivery_mode" = 'pickup'),
	CONSTRAINT "orders_delivery_ck" CHECK ("orders"."delivery_mode" IS DISTINCT FROM 'express' AND "orders"."delivery_mode" IS DISTINCT FROM 'economy' OR ("orders"."delivery_commune_code" IS NOT NULL AND "orders"."delivery_address" IS NOT NULL AND "orders"."delivery_fee_fcfa" IS NOT NULL AND "orders"."tariff_id" IS NOT NULL)),
	CONSTRAINT "orders_conversation_ck" CHECK (("orders"."source" = 'conversation') = ("orders"."conversation_id" IS NOT NULL)),
	CONSTRAINT "orders_amounts_ck" CHECK ("orders"."items_total_fcfa" > 0 AND ("orders"."delivery_fee_fcfa" IS NULL OR "orders"."delivery_fee_fcfa" >= 0))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_kind_ck";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_ck";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_handover_codes" ADD CONSTRAINT "order_handover_codes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_handover_codes" ADD CONSTRAINT "order_handover_codes_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_commune_code_communes_code_fk" FOREIGN KEY ("shop_commune_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_commune_code_communes_code_fk" FOREIGN KEY ("delivery_commune_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tariff_id_delivery_tariffs_id_fk" FOREIGN KEY ("tariff_id") REFERENCES "public"."delivery_tariffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_position_uq" ON "order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_uq" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_uq" ON "orders" USING btree ("created_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_shop_idx" ON "orders" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_expiry_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."status" IN ('proposed', 'pending_shop');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_ck" CHECK ("messages"."kind" IN ('text', 'photo', 'order'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_ck" CHECK (("messages"."kind" = 'text' AND "messages"."text" IS NOT NULL) OR ("messages"."kind" = 'photo' AND "messages"."media_key" IS NOT NULL) OR ("messages"."kind" = 'order' AND "messages"."order_id" IS NOT NULL) OR "messages"."status" <> 'published');--> statement-breakpoint
-- Numéro immuable ; historique des commandes en écriture seule ; aucune commande ni ligne supprimée.
CREATE OR REPLACE FUNCTION forbid_order_number_change() RETURNS trigger AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'Le numéro d''une commande ne se modifie pas' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_number_immutable BEFORE UPDATE OF number ON "orders" FOR EACH ROW EXECUTE FUNCTION forbid_order_number_change();--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_order_history_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'L''historique d''une commande ne se modifie ni ne se supprime (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON "order_events" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
CREATE TRIGGER order_items_frozen BEFORE UPDATE OR DELETE ON "order_items" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
-- Délais (A10, valeurs initiales proposées, provisoires) ; lus par le worker minute par minute.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('orders.proposal_ttl_hours', '24', 'Expiration d''une proposition de commande faite par une boutique dans sa conversation (heures)', 'provisional', 'A10', 'migration'),
  ('orders.shop_confirm_ttl_hours', '24', 'Délai de confirmation par la boutique d''une commande passée sur le BimShop, avant expiration (heures)', 'provisional', 'A10', 'migration'),
  ('orders.handover_code_max_attempts', '5', 'Essais faux avant blocage du code de remise (le support le recrée)', 'provisional', 'A1', 'migration')
ON CONFLICT (key) DO NOTHING;
