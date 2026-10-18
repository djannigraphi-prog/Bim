CREATE TABLE "live_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"live_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" varchar(300) NOT NULL,
	"status" varchar(10) DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_comments_status_ck" CHECK ("live_comments"."status" IN ('published', 'hidden'))
);
--> statement-breakpoint
CREATE TABLE "live_viewers" (
	"live_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_viewers_live_id_user_id_pk" PRIMARY KEY("live_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"host_user_id" uuid NOT NULL,
	"shop_id" uuid,
	"kind" varchar(8) NOT NULL,
	"title" varchar(100) NOT NULL,
	"status" varchar(10) NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"pinned_product_id" uuid,
	"heart_count" integer DEFAULT 0 NOT NULL,
	"coin_count" integer DEFAULT 0 NOT NULL,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lives_kind_ck" CHECK (("lives"."kind" = 'simple' AND "lives"."shop_id" IS NULL) OR ("lives"."kind" = 'sale' AND "lives"."shop_id" IS NOT NULL)),
	CONSTRAINT "lives_status_ck" CHECK ("lives"."status" IN ('scheduled', 'live', 'ended')),
	CONSTRAINT "lives_counts_ck" CHECK ("lives"."heart_count" >= 0 AND "lives"."coin_count" >= 0 AND "lives"."peak_viewers" >= 0)
);
--> statement-breakpoint
ALTER TABLE "coin_gifts" DROP CONSTRAINT "coin_gifts_target_ck";--> statement-breakpoint
ALTER TABLE "coin_gifts" ALTER COLUMN "post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD COLUMN "live_id" uuid;--> statement-breakpoint
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_viewers" ADD CONSTRAINT "live_viewers_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_viewers" ADD CONSTRAINT "live_viewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lives" ADD CONSTRAINT "lives_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lives" ADD CONSTRAINT "lives_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lives" ADD CONSTRAINT "lives_pinned_product_id_products_id_fk" FOREIGN KEY ("pinned_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_comments_live_idx" ON "live_comments" USING btree ("live_id","id");--> statement-breakpoint
CREATE INDEX "live_comments_user_idx" ON "live_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "live_viewers_user_idx" ON "live_viewers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lives_status_idx" ON "lives" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "lives_scheduled_idx" ON "lives" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "lives_host_idx" ON "lives" USING btree ("host_user_id","created_at");--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_gifts_live_idx" ON "coin_gifts" USING btree ("live_id","created_at");--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_target_ck" CHECK (("coin_gifts"."target_type" = 'post' AND "coin_gifts"."post_id" IS NOT NULL AND "coin_gifts"."comment_id" IS NULL AND "coin_gifts"."live_id" IS NULL) OR ("coin_gifts"."target_type" = 'comment' AND "coin_gifts"."post_id" IS NOT NULL AND "coin_gifts"."comment_id" IS NOT NULL AND "coin_gifts"."live_id" IS NULL) OR ("coin_gifts"."target_type" = 'live' AND "coin_gifts"."live_id" IS NOT NULL AND "coin_gifts"."post_id" IS NULL AND "coin_gifts"."comment_id" IS NULL));