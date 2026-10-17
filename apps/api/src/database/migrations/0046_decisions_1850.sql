ALTER TABLE "courier_accounts" ADD COLUMN "payout_operator" varchar(8);--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_payout_operator_ck" CHECK ("courier_accounts"."payout_operator" IS NULL OR "courier_accounts"."payout_operator" IN ('orange', 'mtn', 'wave', 'moov'));--> statement-breakpoint
-- Décisions du fondateur du 17/10/2026 (18 h 50).
-- Âges : commander dès 16 ans (âge de l'inscription) ; ouvrir une boutique et être livreur : 18 ans.
UPDATE app_settings SET value = '16', decision_status = 'decided', decision_ref = 'D-1850', updated_by = 'migration' WHERE key = 'age.min_other_payments';
--> statement-breakpoint
UPDATE app_settings SET value = '18', decision_status = 'decided', decision_ref = 'D-1850', updated_by = 'migration' WHERE key = 'age.min_merchant';
--> statement-breakpoint
UPDATE app_settings SET value = '18', decision_status = 'decided', decision_ref = 'D-1850', updated_by = 'migration' WHERE key = 'age.min_courier';
--> statement-breakpoint
-- Pièces d'identité : gardées tant que le compte existe, supprimées 365 jours après la fermeture du compte.
UPDATE app_settings SET value = '365', decision_status = 'decided', decision_ref = 'D-1850', updated_by = 'migration',
  description = 'Pièces d''identité et selfies (boutiques, livreurs) : gardés tant que le compte existe, supprimés ce nombre de jours après la fermeture du compte (décidé : 365)'
WHERE key = 'kyc.document_retention_days';
