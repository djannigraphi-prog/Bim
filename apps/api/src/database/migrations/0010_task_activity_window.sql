ALTER TABLE "project_tasks" ADD COLUMN "active_from" date;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN "active_until" date;--> statement-breakpoint
-- Reprise de l'historique (jours à l'heure d'Abidjan = UTC) : une tâche retirée cesse de compter le jour de son retrait ;
-- une tâche ajoutée par la personne après le début du projet compte à partir du jour de son ajout.
UPDATE "project_tasks" SET "active_until" = ("removed_at" AT TIME ZONE 'UTC')::date WHERE "removed_at" IS NOT NULL;--> statement-breakpoint
UPDATE "project_tasks" t SET "active_from" = (t."created_at" AT TIME ZONE 'UTC')::date FROM "projects" p
  WHERE p."id" = t."project_id" AND t."origin" = 'user' AND (t."created_at" AT TIME ZONE 'UTC')::date > p."start_date";--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_active_ck" CHECK ("project_tasks"."active_until" IS NULL OR "project_tasks"."active_from" IS NULL OR "project_tasks"."active_until" >= "project_tasks"."active_from");