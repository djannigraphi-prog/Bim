-- Données de référence et garde-fous qui doivent exister dans tous les environnements (dev, staging, production).
-- Migration écrite à la main ; ne jamais modifier après fusion : créer une nouvelle migration.

-- Centres d'intérêt de l'écran 05 (au moins 3 à l'inscription).
INSERT INTO "interests" ("code", "label", "icon", "sort_order") VALUES
  ('mode', 'Mode', 'shirt', 10),
  ('sport_coaching', 'Sport & coaching', 'dumbbell', 20),
  ('beaute_esthetique', 'Beauté / esthétique', 'sparkles', 30),
  ('soins_spa', 'Soins / spa', 'flower', 40),
  ('coiffure', 'Coiffure', 'scissors', 50),
  ('maquillage', 'Maquillage', 'brush', 60),
  ('ongles', 'Ongles', 'hand', 70),
  ('bien_etre', 'Bien-être', 'leaf', 80),
  ('lifestyle', 'Lifestyle', 'camera', 90),
  ('accessoires', 'Accessoires', 'glasses', 100)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- Réglages métier. decision_status : decided | provisional (sous réserve de vérification légale) | pending (non décidé).
-- Une valeur JSON null signifie « règle non décidée » : la fonctionnalité concernée reste fermée.
INSERT INTO "app_settings" ("key", "value", "description", "decision_status", "decision_ref", "updated_by") VALUES
  ('age.min_registration', '16', 'Âge minimum pour créer un compte BIM', 'provisional', 'F15', 'migration'),
  ('age.min_coins_purchase', '18', 'Âge minimum pour acheter des pièces convertibles en argent', 'provisional', 'F15', 'migration'),
  ('age.min_coins_withdrawal', '18', 'Âge minimum pour retirer des pièces', 'provisional', 'F15', 'migration'),
  ('age.min_paid_subscription', 'null', 'Âge minimum pour souscrire un abonnement payant : selon les règles applicables aux mineurs, à vérifier', 'pending', 'F15', 'migration'),
  ('age.min_other_payments', 'null', 'Âge minimum pour les autres paiements (BimShop, projets) : selon les règles applicables aux mineurs, à vérifier', 'pending', 'F15', 'migration'),
  ('age.min_merchant', 'null', 'Âge minimum pour ouvrir une boutique : non décidé', 'pending', NULL, 'migration'),
  ('age.min_courier', 'null', 'Âge minimum pour ouvrir un compte livreur : non décidé', 'pending', NULL, 'migration'),
  ('auth.recovery_preferred_channel', '"phone"', 'Moyen de récupération privilégié (le téléphone ; l''e-mail est accepté)', 'decided', 'F16', 'migration'),
  ('auth.registration_min_interests', '3', 'Nombre minimum de centres d''intérêt à l''inscription (écran 05)', 'provisional', 'Ecran 05', 'migration')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Rôles d'administration proposés (section 5 de l'analyse) ; permissions définies dans le code et documentées.
INSERT INTO "admin_roles" ("code", "label") VALUES
  ('super_admin', 'Administrateur principal'),
  ('support', 'Support client'),
  ('moderator', 'Modérateur'),
  ('commercial', 'Gestionnaire commercial'),
  ('finance', 'Gestionnaire financier'),
  ('tech', 'Responsable technique')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- Le journal d'audit est en écriture seule : toute modification ou suppression est refusée par la base elle-même.
CREATE OR REPLACE FUNCTION audit_logs_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en écriture seule';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
--> statement-breakpoint

-- Garde-fous de cohérence que l'application ne doit jamais pouvoir contourner.
ALTER TABLE "users" ADD CONSTRAINT "users_username_format_ck" CHECK ("username" ~ '^[a-z0-9._]{3,30}$');
--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_value_format_ck" CHECK (
  ("type" = 'phone' AND "value" ~ '^\+[1-9][0-9]{6,14}$') OR ("type" = 'email' AND "value" = lower("value") AND position('@' in "value") > 1)
);
--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_attempts_ck" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts");
--> statement-breakpoint
ALTER TABLE "courier_shop_partnerships" ADD CONSTRAINT "courier_shop_outstanding_ck" CHECK ("max_outstanding_fcfa" IS NULL OR "max_outstanding_fcfa" >= 0);
