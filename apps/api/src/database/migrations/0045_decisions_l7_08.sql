-- Décisions du fondateur du 17/10/2026 (14 h 21).
-- L7-08 : un problème se signale dans les 3 jours suivant la remise ; ensuite, la vente est close. Il se règle entre le
-- client et la boutique (sans le support) ; le client garde son évaluation de la boutique, qui agit sur sa réputation.
UPDATE app_settings
SET value = '3', decision_status = 'decided', decision_ref = 'L7-08', updated_by = 'migration',
    description = 'Délai (jours) pour signaler un problème après la remise ; ensuite la vente est close (décision L7-08)'
WHERE key = 'orders.dispute_window_days';
--> statement-breakpoint
-- L7-09 : mise à jour recommandée, rappelée sans bloquer ; le blocage (version minimale) reste réservé au nécessaire.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('app.recommended_version_android', 'null', 'Version recommandée de l''app Android (x.y.z) : rappel non bloquant à chaque ouverture si l''app est plus ancienne. Null : aucun rappel', 'pending', 'L7-09', 'migration'),
  ('app.recommended_version_ios', 'null', 'Version recommandée de l''app iOS (x.y.z) : rappel non bloquant à chaque ouverture si l''app est plus ancienne. Null : aucun rappel', 'pending', 'L7-09', 'migration')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
UPDATE app_settings
SET description = 'Version minimale de l''app Android (x.y.z) : bloque une app plus ancienne — à réserver au strict nécessaire (sécurité, incompatibilité), L7-09. Null : aucun blocage'
WHERE key = 'app.min_version_android';
--> statement-breakpoint
UPDATE app_settings
SET description = 'Version minimale de l''app iOS (x.y.z) : bloque une app plus ancienne — à réserver au strict nécessaire (sécurité, incompatibilité), L7-09. Null : aucun blocage'
WHERE key = 'app.min_version_ios';
