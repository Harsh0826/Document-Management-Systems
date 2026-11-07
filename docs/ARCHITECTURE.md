# DMS — Architecture

## 1. System overview

```
┌──────────────────────────┐        HTTPS (same origin)        ┌──────────────────────────────┐
│  React SPA (client/)     │  ───────────────────────────────▶ │  Express REST API (server/)  │
│  Vite · TS · Tailwind    │   Bearer access JWT (memory)      │  /api/*                      │
│  shadcn-style UI         │   httpOnly refresh cookie         │  helmet · rate limit · zod   │
│  TanStack Query · RHF+Zod│                                   │  RBAC + scope checks         │
└──────────────────────────┘                                   └──────┬───────────────┬───────┘
                                                                      │               │
                                                        SQL (pg)      │               │  AWS SDK v3
                                                                      ▼               ▼
                                                        ┌────────────────────┐ ┌──────────────────────┐
                                                        │ PostgreSQL         │ │ S3 (private bucket)  │
                                                        │ (PGlite in local   │ │ presigned GET/PUT,   │
                                                        │  dev if no DB URL) │ │ 5-min expiry, SSE    │
                                                        └────────────────────┘ └──────────────────────┘
```

* **Single origin in production.** Express serves the built SPA (`client/dist`) and the API, so cookies are
  `SameSite=Strict` and no CORS is needed. In development Vite proxies `/api` to the server.
* **Storage drivers.** `STORAGE_DRIVER=s3` uses a private S3 bucket and returns presigned URLs.
  `STORAGE_DRIVER=local` (development only) stores files outside the web root and serves them through
  HMAC-signed, time-limited URLs that behave exactly like presigned URLs. No storage URL is ever
  permanent or public.
* **Database drivers.** `DATABASE_URL` set → `pg` connection pool against PostgreSQL. Unset (local dev
  and tests) → PGlite, an embedded build of real PostgreSQL, so the same SQL and migrations run everywhere.

## 2. Roles and access model

| Role | Portal | Scope of data |
|---|---|---|
| **admin** | Admin & Staff portal | Everything, all clients |
| **staff** (your internal employees) | Admin & Staff portal | Only clients assigned to them (`staff_client_assignments`), only what their permissions allow |
| **employee** (client employees) | Employee portal | Only their own employee record, documents, folders, requests |

Effective permissions = `role_permissions(role)` ∪ `user_permissions(user)`. Admin's role holds every
permission. Staff's role holds only `documents.view`; everything else is granted per staff user, so staff
never inherit admin power. Employees hold no permission keys — their capabilities are hard-scoped to
"own records" in code.

| Permission | Meaning |
|---|---|
| `documents.view` | List / open documents in scope |
| `documents.download` | Preview and download files (signed URLs) |
| `documents.upload` | Upload or replace on behalf of employees |
| `documents.edit` | Rename, edit metadata, move between folders |
| `documents.review` | Approve / reject / require renewal |
| `documents.archive` | Archive and unarchive |
| `documents.delete` | Delete documents |
| `documents.comment` | Add comments and internal notes |
| `folders.manage` | Create, rename, move, delete folders |
| `requests.manage` | Assign document requests (tasks) to employees |
| `users.manage` | Create, invite, edit, deactivate users; assign permissions and clients |
| `clients.manage` | Create and edit client companies |
| `audit.view` | Read audit logs |

**Every** document/folder operation goes through `server/src/services/access.ts`:
1. `scopeFilter(user)` produces the SQL predicate that limits rows to the caller's scope
   (admin → none, staff → assigned clients, employee → own employee id). List queries always include it.
2. `loadDocumentForUser(user, id)` loads a single row *through the scope predicate*; out-of-scope rows
   return 404 (not 403) so IDs cannot be probed.
3. `requirePermission(key)` middleware + per-action checks (e.g. employees may replace a document only
   while it is pending / rejected / expired / renewal-required).

## 3. Authentication

* Passwords hashed with **bcrypt (cost 12)**. Policy: ≥ 10 chars, upper, lower, digit.
* Login: `POST /api/auth/login` with `portal` (`admin` | `employee`). Role must match the portal.
  5 failed attempts lock the account for 15 minutes; login endpoint is rate limited per IP.
* **Access token**: JWT (HS256, 15 min) held in memory by the SPA, sent as `Authorization: Bearer`.
  Every request reloads the user, so deactivation takes effect immediately.
* **Refresh token**: 256-bit random, stored **hashed** in `auth_sessions`, sent as an `httpOnly`,
  `Secure`, `SameSite=Strict` cookie scoped to `/api/auth`. Rotated on every refresh; reuse of an old
  token revokes the whole session family (theft detection). Refresh requires the `X-Requested-With`
  header as an extra CSRF guard.
* Invitations and password resets use single-use, hashed, expiring tokens (`user_tokens`).

## 4. Document lifecycle

```
upload ──▶ pending_review ──approve──▶ approved ──(≤30 days to expiry)──▶ renewal_required
                │                         │                                     │
                └──reject──▶ rejected     └──────────(expiry date passed)───────┴──▶ expired
                                 │                                                       │
                                 └──────────── upload new version ◀──────────────────────┘
                                                     (back to pending_review, old version kept)
```

* Each upload creates a row in `document_versions`; `documents.current_version_id` points to the latest.
  Old versions remain downloadable by authorized users.
* An hourly **expiry job** marks expired documents, flips approved documents to `renewal_required` at
  30 days, and sends 90/60/30-day and expired notifications (de-duplicated via `expiry_reminders`).
* Files are validated server-side by extension whitelist, declared MIME, **magic bytes**, and size.
  Storage keys are generated (`clients/<id>/documents/<id>/v<n>-<uuid>.<ext>`) and never contain
  user-supplied names.

## 5. Folder model

```
Client root (client_root, created with the client)
├── Employee folder (employee_root, created with the employee)
│   ├── Identification Documents   (category folders, auto-created on first upload)
│   ├── Educational Certificates
│   └── ...custom subfolders
└── ...custom folders
```

System folders (client/employee roots) cannot be deleted or renamed. Deleting a non-empty folder
requires an explicit choice to move its contents to the parent folder. Folder moves are cycle-checked
and cannot cross clients.

## 6. Database

See `server/src/db/migrations/001_init.sql` — normalized schema with foreign keys, check constraints,
indexes (including trigram indexes for partial-name search) and an append-only trigger on `audit_logs`.

Tables: `roles`, `permissions`, `role_permissions`, `user_permissions`, `users`, `clients`, `employees`,
`staff_client_assignments`, `auth_sessions`, `user_tokens`, `document_categories`, `folders`,
`documents`, `document_versions`, `document_approvals`, `document_comments`, `document_requests`,
`notifications`, `expiry_reminders`, `audit_logs`, `schema_migrations`.

## 7. Frontend structure

```
client/src
├── api/          axios client (token refresh), typed endpoint functions
├── components/
│   ├── ui/       shadcn-style primitives (Radix + Tailwind)
│   ├── layout/   AppShell, Sidebar, Topbar, NotificationBell
│   └── documents/ DocumentTable, Filters, UploadDropzone, PreviewDialog, StatusBadge ...
├── hooks/        TanStack Query hooks per resource
├── lib/          utils, formatters, auth context
└── pages/        route screens (dashboard, documents, explorer, reviews, expiry, users, ...)
```

## 8. Deployment (AWS)

* **App**: container (see `Dockerfile`) on ECS Fargate or Elastic Beanstalk behind an ALB with TLS.
* **DB**: RDS for PostgreSQL (encryption at rest, automated backups), `DATABASE_URL` from Secrets Manager.
* **Files**: private S3 bucket — Block Public Access ON, SSE-S3 or SSE-KMS, bucket policy denying
  non-TLS access. The app's IAM role needs only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on
  `arn:aws:s3:::<bucket>/clients/*`.
* `JWT_SECRET`, `FILE_URL_SECRET` from Secrets Manager; `NODE_ENV=production`, `TRUST_PROXY=1`.
