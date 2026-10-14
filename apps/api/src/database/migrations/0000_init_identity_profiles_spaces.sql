CREATE TYPE "public"."contact_type" AS ENUM('phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('female', 'male', 'undisclosed');--> statement-breakpoint
CREATE TYPE "public"."social_provider" AS ENUM('google', 'apple', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending_verification', 'active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('signup', 'password_reset', 'contact_add', 'step_up');--> statement-breakpoint
CREATE TYPE "public"."theme_preference" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."courier_status" AS ENUM('pending_verification', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."courier_type" AS ENUM('independent', 'freelance', 'employed');--> statement-breakpoint
CREATE TYPE "public"."partnership_status" AS ENUM('pending', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."shop_member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."shop_status" AS ENUM('draft', 'pending_verification', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."admin_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "social_provider" NOT NULL,
	"provider_subject" varchar(255) NOT NULL,
	"email" varchar(254),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier_hash" varchar(64) NOT NULL,
	"ip" "inet",
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"device_name" varchar(120),
	"user_agent" varchar(400),
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "step_up_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" varchar(40) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "contact_type" NOT NULL,
	"value" varchar(254) NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "user_status" DEFAULT 'pending_verification' NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"username" varchar(30) NOT NULL,
	"birth_date" date NOT NULL,
	"gender" "gender",
	"city" varchar(80) NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"purpose" "verification_purpose" NOT NULL,
	"channel" "contact_type" NOT NULL,
	"destination" varchar(254) NOT NULL,
	"scope" varchar(40),
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(60) NOT NULL,
	"icon" varchar(40) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"birth_date_public" boolean DEFAULT false NOT NULL,
	"gender_public" boolean DEFAULT false NOT NULL,
	"city_public" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"user_id" uuid NOT NULL,
	"interest_code" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_interests_user_id_interest_code_pk" PRIMARY KEY("user_id","interest_code")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" "theme_preference" DEFAULT 'system' NOT NULL,
	"language" varchar(5) DEFAULT 'fr' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "courier_type" NOT NULL,
	"status" "courier_status" DEFAULT 'pending_verification' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_shop_partnerships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"courier_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" "partnership_status" DEFAULT 'pending' NOT NULL,
	"can_collect_article_payment" boolean DEFAULT false NOT NULL,
	"max_outstanding_fcfa" bigint,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_members" (
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "shop_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"status" "shop_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_roles" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(80) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_user_roles" (
	"admin_id" uuid NOT NULL,
	"role_code" varchar(40) NOT NULL,
	CONSTRAINT "admin_user_roles_admin_id_role_code_pk" PRIMARY KEY("admin_id","role_code")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"status" "admin_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text NOT NULL,
	"decision_status" varchar(12) DEFAULT 'pending' NOT NULL,
	"decision_ref" varchar(40),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"ip" "inet",
	"user_agent" varchar(400),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_grants" ADD CONSTRAINT "step_up_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_code_interests_code_fk" FOREIGN KEY ("interest_code") REFERENCES "public"."interests"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD CONSTRAINT "courier_shop_partnerships_courier_id_courier_accounts_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD CONSTRAINT "courier_shop_partnerships_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_code_admin_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."admin_roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_uq" ON "auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "login_attempts_identifier_idx" ON "login_attempts" USING btree ("identifier_hash","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_hash_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_up_grants_token_uq" ON "step_up_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_contacts_user_type_value_uq" ON "user_contacts" USING btree ("user_id","type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "user_contacts_verified_value_uq" ON "user_contacts" USING btree ("type","value") WHERE "user_contacts"."verified_at" is not null;--> statement-breakpoint
CREATE INDEX "user_contacts_lookup_idx" ON "user_contacts" USING btree ("type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_codes_user_idx" ON "verification_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_codes_dest_idx" ON "verification_codes" USING btree ("destination");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_accounts_user_uq" ON "courier_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_shop_active_uq" ON "courier_shop_partnerships" USING btree ("courier_id","shop_id") WHERE "courier_shop_partnerships"."status" <> 'ended';--> statement-breakpoint
CREATE UNIQUE INDEX "shop_members_shop_user_uq" ON "shop_members" USING btree ("shop_id","user_id");--> statement-breakpoint
CREATE INDEX "shop_members_user_idx" ON "shop_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_slug_uq" ON "shops" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "shops_owner_idx" ON "shops" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");