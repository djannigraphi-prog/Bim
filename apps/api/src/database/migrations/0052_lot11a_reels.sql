CREATE TABLE "reel_likes" (
	"reel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reel_likes_reel_id_user_id_pk" PRIMARY KEY("reel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reel_views" (
	"reel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reel_views_reel_id_user_id_pk" PRIMARY KEY("reel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"caption" varchar(300),
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"status" varchar(10) DEFAULT 'published' NOT NULL,
	"duration_ms" integer NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" integer NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"coin_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reels_visibility_ck" CHECK ("reels"."visibility" IN ('public', 'followers')),
	CONSTRAINT "reels_status_ck" CHECK ("reels"."status" IN ('published', 'hidden', 'deleted')),
	CONSTRAINT "reels_counts_ck" CHECK ("reels"."like_count" >= 0 AND "reels"."coin_count" >= 0 AND "reels"."view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_ck";--> statement-breakpoint
ALTER TABLE "coin_gifts" DROP CONSTRAINT "coin_gifts_target_ck";--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD COLUMN "reel_id" uuid;--> statement-breakpoint
ALTER TABLE "reel_likes" ADD CONSTRAINT "reel_likes_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_likes" ADD CONSTRAINT "reel_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_views" ADD CONSTRAINT "reel_views_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_views" ADD CONSTRAINT "reel_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reel_likes_user_idx" ON "reel_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reel_views_user_idx" ON "reel_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reels_feed_idx" ON "reels" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "reels_user_idx" ON "reels" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_gifts_reel_idx" ON "coin_gifts" USING btree ("reel_id");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_ck" CHECK ("content_reports"."target_type" IN ('post', 'comment', 'user', 'story', 'message', 'review', 'reel'));--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_target_ck" CHECK (("coin_gifts"."target_type" = 'post' AND "coin_gifts"."post_id" IS NOT NULL AND "coin_gifts"."comment_id" IS NULL AND "coin_gifts"."live_id" IS NULL AND "coin_gifts"."reel_id" IS NULL) OR ("coin_gifts"."target_type" = 'comment' AND "coin_gifts"."post_id" IS NOT NULL AND "coin_gifts"."comment_id" IS NOT NULL AND "coin_gifts"."live_id" IS NULL AND "coin_gifts"."reel_id" IS NULL) OR ("coin_gifts"."target_type" = 'live' AND "coin_gifts"."live_id" IS NOT NULL AND "coin_gifts"."post_id" IS NULL AND "coin_gifts"."comment_id" IS NULL AND "coin_gifts"."reel_id" IS NULL) OR ("coin_gifts"."target_type" = 'reel' AND "coin_gifts"."reel_id" IS NOT NULL AND "coin_gifts"."post_id" IS NULL AND "coin_gifts"."comment_id" IS NULL AND "coin_gifts"."live_id" IS NULL));