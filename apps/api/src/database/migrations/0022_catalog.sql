CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" varchar(12) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_reason_ck" CHECK ("inventory_movements"."reason" IN ('adjustment', 'sale', 'return')),
	CONSTRAINT "inventory_movements_delta_ck" CHECK ("inventory_movements"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "product_favorites" (
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_favorites_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"label" varchar(60) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" varchar(8) DEFAULT 'product' NOT NULL,
	"category_code" varchar(40),
	"title" varchar(120) NOT NULL,
	"description" varchar(2000),
	"price_fcfa" integer NOT NULL,
	"compare_at_fcfa" integer,
	"duration_minutes" integer,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_kind_ck" CHECK ("products"."kind" IN ('product', 'service')),
	CONSTRAINT "products_status_ck" CHECK ("products"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "products_price_ck" CHECK ("products"."price_fcfa" > 0 AND "products"."price_fcfa" <= 100000000),
	CONSTRAINT "products_compare_ck" CHECK ("products"."compare_at_fcfa" IS NULL OR "products"."compare_at_fcfa" > "products"."price_fcfa"),
	CONSTRAINT "products_duration_ck" CHECK ("products"."duration_minutes" IS NULL OR ("products"."duration_minutes" BETWEEN 5 AND 1440))
);
--> statement-breakpoint
CREATE TABLE "shop_categories" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(60) NOT NULL,
	"parent_code" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_follows" (
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_follows_user_id_shop_id_pk" PRIMARY KEY("user_id","shop_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_favorites" ADD CONSTRAINT "product_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_favorites" ADD CONSTRAINT "product_favorites_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_code_shop_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."shop_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_variant_idx" ON "inventory_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "product_favorites_product_idx" ON "product_favorites" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "product_media" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_label_uq" ON "product_variants" USING btree ("product_id","label");--> statement-breakpoint
CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "products_catalog_idx" ON "products" USING btree ("status","category_code","published_at");--> statement-breakpoint
CREATE INDEX "shop_categories_parent_idx" ON "shop_categories" USING btree ("parent_code","sort_order");--> statement-breakpoint
CREATE INDEX "shop_follows_shop_idx" ON "shop_follows" USING btree ("shop_id");--> statement-breakpoint
-- Stock jamais négatif (ANALYSE.md, section 8) : vérifié par la base à chaque mouvement, sous verrou de la variante.
CREATE OR REPLACE FUNCTION enforce_non_negative_stock() RETURNS trigger AS $$
DECLARE total integer;
BEGIN
  PERFORM 1 FROM product_variants WHERE id = NEW.variant_id FOR UPDATE;
  SELECT coalesce(sum(delta), 0) INTO total FROM inventory_movements WHERE variant_id = NEW.variant_id;
  IF total < 0 THEN
    RAISE EXCEPTION 'Stock négatif interdit (variante %)', NEW.variant_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_non_negative AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION enforce_non_negative_stock();
--> statement-breakpoint
-- Rubriques du BimShop, reprises de la maquette 33 (référentiel administrable). Les sous-rubriques de « Services »
-- ne sont pas lisibles sur la maquette : à compléter par l'équipe BIM.
INSERT INTO "shop_categories" ("code", "label", "parent_code", "sort_order") VALUES
  ('vetements', 'Vêtements', NULL, 1),
  ('vetements_corporate', 'Corporate', 'vetements', 1),
  ('vetements_plage', 'Plage', 'vetements', 2),
  ('vetements_artistique', 'Artistique / Créatif', 'vetements', 3),
  ('vetements_traditionnel', 'Traditionnel / Culturel', 'vetements', 4),
  ('vetements_soiree', 'Soirée', 'vetements', 5),
  ('vetements_sport', 'Sport', 'vetements', 6),
  ('vetements_autres', 'Autres', 'vetements', 7),
  ('accessoires', 'Accessoires', NULL, 2),
  ('accessoires_chaussures', 'Chaussures', 'accessoires', 1),
  ('accessoires_sacs', 'Sacs', 'accessoires', 2),
  ('accessoires_lunettes', 'Lunettes', 'accessoires', 3),
  ('accessoires_bijoux', 'Bijoux', 'accessoires', 4),
  ('accessoires_montres', 'Montres', 'accessoires', 5),
  ('accessoires_style', 'Accessoires de style', 'accessoires', 6),
  ('accessoires_autres', 'Autres', 'accessoires', 7),
  ('sante', 'Santé / Esthétique', NULL, 3),
  ('sante_visage', 'Soins du visage', 'sante', 1),
  ('sante_corps', 'Soins du corps', 'sante', 2),
  ('sante_minceur', 'Minceur', 'sante', 3),
  ('sante_complements', 'Compléments', 'sante', 4),
  ('sante_hygiene', 'Hygiène', 'sante', 5),
  ('sport', 'Sport & Coaching', NULL, 4),
  ('sport_salles', 'Salles de sport', 'sport', 1),
  ('sport_coachs', 'Coachs', 'sport', 2),
  ('sport_tenues', 'Tenues de sport', 'sport', 3),
  ('sport_equipements', 'Équipements', 'sport', 4),
  ('sport_nutrition', 'Nutrition sportive', 'sport', 5),
  ('services', 'Services', NULL, 5)
ON CONFLICT ("code") DO NOTHING;
