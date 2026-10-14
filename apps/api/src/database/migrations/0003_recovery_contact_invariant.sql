-- F16 garanti par la base elle-même : un compte actif garde toujours au moins une coordonnée vérifiée.
-- Contrôle différé en fin de transaction, pour permettre « ajouter la nouvelle puis retirer l'ancienne » dans une même transaction.
CREATE OR REPLACE FUNCTION enforce_verified_recovery_contact() RETURNS trigger AS $$
DECLARE
  uid uuid;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    uid := NEW.id;
  ELSE
    uid := OLD.user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = uid AND u.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM user_contacts c WHERE c.user_id = uid AND c.verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'F16 : un compte actif doit garder au moins une coordonnée vérifiée (utilisateur %)', uid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_contacts_keep_one_verified
  AFTER DELETE OR UPDATE ON "user_contacts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_verified_recovery_contact();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER users_active_needs_verified_contact
  AFTER INSERT OR UPDATE OF "status" ON "users"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION enforce_verified_recovery_contact();
--> statement-breakpoint
-- Le journal d'audit refuse aussi TRUNCATE (le déclencheur ligne à ligne ne le couvrait pas).
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();
