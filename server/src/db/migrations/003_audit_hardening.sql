-- =====================================================================================
-- Audit log hardening
--  * snapshot of the actor's display name at the time of the action
--  * every column is immutable (only FK-driven SET NULL of actor_id/client_id is allowed)
--  * TRUNCATE is blocked
-- In production also run the app with a DB role that has only INSERT/SELECT on audit_logs:
--   REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM <app_role>;
-- =====================================================================================
ALTER TABLE audit_logs ADD COLUMN actor_name TEXT;

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.action = OLD.action
     AND NEW.created_at = OLD.created_at
     AND NEW.metadata = OLD.metadata
     AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.actor_email IS NOT DISTINCT FROM OLD.actor_email
     AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name
     AND NEW.ip IS NOT DISTINCT FROM OLD.ip
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     -- the only permitted changes: ON DELETE SET NULL of the actor or client reference
     AND (NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id OR NEW.actor_id IS NULL)
     AND (NEW.client_id IS NOT DISTINCT FROM OLD.client_id OR NEW.client_id IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_logs_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_no_truncate();
