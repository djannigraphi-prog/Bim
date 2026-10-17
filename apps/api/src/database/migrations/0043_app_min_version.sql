-- Lot 7-A — Version minimale de l'app mobile, par plateforme (« x.y.z »). Valeur null, en attente : aucune exigence ;
-- à décider (et à publier dans l'administration) avant l'ouverture des commandes.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('app.min_version_android', 'null', 'Version minimale de l''app Android (x.y.z) ; plus ancienne : « Mise à jour nécessaire ». Null : aucune exigence', 'pending', '7-A', 'migration'),
  ('app.min_version_ios', 'null', 'Version minimale de l''app iOS (x.y.z) ; plus ancienne : « Mise à jour nécessaire ». Null : aucune exigence', 'pending', '7-A', 'migration')
ON CONFLICT (key) DO NOTHING;
