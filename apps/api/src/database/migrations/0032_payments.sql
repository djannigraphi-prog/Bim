CREATE TABLE "order_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" varchar(14) NOT NULL,
	"method" varchar(12) NOT NULL,
	"amount_fcfa" integer NOT NULL,
	"declared_at" timestamp with time zone,
	"declared_reference" varchar(60),
	"cash_observed_at" timestamp with time zone,
	"cash_observed_amount_fcfa" integer,
	"cash_observed_by" uuid,
	"cash_observed_by_role" varchar(10),
	"provider_status" varchar(12) DEFAULT 'unavailable' NOT NULL,
	"decision" varchar(10) DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"contest_reason" varchar(300),
	"failure" varchar(10) DEFAULT 'none' NOT NULL,
	"failure_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"review_queued_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_note" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payments_kind_ck" CHECK ("order_payments"."kind" IN ('article', 'delivery_fee')),
	CONSTRAINT "order_payments_method_ck" CHECK ("order_payments"."method" IN ('mobile_money', 'cash')),
	CONSTRAINT "order_payments_amount_ck" CHECK ("order_payments"."amount_fcfa" > 0),
	CONSTRAINT "order_payments_provider_ck" CHECK ("order_payments"."provider_status" = 'unavailable'),
	CONSTRAINT "order_payments_decision_ck" CHECK ("order_payments"."decision" IN ('pending', 'confirmed', 'contested')),
	CONSTRAINT "order_payments_failure_ck" CHECK ("order_payments"."failure" IN ('none', 'failed', 'cancelled')),
	CONSTRAINT "order_payments_contest_ck" CHECK (("order_payments"."decision" = 'contested') = ("order_payments"."contest_reason" IS NOT NULL)),
	CONSTRAINT "order_payments_cash_ck" CHECK ("order_payments"."cash_observed_at" IS NULL OR "order_payments"."method" = 'cash'),
	CONSTRAINT "order_payments_declared_ck" CHECK ("order_payments"."declared_at" IS NULL OR "order_payments"."method" = 'mobile_money')
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_ck";--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_cash_observed_by_users_id_fk" FOREIGN KEY ("cash_observed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_payments_kind_uq" ON "order_payments" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "order_payments_review_idx" ON "order_payments" USING btree ("review_queued_at") WHERE "order_payments"."review_queued_at" IS NOT NULL AND "order_payments"."reviewed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_ck" CHECK ("orders"."status" IN ('proposed', 'pending_shop', 'confirmed', 'preparing', 'ready', 'delivered', 'completed', 'declined', 'expired', 'cancelled'));--> statement-breakpoint
-- Registre des paiements : aucune suppression (historique financier).
CREATE TRIGGER order_payments_no_delete BEFORE DELETE ON "order_payments" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('payments.shop_decision_reminder_days', '3', 'Jours sans décision de la boutique sur un paiement avant rappel et file « à vérifier » du support (jamais de confirmation implicite)', 'provisional', 'A10', 'migration')
ON CONFLICT (key) DO NOTHING;
