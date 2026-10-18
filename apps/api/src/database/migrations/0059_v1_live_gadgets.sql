ALTER TABLE "lives" ADD COLUMN "pinned_message" varchar(140);--> statement-breakpoint
ALTER TABLE "lives" ADD COLUMN "theme" varchar(12) DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "lives" ADD CONSTRAINT "lives_theme_ck" CHECK ("lives"."theme" IN ('classic', 'sunset', 'ocean', 'gold'));