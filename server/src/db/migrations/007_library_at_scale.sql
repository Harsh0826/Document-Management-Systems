-- =====================================================================================
-- Keep the library fast with tens of thousands of folders and hundreds of thousands of files.
--
-- 1. File counts are stored on each folder and kept up to date by triggers, so listing folders
--    never has to count files.
-- 2. Each file has one search column (its name, original file name and folder names), indexed for
--    "contains" searches, so search does not have to scan every file.
-- 3. Indexes for every sort and filter the library offers.
-- 4. Pinned folders: each person's own shortcuts.
-- =====================================================================================

ALTER TABLE library_folders
  ADD COLUMN own_files   INT NOT NULL DEFAULT 0, -- live files directly in this folder
  ADD COLUMN total_files INT NOT NULL DEFAULT 0; -- live files in this folder and all of its sub-folders

ALTER TABLE library_files ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

-- A folder and its ancestors (folders are at most 3 levels deep).
CREATE FUNCTION library_folder_chain(start UUID) RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
  SELECT a.id FROM library_folders a WHERE a.id = start
  UNION ALL
  SELECT a.parent_id FROM library_folders a WHERE a.id = start AND a.parent_id IS NOT NULL
  UNION ALL
  SELECT b.parent_id FROM library_folders a JOIN library_folders b ON b.id = a.parent_id WHERE a.id = start AND b.parent_id IS NOT NULL
$$;

-- A folder and everything below it.
CREATE FUNCTION library_folder_subtree(root UUID) RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM library_folders WHERE id = root OR parent_id = root
  UNION ALL
  SELECT c.id FROM library_folders b JOIN library_folders c ON c.parent_id = b.id WHERE b.parent_id = root
$$;

CREATE FUNCTION library_search_text(p_name TEXT, p_version UUID, p_folder UUID) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT lower(concat_ws(' ', p_name,
    (SELECT original_filename FROM library_file_versions WHERE id = p_version),
    (SELECT string_agg(f.name, ' ') FROM library_folders f WHERE f.id IN (SELECT library_folder_chain(p_folder)))))
$$;

-- ---- Backfill -----------------------------------------------------------------------------
UPDATE library_files SET search_text = library_search_text(name, current_version_id, folder_id);
UPDATE library_folders f SET own_files = (SELECT count(*) FROM library_files x WHERE x.folder_id = f.id AND x.deleted_at IS NULL);
UPDATE library_folders f SET total_files = (SELECT COALESCE(sum(s.own_files), 0) FROM library_folders s WHERE s.id IN (SELECT library_folder_subtree(f.id)));

-- ---- Triggers -----------------------------------------------------------------------------
-- "Last updated" should change only for real edits, not for count and search bookkeeping.
DROP TRIGGER library_files_updated_at ON library_files;
CREATE TRIGGER library_files_updated_at BEFORE UPDATE OF name, folder_id, valid_until, current_version_id ON library_files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER library_folders_updated_at ON library_folders;
CREATE TRIGGER library_folders_updated_at BEFORE UPDATE OF name, parent_id ON library_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION library_files_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE library_folders SET own_files = own_files - 1 WHERE id = OLD.folder_id;
      UPDATE library_folders SET total_files = total_files - 1 WHERE id IN (SELECT library_folder_chain(OLD.folder_id));
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.deleted_at IS NULL THEN
      UPDATE library_folders SET own_files = own_files + 1 WHERE id = NEW.folder_id;
      UPDATE library_folders SET total_files = total_files + 1 WHERE id IN (SELECT library_folder_chain(NEW.folder_id));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER library_files_count AFTER INSERT OR DELETE OR UPDATE OF folder_id, deleted_at ON library_files
  FOR EACH ROW EXECUTE FUNCTION library_files_count();

CREATE FUNCTION library_files_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := library_search_text(NEW.name, NEW.current_version_id, NEW.folder_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_files_search BEFORE INSERT OR UPDATE OF name, folder_id, current_version_id ON library_files
  FOR EACH ROW EXECUTE FUNCTION library_files_search();

-- A folder was renamed or moved: carry its file count to the new place and refresh the search text
-- of every file inside it.
CREATE FUNCTION library_folders_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.parent_id IS DISTINCT FROM NEW.parent_id AND NEW.total_files <> 0 THEN
    IF OLD.parent_id IS NOT NULL THEN
      UPDATE library_folders SET total_files = total_files - NEW.total_files WHERE id IN (SELECT library_folder_chain(OLD.parent_id));
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      UPDATE library_folders SET total_files = total_files + NEW.total_files WHERE id IN (SELECT library_folder_chain(NEW.parent_id));
    END IF;
  END IF;
  UPDATE library_files SET search_text = library_search_text(name, current_version_id, folder_id)
   WHERE folder_id IN (SELECT library_folder_subtree(NEW.id));
  RETURN NULL;
END;
$$;
CREATE TRIGGER library_folders_changed AFTER UPDATE OF name, parent_id ON library_folders
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION library_folders_changed();

-- ---- Indexes ------------------------------------------------------------------------------
DROP INDEX IF EXISTS library_files_name_trgm;
DROP INDEX IF EXISTS library_file_versions_filename_trgm;
DROP INDEX IF EXISTS library_files_folder_idx;
CREATE INDEX library_files_search_trgm ON library_files USING gin (search_text gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX library_files_folder_created_idx ON library_files (folder_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX library_files_valid_idx ON library_files (valid_until) WHERE deleted_at IS NULL AND valid_until IS NOT NULL;
CREATE INDEX library_files_deleted_idx ON library_files (deleted_at DESC) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX library_folders_root_name_idx ON library_folders (lower(name)) WHERE parent_id IS NULL;
CREATE INDEX library_folders_parent_name_idx ON library_folders (parent_id, lower(name));
DROP INDEX IF EXISTS library_folders_parent_idx;

-- ---- Pinned folders -----------------------------------------------------------------------
CREATE TABLE library_pins (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  UUID NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, folder_id)
);
