CREATE TABLE "project_category_rubriques" (
	"project_category_code" varchar(40) NOT NULL,
	"shop_category_code" varchar(40) NOT NULL,
	CONSTRAINT "project_category_rubriques_project_category_code_shop_category_code_pk" PRIMARY KEY("project_category_code","shop_category_code")
);
--> statement-breakpoint
CREATE TABLE "project_offer_products" (
	"offer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_offer_products_offer_id_product_id_pk" PRIMARY KEY("offer_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "project_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"message" varchar(500) NOT NULL,
	"status" varchar(10) DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "project_offers_status_ck" CHECK ("project_offers"."status" IN ('sent', 'declined', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "project_category_rubriques" ADD CONSTRAINT "project_category_rubriques_project_category_code_project_categories_code_fk" FOREIGN KEY ("project_category_code") REFERENCES "public"."project_categories"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_category_rubriques" ADD CONSTRAINT "project_category_rubriques_shop_category_code_shop_categories_code_fk" FOREIGN KEY ("shop_category_code") REFERENCES "public"."shop_categories"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_offer_products" ADD CONSTRAINT "project_offer_products_offer_id_project_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."project_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_offer_products" ADD CONSTRAINT "project_offer_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_offers" ADD CONSTRAINT "project_offers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_offers" ADD CONSTRAINT "project_offers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_offers_shop_uq" ON "project_offers" USING btree ("project_id","shop_id");--> statement-breakpoint
CREATE INDEX "project_offers_shop_idx" ON "project_offers" USING btree ("shop_id","created_at");--> statement-breakpoint
-- Correspondance proposée (à valider par le fondateur, modifiable ensuite) entre catégories de projet et rubriques du BimShop.
INSERT INTO "project_category_rubriques" ("project_category_code", "shop_category_code") VALUES
  ('sport', 'sport'),
  ('sport', 'vetements_sport'),
  ('style_look', 'vetements'),
  ('style_look', 'accessoires'),
  ('visage_peau', 'sante_visage'),
  ('visage_peau', 'sante_hygiene'),
  ('cheveux_coiffure', 'services'),
  ('ongles_mains', 'services'),
  ('maquillage', 'sante_visage'),
  ('maquillage', 'services'),
  ('bien_etre_spa', 'sante_corps'),
  ('bien_etre_spa', 'services')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('offers.max_per_shop_per_day', '20', 'Nombre maximal d''offres de projet envoyées par une boutique en 24 h (anti-démarchage).', 'provisional', 'LOT5', 'migration')
ON CONFLICT ("key") DO NOTHING;
