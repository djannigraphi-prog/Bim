-- Conservation des discussions avec Peni (lot 3, demande du fondateur du 15/10/2026, 17 h 48) : mécanisme prêt, mais
-- AUCUNE durée fixée. Tant que la valeur est null ou que le réglage n'est pas marqué « decided », rien n'est supprimé.
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('peni.conversation_retention_days', 'null', 'Durée de conservation des discussions avec Peni, en jours depuis leur dernière activité (minimum 7). Null : aucune suppression. À valider après examen de la confidentialité et de la réglementation.', 'pending', 'T-032', 'migration')
ON CONFLICT ("key") DO NOTHING;
