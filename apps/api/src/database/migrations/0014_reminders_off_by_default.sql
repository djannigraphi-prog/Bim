-- Rappels désactivés par défaut (décision du fondateur, 15/10/2026) : la personne les active elle-même.
-- Aucune ligne existante n’est modifiée : aucune donnée de production à ce jour (rien n’est déployé).
ALTER TABLE "notification_preferences" ALTER COLUMN "reminders_enabled" SET DEFAULT false;
