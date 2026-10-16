-- Lot 7-A (16/10/2026) — Références des articles, réputation par version de contenu, équipe des boutiques.
-- Migration additive : nouvelles tables, colonnes avec valeur par défaut, statut « hidden » ajouté.
CREATE TABLE "shop_member_permissions" (
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" varchar(32) NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_member_permissions_shop_id_user_id_permission_pk" PRIMARY KEY("shop_id","user_id","permission"),
	CONSTRAINT "shop_member_permissions_ck" CHECK ("shop_member_permissions"."permission" IN ('orders.read', 'orders.prepare', 'products.edit', 'products.publish', 'products.visibility', 'messages.reply', 'deliveries.select_courier', 'deliveries.settings', 'payments.decide'))
);
--> statement-breakpoint
CREATE TABLE "product_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"changed_fields" varchar(200) NOT NULL,
	"previous" jsonb NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_status_ck";--> statement-breakpoint
ALTER TABLE "shop_members" ADD COLUMN "accepted_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "shop_members" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "product_favorites" ADD COLUMN "product_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- 7-A (A13) : référence publique BIM-000001… Les articles existants sont numérotés dans l'ordre de création ;
-- ensuite la séquence attribue les numéros (jamais réutilisés, trous possibles après une création annulée).
CREATE SEQUENCE "product_reference_seq" AS bigint START WITH 1 MINVALUE 1;--> statement-breakpoint
CREATE OR REPLACE FUNCTION bim_product_reference(n bigint) RETURNS varchar AS $$
  SELECT 'BIM-' || lpad(n::text, greatest(6, length(n::text)), '0')
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reference" varchar(20);--> statement-breakpoint
UPDATE "products" p SET "reference" = bim_product_reference(r.n)
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM "products") r WHERE r.id = p.id;--> statement-breakpoint
SELECT setval('product_reference_seq', greatest((SELECT count(*) FROM "products"), 1), (SELECT count(*) FROM "products") > 0);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "reference" SET DEFAULT bim_product_reference(nextval('product_reference_seq'));--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "reference" SET NOT NULL;--> statement-breakpoint
-- Référence immuable : aucune mise à jour, quelle que soit la requête.
CREATE OR REPLACE FUNCTION forbid_product_reference_change() RETURNS trigger AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'La référence d''un article ne peut pas être modifiée (%)', OLD.reference USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER products_reference_immutable BEFORE UPDATE OF reference ON "products" FOR EACH ROW EXECUTE FUNCTION forbid_product_reference_change();--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reputation_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_member_permissions" ADD CONSTRAINT "shop_member_permissions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_member_permissions" ADD CONSTRAINT "shop_member_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_member_permissions" ADD CONSTRAINT "shop_member_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_revisions_version_uq" ON "product_revisions" USING btree ("product_id","version");--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_reference_uq" ON "products" USING btree ("reference");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_ck" CHECK ("products"."status" IN ('draft', 'published', 'hidden', 'archived'));--> statement-breakpoint
-- Articles déjà publiés puis retirés de la vente (ancien « brouillon » après publication) : « visibles par moi
-- uniquement ». Rien d'autre ne change.
UPDATE "products" SET "status" = 'hidden' WHERE "status" = 'draft' AND "published_at" IS NOT NULL;