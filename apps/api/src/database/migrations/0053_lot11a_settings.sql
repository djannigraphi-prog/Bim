-- Lot 11 (prototype) — Reels : valeurs proposées (provisional), modifiables dans l'administration.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('reels.max_seconds', '60', 'Durée maximale d''un Reel, en secondes (proposé : 60)', 'provisional', 'P-0018', 'migration'),
  ('reels.daily_limit', '10', 'Reels publiés au plus par personne sur 24 heures (proposé : 10)', 'provisional', 'P-0018', 'migration')
ON CONFLICT (key) DO NOTHING;
