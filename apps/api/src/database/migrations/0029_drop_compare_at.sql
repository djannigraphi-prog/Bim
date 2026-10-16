-- L7-04 : l'ancien prix barré a été repris dans promo_price_fcfa (0028) ; la colonne, vide, est retirée.
ALTER TABLE "products" DROP CONSTRAINT "products_compare_ck";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "compare_at_fcfa";