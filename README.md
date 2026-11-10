# Company Documents

A simple internal library for company documents and licences. **Employees find, view and download.
Administrators upload and organise.** Nothing else, so anyone can use it without training.

**Stack:** React 19 · TypeScript · Tailwind CSS 4 · Radix · TanStack Query · Node.js · Express 5 ·
PostgreSQL · AWS S3 · JWT + bcrypt.

- Design and the reasoning behind every kept or removed feature: [`docs/REDESIGN_SPEC.md`](docs/REDESIGN_SPEC.md)
- API: [`docs/API.md`](docs/API.md)
- How it's built and secured: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Moving files to Amazon S3: [`docs/S3_MIGRATION.md`](docs/S3_MIGRATION.md)

## What people can do

| Everyone | Administrators also |
|---|---|
| Sign in on one page | Add files (drag and drop, names filled in automatically) |
| Search ("Search for a document…"), partial words and spelling variants included | Create, rename and delete folders (max 3 levels) |
| Browse big, labelled folders with file counts and breadcrumbs (Home › Licences › 2025) | Rename, move, replace with a newer copy, delete files |
| See Recently added on Home | Restore deleted files for 30 days |
| **View** and **Download** every file, with name, date added, type, size and "Valid until" for licences | People: add, "Can manage documents?", reset password, remove access |
| Change my password | Two-step sign-in (required for admins in production) |

Kept in the background: private encrypted storage with 5-minute links, a record of every view,
download and change, account lockout and rate limits.

## Run it locally

Requirements: Node.js 20+. PostgreSQL and S3 are optional for local use.

```bash
npm install
```

```bash
cp server/.env.example server/.env
```

```bash
npm run dev
```

Open http://localhost:5173. Without `DATABASE_URL` it uses an embedded PostgreSQL (`server/.data/`)
and stores files on disk (`server/storage/`), for development only. On first start the default
`.env` creates:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@dms.local` | `Admin@12345` |
| Employee | `employee@dms.local` | `Demo@12345` |

…plus four empty starter folders (Licences, HR Policies, Finance, Health & Safety). Set
`SEED_DEMO_DATA=false` and your own `SEED_ADMIN_*` values before sharing it with anyone.

## Checks

```bash
npm run ci
```

That runs lint, formatting, typecheck, the 45 server tests and the build; GitHub Actions runs it on
every push. The tests cover the library (3-level limit, duplicate names, search variants, counts,
view/download links, recently deleted and the 30-day removal), read-only employees, People, sign-in,
lockout, session theft detection, two-step sign-in, password resets, the append-only activity record
and the S3 move.

## Deploying on AWS

1. **Database:** RDS PostgreSQL; set `DATABASE_URL` and `DATABASE_SSL=true`. Migrations run on start.
2. **Files:** private S3 bucket (Block Public Access on, default encryption). The app's role needs
   only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on the bucket.
3. **Secrets:** `JWT_SECRET`, `FILE_URL_SECRET` (different, ≥48 random characters),
   `DATA_ENCRYPTION_KEY` (32 random bytes, base64), `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
4. **Run:** `docker build -t dms .` and deploy behind a load balancer with HTTPS. Set `NODE_ENV=production`,
   `TRUST_PROXY=1` and `APP_URL=https://…`.

The server refuses to start in production with missing or example secrets, local file storage, or an
http address.

## Upgrading from the earlier version

The previous version managed per-employee certificates for several client companies. Upgrading
(migration `005_company_library.sql`) copies every live document into the shared library, with one
top-level folder per old category. Former staff accounts become employees; promote them from People
if they should manage documents. Migration `006_drop_old_app_tables.sql` then removes the old tables
(the activity log is kept). Back up the database before upgrading.
