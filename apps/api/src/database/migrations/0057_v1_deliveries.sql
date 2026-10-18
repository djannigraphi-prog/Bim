ALTER TABLE "incidents" DROP CONSTRAINT "incidents_reason_ck";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "reassign_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "reassign_reason" varchar(300);--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "reassign_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_attempts_ck" CHECK ("deliveries"."attempts" BETWEEN 1 AND 3);--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reason_ck" CHECK ("incidents"."reason" IN ('item_incorrect', 'item_damaged', 'item_incomplete', 'client_absent', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'reassign_refused', 'other'));--> statement-breakpoint
-- Décisions du fondateur (18/10/2026, 15 h 10) : 3 courses à la fois au plus ; nouvelle tentative payée par le client.
INSERT INTO app_settings (key, value, description, decision_status, decision_ref, updated_by) VALUES
  ('deliveries.max_courses_at_once', '3', 'Courses en même temps au plus par livreur (courses groupées ; décidé : 3)', 'decided', 'V1-1810', 'migration'),
  ('deliveries.max_retries', '1', 'Nouvelles tentatives de livraison au plus après une absence du client (proposé : 1)', 'provisional', 'V1-1810', 'migration')
ON CONFLICT (key) DO NOTHING;
