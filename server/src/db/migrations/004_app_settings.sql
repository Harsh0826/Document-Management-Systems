-- =====================================================================================
-- Application settings managed from the admin UI (e.g. where document files are stored).
-- Secrets inside values are encrypted by the application (AES-256-GCM) before they are stored.
-- =====================================================================================
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
