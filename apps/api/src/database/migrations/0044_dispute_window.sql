-- Lot 7-G — Délai de contestation après la remise (§12, valeur initiale proposée, A10 : à vérifier).
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('orders.dispute_window_days', '7', 'Délai (jours) pour contester une commande après la remise ; au-delà, le support reste joignable par « Aide »', 'provisional', 'A10', 'migration')
ON CONFLICT (key) DO NOTHING;
