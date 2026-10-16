CREATE TABLE "communes" (
	"code" varchar(80) PRIMARY KEY NOT NULL,
	"city" varchar(80) NOT NULL,
	"name" varchar(80) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communes_code_ck" CHECK ("communes"."code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "delivery_durations" (
	"from_code" varchar(80) NOT NULL,
	"to_code" varchar(80) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "delivery_durations_from_code_to_code_mode_pk" PRIMARY KEY("from_code","to_code","mode"),
	CONSTRAINT "delivery_durations_mode_ck" CHECK ("delivery_durations"."mode" IN ('express', 'economy')),
	CONSTRAINT "delivery_durations_minutes_ck" CHECK ("delivery_durations"."minutes" BETWEEN 1 AND 2880)
);
--> statement-breakpoint
CREATE TABLE "delivery_tariffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(10) NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"base_fcfa" integer NOT NULL,
	"per_minute_fcfa" integer NOT NULL,
	"minimum_fcfa" integer NOT NULL,
	"rounding_fcfa" integer NOT NULL,
	"free_wait_minutes" integer NOT NULL,
	"wait_per_minute_fcfa" integer NOT NULL,
	"wait_cap_minutes" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "delivery_tariffs_mode_ck" CHECK ("delivery_tariffs"."mode" IN ('express', 'economy')),
	CONSTRAINT "delivery_tariffs_status_ck" CHECK ("delivery_tariffs"."status" IN ('draft', 'published')),
	CONSTRAINT "delivery_tariffs_values_ck" CHECK ("delivery_tariffs"."base_fcfa" >= 0 AND "delivery_tariffs"."per_minute_fcfa" >= 0 AND "delivery_tariffs"."minimum_fcfa" >= 0 AND "delivery_tariffs"."rounding_fcfa" >= 1 AND "delivery_tariffs"."free_wait_minutes" >= 0 AND "delivery_tariffs"."wait_per_minute_fcfa" >= 0 AND "delivery_tariffs"."wait_cap_minutes" >= 0),
	CONSTRAINT "delivery_tariffs_published_ck" CHECK (("delivery_tariffs"."status" = 'published') = ("delivery_tariffs"."published_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "delivery_durations" ADD CONSTRAINT "delivery_durations_from_code_communes_code_fk" FOREIGN KEY ("from_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_durations" ADD CONSTRAINT "delivery_durations_to_code_communes_code_fk" FOREIGN KEY ("to_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_durations" ADD CONSTRAINT "delivery_durations_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tariffs" ADD CONSTRAINT "delivery_tariffs_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tariffs" ADD CONSTRAINT "delivery_tariffs_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_tariffs_version_uq" ON "delivery_tariffs" USING btree ("mode","version");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_tariffs_draft_uq" ON "delivery_tariffs" USING btree ("mode") WHERE "delivery_tariffs"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "delivery_tariffs_published_idx" ON "delivery_tariffs" USING btree ("mode","published_at");--> statement-breakpoint
-- 7-D : une grille publiée est immuable (§7.1) ; on ne peut que publier une nouvelle version. Rien ne se supprime.
CREATE OR REPLACE FUNCTION forbid_published_tariff_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'Une grille tarifaire publiée ne se supprime pas (version %, %)', OLD.version, OLD.mode USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Une grille tarifaire publiée ne se modifie pas (version %, %) : publier une nouvelle version', OLD.version, OLD.mode USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER delivery_tariffs_frozen BEFORE UPDATE OR DELETE ON delivery_tariffs FOR EACH ROW EXECUTE FUNCTION forbid_published_tariff_change();
--> statement-breakpoint
-- A2-c (proposé) : l'attente est enregistrée ; elle n'est facturée que si ce réglage est activé (false au lancement).
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('delivery.wait_fees_enabled', 'false', 'Facturer l''attente au-delà de l''attente gratuite (A2-c : enregistrée, non facturée au lancement)', 'provisional', 'A2-c', 'migration')
ON CONFLICT (key) DO NOTHING;
