-- V1 (19/10/2026, décision du fondateur) : le Bateau pirate vient avant la Banque, et leurs valeurs s'échangent
-- (Bateau pirate 10 000 pièces, Banque 100 000 pièces). Seules ces deux entrées changent ; les autres cadeaux et
-- toute valeur déjà modifiée par l'équipe pour d'autres cadeaux sont conservés.
UPDATE app_settings
SET value = (
      SELECT jsonb_agg(g ORDER BY ord)
      FROM (
        SELECT CASE e->>'code'
                 WHEN 'ship' THEN jsonb_set(e, '{coins}', '10000')
                 WHEN 'bank' THEN jsonb_set(e, '{coins}', '100000')
                 ELSE e
               END AS g,
               CASE e->>'code' WHEN 'ship' THEN 6.5 ELSE i END AS ord
        FROM jsonb_array_elements(value) WITH ORDINALITY AS t(e, i)
      ) x
    ),
    decision_ref = 'V1-1910-G',
    updated_by = 'migration',
    updated_at = now()
WHERE key = 'coins.gifts'
  AND value @> '[{"code":"bank","coins":10000},{"code":"ship","coins":100000}]'::jsonb;
