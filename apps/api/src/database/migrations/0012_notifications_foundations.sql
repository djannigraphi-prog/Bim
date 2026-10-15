CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"quiet_start" varchar(5),
	"quiet_end" varchar(5),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_quiet_ck" CHECK (("notification_preferences"."quiet_start" IS NULL) = ("notification_preferences"."quiet_end" IS NULL)),
	CONSTRAINT "notification_prefs_time_ck" CHECK ("notification_preferences"."quiet_start" IS NULL OR ("notification_preferences"."quiet_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "notification_preferences"."quiet_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_family_id" uuid NOT NULL,
	"platform" varchar(8) NOT NULL,
	"token" varchar(4096) NOT NULL,
	"app_version" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_platform_ck" CHECK ("push_devices"."platform" IN ('android', 'ios'))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_family_uq" ON "push_devices" USING btree ("session_family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_uq" ON "push_devices" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
-- Réglages des rappels (lot 2) : NON VALIDÉS par le fondateur (decision_status = pending). Rappels désactivés.
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('notifications.reminders_enabled', 'false', 'Interrupteur général des rappels (lot 2). Reste à false tant que le fondateur n''a pas validé la mise en service.', 'pending', 'LOT2_RAPPELS_ETUDE', 'migration'),
  ('notifications.reminder_offsets_minutes', '[0, 60, 120]', 'Rappels après l''heure de la tâche, en minutes, tant qu''elle n''est pas cochée (proposition : 0, +1 h, +2 h ; écrans 27 et 28).', 'pending', 'LOT2_RAPPELS_ETUDE', 'migration'),
  ('notifications.quiet_hours', '{"start": "22:00", "end": "06:00"}', 'Heures calmes par défaut, à l''heure locale (proposition) ; chaque personne peut les changer.', 'pending', 'LOT2_RAPPELS_ETUDE', 'migration'),
  ('notifications.reminder_grace_minutes', '30', 'Retard maximal d''un rappel (panne, reprise) : au-delà, il n''est plus envoyé et il est compté comme manqué.', 'provisional', 'LOT2_RAPPELS_ETUDE', 'migration')
ON CONFLICT ("key") DO NOTHING;
