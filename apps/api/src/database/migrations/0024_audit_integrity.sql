-- Audit (16/10/2026) : doublons éventuels supprimés avant les index uniques.
-- Coffres ouverts en double : on garde le premier événement.
DELETE FROM "project_events" e USING "project_events" d
  WHERE e."type" = 'chest_opened' AND d."type" = 'chest_opened' AND e."project_id" = d."project_id" AND e."payload" = d."payload"
    AND (e."created_at", e."id") > (d."created_at", d."id");--> statement-breakpoint
-- Photos « avant » / « après » actives en double : la plus récente reste active.
UPDATE "project_photos" p SET "deleted_at" = now()
  WHERE p."deleted_at" IS NULL AND EXISTS (
    SELECT 1 FROM "project_photos" q WHERE q."project_id" = p."project_id" AND q."kind" = p."kind" AND q."deleted_at" IS NULL
      AND (q."created_at", q."id") > (p."created_at", p."id"));--> statement-breakpoint
-- Demandes de boutique ouvertes en double pour une même personne (envoi simultané, constat D-2) : la plus avancée
-- (envoyée, puis la plus récente) est gardée ; les autres sont retirées comme par « Abandonner » (boutique fermée).
-- Les pièces chiffrées des demandes retirées restent dans le stockage : à effacer manuellement si ce cas se présente.
WITH ranked AS (
  SELECT id, shop_id, row_number() OVER (PARTITION BY user_id ORDER BY (status = 'submitted') DESC, updated_at DESC, id DESC) AS rk
  FROM "merchant_applications" WHERE status IN ('draft', 'submitted', 'rejected')
), gone AS (
  DELETE FROM "merchant_applications" a USING ranked r WHERE a.id = r.id AND r.rk > 1 RETURNING a.shop_id
)
UPDATE "shops" SET status = 'closed', updated_at = now() WHERE id IN (SELECT shop_id FROM gone);--> statement-breakpoint
CREATE UNIQUE INDEX "project_events_chest_uq" ON "project_events" USING btree ("project_id","payload") WHERE "project_events"."type" = 'chest_opened';--> statement-breakpoint
CREATE UNIQUE INDEX "project_photos_active_uq" ON "project_photos" USING btree ("project_id","kind") WHERE "project_photos"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "projects_offer_requests_idx" ON "projects" USING btree ("created_at") WHERE "projects"."receive_merchant_offers" AND "projects"."status" = 'active';--> statement-breakpoint
CREATE INDEX "content_reports_target_user_idx" ON "content_reports" USING btree ("target_user_id","resolved_at") WHERE "content_reports"."action" = 'hidden';--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_applications_open_user_uq" ON "merchant_applications" USING btree ("user_id") WHERE "merchant_applications"."status" IN ('draft', 'submitted', 'rejected');