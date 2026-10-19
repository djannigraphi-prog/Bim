-- V1 (19/10/2026, décisions du fondateur) :
-- 1. Cadeaux : le Bateau pirate vient avant la Banque ; Bateau pirate 100 000 pièces, Banque 200 000 pièces. Seules
--    ces deux entrées changent, et seulement si elles ont encore les valeurs d'origine (aucune valeur choisie par
--    l'équipe n'est écrasée).
UPDATE app_settings
SET value = (
      SELECT jsonb_agg(g ORDER BY ord)
      FROM (
        SELECT CASE e->>'code'
                 WHEN 'ship' THEN jsonb_set(e, '{coins}', '100000')
                 WHEN 'bank' THEN jsonb_set(e, '{coins}', '200000')
                 ELSE e
               END AS g,
               CASE e->>'code' WHEN 'ship' THEN 6.5 ELSE i END AS ord
        FROM jsonb_array_elements(value) WITH ORDINALITY AS t(e, i)
      ) x
    ),
    description = '8 cadeaux de 1 à 200 000 pièces (écran 13) ; Bateau pirate avant la Banque (V1-1910-G)',
    decision_ref = 'V1-1910-G',
    updated_by = 'migration',
    updated_at = now()
WHERE key = 'coins.gifts'
  AND value @> '[{"code":"bank","coins":10000},{"code":"ship","coins":100000}]'::jsonb;
--> statement-breakpoint
-- 2. Achat de pièces : « Autre montant », la personne choisit elle-même le nombre de pièces, entre deux bornes
--    (proposées, modifiables dans l'administration).
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('coins.custom_min', '100', 'Achat de pièces, « Autre montant » : minimum (1 pièce = 1 F)', 'provisional', 'V1-1910-G', 'migration'),
  ('coins.custom_max', '1000000', 'Achat de pièces, « Autre montant » : maximum par achat', 'provisional', 'V1-1910-G', 'migration')
ON CONFLICT (key) DO NOTHING;
