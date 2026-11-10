-- =====================================================================================
-- Security hardening: TOTP multi-factor authentication
-- =====================================================================================
ALTER TABLE users
  ADD COLUMN mfa_secret_enc        TEXT,          -- AES-256-GCM encrypted base32 secret (active)
  ADD COLUMN mfa_pending_secret_enc TEXT,         -- secret being enrolled, not yet confirmed
  ADD COLUMN mfa_enabled_at        TIMESTAMPTZ,
  ADD COLUMN mfa_last_step         BIGINT,        -- last accepted TOTP time-step (replay protection)
  ADD COLUMN mfa_recovery_hashes   TEXT[] NOT NULL DEFAULT '{}'; -- sha256 of unused recovery codes

-- Sessions remember when their family (the original sign-in) started, for an absolute lifetime cap.
ALTER TABLE auth_sessions ADD COLUMN family_started_at TIMESTAMPTZ NOT NULL DEFAULT now();
