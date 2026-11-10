# Architecture

## 1. Overview

```
┌──────────────────────────┐   same origin (HTTPS)    ┌──────────────────────────────┐
│ React app (client/)      │ ───────────────────────▶ │ Express API (server/)  /api/* │
│ Home · Folder · File ·   │  Bearer token (memory)   │ helmet · rate limits · zod   │
│ Search · Add files ·     │  httpOnly refresh cookie │ role checks on every write   │
│ People · My account      │                          └──────┬────────────────┬──────┘
└──────────────────────────┘                                 │ SQL (pg)       │ AWS SDK
                                                             ▼                ▼
                                              PostgreSQL (PGlite locally)   Private S3 bucket
                                                                            (5-minute links)
```

- One origin in production: Express serves the built app and the API, so there is no CORS and
  cookies are `SameSite=Strict`.
- Storage: `STORAGE_DRIVER=s3` uses a private bucket with presigned links. `local` (development only)
  keeps files outside the web root behind HMAC-signed links that expire. Admins can switch to S3 at
  runtime from `/settings/storage`.
- Database: `DATABASE_URL` points at PostgreSQL. Without it, PGlite (PostgreSQL compiled to WASM) runs
  the same SQL and migrations, for development and tests.

## 2. Roles

| Role | Can |
|---|---|
| **employee** | Sign in, browse folders, search, view and download every library file, change their password |
| **admin** | Everything above, plus add/rename/move/replace/delete files, create/rename/delete folders, restore deleted files, manage People |

- Reads (`GET /api/library/*`) need any signed-in account.
- Every write needs `role = admin`, checked on the server (`requireRole('admin')`). Uploads check
  the role *before* the request body is read.
- There are only these two roles. Migration 005 turned old staff accounts into employees and
  migration 006 removed the staff role and the old permission tables.

## 3. Library data model

```
library_folders (id, name, parent_id → library_folders, depth 1..3)
library_files   (id, folder_id → library_folders, name, valid_until, current_version_id,
                 deleted_at, purged_at)                 unique (folder_id, lower(name)) for live files
library_file_versions (id, file_id, version_number, storage_key, original_filename, file_ext,
                       mime_type, size_bytes, checksum_sha256)
```

- **Depth** is stored and limited to 3 (`CHECK depth BETWEEN 1 AND 3`), so breadcrumbs and counts
  need no recursive queries: a file's path is at most three joins away.
- **Replace** adds a version and moves `current_version_id`; earlier copies stay stored.
- **Delete** sets `deleted_at`. The file appears under Recently deleted and can be restored for
  30 days. A background job then deletes the stored copies and sets `purged_at`.
- A folder can only be deleted when it has no live files and no sub-folders.
- **Search** requires every word to match (case-insensitive, partial) the file name, the original
  file name or any of its folder names, accepting simple spelling variants. These are kept together in
  one `search_text` column per file, with a trigram index, so search stays fast with hundreds of
  thousands of files. Database triggers refresh it when a file or folder is renamed or moved.
- Storage keys are generated (`library/<file id>/<uuid>.<ext>`) and never include user input.
  Downloads are named after the document.
- Uploads are checked by extension allow-list, declared type, **file signature (magic bytes)** and
  size (25 MB).

### Built for large libraries (migration 007)

Tested with 10,000 folders and 100,000 files:

- **Counts are stored, not counted.** Each folder keeps `own_files` and `total_files` (including
  sub-folders), maintained by triggers on every add, move, delete, restore and folder move.
- **Lists are paged.** Folder and search results arrive 50 at a time as you scroll. Only the first page
  works out the total, capped at "10,000+".
- **The folder sidebar** (a drawer on phones) is a tree that loads each level only when it is opened,
  and opens itself to the current folder.
- **Pickers load one level at a time** and can find any folder by name, so no screen ever downloads
  the whole tree.
- Indexes cover every sort and filter: per-folder by date, expiry date, recently deleted, and folder
  names by parent.

Migration 005 copied the earlier version's live documents into the library; migration 006 then removed
the old tables (`documents`, `document_versions`, `folders`, `clients`, `employees`, …). The activity
log keeps its full history. Stored files of old deleted or archived documents are never deleted
automatically: their locations are saved in `app_settings` under `retired_files`.

## 4. Sign-in and sessions

- One sign-in page. Passwords use bcrypt (cost 12), 10–72 characters with upper, lower and digit.
- Every failure gets the same message. Failed attempts are counted atomically; 5 lock the account
  for 15 minutes; the endpoint is rate-limited per IP.
- **Access token:** HS256 JWT (15 minutes) kept in memory, bound to a live session of the same user.
  Every request reloads the user, so removing access takes effect immediately.
- **Refresh token:** random, stored hashed, httpOnly / Secure / SameSite=Strict cookie on
  `/api/auth`. It rotates on every use. Replaying an old token revokes the whole session (theft
  detection), and a sign-in lasts at most 30 days.
- **Two-step sign-in (TOTP):** admins only, required in production. Secrets are AES-256-GCM
  encrypted; codes work once (replay protection); 10 hashed recovery codes.
- Invitations and password resets are single-use, hashed, expiring tokens.

## 5. Activity record and other protections

- Every view, download, change and sign-in is written to `audit_logs`. A database trigger blocks
  UPDATE, DELETE and TRUNCATE. There's no screen for it; admins and IT can export it via
  `GET /api/audit-logs`.
- Download links last 5 minutes, and each person can request 200 per hour. Hitting the limit is
  recorded.
- Helmet sets a strict CSP (previews allowed only from the active bucket), HSTS in production,
  `nosniff` and frame restrictions.
- Request IDs appear in logs and error responses; logs never contain invitation or file tokens.
- In production the server refuses example secrets, local storage, http addresses or a missing
  encryption key.

## 6. Client structure

```
client/src
├── api/                 axios client (silent refresh) + TanStack Query hooks
├── components/library/  folder tiles and rows, document browser (filters, paging, bulk select), quick search, folder picker, breadcrumb,
│                        folder picker, admin dialogs (rename, move, replace, delete, folders)
├── components/security/ two-step sign-in setup
├── components/users/    shareable invitation message
├── components/ui/       buttons, inputs, dialogs, menus
└── pages/               Home, Folder, File, Search, Add files, People, Recently deleted,
                         My account, Sign in, Accept invitation, Storage (IT)
```

Accessibility: base text 16–18px, 44px minimum touch targets, AA contrast, visible focus, skip link,
labelled landmarks ("You are here" breadcrumb), and screen-reader names that include the file
("Download Fire Safety Licence 2025, PDF, 1.2 MB"). Status is never shown by colour alone.
