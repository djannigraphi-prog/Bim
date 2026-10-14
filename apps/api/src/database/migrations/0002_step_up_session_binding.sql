-- Les autorisations step-up durent 5 minutes : on purge celles qui existent avant d'ajouter la colonne obligatoire.
DELETE FROM "step_up_grants";
--> statement-breakpoint
ALTER TABLE "step_up_grants" ADD COLUMN "session_id" uuid NOT NULL;
