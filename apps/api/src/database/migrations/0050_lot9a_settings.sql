-- Lot 9-A (prototype) — Premium, pièces et retraits. Valeurs « provisional » : réponses conseillées du questionnaire du
-- 17/10/2026, appliquées en attendant la réponse du fondateur (demande du 18/10/2026, 00 h 17) ; modifiables dans
-- l'administration. Aucun achat ni retrait réel : seul le circuit « demo » existe (DEMO_MODE, interdit en production).
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('premium.user_price_fcfa', '2000', 'Prix mensuel de Premium utilisateur, en F (proposé : 2 000 F, question PRIX)', 'provisional', 'PRIX', 'migration'),
  ('coins.packs', '[100, 500, 1000, 5000, 10000, 50000]', 'Packs de pièces (écran 60), 1 pièce = 1 F, sans frais ajoutés à l''achat (S2 non retenue)', 'provisional', 'Q55', 'migration'),
  ('coins.gifts', '[{"code":"coin1","name":"Pièce","coins":1},{"code":"coin5","name":"5 pièces","coins":5},{"code":"purse","name":"Porte-monnaie","coins":50},{"code":"chest_s","name":"Petit coffre","coins":100},{"code":"chest_l","name":"Grand coffre","coins":500},{"code":"safe","name":"Coffre-fort","coins":1000},{"code":"bank","name":"Banque","coins":10000},{"code":"ship","name":"Bateau pirate","coins":100000}]', '8 cadeaux de 1 à 100 000 pièces (écran 13) ; valeurs intermédiaires proposées', 'provisional', 'Q56', 'migration'),
  ('coins.withdraw_min', '5000', 'Retrait minimal, en pièces (proposé : 5 000, questions F13-S6 et MIN)', 'provisional', 'MIN', 'migration'),
  ('coins.withdraw_daily_cap', '5000000', 'Plafond des retraits sur 24 heures, en pièces (proposé : 5 millions, question F14)', 'provisional', 'F14', 'migration'),
  ('coins.withdraw_instant_max', '100000', 'Au-delà, le retrait est vérifié par l''équipe (proposé : 100 000, question DELAI)', 'provisional', 'DELAI', 'migration'),
  ('coins.withdraw_fee_percent', '1', 'Frais de l''opérateur au retrait, à la charge de la personne (S3), en % ; commission BIM : 0', 'provisional', 'F13', 'migration')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- Abonnement payant (Premium) : 18 ans, comme l'achat de pièces, en attendant la vérification légale (F15).
UPDATE app_settings SET value = '18', decision_status = 'provisional', updated_by = 'migration',
  description = 'Âge minimum pour souscrire un abonnement payant (proposé : 18 ans, comme les pièces ; à vérifier avec l''avocat)'
WHERE key = 'age.min_paid_subscription' AND decision_status = 'pending';
