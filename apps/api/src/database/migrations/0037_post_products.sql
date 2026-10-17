CREATE TABLE "post_products" (
	"post_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_products_post_id_product_id_pk" PRIMARY KEY("post_id","product_id"),
	CONSTRAINT "post_products_position_ck" CHECK ("post_products"."position" BETWEEN 0 AND 4)
);
--> statement-breakpoint
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_products_position_uq" ON "post_products" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "post_products_product_idx" ON "post_products" USING btree ("product_id");