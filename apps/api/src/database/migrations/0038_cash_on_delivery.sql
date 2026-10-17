ALTER TABLE "orders" DROP CONSTRAINT "orders_cash_ck";--> statement-breakpoint
-- L7-07 (décisions du fondateur, 17/10/2026) : délais de livraison confirmés (5 et 15 minutes), réglages « décidés ».
UPDATE app_settings SET decision_status = 'decided', decision_ref = 'L7-07' WHERE key IN ('deliveries.mission_accept_minutes', 'deliveries.client_absent_after_minutes');
