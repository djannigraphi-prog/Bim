CREATE TABLE "product_recommendations" (
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_recommendations_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "product_videos" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_videos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_videos_format_ck" CHECK ("product_videos"."width" > 0 AND "product_videos"."height" > 0 AND "product_videos"."width" <= "product_videos"."height"),
	CONSTRAINT "product_videos_duration_ck" CHECK ("product_videos"."duration_ms" > 0 AND "product_videos"."duration_ms" <= 60500)
);
--> statement-breakpoint
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_videos" ADD CONSTRAINT "product_videos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_recommendations_product_idx" ON "product_recommendations" USING btree ("product_id","product_version");