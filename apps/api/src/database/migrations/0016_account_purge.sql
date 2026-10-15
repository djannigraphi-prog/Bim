CREATE TABLE "maintenance_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" varchar(40) NOT NULL,
	"mode" varchar(12) NOT NULL,
	"status" varchar(12) NOT NULL,
	"trigger" varchar(12) NOT NULL,
	"candidates" integer NOT NULL,
	"deleted" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "maintenance_runs_job_idx" ON "maintenance_runs" USING btree ("job","started_at");--> statement-breakpoint
-- Purge des comptes jamais vérifiés (décision du fondateur du 15/10/2026, 15 h 44) : préparée et testée, mais
-- DÉSACTIVÉE et en SIMULATION par défaut. La suppression réelle demande sa validation explicite : interrupteur à true,
-- mode « real », et ces deux réglages marqués « decided » dans l'administration.
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('maintenance.account_purge_enabled', 'false', 'Purge quotidienne des comptes jamais vérifiés. Reste à false tant que le fondateur ne l''a pas validée.', 'pending', 'T-030', 'migration'),
  ('maintenance.account_purge_mode', '"simulation"', 'simulation : compte les comptes concernés sans rien supprimer. real : suppression, seulement après validation explicite du fondateur (réglage marqué decided).', 'pending', 'T-030', 'migration'),
  ('maintenance.account_purge_after_days', '30', 'Délai avant la purge d''un compte jamais vérifié, en jours (minimum 30, imposé par le code).', 'decided', 'T-030', 'migration')
ON CONFLICT ("key") DO NOTHING;
