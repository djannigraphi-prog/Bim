CREATE TABLE "courier_communes" (
	"courier_id" uuid NOT NULL,
	"commune_code" varchar(80) NOT NULL,
	CONSTRAINT "courier_communes_courier_id_commune_code_pk" PRIMARY KEY("courier_id","commune_code")
);
--> statement-breakpoint
CREATE TABLE "courier_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"courier_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "courier_documents_kind_ck" CHECK ("courier_documents"."kind" IN ('id_front', 'id_back', 'selfie'))
);
--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "id_doc_type" varchar(12);--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "reject_reason" varchar(300);--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "capacity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN "vehicle" varchar(10);--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD COLUMN "relation" varchar(10) DEFAULT 'partner' NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD COLUMN "ended_by" uuid;--> statement-breakpoint
ALTER TABLE "courier_communes" ADD CONSTRAINT "courier_communes_courier_id_courier_accounts_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_communes" ADD CONSTRAINT "courier_communes_commune_code_communes_code_fk" FOREIGN KEY ("commune_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_documents" ADD CONSTRAINT "courier_documents_courier_id_courier_accounts_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_communes_commune_idx" ON "courier_communes" USING btree ("commune_code");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_documents_kind_uq" ON "courier_documents" USING btree ("courier_id","kind");--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD CONSTRAINT "courier_shop_partnerships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD CONSTRAINT "courier_shop_partnerships_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_one_employment_uq" ON "courier_shop_partnerships" USING btree ("courier_id") WHERE "courier_shop_partnerships"."relation" = 'employee' AND "courier_shop_partnerships"."status" = 'active';--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_capacity_ck" CHECK ("courier_accounts"."capacity" BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_vehicle_ck" CHECK ("courier_accounts"."vehicle" IS NULL OR "courier_accounts"."vehicle" IN ('moto', 'velo', 'voiture', 'pied'));--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD CONSTRAINT "courier_shop_relation_ck" CHECK ("courier_shop_partnerships"."relation" IN ('employee', 'partner'));