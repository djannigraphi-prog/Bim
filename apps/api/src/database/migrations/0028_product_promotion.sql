-- L7-04 (16/10/2026) — Prix normal fixe et promotion séparée. Le prix normal, le nom et la description d'une fiche ne
-- se modifient plus après sa création ; la promotion s'active, se modifie et se supprime sans toucher à la réputation.
ALTER TABLE "products" ADD COLUMN "promo_price_fcfa" integer;--> statement-breakpoint
-- Ancien « prix barré » : le prix barré était le prix normal et le prix affiché la promotion. Reprise sans perte.
UPDATE "products" SET "promo_price_fcfa" = "price_fcfa", "price_fcfa" = "compare_at_fcfa", "compare_at_fcfa" = NULL WHERE "compare_at_fcfa" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_promo_ck" CHECK ("products"."promo_price_fcfa" IS NULL OR ("products"."promo_price_fcfa" > 0 AND "products"."promo_price_fcfa" < "products"."price_fcfa"));--> statement-breakpoint
-- Identité de la fiche figée après la création, quelle que soit la requête (défense en profondeur).
CREATE OR REPLACE FUNCTION forbid_product_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description OR NEW.price_fcfa IS DISTINCT FROM OLD.price_fcfa THEN
    RAISE EXCEPTION 'Le nom, la description et le prix normal d''un article ne se modifient pas (%) : nouvelle fiche nécessaire', OLD.reference USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER products_identity_frozen BEFORE UPDATE OF title, description, price_fcfa ON "products" FOR EACH ROW EXECUTE FUNCTION forbid_product_identity_change();
