-- =====================================================================================
-- DMS initial schema
-- =====================================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Shared trigger to maintain updated_at -----------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Roles & permissions ------------------------------------------------------------------
CREATE TABLE roles (
  id          SMALLSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE CHECK (name IN ('admin', 'staff', 'employee')),
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
  id          SMALLSERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id       SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Clients (companies) ------------------------------------------------------------------
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  code          TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  industry      TEXT,
  contact_email TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Users --------------------------------------------------------------------------------
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL CHECK (length(email) <= 254),
  password_hash         TEXT,
  first_name            TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
  last_name             TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 100),
  phone                 TEXT,
  job_title             TEXT,
  role_id               SMALLINT NOT NULL REFERENCES roles(id),
  status                TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'deactivated')),
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE INDEX users_role_idx ON users (role_id);
CREATE INDEX users_status_idx ON users (status);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-user permission grants (used for staff; effective = role perms ∪ user perms)
CREATE TABLE user_permissions (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

-- Client employees (one row per employee user) -----------------------------------------
CREATE TABLE employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  employee_number TEXT,
  department      TEXT,
  position        TEXT,
  hire_date       DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, employee_number)
);
CREATE INDEX employees_client_idx ON employees (client_id);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which clients a staff member may access ----------------------------------------------
CREATE TABLE staff_client_assignments (
  staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, client_id)
);
CREATE INDEX staff_client_assignments_client_idx ON staff_client_assignments (client_id);

-- Sessions (hashed, rotating refresh tokens) -------------------------------------------
CREATE TABLE auth_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          UUID NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  user_agent         TEXT,
  ip                 TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  rotated_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);

-- Single-use tokens (invitations, password resets) -------------------------------------
CREATE TABLE user_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('invite', 'password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, purpose);

-- Document categories ------------------------------------------------------------------
CREATE TABLE document_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  is_certificate  BOOLEAN NOT NULL DEFAULT FALSE,
  requires_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_categories_name_uq ON document_categories (lower(name));
CREATE TRIGGER document_categories_updated_at BEFORE UPDATE ON document_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Folders ------------------------------------------------------------------------------
CREATE TABLE folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  parent_id   UUID REFERENCES folders(id) ON DELETE RESTRICT,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  category_id UUID REFERENCES document_categories(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('client_root', 'employee_root', 'category', 'custom')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'client_root') = (parent_id IS NULL))
);
-- Sibling names are unique (case-insensitive); only one root per client.
CREATE UNIQUE INDEX folders_sibling_name_uq ON folders (client_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE UNIQUE INDEX folders_client_root_uq ON folders (client_id) WHERE kind = 'client_root';
CREATE UNIQUE INDEX folders_employee_root_uq ON folders (employee_id) WHERE kind = 'employee_root';
CREATE INDEX folders_parent_idx ON folders (parent_id);
CREATE INDEX folders_employee_idx ON folders (employee_id);
CREATE TRIGGER folders_updated_at BEFORE UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Documents ----------------------------------------------------------------------------
CREATE TABLE documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  folder_id          UUID REFERENCES folders(id) ON DELETE SET NULL,
  category_id        UUID REFERENCES document_categories(id) ON DELETE SET NULL,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description        TEXT CHECK (length(description) <= 2000),
  status             TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review', 'approved', 'rejected', 'expired', 'renewal_required')),
  issue_date         DATE,
  expiry_date        DATE,
  current_version_id UUID,
  uploaded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  is_archived        BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at        TIMESTAMPTZ,
  archived_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);
CREATE INDEX documents_client_idx ON documents (client_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_employee_idx ON documents (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_folder_idx ON documents (folder_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_category_idx ON documents (category_id);
CREATE INDEX documents_status_idx ON documents (status) WHERE deleted_at IS NULL;
CREATE INDEX documents_expiry_idx ON documents (expiry_date) WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;
CREATE INDEX documents_created_idx ON documents (created_at DESC);
CREATE INDEX documents_title_trgm ON documents USING gin (title gin_trgm_ops);
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number    INT NOT NULL CHECK (version_number > 0),
  storage_key       TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL CHECK (length(original_filename) <= 255),
  file_ext          TEXT NOT NULL CHECK (file_ext IN ('pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'xls', 'xlsx')),
  mime_type         TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum_sha256   TEXT NOT NULL,
  issue_date        DATE,
  expiry_date       DATE,
  change_note       TEXT CHECK (length(change_note) <= 1000),
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);
CREATE INDEX document_versions_filename_trgm ON document_versions USING gin (original_filename gin_trgm_ops);
CREATE INDEX document_versions_ext_idx ON document_versions (file_ext);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id) ON DELETE SET NULL;

CREATE TABLE document_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id  UUID REFERENCES document_versions(id) ON DELETE SET NULL,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'renewal_required')),
  comment     TEXT CHECK (length(comment) <= 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_approvals_document_idx ON document_approvals (document_id, created_at DESC);

CREATE TABLE document_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE, -- internal notes are hidden from employees
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_comments_document_idx ON document_comments (document_id, created_at);
CREATE TRIGGER document_comments_updated_at BEFORE UPDATE ON document_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Document requests / tasks ("please upload X by date") --------------------------------
CREATE TABLE document_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category_id           UUID REFERENCES document_categories(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  instructions          TEXT CHECK (length(instructions) <= 2000),
  due_date              DATE,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  requested_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  fulfilled_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  fulfilled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_requests_employee_idx ON document_requests (employee_id, status);
CREATE INDEX document_requests_client_idx ON document_requests (client_id, status);
CREATE TRIGGER document_requests_updated_at BEFORE UPDATE ON document_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Notifications ------------------------------------------------------------------------
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  link        TEXT,
  entity_type TEXT,
  entity_id   UUID,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

-- De-duplicates expiry reminders (one per version per threshold) ----------------------
CREATE TABLE expiry_reminders (
  version_id     UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  threshold_days INT NOT NULL, -- 90, 60, 30, or 0 (= expired)
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, threshold_days)
);

-- Audit log (append-only) --------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  ip          TEXT,
  user_agent  TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  -- Allow the FK-driven "SET NULL" of actor/client when a user or client row is removed.
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id AND NEW.action = OLD.action AND NEW.created_at = OLD.created_at
     AND NEW.metadata = OLD.metadata AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND (NEW.actor_id IS NULL OR NEW.actor_id = OLD.actor_id)
     AND (NEW.client_id IS NULL OR NEW.client_id = OLD.client_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- Reference data -----------------------------------------------------------------------
INSERT INTO roles (name, description) VALUES
  ('admin', 'Full control of the system'),
  ('staff', 'Internal staff; access limited to assigned clients and granted permissions'),
  ('employee', 'Client employee; access limited to own documents');

INSERT INTO permissions (key, description) VALUES
  ('documents.view', 'View documents in scope'),
  ('documents.download', 'Preview and download documents'),
  ('documents.upload', 'Upload or replace documents on behalf of employees'),
  ('documents.edit', 'Rename, edit metadata and move documents'),
  ('documents.review', 'Approve, reject or require renewal of documents'),
  ('documents.archive', 'Archive and unarchive documents'),
  ('documents.delete', 'Delete documents'),
  ('documents.comment', 'Add comments and internal notes'),
  ('folders.manage', 'Create, rename, move and delete folders'),
  ('requests.manage', 'Request documents from employees'),
  ('users.manage', 'Create, invite, edit and deactivate users; manage permissions'),
  ('clients.manage', 'Create and edit client companies'),
  ('audit.view', 'View audit logs');

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'admin';
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'documents.view' WHERE r.name = 'staff';

INSERT INTO document_categories (name, slug, description, is_certificate, requires_expiry, sort_order) VALUES
  ('Identification Documents', 'identification', 'Passport, national ID, driver''s licence', FALSE, TRUE, 10),
  ('Educational Certificates', 'educational', 'Degrees, diplomas, transcripts', TRUE, FALSE, 20),
  ('Professional Certifications', 'professional', 'Licences and professional certifications', TRUE, TRUE, 30),
  ('Training Certificates', 'training', 'Safety, compliance and skills training', TRUE, TRUE, 40),
  ('Other Documents', 'other', 'Anything else', FALSE, FALSE, 90);
