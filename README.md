# DocuVault — Secure Document Management System

A full-stack platform for managing employee documents and certificates across client companies:
client employees upload certificates, internal staff review them, administrators control users,
permissions, folders and compliance.

**Stack:** React 19 · TypeScript · Tailwind CSS 4 · shadcn-style components (Radix) · TanStack Query ·
React Hook Form + Zod · Node.js · Express 5 · PostgreSQL · AWS S3 · JWT + bcrypt.

- Architecture, roles, permission model, lifecycle: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- REST API reference: [`docs/API.md`](docs/API.md)
- Database schema: [`server/src/db/migrations/001_init.sql`](server/src/db/migrations/001_init.sql)

## Features

| Area | What works |
|---|---|
| Auth | Separate **Employee** and **Admin & Staff** portals, invitation links, bcrypt, 15-min JWT + rotating httpOnly refresh cookie with reuse detection, account lockout, rate limiting, instant revocation on deactivation |
| RBAC | Admin (everything) · Staff (assigned clients + configurable permissions) · Employee (own records only). Enforced server-side on every query and action; out-of-scope ids return 404 |
| Documents | Drag-and-drop multi-upload with per-file progress, type/size/magic-byte validation, metadata (title, description, category, employee, issue/expiry), versioning (replace/renew keeps history), rename, archive, delete, in-app PDF/image preview, signed-URL downloads |
| Search & filters | Instant partial search over title, file names (incl. past versions), employee name/number, category; combinable filters for client, employee, category, file type, status, uploader, upload date, expiry date, expiring-within, archived; sorting; URL-shareable |
| Folders | Client → Employee → Category hierarchy auto-created; custom subfolders; rename, move, safe delete (contents moved up), breadcrumbs, drag-and-drop filing |
| Review | Review queue, approve / reject / require renewal with reasons, review history, comments and internal staff notes |
| Expiry | Hourly job: marks expired, flags renewal at 30 days, sends 90/60/30-day and expiry notifications (once each); expiry tracker page |
| Requests | Staff/admin request missing documents from one or many employees with due dates; auto-fulfilled by matching uploads |
| Notifications | In-app bell + page for uploads, approvals, rejections, renewals, expiry, requests, comments |
| Audit | Append-only audit log (DB trigger) of logins, failed logins, views, previews, downloads and every change |
| Dashboard | Live, scoped stats, uploads chart, status breakdown, pending approvals, expiring soon, recent activity — no hardcoded data |

## Quick start (local)

Requirements: Node.js 20+ (tested on 24). PostgreSQL and S3 are optional locally.

```bash
npm install
```

```bash
cp server/.env.example server/.env
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on :4000 and Vite proxies `/api`.

Without `DATABASE_URL`, the server uses **PGlite** (real PostgreSQL compiled to WASM, data in
`server/.data/`) and stores files on local disk behind HMAC-signed expiring URLs — handy for
development only. With the default `.env`, these accounts are created on first start
(no documents are seeded):

| Portal | Email | Password |
|---|---|---|
| Admin & Staff | `admin@dms.local` | `Admin@12345` |
| Admin & Staff | `staff@dms.local` (reviewer for the demo client) | `Demo@12345` |
| Employee | `employee@dms.local` | `Demo@12345` |

Change or remove these before any shared deployment (`SEED_DEMO_DATA=false`).

### Using real PostgreSQL + S3 locally (MinIO)

```bash
docker compose up -d
```

Then in `server/.env`:

```
DATABASE_URL=postgres://dms:dms_dev_password@localhost:5432/dms
STORAGE_DRIVER=s3
S3_BUCKET=dms-documents
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=dms-minio
AWS_SECRET_ACCESS_KEY=dms-minio-secret
```

## Tests

```bash
npm test
```

27 integration tests (Vitest + Supertest against an in-memory PostgreSQL) cover login and portal
enforcement, lockout, refresh-token rotation and reuse detection, CSRF guard, invitations,
deactivation, cross-employee and cross-client isolation, permission-limited staff, upload validation
(extension, spoofed content, required expiry), review workflow and notifications, signed-URL
tampering, internal comments, search wildcards, folder safeguards, and the expiry job.

```bash
npm run typecheck
```

## Project structure

```
server/src
  config/env.ts          zod-validated environment
  db/                    pg / PGlite adapter, migrations, seed
  middleware/            authentication, permission guards, rate limits, CSRF guard
  services/              access (scope rules), auth, storage (S3/local), files (validation),
                         folders, notifications, audit, expiry job
  routes/                auth, users, clients/employees/categories, documents, folders,
                         requests, notifications/audit/dashboard/files
server/tests             integration tests
client/src
  api/                   axios client (silent refresh) + TanStack Query hooks
  components/ui          button, inputs, dialogs, menus, tables, tabs… (shadcn-style)
  components/documents   table, filters, actions, preview/review/edit/move/replace dialogs
  components/folders     folder tree with drop targets
  components/layout      app shell, sidebar, notifications
  pages/                 dashboard, documents, detail, upload, folders, reviews, expiry,
                         requests, employees, users, clients, categories, audit, profile, auth
```

## Production deployment (AWS)

1. **Database:** RDS PostgreSQL 15+; set `DATABASE_URL` (and `DATABASE_SSL=true`). Migrations run
   automatically on start (`npm run db:migrate` also available).
2. **Storage:** private S3 bucket with Block Public Access on and default encryption (SSE-S3 or
   KMS via `S3_KMS_KEY_ID`). Give the task role only `s3:PutObject`, `s3:GetObject`,
   `s3:DeleteObject` on `arn:aws:s3:::<bucket>/clients/*`.
3. **Secrets:** `JWT_SECRET` and `FILE_URL_SECRET` (≥32 random chars) and
   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (≥14 chars, used once to create the first admin)
   from Secrets Manager.
4. **Run:** `docker build -t dms .` → ECS Fargate (or App Runner / Elastic Beanstalk) behind an
   ALB with TLS. Set `NODE_ENV=production`, `TRUST_PROXY=1`, `APP_URL=https://your-domain`.
   The container serves the SPA and the API from one origin (no CORS, `SameSite=Strict` cookies).

The server refuses to start in production without `DATABASE_URL` and `STORAGE_DRIVER=s3`.

## Not included yet

- **Email delivery** — invitations return a single-use link the admin copies; notifications are
  in-app. Plug SES into `services/notifications.ts` / user creation to email them.
- **Self-service password reset** — admins issue new links; the `user_tokens` table already
  supports a `password_reset` purpose.
- **Virus scanning** of uploads (e.g. S3 + GuardDuty Malware Protection or ClamAV) and MFA are
  recommended before handling highly sensitive identity documents.
