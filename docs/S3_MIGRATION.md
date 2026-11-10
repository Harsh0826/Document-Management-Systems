# Moving document files to Amazon S3

## The easy way: from the app (no command line)

1. Sign in as an **administrator** and open **File Storage** in the menu.
2. **Step 1 — Connect your bucket:** enter the bucket name and region. Choose how the app signs in to AWS:
   - **Use the server's AWS role** (recommended): your IT contact attaches the IAM policy below to the
     server once. No keys are stored in the app.
   - **Use an access key**: paste an access key ID and secret created for this app in AWS IAM. The secret
     is stored encrypted and is never shown again.
3. Click **Save & test connection**. You'll see "Connected", or a plain-English explanation of what to fix
   (wrong region, missing permission, bucket not found…).
4. **Step 2:** click **Move files to Amazon S3** and watch the progress bar. Documents stay available
   throughout. You can leave the page.
5. When every file has been copied and checked, the app **switches to S3 automatically**. If any file
   couldn't be moved, nothing is switched: the screen lists those files with what to do, and
   **Try again** skips files already copied.

You still need to create the bucket once (section 1 below), or have your IT contact do it.

---

## The command-line way (for IT staff)

This copies every stored document file (all versions of every non-deleted document) from local disk
(`server/storage/`) into a **private** S3 bucket, then switches the app to serve files from S3 through
5-minute presigned links.

What moves: the document **files**. The database (users, metadata, audit log) belongs in PostgreSQL —
in production, Amazon RDS — not in S3.

The tool:

- copies files listed in the database, not whatever happens to be in the folder;
- checks each local file against the SHA-256 recorded when it was uploaded, and never copies a
  corrupted file;
- uploads with an S3-verified SHA-256 checksum and server-side encryption;
- confirms each object after upload;
- skips files already in S3, so it is safe to re-run;
- writes a JSON report.

---

## 1. Create the bucket (once)

Use your own bucket name and region. With the AWS CLI:

```bash
aws s3api create-bucket --bucket YOUR-BUCKET --region YOUR-REGION --create-bucket-configuration LocationConstraint=YOUR-REGION
```

> For `us-east-1`, omit `--create-bucket-configuration`.

```bash
aws s3api put-public-access-block --bucket YOUR-BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

```bash
aws s3api put-bucket-encryption --bucket YOUR-BUCKET --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
```

```bash
aws s3api put-bucket-versioning --bucket YOUR-BUCKET --versioning-configuration Status=Enabled
```

Recommended: a bucket policy that denies non-TLS requests (`aws:SecureTransport = false`). No CORS
configuration is needed: previews load in an iframe or image tag, and downloads use direct links.

## 2. Give the app (and the migration) access

Create an IAM policy with **only** these rights and attach it to the identity that runs the app
(ECS task role in production) and to the user or role you'll run the migration with:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    }
  ]
}
```

If you use a KMS key (`S3_KMS_KEY_ID`), also allow `kms:GenerateDataKey` and `kms:Decrypt` on it.

**Credentials are never put in this project.** The app and the migration use the standard AWS
credential chain: `aws configure` / `AWS_PROFILE`, SSO (`aws sso login`), environment variables in
your shell, or the instance/task role.

## 3. Point the app at the bucket

In `server/.env`, keep `STORAGE_DRIVER=local` for now and add:

```
S3_BUCKET=YOUR-BUCKET
AWS_REGION=YOUR-REGION
# S3_KMS_KEY_ID=arn:aws:kms:...   (optional, otherwise SSE-S3/AES256)
```

## 4. Dry run

**If you use the embedded development database, stop the API server first** (press Ctrl+C in the
`npm run dev` terminal). The embedded database allows only one process at a time.

From the project root:

```bash
npm run storage:migrate -- --dry-run
```

This checks bucket access and every local file without uploading anything. The summary should show
`missing locally: 0` and `checksum mismatch: 0`.

## 5. Copy the files

```bash
npm run storage:migrate
```

For large libraries, raise the concurrency, for example `--concurrency=8`. A report is saved as
`server/storage-migration-report-<time>.json`. If anything failed, fix the cause and run the same
command again; files already in S3 are skipped.

## 6. Switch the app to S3

In `server/.env`:

```
STORAGE_DRIVER=s3
```

Restart with `npm run dev`. Open a few documents and use **Preview** and **Download**. The links
now point to `YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com` and expire after 5 minutes.

Run the migration once more. Any file uploaded between the first copy and the switch gets
picked up, and everything else is skipped:

```bash
npm run storage:migrate
```

## 7. Clean up

Keep `server/storage/` as a backup until you have confirmed everything in the app. Then move it to
secure offline storage or delete it. It contains confidential documents in plain form.

## Troubleshooting

| Message | Fix |
|---|---|
| `S3_BUCKET is not set` | Add `S3_BUCKET` / `AWS_REGION` to `server/.env` |
| `Cannot access bucket … AccessDenied` | The IAM identity lacks `s3:GetObject`/`PutObject` on `YOUR-BUCKET/*`, or the wrong profile is active (`aws sts get-caller-identity`) |
| `Cannot access bucket … Could not load credentials` | Run `aws configure` / `aws sso login`, or set `AWS_PROFILE` |
| `missing locally` | The file is gone from `server/storage/`. Restore it from backup and re-run, or re-upload the document |
| `checksum mismatch` | The local file changed since upload (disk corruption or manual edit). It was not copied. Restore it from backup |
| Previews blank after switching | `APP_URL`/CSP: make sure `S3_BUCKET` and `AWS_REGION` match the bucket's real region, then restart |
