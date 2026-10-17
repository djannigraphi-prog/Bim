CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_payment_id" uuid NOT NULL,
	"payee_shop_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_ref" varchar(100) NOT NULL,
	"amount_fcfa" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'XOF' NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payment_intents_status_ck" CHECK ("payment_intents"."status" IN ('pending', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "payment_intents_amount_ck" CHECK ("payment_intents"."amount_fcfa" > 0),
	CONSTRAINT "payment_intents_currency_ck" CHECK ("payment_intents"."currency" = 'XOF')
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_key" varchar(160) NOT NULL,
	"intent_id" uuid,
	"outcome" varchar(20) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_payments" DROP CONSTRAINT "order_payments_provider_ck";--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "provider_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_payment_id_order_payments_id_fk" FOREIGN KEY ("order_payment_id") REFERENCES "public"."order_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payee_shop_id_shops_id_fk" FOREIGN KEY ("payee_shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_ref_uq" ON "payment_intents" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_open_uq" ON "payment_intents" USING btree ("order_payment_id") WHERE "payment_intents"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_key_uq" ON "payment_provider_events" USING btree ("provider","event_key");--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_provider_ck" CHECK (("order_payments"."provider_status" = 'unavailable' AND "order_payments"."provider_confirmed_at" IS NULL) OR ("order_payments"."provider_status" = 'confirmed' AND "order_payments"."provider_confirmed_at" IS NOT NULL AND "order_payments"."method" = 'mobile_money'));--> statement-breakpoint
-- Notifications des prestataires en écriture seule ; un paiement en ligne n'est jamais supprimé.
CREATE TRIGGER payment_provider_events_append_only BEFORE UPDATE OR DELETE ON "payment_provider_events" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
CREATE TRIGGER payment_intents_no_delete BEFORE DELETE ON "payment_intents" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
-- Lot 8 : paiement en ligne fermé tant que le fondateur n'a autorisé ni prestataire ni dépense (17/10/2026).
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('payments.online_enabled', 'false', 'Paiement en ligne Mobile Money (prestataire). Fermé : aucun prestataire ni dépense autorisés', 'pending', 'L7-07', 'migration')
ON CONFLICT (key) DO NOTHING;
