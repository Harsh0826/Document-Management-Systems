-- =====================================================================================
-- Remove the tables of the previous version of the app (per-client certificates, review workflow,
-- staff permissions, notifications). Migration 005 copied every live document into the library,
-- and the library points at the same stored files, so nothing in use is lost.
--
-- Kept: users, roles, auth_sessions, user_tokens, audit_logs (history, still append-only),
-- app_settings and the library tables. Stored files themselves are never touched by migrations.
-- =====================================================================================

-- Stored files of old documents that never made it into the library (deleted or archived ones) are not
-- deleted. Their locations are saved here so they can still be found and removed deliberately later.
INSERT INTO app_settings (key, value)
SELECT 'retired_files',
       jsonb_agg(jsonb_build_object('storageKey', v.storage_key, 'filename', v.original_filename, 'sizeBytes', v.size_bytes,
                                    'title', d.title, 'deleted', d.deleted_at IS NOT NULL, 'archived', d.is_archived))
  FROM document_versions v JOIN documents d ON d.id = v.document_id
 WHERE NOT EXISTS (SELECT 1 FROM library_file_versions l WHERE l.storage_key = v.storage_key)
HAVING count(*) > 0
ON CONFLICT (key) DO NOTHING;

-- Anyone still on the retired "staff" role becomes an employee, then the role goes.
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'employee')
 WHERE role_id = (SELECT id FROM roles WHERE name = 'staff');

DROP TABLE IF EXISTS
  expiry_reminders,
  notifications,
  document_requests,
  document_comments,
  document_approvals,
  document_versions,
  documents,
  folders,
  document_categories,
  staff_client_assignments,
  employees,
  user_permissions,
  role_permissions,
  permissions,
  clients
  CASCADE; -- also removes audit_logs' link to clients; the old client ids stay in the log as history

DELETE FROM roles WHERE name = 'staff';
