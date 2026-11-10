-- =====================================================================================
-- Company document library: one shared folder tree (max 3 levels) of files that every employee can
-- view and download, managed by administrators.
--
-- The previous per-employee / per-client tables are left untouched as history. Existing live
-- documents are copied into the library (same stored files, no data is moved or lost).
-- =====================================================================================

CREATE TABLE library_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  parent_id  UUID REFERENCES library_folders(id) ON DELETE RESTRICT,
  depth      SMALLINT NOT NULL CHECK (depth BETWEEN 1 AND 3),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((parent_id IS NULL) = (depth = 1))
);
CREATE UNIQUE INDEX library_folders_sibling_uq ON library_folders (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX library_folders_parent_idx ON library_folders (parent_id);
CREATE INDEX library_folders_name_trgm ON library_folders USING gin (name gin_trgm_ops);
CREATE TRIGGER library_folders_updated_at BEFORE UPDATE ON library_folders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE library_files (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id          UUID NOT NULL REFERENCES library_folders(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  valid_until        DATE,
  current_version_id UUID,
  uploaded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  purged_at          TIMESTAMPTZ
);
-- No two live files with the same name in one folder.
CREATE UNIQUE INDEX library_files_name_uq ON library_files (folder_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX library_files_folder_idx ON library_files (folder_id) WHERE deleted_at IS NULL;
CREATE INDEX library_files_created_idx ON library_files (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX library_files_name_trgm ON library_files USING gin (name gin_trgm_ops);
CREATE TRIGGER library_files_updated_at BEFORE UPDATE ON library_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE library_file_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id           UUID NOT NULL REFERENCES library_files(id) ON DELETE CASCADE,
  version_number    INT NOT NULL CHECK (version_number > 0),
  storage_key       TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL CHECK (length(original_filename) <= 255),
  file_ext          TEXT NOT NULL CHECK (file_ext IN ('pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'xls', 'xlsx')),
  mime_type         TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum_sha256   TEXT NOT NULL,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_id, version_number)
);
CREATE INDEX library_file_versions_filename_trgm ON library_file_versions USING gin (original_filename gin_trgm_ops);

ALTER TABLE library_files
  ADD CONSTRAINT library_files_current_version_fk FOREIGN KEY (current_version_id) REFERENCES library_file_versions(id) ON DELETE SET NULL;

-- ---- Roles: Admin and Employee only. Former staff accounts become employees (least privilege);
--      administrators can promote anyone from the People screen.
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'employee')
 WHERE role_id = (SELECT id FROM roles WHERE name = 'staff');

-- ---- Copy existing live documents into the library -----------------------------------------
-- One top-level folder per category in use; uncategorised documents go to "Other Documents".
INSERT INTO library_folders (name, depth)
SELECT DISTINCT COALESCE(c.name, 'Other Documents'), 1
  FROM documents d LEFT JOIN document_categories c ON c.id = d.category_id
 WHERE d.deleted_at IS NULL AND NOT d.is_archived AND d.current_version_id IS NOT NULL;

INSERT INTO library_files (id, folder_id, name, valid_until, uploaded_by, created_at)
SELECT x.id, f.id,
       CASE WHEN x.rn = 1 THEN x.title ELSE left(x.title, 190) || ' (' || left(x.id::text, 4) || ')' END,
       x.expiry_date, x.uploaded_by, x.created_at
  FROM (
    SELECT d.id, d.title, d.expiry_date, d.uploaded_by, d.created_at, COALESCE(c.name, 'Other Documents') AS folder_name,
           row_number() OVER (PARTITION BY COALESCE(c.name, 'Other Documents'), lower(d.title) ORDER BY d.created_at) AS rn
      FROM documents d LEFT JOIN document_categories c ON c.id = d.category_id
     WHERE d.deleted_at IS NULL AND NOT d.is_archived AND d.current_version_id IS NOT NULL
  ) x
  JOIN library_folders f ON f.parent_id IS NULL AND f.name = x.folder_name;

INSERT INTO library_file_versions (id, file_id, version_number, storage_key, original_filename, file_ext, mime_type, size_bytes, checksum_sha256, uploaded_by, created_at)
SELECT v.id, v.document_id, v.version_number, v.storage_key, v.original_filename, v.file_ext, v.mime_type, v.size_bytes, v.checksum_sha256, v.uploaded_by, v.created_at
  FROM document_versions v JOIN library_files lf ON lf.id = v.document_id;

UPDATE library_files lf SET current_version_id = d.current_version_id FROM documents d WHERE d.id = lf.id;
