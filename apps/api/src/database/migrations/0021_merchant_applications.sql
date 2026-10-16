ALTER TYPE "public"."verification_purpose" ADD VALUE 'payout_number';--> statement-breakpoint
CREATE TABLE "merchant_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"id_doc_type" varchar(10),
	"payout_phone" varchar(20),
	"payout_operator" varchar(10),
	"payout_verified_at" timestamp with time zone,
	"address" varchar(200),
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_applications_status_ck" CHECK ("merchant_applications"."status" IN ('draft', 'submitted', 'approved', 'rejected')),
	CONSTRAINT "merchant_applications_doc_ck" CHECK ("merchant_applications"."id_doc_type" IS NULL OR "merchant_applications"."id_doc_type" IN ('cni', 'passport', 'permis')),
	CONSTRAINT "merchant_applications_operator_ck" CHECK ("merchant_applications"."payout_operator" IS NULL OR "merchant_applications"."payout_operator" IN ('wave', 'orange', 'mtn', 'moov'))
);
--> statement-breakpoint
CREATE TABLE "merchant_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "merchant_documents_kind_ck" CHECK ("merchant_documents"."kind" IN ('id_front', 'id_back', 'selfie'))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "description" varchar(300);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "city" varchar(80);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "commune" varchar(80);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "logo_key" varchar(200);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."merchant_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_applications_shop_uq" ON "merchant_applications" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "merchant_applications_status_idx" ON "merchant_applications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "merchant_applications_user_idx" ON "merchant_applications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_documents_kind_uq" ON "merchant_documents" USING btree ("application_id","kind");--> statement-breakpoint
-- Lot 5-A : durée de conservation des pièces d'identité et selfies des demandes de boutique. NON FIXÉE : rien n'est
-- supprimé automatiquement tant que le fondateur ne l'a pas validée (examen juridique, ARTCI).
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('kyc.document_retention_days', 'null', 'Durée de conservation des pièces d''identité et selfies des demandes de boutique, après décision. Null : aucune suppression automatique. À valider (juridique, ARTCI).', 'pending', 'LOT5', 'migration')
ON CONFLICT ("key") DO NOTHING;
