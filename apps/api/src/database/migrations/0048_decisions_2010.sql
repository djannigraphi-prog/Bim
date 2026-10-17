-- Décisions du fondateur du 17/10/2026 (20 h 10).
-- Discussions avec Peni : supprimées après 1 an sans activité (T-032).
UPDATE app_settings SET value = '365', decision_status = 'decided', decision_ref = 'D-2010', updated_by = 'migration',
  description = 'Discussions avec Peni supprimées après ce nombre de jours sans activité (décidé : 365)'
WHERE key = 'peni.conversation_retention_days';
