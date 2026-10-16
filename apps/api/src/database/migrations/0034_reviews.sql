CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(6) NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid,
	"product_id" uuid,
	"product_reference" varchar(20),
	"content_version" integer,
	"shop_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" varchar(1000),
	"status" varchar(10) DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_kind_ck" CHECK ("reviews"."kind" IN ('item', 'shop')),
	CONSTRAINT "reviews_item_ck" CHECK (("reviews"."kind" = 'item') = ("reviews"."order_item_id" IS NOT NULL AND "reviews"."product_id" IS NOT NULL AND "reviews"."product_reference" IS NOT NULL AND "reviews"."content_version" IS NOT NULL)),
	CONSTRAINT "reviews_rating_ck" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_status_ck" CHECK ("reviews"."status" IN ('published', 'hidden', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_ck";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_item_uq" ON "reviews" USING btree ("order_item_id") WHERE "reviews"."kind" = 'item';--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_shop_uq" ON "reviews" USING btree ("order_id") WHERE "reviews"."kind" = 'shop';--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_shop_idx" ON "reviews" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_ck" CHECK ("content_reports"."target_type" IN ('post', 'comment', 'user', 'story', 'message', 'review'));--> statement-breakpoint
-- Une évaluation ne se supprime pas (l'auteur la retire : statut « deleted ») ; la note et le texte ne changent plus.
CREATE OR REPLACE FUNCTION forbid_review_rewrite() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une évaluation ne se supprime pas' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.rating IS DISTINCT FROM OLD.rating OR NEW.comment IS DISTINCT FROM OLD.comment OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id OR NEW.product_reference IS DISTINCT FROM OLD.product_reference THEN
    RAISE EXCEPTION 'Une évaluation publiée ne se réécrit pas' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER reviews_frozen BEFORE UPDATE OR DELETE ON "reviews" FOR EACH ROW EXECUTE FUNCTION forbid_review_rewrite();--> statement-breakpoint
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('reviews.window_days', '30', 'Jours après la remise pendant lesquels le client peut évaluer (proposé, A17)', 'provisional', 'A17', 'migration')
ON CONFLICT (key) DO NOTHING;
