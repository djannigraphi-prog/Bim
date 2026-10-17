-- Lot 8 — décisions du fondateur du 17/10/2026 (L8-02). Le paiement en ligne reste fermé :
-- `payments.online_enabled` est inchangé (false, en attente) et aucun prestataire n'est configuré.
-- 1. Les frais du prestataire sont supportés par la boutique (décision définitive) ; BIM ne prélève aucune commission.
UPDATE app_settings
SET value = '"shop"', decision_status = 'decided', decision_ref = 'L8-02', updated_by = 'migration',
    description = 'Frais du prestataire de paiement supportés par la boutique (décision définitive du 17/10/2026, L8-02) ; BIM ne prélève aucune commission'
WHERE key = 'payments.fee_bearer';
--> statement-breakpoint
-- 2. Conditions (frais applicables) communiquées aux boutiques avant toute activation : tant qu'elles ne sont pas
--    publiées (texte décidé), le paiement en ligne reste fermé.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('payments.shop_fee_terms', 'null', 'Frais du prestataire communiqués aux boutiques avant l''activation (texte affiché dans l''espace boutique). Non publiés : paiement en ligne fermé', 'pending', 'L8-02', 'migration')
ON CONFLICT (key) DO NOTHING;
