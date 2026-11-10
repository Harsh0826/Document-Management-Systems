# API

Base URL `/api`. JSON unless noted. Signed-in calls send `Authorization: Bearer <accessToken>`.
Errors look like:

```json
{ "error": { "code": "name_taken", "message": "There's already a file called \"Holiday Policy\" in this folder. Choose another name.", "details": { "fields": { "name": "…" } } } }
```

Messages are written in plain language so the app can show them as they are.

Two roles: **employee** (view and download everything in the library) and **admin** (also manages
files, folders and people). Every write endpoint checks the role on the server.

## Sign-in — `/api/auth`

| Method | Path | Notes |
|---|---|---|
| POST | `/login` | `{ email, password }` → `{ accessToken, user }` (sets an httpOnly refresh cookie), or `{ mfaRequired: true, mfaToken }` for admins with two-step sign-in. One generic message for every failure; 5 failures lock the account for 15 minutes. |
| POST | `/login/mfa` | `{ mfaToken, code }`. `code` is the 6-digit code or a recovery code. |
| POST | `/refresh` | Needs the cookie and `X-Requested-With: XMLHttpRequest`. Rotates the cookie; `409 refresh_race` means "retry once". |
| POST | `/logout` | Ends the session. |
| GET | `/invitations/:token` | Checks an invitation or reset link → `{ email, firstName, purpose }`. |
| POST | `/accept-invite` | `{ token, password }`. Sets the password (10–72 chars, upper, lower, digit). |
| GET | `/me` | The signed-in person. |
| POST | `/change-password` | `{ currentPassword, newPassword }`. Signs out other devices. |
| GET/POST | `/mfa`, `/mfa/setup`, `/mfa/enable`, `/mfa/recovery-codes`, `/mfa/disable` | Two-step sign-in (required for admins in production). |

## Library — `/api/library`

### Reading (everyone)

| Method | Path | Returns |
|---|---|---|
| GET | `/home` | `{ folders, pinned, recent, opened, totals, attention? }`: top-level folders, the person's pinned folders, the 6 newest files, the 6 files the person opened most recently, `{ files, folders }` totals and, for admins, `{ expired, soon }` counts. Folders carry `fileCount` (including sub-folders), `folderCount` and `parents` (where the folder lives). |
| GET | `/folders?parent=` | One level of folders (top level without `parent`), up to 2,000. Pickers load the library one level at a time. |
| GET | `/folders?q=` | Up to 30 folders anywhere whose name matches, best matches first, with `parents`. |
| GET | `/folders/:id` | The folder, its `path` (breadcrumb), `subfolders`, `ownFileCount` (files directly in it) and `pinned`. Files come from `GET /files`. |
| GET | `/files?folder=&deep=&q=&type=&validity=&added=&sort=&offset=&limit=` | Documents a page at a time (`limit` up to 100, default 50): `{ files, nextOffset, total?, totalIsCapped? }`. `folder` limits it to one folder; `deep=1` includes its sub-folders. `type` is `pdf`, `word`, `excel` or `picture`; `validity` is `expired`, `soon` (within 30 days), `valid` or `none`; `added` is `7`, `30` or `365` days. `sort` is `relevance` (the default with `q`), `newest` (the default otherwise), `oldest`, `name`, `name_desc`, `expiry` or `largest`. Only the first page has `total`, capped at 10,000 (`totalIsCapped`). |
| GET | `/search?q=&limit=` | Quick suggestions while typing: `{ folders, files, moreFiles }`, at most 8 folders and `limit` (default 8) files. Every word must match the file name, original file name or a folder name. Partial words and spelling variants count (licence/license, policy/policies). |
| GET | `/expiry` | `{ expired, soon }`: how many documents have expired and how many expire in the next 30 days (the counts in the navigation bar). |
| GET | `/pins` | `{ folders }`: your pinned folders (the sidebar). |
| PUT / DELETE | `/folders/:id/pin` | Pin or unpin a folder on your own Home page (up to 50). Nobody else sees your pins. |
| GET | `/files/:id` | One file. |
| GET | `/files/:id/url?disposition=inline\|attachment` | A link that expires in 5 minutes, used for viewing in the app or downloading. Downloads are named after the document. Limited to 200 per person per hour, and recorded. |

A file looks like this:

```json
{
  "id": "…", "name": "Fire Safety Licence 2025", "folderId": "…",
  "folderPath": [{ "id": "…", "name": "Licences" }, { "id": "…", "name": "2025" }],
  "validUntil": "2026-03-02", "daysLeft": 117, "addedAt": "2025-03-03T09:12:00Z", "isNew": false,
  "type": "PDF", "ext": "pdf", "sizeBytes": 1258291, "previewable": true
}
```

### Managing (admins)

| Method | Path | Body / notes |
|---|---|---|
| POST | `/folders` | `{ name, parentId? }`. Folders can only go 3 levels deep, and two folders in the same place can't share a name. |
| PATCH | `/folders/:id` | `{ name?, parentId? }`: rename and/or move a folder with everything in it (`parentId: null` moves it to the top level). It refuses to move a folder into itself or deeper than 3 levels. |
| POST | `/files/bulk` | `{ action: "move" | "delete", ids (up to 500), folderId? }` → `{ done, skipped, notFound }`. A move skips files whose name is already used in the destination and lists them in `skipped`. |
| DELETE | `/folders/:id` | Only empty folders. Otherwise `409` "This folder still has 3 files. Move or delete them first." |
| POST | `/files` | **multipart**: `file`, `folderId`, optional `name` (defaults to a tidy version of the file name) and `validUntil`. Accepts PDF, Word, Excel, JPG and PNG up to 25 MB, checking the real file content. Two files in one folder can't share a name. |
| PATCH | `/files/:id` | `{ name?, folderId?, validUntil? }`: rename, move, or change the date. |
| POST | `/files/:id/replace` | **multipart** `file`, optional `validUntil`. Keeps the name and place; the old copy is kept. |
| DELETE | `/files/:id` | Moves the file to Recently deleted. |
| GET | `/deleted` | Recently deleted files, each with `removedForGoodAt`. |
| POST | `/files/:id/restore` | Brings a deleted file back (within 30 days). |

After 30 days, a background job removes deleted files' stored copies for good.

## People — `/api/people` (admins)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{ id, firstName, lastName, email, isAdmin, status, twoStepOn, lastLoginAt }[]` |
| POST | `/` | `{ firstName, lastName, email, isAdmin }` → `{ person, inviteUrl, expiresInHours }` |
| PATCH | `/:id` | `{ isAdmin }`: "Can manage documents?" |
| POST | `/:id/reset-password` | → `{ url, hours, kind }`. Sends a new invitation instead if they haven't accepted the first one. Signs them out. |
| POST | `/:id/remove` | Removes access straight away. |
| POST | `/:id/restore` | Gives access again. |
| POST | `/:id/reset-two-step` | For a lost phone. |

There is always at least one admin, and admins can't remove or demote themselves.

## For IT

| Method | Path | Notes |
|---|---|---|
| GET | `/api/audit-logs` | Admin-only export of the activity record (sign-ins, views, downloads, changes). No screen in the app. |
| GET/PUT/POST | `/api/admin/storage`, `/s3`, `/test`, `/move` | One-time S3 setup (screen at `/settings/storage`, not in the menu). See `docs/S3_MIGRATION.md`. |
| GET | `/api/files/:token` | Serves files for the local development storage only. |
| GET | `/api/health` | `{ ok: true }` |
