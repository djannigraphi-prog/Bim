-- Référentiels du lot 1, relevés sur les maquettes 19, 20, 21 et 27. Tout est modifiable par l'administration.
-- Aucun modèle de programme n'est créé ici : leur contenu doit être rédigé et validé par l'équipe BIM.
INSERT INTO "project_categories" ("code", "label", "icon", "tint", "sort_order") VALUES
  ('sport', 'Sport', 'dumbbell', '#FDECEF', 10),
  ('style_look', 'Style & look', 'shirt', '#EEF0FF', 20),
  ('visage_peau', 'Visage & peau', 'sparkles', '#FFF4E5', 30),
  ('cheveux_coiffure', 'Cheveux & coiffure', 'scissors', '#EAF3FF', 40),
  ('ongles_mains', 'Ongles & mains', 'hand', '#FDEFF3', 50),
  ('maquillage', 'Maquillage', 'brush', '#F3EEFF', 60),
  ('bien_etre_spa', 'Bien-être & spa', 'flower', '#EAF7EF', 70)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- Objectifs de la catégorie Sport (écran 21). Les autres catégories n'ont pas encore de liste : la personne décrit son objectif.
INSERT INTO "project_goals" ("code", "category_code", "label", "quantity_unit", "quantity_min", "quantity_max", "title_pattern", "sort_order") VALUES
  ('sport_perte_poids', 'sport', 'Perte de poids', 'kg', 1, 30, 'Perdre {q} kg', 10),
  ('sport_fessiers', 'sport', 'Fessiers', NULL, NULL, NULL, 'Travailler mes fessiers', 20),
  ('sport_abdos', 'sport', 'Abdos', NULL, NULL, NULL, 'Renforcer mes abdos', 30),
  ('sport_pectoraux', 'sport', 'Pectoraux', NULL, NULL, NULL, 'Développer mes pectoraux', 40),
  ('sport_bras', 'sport', 'Bras', NULL, NULL, NULL, 'Tonifier mes bras', 50),
  ('sport_cuisses', 'sport', 'Cuisses', NULL, NULL, NULL, 'Affiner mes cuisses', 60),
  ('sport_cardio', 'sport', 'Cardio & endurance', NULL, NULL, NULL, 'Améliorer mon endurance', 70),
  ('sport_prise_masse', 'sport', 'Prise de masse', 'kg', 1, 15, 'Prendre {q} kg', 80),
  ('sport_souplesse', 'sport', 'Souplesse', NULL, NULL, NULL, 'Gagner en souplesse', 90),
  ('sport_remise_forme', 'sport', 'Remise en forme', NULL, NULL, NULL, 'Me remettre en forme', 100)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('projects.max_active', '5', 'Nombre maximum de projets en cours par personne (écran 18 : « 4 / 5 projets »)', 'provisional', 'Ecran 18', 'migration'),
  ('projects.durations_days', '[30, 60, 90]', 'Durées proposées quand aucun modèle de programme validé n''existe', 'provisional', 'Ecran 24', 'migration'),
  ('projects.budget_tiers', '{"small": "≈ 10 000 F", "medium": "≈ 35 000 F", "boosted": "75 000 F +"}', 'Budgets indicatifs du mode Premium (écran 19) ; aucun paiement dans le projet (F4)', 'provisional', 'Ecran 19', 'migration'),
  ('projects.availability_times', '{"morning": "07:00", "noon": "12:30", "afternoon": "15:00"}', 'Heure des séances selon la disponibilité choisie (écrans 23 et 27)', 'provisional', 'Ecran 27', 'migration'),
  ('projects.pause_max_days', '30', 'Durée maximale d''une pause (écran 29, choix « Autre »)', 'pending', NULL, 'migration')
ON CONFLICT ("key") DO NOTHING;
