CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"status" varchar(18) DEFAULT 'searching' NOT NULL,
	"courier_id" uuid,
	"courier_category" varchar(12),
	"accepted_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"code_validated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"waited_seconds" integer,
	"wait_fee_fcfa" integer,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(300),
	"refusal_reason" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_status_ck" CHECK ("deliveries"."status" IN ('searching', 'offered', 'accepted', 'picked_up', 'arrived', 'code_validated', 'closed', 'refused_by_client', 'client_absent', 'cancelled')),
	CONSTRAINT "deliveries_category_ck" CHECK ("deliveries"."courier_category" IS NULL OR "deliveries"."courier_category" IN ('employee', 'partner', 'independent')),
	CONSTRAINT "deliveries_refusal_ck" CHECK ("deliveries"."refusal_reason" IS NULL OR "deliveries"."refusal_reason" IN ('incorrect', 'damaged', 'incomplete', 'other')),
	CONSTRAINT "deliveries_courier_ck" CHECK ("deliveries"."status" IN ('searching', 'offered', 'cancelled') OR "deliveries"."courier_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"actor_type" varchar(10) NOT NULL,
	"actor_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_events_actor_ck" CHECK ("delivery_events"."actor_type" IN ('customer', 'shop', 'courier', 'system', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "delivery_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"courier_id" uuid NOT NULL,
	"category" varchar(12) NOT NULL,
	"status" varchar(10) DEFAULT 'offered' NOT NULL,
	"skip_reason" varchar(300),
	"offered_by" uuid NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "delivery_offers_status_ck" CHECK ("delivery_offers"."status" IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
	CONSTRAINT "delivery_offers_category_ck" CHECK ("delivery_offers"."category" IN ('employee', 'partner', 'independent'))
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"actor_type" varchar(10) NOT NULL,
	"actor_id" uuid,
	"note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_events_actor_ck" CHECK ("incident_events"."actor_type" IN ('customer', 'shop', 'courier', 'system', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"delivery_id" uuid,
	"opened_by_type" varchar(10) NOT NULL,
	"opened_by_id" uuid NOT NULL,
	"reason" varchar(24) NOT NULL,
	"description" varchar(1000),
	"status" varchar(14) DEFAULT 'open' NOT NULL,
	"resolution" varchar(1000),
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_opener_ck" CHECK ("incidents"."opened_by_type" IN ('customer', 'shop', 'courier', 'system')),
	CONSTRAINT "incidents_status_ck" CHECK ("incidents"."status" IN ('open', 'with_support', 'resolved')),
	CONSTRAINT "incidents_reason_ck" CHECK ("incidents"."reason" IN ('item_incorrect', 'item_damaged', 'item_incomplete', 'client_absent', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'other'))
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_ck";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_kind_ck";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "kind" SET DATA TYPE varchar(8);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courier_id_courier_accounts_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_courier_id_courier_accounts_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_offered_by_users_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_uq" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_courier_idx" ON "deliveries" USING btree ("courier_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_events_delivery_idx" ON "delivery_events" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_offers_open_uq" ON "delivery_offers" USING btree ("delivery_id") WHERE "delivery_offers"."status" = 'offered';--> statement-breakpoint
CREATE INDEX "delivery_offers_courier_idx" ON "delivery_offers" USING btree ("courier_id","status");--> statement-breakpoint
CREATE INDEX "incident_events_incident_idx" ON "incident_events" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incidents_order_idx" ON "incidents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_delivery_uq" ON "reviews" USING btree ("delivery_id") WHERE "reviews"."kind" = 'delivery';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_ck" CHECK ("orders"."status" IN ('proposed', 'pending_shop', 'confirmed', 'preparing', 'ready', 'in_delivery', 'delivered', 'completed', 'declined', 'expired', 'cancelled'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_delivery_ck" CHECK (("reviews"."kind" = 'delivery') = ("reviews"."delivery_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_kind_ck" CHECK ("reviews"."kind" IN ('item', 'shop', 'delivery'));--> statement-breakpoint
-- Historiques des livraisons et des incidents en écriture seule ; ni livraison ni incident supprimés.
CREATE TRIGGER delivery_events_append_only BEFORE UPDATE OR DELETE ON "delivery_events" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
CREATE TRIGGER incident_events_append_only BEFORE UPDATE OR DELETE ON "incident_events" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON "deliveries" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
CREATE TRIGGER incidents_no_delete BEFORE DELETE ON "incidents" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
-- Délais (A10, valeurs initiales proposées, provisoires).
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('deliveries.mission_accept_minutes', '5', 'Délai pour qu''un livreur accepte la mission proposée ; ensuite, le marchand en sollicite un autre', 'provisional', 'A10', 'migration'),
  ('deliveries.client_absent_after_minutes', '15', 'Après « Je suis arrivé », délai avant que le livreur puisse déclarer « client absent »', 'provisional', 'A10', 'migration')
ON CONFLICT (key) DO NOTHING;
