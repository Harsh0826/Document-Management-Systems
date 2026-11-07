# DMS REST API

Base URL: `/api`. All bodies are JSON unless noted. Authenticated endpoints need
`Authorization: Bearer <accessToken>`. Errors always look like:

```json
{ "error": { "code": "bad_request", "message": "Validation failed", "details": { "fields": { "email": "Invalid email address" } } } }
```

| Status | Meaning |
|---|---|
| 400 | Validation failed (`details.fields` maps field → message) |
| 401 | Not signed in / token expired / session revoked |
| 403 | Signed in but not permitted |
| 404 | Not found **or outside your scope** (ids of other clients' data are never confirmed) |
| 409 | Conflict (duplicate, non-empty folder, …) |
| 413 / 415 | File too large / file type not allowed or content does not match extension |
| 429 | Rate limited |

Scope rules: **admin** → all data · **staff** → assigned clients only, plus granted permissions ·
**employee** → own records only. The `can` object returned with documents lists the actions the
caller may perform; the server enforces each one regardless.

---

## Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | – | `{ email, password, portal: "admin" \| "employee" }` → `{ accessToken, user }`, sets httpOnly refresh cookie. Role must match portal (admin portal: admin + staff). 5 failures → 15-min lock. |
| POST | `/refresh` | cookie + `X-Requested-With: XMLHttpRequest` | Rotates the refresh token → `{ accessToken, user }`. Replaying an old token revokes the session family. |
| POST | `/logout` | cookie + `X-Requested-With` | Revokes the session family, clears cookie. `204` |
| GET | `/invitations/:token` | – | Validates an invite → `{ email, firstName, lastName, portal }` or `410` |
| POST | `/accept-invite` | – | `{ token, password }` → sets password, activates account → `{ portal }` |
| GET | `/me` | ✓ | Current user + profile details |
| PATCH | `/profile` | ✓ | `{ firstName, lastName, phone?, jobTitle? }` |
| POST | `/change-password` | ✓ | `{ currentPassword, newPassword }`; signs out other devices |

Password policy: ≥10 chars, upper, lower, digit.

## Dashboard — `/api/dashboard`

| GET | `/` | ✓ | Scoped totals (employees, documents, pending, approved, rejected, expired, renewalRequired, expiring30/60/90, openRequests, overdueRequests), `uploadsByMonth` (6 months), `byCategory`, `recentUploads`, `pendingApprovals`, `expiringSoon`, `recentActivity` |
|---|---|---|---|

## Documents — `/api/documents`

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/` | `documents.view` (staff) / own (employee) | Search & filter. Query: `q` (title, current or past file name, employee name/number, category, description — partial, case-insensitive), `clientId`, `employeeId`, `categoryId` (csv), `fileType` (csv: pdf,doc,docx,jpg,jpeg,png,xls,xlsx), `status` (csv), `uploadedBy`, `uploadedFrom`, `uploadedTo`, `expiryFrom`, `expiryTo`, `expiringWithin` (days), `folderId`, `includeSubfolders=true`, `archived=exclude\|only\|include`, `sort=title\|employee\|category\|fileType\|uploadedAt\|expiryDate\|status\|client`, `order`, `page`, `pageSize` (≤100) → `{ items, total, page, pageSize }` |
| POST | `/` | employee (self) or `documents.upload` | **multipart/form-data**: `file` + `title`, `description?`, `categoryId?`, `employeeId` (staff/admin), `folderId?`, `requestId?`, `issueDate?`, `expiryDate?`. Max 25 MB. Validated by extension, MIME and magic bytes. Files into the category folder automatically and fulfils a matching open request. `201` |
| GET | `/:id` | view | Details + `versions`, `approvals`, `comments` (internal notes hidden from employees), `folderPath`, `can`. Audited as `document.viewed`. |
| PATCH | `/:id` | `documents.edit` (title/description/category), dates need `edit_dates`, `folderId` needs move | Employees may edit title/description/category; dates only while pending/rejected. |
| POST | `/:id/versions` | `documents.upload`, or employee while pending/rejected/expired/renewal-required | multipart `file` + `issueDate?`, `expiryDate?`, `changeNote?`. Keeps previous versions; status → `pending_review`. |
| POST | `/:id/review` | `documents.review` | `{ decision: "approved" \| "rejected" \| "renewal_required", comment? }` (comment required unless approving). Cannot approve an already-expired certificate. Notifies the employee. |
| POST | `/:id/archive` · `/:id/unarchive` | `documents.archive` | |
| DELETE | `/:id` | `documents.delete` | Soft-deletes the record (kept for audit) and purges all stored files. `204` |
| POST | `/move` | `documents.edit` | `{ documentIds: [], folderId }` — same client only; personal folders only accept that employee's documents. |
| GET | `/:id/url` | `documents.download` | `?disposition=inline\|attachment&versionId=` → `{ url, expiresAt, filename, mimeType, previewable }`. Short-lived signed URL (S3 presigned, or HMAC-signed local URL). Inline only for PDF/images. Audited. |
| POST | `/:id/comments` | `documents.comment` / employee | `{ body, isInternal? }` — internal notes are staff/admin only. |
| GET | `/:id/history` | staff/admin | Audit trail of the document. |

Statuses: `pending_review`, `approved`, `rejected`, `expired`, `renewal_required`.

## Files — `/api/files/:token` (local storage driver only)

Streams a file for a valid, unexpired HMAC token (`403` otherwise). With S3, URLs point directly to the private bucket.

## Folders — `/api/folders`

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/` | view | All visible folders (flat, with `documentCount`, `childCount`, `kind`). `?clientId=` |
| GET | `/:id` | view | Folder + breadcrumb `path` + `children` |
| POST | `/` | `folders.manage` | `{ name, parentId }` — inherits client/employee from parent |
| PATCH | `/:id` | `folders.manage` | `{ name?, parentId? }` — system folders immutable; moves are cycle-checked, same client and same employee subtree |
| DELETE | `/:id` | `folders.manage` | `409` with counts if not empty, unless `?moveContentsToParent=true` |

Folder kinds: `client_root`, `employee_root` (system, auto-created), `category` (auto-created on upload), `custom`.

## Requests (tasks) — `/api/requests`

| GET | `/` | view | `?status=open\|fulfilled\|cancelled&employeeId&clientId&page` |
|---|---|---|---|
| POST | `/` | `requests.manage` | `{ employeeIds: [], title, categoryId?, instructions?, dueDate? }` → notifies each employee |
| POST | `/:id/cancel` | `requests.manage` | |

## Notifications — `/api/notifications`

| GET | `/` | ✓ | `?unreadOnly=true&page` → `{ items, total, unread }` |
|---|---|---|---|
| GET | `/unread-count` | ✓ | |
| POST | `/:id/read` · `/read-all` | ✓ | |

Types: `document_uploaded`, `document_approved`, `document_rejected`, `renewal_required`,
`certificate_expiring`, `certificate_expired`, `document_requested`, `comment_added`, `account`.

## Users — `/api/users` (requires `users.manage`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | `?q&role&status&clientId&page` |
| GET | `/permissions` | Permission catalogue with `grantableToStaff` |
| GET | `/:id` | Detail incl. granted permissions and assigned clients |
| POST | `/` | Create: `{ email, firstName, lastName, role, … }`. Employees need `clientId` (+ `employeeNumber`, `department`, `position`, `hireDate`). Staff accept `permissions[]`, `clientIds[]`. Without `password` the user is `invited` and the response has a single-use `inviteUrl`. |
| PATCH | `/:id` | Profile fields; role admin⇄staff |
| PUT | `/:id/permissions` | Staff only: `{ permissions: [] }` (users/clients management cannot be granted to staff) |
| PUT | `/:id/clients` | Staff only: `{ clientIds: [] }` |
| POST | `/:id/deactivate` · `/:id/activate` | Deactivation revokes all sessions immediately; the last active admin cannot be deactivated |
| POST | `/:id/invite` | New invitation link for an invited user |

## Clients, employees, categories

| GET | `/api/clients` | ✓ (scoped) | with employee/document/pending/staff counts |
|---|---|---|---|
| POST / PATCH | `/api/clients[/:id]` | `clients.manage` | `{ name, code, industry?, contactEmail?, isActive? }`; creates the client root folder |
| GET | `/api/employees` | ✓ (scoped) | `?q&clientId&page&pageSize` with document/pending/expired/request counts |
| GET | `/api/employees/:id` | ✓ (scoped) | |
| GET | `/api/categories` | ✓ | |
| POST / PATCH / DELETE | `/api/categories[/:id]` | `clients.manage` | delete refused while in use |

## Audit — `/api/audit-logs` (requires `audit.view`; staff limited to assigned clients)

| GET | `/` | `?q&action&entityType&entityId&actorId&clientId&from&to&page&pageSize` |
|---|---|---|
| GET | `/actions` | Distinct action names |

## Health

`GET /api/health` → `{ ok: true, storage }`
