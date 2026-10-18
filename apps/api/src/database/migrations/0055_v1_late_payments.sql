ALTER TABLE "payment_intents" DROP CONSTRAINT "payment_intents_status_ck";--> statement-breakpoint
ALTER TABLE "payment_refunds" ALTER COLUMN "requested_by_admin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "paid_amount_fcfa" integer;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_status_ck" CHECK ("payment_intents"."status" IN ('pending', 'succeeded', 'failed', 'expired', 'late_paid'));--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_origin_ck" CHECK ("payment_refunds"."automatic" OR "payment_refunds"."requested_by_admin" IS NOT NULL);