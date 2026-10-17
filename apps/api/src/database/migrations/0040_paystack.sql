CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"amount_fcfa" integer NOT NULL,
	"reason" varchar(300) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"provider_refund_ref" varchar(60),
	"requested_by_admin" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payment_refunds_status_ck" CHECK ("payment_refunds"."status" IN ('pending', 'processing', 'processed', 'failed')),
	CONSTRAINT "payment_refunds_amount_ck" CHECK ("payment_refunds"."amount_fcfa" > 0)
);
--> statement-breakpoint
CREATE TABLE "shop_payment_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"account_ref" varchar(60) NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"note" varchar(300),
	"created_by_admin" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "shop_payment_accounts_status_ck" CHECK ("shop_payment_accounts"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "payee_account_ref" varchar(60);--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "failure_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_payment_accounts" ADD CONSTRAINT "shop_payment_accounts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_open_uq" ON "payment_refunds" USING btree ("intent_id") WHERE "payment_refunds"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "shop_payment_accounts_active_uq" ON "shop_payment_accounts" USING btree ("shop_id","provider") WHERE "shop_payment_accounts"."status" = 'active';--> statement-breakpoint
CREATE TRIGGER payment_refunds_no_delete BEFORE DELETE ON "payment_refunds" FOR EACH ROW EXECUTE FUNCTION forbid_order_history_change();--> statement-breakpoint
-- Lot 8 : qui supporte les frais du prestataire (boutique ou BIM) : décision commerciale du fondateur, non prise.
-- Tant qu'elle ne l'est pas, aucun paiement en ligne n'est lancé. Délai d'expiration d'un paiement en ligne non validé.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('payments.fee_bearer', 'null', 'Frais du prestataire de paiement : « shop » (la boutique) ou « bim » (BIM). Non décidé : paiement en ligne fermé', 'pending', 'L8-01', 'migration'),
  ('payments.intent_expiry_minutes', '30', 'Délai après lequel un paiement en ligne non validé est revérifié puis expiré', 'provisional', 'L8-01', 'migration')
ON CONFLICT (key) DO NOTHING;
