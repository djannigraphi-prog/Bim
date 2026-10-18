CREATE TABLE "coin_gifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"target_type" varchar(8) NOT NULL,
	"post_id" uuid NOT NULL,
	"comment_id" uuid,
	"gift_code" varchar(20) NOT NULL,
	"quantity" integer NOT NULL,
	"coins" integer NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_gifts_target_ck" CHECK (("coin_gifts"."target_type" = 'post' AND "coin_gifts"."comment_id" IS NULL) OR ("coin_gifts"."target_type" = 'comment' AND "coin_gifts"."comment_id" IS NOT NULL)),
	CONSTRAINT "coin_gifts_coins_ck" CHECK ("coin_gifts"."coins" > 0 AND "coin_gifts"."quantity" > 0),
	CONSTRAINT "coin_gifts_self_ck" CHECK ("coin_gifts"."sender_id" <> "coin_gifts"."recipient_id")
);
--> statement-breakpoint
CREATE TABLE "coin_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"bucket" varchar(10) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"delta" integer NOT NULL,
	"ref_id" uuid NOT NULL,
	"channel" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_ledger_bucket_ck" CHECK ("coin_ledger"."bucket" IN ('purchased', 'received')),
	CONSTRAINT "coin_ledger_kind_ck" CHECK ("coin_ledger"."kind" IN ('purchase', 'gift_sent', 'gift_received', 'withdrawal', 'withdrawal_refund')),
	CONSTRAINT "coin_ledger_delta_ck" CHECK ("coin_ledger"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "coin_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"coins" integer NOT NULL,
	"price_fcfa" integer NOT NULL,
	"channel" varchar(10) NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_purchases_coins_ck" CHECK ("coin_purchases"."coins" > 0),
	CONSTRAINT "coin_purchases_channel_ck" CHECK ("coin_purchases"."channel" IN ('demo'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" varchar(20) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"price_fcfa" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_channel_ck" CHECK ("subscriptions"."channel" IN ('demo'))
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"purchased" integer DEFAULT 0 NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_purchased_ck" CHECK ("wallets"."purchased" >= 0),
	CONSTRAINT "wallets_received_ck" CHECK ("wallets"."received" >= 0)
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"coins" integer NOT NULL,
	"fee_fcfa" integer NOT NULL,
	"net_fcfa" integer NOT NULL,
	"operator" varchar(10) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"status" varchar(10) NOT NULL,
	"review_reason" varchar(10),
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason" varchar(300),
	"idempotency_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_status_ck" CHECK ("withdrawals"."status" IN ('review', 'paid', 'rejected')),
	CONSTRAINT "withdrawals_operator_ck" CHECK ("withdrawals"."operator" IN ('orange', 'mtn', 'moov', 'wave')),
	CONSTRAINT "withdrawals_channel_ck" CHECK ("withdrawals"."channel" IN ('demo')),
	CONSTRAINT "withdrawals_amount_ck" CHECK ("withdrawals"."coins" > 0 AND "withdrawals"."fee_fcfa" >= 0 AND "withdrawals"."net_fcfa" = "withdrawals"."coins" - "withdrawals"."fee_fcfa")
);
--> statement-breakpoint
ALTER TABLE "post_comments" ADD COLUMN "coin_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "coin_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_comment_id_post_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_decided_by_admin_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_gifts_idem_uq" ON "coin_gifts" USING btree ("sender_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "coin_gifts_post_idx" ON "coin_gifts" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "coin_gifts_comment_idx" ON "coin_gifts" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "coin_gifts_recipient_idx" ON "coin_gifts" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "coin_ledger_user_idx" ON "coin_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_purchases_idem_uq" ON "coin_purchases" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","plan","current_period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_idem_uq" ON "withdrawals" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status","created_at");