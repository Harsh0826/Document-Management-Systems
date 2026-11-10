/**
 * DEVELOPMENT ONLY — fills the library with sample folders and PDF files so you can see how the app
 * looks with a lot of content. Everything goes through the running API as the seed administrator
 * (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in server/.env), exactly like a real upload.
 *
 *   npm run sample:add -w server       add ~56 folders and ~330 PDFs (takes ~6 minutes: uploads are rate limited)
 *   npm run sample:remove -w server    move the sample files to "Recently deleted" and remove the sample folders
 *
 * Options: --files=330  --api=http://localhost:4000
 * What was created is recorded in server/.data/sample-library.json so it can be removed again.
 */
import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../.env'), quiet: true });

const args = process.argv.slice(2);
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const API = opt('api', `http://localhost:${process.env.PORT ?? 4000}`);
const TARGET_FILES = Number(opt('files', 330));
const RECORD = resolve(here, '../.data/sample-library.json');
const UPLOAD_GAP_MS = 1100; // the API allows 60 uploads a minute

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV is production.');
  process.exit(1);
}
if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) {
  console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in server/.env first.');
  process.exit(1);
}

// ---------------------------------------------------------------- API client
let token = '';
async function login() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Sign-in failed (${r.status}): ${body?.error?.message ?? r.statusText}`);
  if (body.mfaRequired) throw new Error('The seed administrator has two-step sign-in turned on; this script cannot sign in.');
  token = body.accessToken;
}

async function call(method, path, body, isForm = false) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let r;
    try {
      r = await fetch(`${API}/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'x-requested-with': 'XMLHttpRequest', ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
    } catch {
      // The dev API restarts when server code changes; wait for it to come back.
      console.log('  (API not reachable, retrying in 5 seconds)');
      await sleep(5000);
      continue;
    }
    if (r.status === 401) {
      await login(); // access tokens last 15 minutes
      continue;
    }
    if (r.status === 429) {
      await sleep(Number(r.headers.get('retry-after') ?? 30) * 1000);
      continue;
    }
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(data?.error?.message ?? `${method} ${path} → ${r.status}`), { status: r.status });
    return data;
  }
  throw new Error(`${method} ${path} kept failing`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- sample PDF
/** A small, valid one-page PDF with a title and a few lines of text. */
function makePdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  const text = [`BT /F1 20 Tf 72 740 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 11 Tf 72 ${700 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------------------------------------------------------------- sample content
/** [folder, children?] — three levels at most. `kind` picks the document names used inside. */
const TREE = [
  ['Licences', [['Business Licences'], ['Driving Licences'], ['Trade Licences', [['Electrical'], ['Plumbing'], ['Gas Safe']]], ['Equipment Licences']]],
  ['HR Policies', [['Leave & Holidays'], ['Code of Conduct'], ['Recruitment'], ['Onboarding']]],
  ['Finance', [['Invoices 2024'], ['Invoices 2025'], ['Tax Returns'], ['Budgets'], ['Bank Statements']]],
  ['Health & Safety', [['Risk Assessments', [['Site A'], ['Site B'], ['Warehouse']]], ['Fire Safety'], ['First Aid'], ['Incident Reports']]],
  ['Contracts', [['Suppliers'], ['Customers'], ['Employment Contracts']]],
  ['Insurance', [['Public Liability'], ['Vehicle Insurance'], ['Property Insurance']]],
  ['Training', [['Manual Handling'], ['Working at Height'], ['Induction']]],
  ['Quality & ISO', [['ISO 9001'], ['ISO 14001'], ['Audits']]],
  ['IT & Security', [['Acceptable Use'], ['Backups']]],
  ['Vehicles', [['Service Records'], ['MOT Certificates']]],
  ['Equipment Manuals'],
  ['Meeting Minutes', [['Board Meetings'], ['Team Meetings']]],
  ['Company Policies'],
  ['Projects', [['Riverside Office Fit-out'], ['North Depot Extension']]],
];

const DOC_WORDS = {
  licence: ['Licence', 'Permit', 'Certificate of Registration', 'Operator Licence', 'Renewal Notice'],
  invoice: ['Invoice', 'Credit Note', 'Remittance Advice', 'Statement'],
  safety: ['Risk Assessment', 'Method Statement', 'Inspection Checklist', 'Safety Briefing', 'Incident Report', 'Fire Drill Record'],
  policy: ['Policy', 'Procedure', 'Guidance', 'Handbook', 'Checklist', 'Form'],
  contract: ['Agreement', 'Contract', 'Terms and Conditions', 'Amendment', 'Renewal Letter'],
  insurance: ['Insurance Certificate', 'Policy Schedule', 'Claim Form', 'Renewal Quote'],
  training: ['Training Certificate', 'Attendance Record', 'Course Notes', 'Assessment'],
  minutes: ['Minutes', 'Agenda', 'Action Log'],
  manual: ['User Manual', 'Maintenance Guide', 'Quick Start Guide', 'Spare Parts List'],
  general: ['Report', 'Summary', 'Plan', 'Register', 'Schedule', 'Letter'],
};
const PEOPLE = ['J. Patel', 'S. Ahmed', 'L. Chen', 'M. Brown', 'R. Okafor', 'A. Novak', 'K. Singh', 'D. Murphy', 'E. Rossi', 'T. Walker'];
const COMPANIES = ['Northwind Supplies', 'Acme Scaffolding', 'Brightline Electrical', 'Harbour Logistics', 'Greenfield Waste', 'Summit Hire'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const kindFor = (path) => {
  const p = path.join(' ').toLowerCase();
  if (/licen|mot/.test(p)) return 'licence';
  if (/invoice|bank|tax|budget|finance/.test(p)) return 'invoice';
  if (/risk|fire|first aid|incident|safety/.test(p)) return 'safety';
  if (/contract|supplier|customer/.test(p)) return 'contract';
  if (/insurance/.test(p)) return 'insurance';
  if (/training|handling|height|induction/.test(p)) return 'training';
  if (/meeting/.test(p)) return 'minutes';
  if (/manual/.test(p)) return 'manual';
  if (/polic|iso|audit|use|backup|hr|leave|conduct|recruit|onboard/.test(p)) return 'policy';
  return 'general';
};

let seed = 42; // repeatable "random" numbers
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function docName(folder, kind) {
  const word = pick(DOC_WORDS[kind]);
  const year = between(2021, 2026);
  switch (kind) {
    case 'invoice':
      return `${pick(COMPANIES)} ${word} ${between(1000, 9999)} - ${pick(MONTHS)} ${year}`;
    case 'contract':
      return `${pick(COMPANIES)} ${word} ${year}`;
    case 'training':
      return `${folder} ${word} - ${pick(PEOPLE)} ${year}`;
    case 'minutes':
      return `${folder.replace(/s$/, '')} ${word} - ${between(1, 28)} ${pick(MONTHS)} ${year}`;
    case 'licence':
      return `${folder.replace(/s$/, '')} ${word} ${pick(['', `- ${pick(PEOPLE)}`, `- Ref ${between(10000, 99999)}`])} ${year}`.replace(/\s+/g, ' ').trim();
    default:
      return `${folder} ${word} ${pick(['', 'v2', `- ${pick(MONTHS)}`, '(updated)'])} ${year}`.replace(/\s+/g, ' ').trim();
  }
}

/** Expiry dates for licences, MOTs, insurance and training: some expired, some due soon, most valid. */
function validUntilFor(kind) {
  const r = Math.random();
  if (!['licence', 'insurance', 'training'].includes(kind) || r < 0.25) return undefined;
  const span = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const days = r < 0.35 ? -span(1, 120) : r < 0.5 ? span(0, 30) : span(31, 900);
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- add / remove
async function add() {
  await login();
  const storage = await call('GET', '/admin/storage').catch(() => null);
  if (storage?.activeDriver === 's3' && !args.includes('--allow-s3')) {
    console.error('Documents are currently stored in Amazon S3. Sample files would be uploaded to your bucket.');
    console.error('Run again with --allow-s3 if that is what you want.');
    process.exit(1);
  }

  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : { folders: [], files: [] };
  const tree = await call('GET', '/library/tree');
  const existing = new Map(tree.map((f) => [`${f.parentId ?? ''}/${f.name.toLowerCase()}`, f.id]));

  // 1. Folders (reuses any that already exist with the same name in the same place).
  const leaves = [];
  async function makeFolder(name, parentId, path, children) {
    const key = `${parentId ?? ''}/${name.toLowerCase()}`;
    let id = existing.get(key);
    if (!id) {
      id = (await call('POST', '/library/folders', { name, parentId })).id;
      record.folders.push(id);
      console.log(`  + folder ${[...path, name].join(' › ')}`);
    }
    leaves.push({ id, name, path: [...path, name] });
    for (const [childName, grandChildren] of children ?? []) await makeFolder(childName, id, [...path, name], grandChildren);
  }
  console.log('Creating folders…');
  for (const [name, children] of TREE) await makeFolder(name, null, [], children);
  writeFileSync(RECORD, JSON.stringify(record, null, 2));

  // 2. Spread the files: a few empty folders, most with a handful, one very full folder.
  const weights = leaves.map((f) => (f.name === 'Invoices 2025' ? 14 : rand() < 0.1 ? 0 : between(1, 4)));
  const total = weights.reduce((a, b) => a + b, 0);
  const plan = leaves.map((f, i) => ({ ...f, count: Math.round((weights[i] / total) * TARGET_FILES) }));
  const fileTotal = plan.reduce((a, p) => a + p.count, 0);
  console.log(
    `\nUploading ${fileTotal} PDF files into ${plan.filter((p) => p.count).length} folders (about ${Math.ceil((fileTotal * UPLOAD_GAP_MS) / 60000)} minutes)…`,
  );

  let done = 0;
  for (const p of plan) {
    if (!p.count) continue;
    const already = new Set(((await call('GET', `/library/folders/${p.id}`))?.files ?? []).map((x) => x.name.toLowerCase()));
    const used = new Set();
    const kind = kindFor(p.path);
    for (let n = 0; n < p.count; n++) {
      let name = docName(p.name, kind);
      while (used.has(name.toLowerCase())) name = `${name} (${between(2, 99)})`;
      used.add(name.toLowerCase());
      if (already.has(name.toLowerCase())) {
        done++; // added on an earlier run (names come from a repeatable sequence)
        continue;
      }
      // Body text and expiry dates use Math.random so only the names follow the repeatable sequence.
      const any = (a) => a[Math.floor(Math.random() * a.length)];
      const lines = [`Folder: ${p.path.join(' > ')}`, `Prepared by ${any(PEOPLE)}`, 'Sample document created for testing the document library.'];
      const sections = 2 + Math.floor(Math.random() * 29);
      for (let l = 0; l < sections; l++) lines.push(`Section ${l + 1}: ${any(DOC_WORDS.general)} details and notes for ${any(COMPANIES)}.`);
      const form = new FormData();
      form.set('folderId', p.id);
      form.set('name', name);
      const validUntil = validUntilFor(kind);
      if (validUntil) form.set('validUntil', validUntil);
      const filename = `${name.replace(/[^\w.-]+/g, '-').toLowerCase()}.pdf`;
      form.set('file', new Blob([makePdf(name, lines)], { type: 'application/pdf' }), filename);
      try {
        const res = await call('POST', '/library/files', form, true);
        record.files.push(res.id ?? res.file?.id);
      } catch (e) {
        if (e.status !== 409) throw e; // 409 = a file with that name is already there; skip it
      }
      done++;
      if (done % 25 === 0 || done === fileTotal) {
        writeFileSync(RECORD, JSON.stringify(record, null, 2));
        console.log(`  ${done}/${fileTotal} uploaded`);
      }
      await sleep(UPLOAD_GAP_MS);
    }
  }
  writeFileSync(RECORD, JSON.stringify(record, null, 2));
  console.log(`\nDone. ${record.folders.length} sample folders and ${record.files.filter(Boolean).length} sample files recorded in ${RECORD}`);
}

async function remove() {
  if (!existsSync(RECORD)) return console.log('Nothing to remove — no sample library was recorded.');
  await login();
  const record = JSON.parse(readFileSync(RECORD, 'utf8'));
  console.log(`Removing ${record.files.length} sample files…`);
  for (const id of record.files.filter(Boolean)) await call('DELETE', `/library/files/${id}`).catch((e) => e.status === 404 || Promise.reject(e));
  console.log(`Removing ${record.folders.length} sample folders…`);
  for (const id of [...record.folders].reverse()) {
    await call('DELETE', `/library/folders/${id}`).catch((e) => {
      if (e.status === 404) return;
      console.log(`  kept one folder: ${e.message}`);
    });
  }
  writeFileSync(RECORD, JSON.stringify({ folders: [], files: [] }, null, 2));
  console.log('Done. The sample files are in "Recently deleted" and are removed for good after 30 days.');
}

mkdirSync(dirname(RECORD), { recursive: true });
(args.includes('--remove') ? remove() : add()).catch((e) => {
  console.error(`\nStopped: ${e.message}`);
  process.exit(1);
});
