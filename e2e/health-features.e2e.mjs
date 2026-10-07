/**
 * MediVault end-to-end tests (real Chrome, real app, real Supabase project).
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=... E2E_PHASE=full node e2e/health-features.e2e.mjs
 *
 *   E2E_PHASE=pre   -> run BEFORE applying 20261008_medivault_health_features.sql:
 *                      proves existing features keep working on the old schema and the new
 *                      pages fail gracefully.
 *   E2E_PHASE=full  -> run AFTER the migration: every new feature, end to end.
 *
 * Requires the dev server (npm run dev) and Chrome. All data it creates is labelled "E2E"
 * and is deleted again at the end (your profile is restored too). Credentials come only
 * from the environment.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- config
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const PHASE = process.env.E2E_PHASE || 'full';
const CHROME =
  process.env.E2E_CHROME ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(
    (p) => fs.existsSync(p)
  );
if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD');
  process.exit(2);
}

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const SB_URL = env.VITE_SUPABASE_URL;
const SB_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, 'artifacts');
fs.mkdirSync(ART, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-e2e-'));
const PNG = path.join(TMP, 'e2e-image.png');
const PDF = path.join(TMP, 'e2e-receipt.pdf');
fs.writeFileSync(
  PNG,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
);
fs.writeFileSync(
  PDF,
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);

// ---------------------------------------------------------------- tiny test framework
const results = [];
let currentSection = '';
const section = (name) => {
  currentSection = name;
  console.log(`\n== ${name}`);
};
async function step(name, fn) {
  const label = `${currentSection} :: ${name}`;
  try {
    await fn();
    results.push({ label, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ label, ok: false, error: e.message.split('\n')[0] });
    console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
    try {
      const file = path.join(ART, `FAIL-${results.length}-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png`);
      await page.screenshot({ path: file, fullPage: true });
    } catch {}
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};
const eq = (got, want, msg = '') => assert(got === want, `${msg} expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const has = (hay, needle, msg = '') => assert(String(hay).includes(needle), `${msg} expected to contain ${JSON.stringify(needle)}, got ${JSON.stringify(String(hay).slice(0, 300))}`);

// ---------------------------------------------------------------- date helpers (independent of app code)
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDaysDate = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const now0 = new Date();
const TODAY = ymd(now0);
const TOMORROW = ymd(addDaysDate(now0, 1));
const NEXT_WEEK = ymd(addDaysDate(now0, 7));
const DOB = '1990-05-15';
function expectedAgeYears(dob, now = new Date()) {
  const [y, m, d] = dob.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}
const timeRe = (t) => {
  // "15:30" -> matches "3:30 PM" / "15:30" depending on locale
  const [h, mi] = t.split(':').map(Number);
  const h12 = h % 12 || 12;
  return new RegExp(`(${h12}:${pad(mi)}\\s?(AM|PM|am|pm))|(${pad(h)}:${pad(mi)})`);
};

// ---------------------------------------------------------------- browser + REST helpers
let browser, context, page;
let token = '';
const rest = async (p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`${SB_URL}${p}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
};
const readToken = async () =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
    return k ? JSON.parse(localStorage.getItem(k)).access_token : '';
  });

const go = async (p) => {
  await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
};
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const noCrash = async () => {
  const body = await page.locator('body').innerText();
  assert(!/something went wrong|unexpected error|application error/i.test(body), 'ErrorBoundary / crash text visible');
};
const notice = async (re) => {
  await page.locator('[data-testid="status-notice"]').filter({ hasText: re }).first().waitFor({ timeout: 15000 });
};
async function login() {
  await go('/login');
  await page.fill('input[name=email]', EMAIL);
  await page.fill('input[name=password]', PASSWORD);
  await tid('button-submit-auth').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  token = await readToken();
  assert(token, 'no access token after login');
}
async function shot(name, vw) {
  try {
    await page.screenshot({ path: path.join(ART, `${name}${vw ? '-' + vw : ''}.png`), fullPage: true });
  } catch {}
}

// ---------------------------------------------------------------- main
const created = { sharesFromPack: [] };
let originalProfile = null;

async function main() {
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  // Controllable Notification API so "browser alerts" can be tested deterministically.
  await context.addInitScript(() => {
    window.__notifs = [];
    let perm = 'default';
    class N {
      constructor(title, opts) {
        window.__notifs.push({ title, body: opts && opts.body, tag: opts && opts.tag });
      }
      static get permission() {
        return perm;
      }
      static requestPermission() {
        perm = 'granted';
        return Promise.resolve('granted');
      }
    }
    Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true });
  });
  page = await context.newPage();
  page.on('dialog', (d) => d.accept()); // window.confirm() for delete flows
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  section('Existing features: auth & shell');
  await step('landing page renders', async () => {
    await go('/');
    await tid('link-get-started').waitFor();
  });
  await step('signup + forgot-password pages render', async () => {
    await go('/signup');
    await tid('form-signup').waitFor();
    await go('/forgot-password');
    await tid('form-forgot').waitFor();
  });
  await step('protected route redirects to /login when signed out', async () => {
    await go('/medicines');
    await page.waitForURL('**/login', { timeout: 15000 });
  });
  await step('wrong password shows an error and stays on /login', async () => {
    await go('/login');
    await page.fill('input[name=email]', EMAIL);
    await page.fill('input[name=password]', 'definitely-wrong-password');
    await tid('button-submit-auth').click();
    await notice(/invalid/i);
    assert(page.url().endsWith('/login'));
  });
  await step('sign in with the real account', login);
  await step('invalid share link shows the expired/invalid screen', async () => {
    const p2 = await context.newPage();
    await p2.goto(`${BASE}/share/not-a-real-token-123`);
    await p2.locator('[data-testid="status-public-share"]').waitFor({ timeout: 20000 });
    has(await p2.locator('[data-testid="status-public-share"]').innerText(), 'invalid');
    await p2.close();
  });

  if (PHASE === 'pre') await prePhase();
  else await fullPhase();

  await step('no uncaught page errors during the whole run', async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  });

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nFailures:');
    failed.forEach((f) => console.log(` - ${f.label}\n     ${f.error}`));
  }
  process.exit(failed.length ? 1 : 0);
}

// ====================================================================================
// PHASE: pre-migration  (existing features must keep working on the OLD schema)
// ====================================================================================
async function prePhase() {
  section('PRE-MIGRATION: existing features still work on the old schema');
  await step('dashboard renders with its original stats', async () => {
    await go('/dashboard');
    await page.getByText('Total Records').waitFor();
    await page.getByText('Upcoming Appointments').waitFor();
    await noCrash();
  });
  await step('upload a record (no time field used) still saves', async () => {
    await go('/records/upload');
    await tid('input-upload-file').setInputFiles(PNG);
    await page.fill('input[name=title]', 'E2E Legacy Record');
    await page.fill('input[name=document_date]', TODAY);
    await tid('button-save-upload').click();
    await page.waitForURL('**/records', { timeout: 30000 });
    await page.getByText('E2E Legacy Record').waitFor();
  });
  await step('record detail opens', async () => {
    await page.getByText('E2E Legacy Record').first().click();
    await tid('button-open-record').waitFor();
  });
  await step('add an appointment (no reminder) still saves on the old schema', async () => {
    await go('/appointments');
    await tid('button-new-appointment').click();
    await page.fill('input[name=doctor_name]', 'Dr. E2E Legacy');
    await page.fill('input[name=appointment_date]', NEXT_WEEK);
    await page.fill('input[name=appointment_time]', '11:45');
    await tid('button-save-appointment').click();
    await notice(/added to your schedule/i);
    await page.getByText('Dr. E2E Legacy').first().waitFor();
    await tid('button-appointment-filter-all').click();
    has(await page.locator('[data-testid^="text-appointment-when-"]').first().innerText(), '2');
  });
  await step('legacy share link works via the fallback (documents only)', async () => {
    await go('/sharing');
    await page.getByText('E2E Legacy Record').first().click();
    await page.fill('input[name=recipient]', 'E2E Legacy Clinic');
    await tid('button-create-share').click();
    const link = await tid('input-generated-share-link').inputValue();
    const p2 = await context.newPage();
    await p2.goto(link);
    await p2.getByText('E2E Legacy Record').waitFor({ timeout: 25000 });
    await p2.locator('[data-testid="link-open-shared-file"]').first().waitFor({ timeout: 25000 });
    await p2.close();
  });
  await step('profile name save still works; DOB save fails gracefully (column missing)', async () => {
    await go('/profile');
    const name = await tid('input-profile-name').inputValue();
    await tid('input-profile-dob').fill(DOB);
    await tid('button-save-profile').click();
    await notice(/date of birth could not be saved|updated/i);
    await noCrash();
    await tid('input-profile-name').fill(name);
  });
  await step('timeline still lists existing records', async () => {
    await go('/timeline');
    await page.getByText('E2E Legacy Record').first().waitFor({ timeout: 20000 });
    await noCrash();
  });
  for (const p of ['/medicines', '/receipts', '/reminders', '/visit-pack', '/search']) {
    await step(`${p} fails gracefully until migrated (no crash)`, async () => {
      await go(p);
      await page.waitForTimeout(2500);
      await noCrash();
      assert(await page.locator('h1').first().isVisible(), 'page heading missing');
    });
  }

  // cleanup
  await step('cleanup: delete legacy test data', async () => {
    await go('/records');
    await page.locator('[data-testid^="button-delete-record-"]').first().click();
    await notice(/deleted/i);
    await go('/appointments');
    await tid('button-appointment-filter-all').click();
    await page.locator('[data-testid^="button-delete-appointment-"]').first().click();
    await notice(/removed/i);
    const sh = await rest("/rest/v1/shares?recipient=like.E2E*&select=id");
    for (const s of sh.json || []) await rest(`/rest/v1/shares?id=eq.${s.id}`, { method: 'DELETE' });
    const left = await rest('/rest/v1/medical_documents?title=like.E2E*&select=id');
    eq((left.json || []).length, 0, 'leftover E2E records');
  });
}

// ====================================================================================
// PHASE: full (post-migration)
// ====================================================================================
async function fullPhase() {
  const tables = ['prescriptions', 'medicines', 'medicine_receipts', 'medication_reminders', 'medication_reminder_logs', 'share_items'];
  section('Migration check');
  await step('all new tables exist and are reachable through the API', async () => {
    for (const t of tables) {
      const r = await rest(`/rest/v1/${t}?select=id&limit=1`);
      assert(r.status === 200, `${t} -> HTTP ${r.status} ${r.text.slice(0, 120)}`);
    }
  });
  await step('profile has date_of_birth column', async () => {
    const r = await rest('/rest/v1/profiles?select=id,full_name,date_of_birth');
    assert(r.status === 200 && r.json.length === 1, `profiles -> ${r.status} ${r.text.slice(0, 120)}`);
    originalProfile = r.json[0];
  });

  // ------------------------------------------------------------ DOB + age
  section('Date of birth + automatic age');
  await step('future date of birth is blocked by the form', async () => {
    await go('/profile');
    await tid('input-profile-dob').fill(ymd(addDaysDate(new Date(), 3)));
    const invalid = await tid('input-profile-dob').evaluate((el) => !el.validity.valid);
    assert(invalid, 'future DOB accepted by the input');
  });
  await step('entering a DOB shows a live age preview', async () => {
    await tid('input-profile-dob').fill(DOB);
    const t = await tid('text-profile-age-preview').innerText();
    has(t, `${expectedAgeYears(DOB)} years`);
  });
  await step('saving stores the DOB and shows current age (card + sidebar)', async () => {
    await tid('button-save-profile').click();
    await notice(/profile has been updated/i);
    has(await tid('text-profile-age').innerText(), `${expectedAgeYears(DOB)} years`);
    has(await tid('text-sidebar-age').innerText(), `${expectedAgeYears(DOB)} years`);
    const detail = await tid('text-profile-age-detail').innerText();
    assert(/\d+ years?, \d+ months?, \d+ days?/.test(detail), `detail format: ${detail}`);
  });
  await step('DOB persists in the database and after reload; age is NOT stored', async () => {
    const r = await rest('/rest/v1/profiles?select=*');
    eq(r.json[0].date_of_birth, DOB);
    assert(!Object.keys(r.json[0]).some((k) => /^age/.test(k)), 'an age column exists');
    await page.reload();
    await tid('text-profile-age').waitFor();
    has(await tid('text-profile-age').innerText(), `${expectedAgeYears(DOB)} years`);
  });
  await step('dashboard greeting shows the age', async () => {
    await go('/dashboard');
    has(await page.locator('main').innerText(), `Age ${expectedAgeYears(DOB)} years`);
  });
  await step('server rejects a future DOB even if the UI is bypassed (trigger)', async () => {
    const uid = (await rest('/rest/v1/profiles?select=id')).json[0].id;
    const r = await rest(`/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', body: { date_of_birth: ymd(addDaysDate(new Date(), 5)) } });
    assert(r.status >= 400, `expected rejection, got ${r.status}`);
  });

  // ------------------------------------------------------------ prescriptions & medicines
  section('Prescriptions & medicines');
  const RX_TIME = '09:30';
  await step('empty form cannot be submitted (required fields)', async () => {
    await go('/medicines');
    await tid('button-add-prescription').click();
    await tid('button-save-prescription').click();
    await tid('form-prescription').waitFor();
    const invalid = await page.locator('input[name=doctor_name]').evaluate((el) => !el.validity.valid);
    assert(invalid, 'doctor name not required');
  });
  await step('add a prescription with 2 medicines and a photo', async () => {
    await page.fill('input[name=doctor_name]', 'Dr. E2E Test');
    await page.fill('input[name=hospital_name]', 'E2E General Hospital');
    await page.fill('input[name=prescription_date]', TODAY);
    await page.fill('input[name=prescription_time]', RX_TIME);
    await page.fill('input[name=reason]', 'E2E routine check');
    await page.fill('input[name=medicine_name_0]', 'E2E-Amoxil');
    await page.fill('input[name=dosage_0]', '500 mg');
    await tid('input-frequency-0').fill('Twice daily');
    await page.fill('input[name=duration_days_0]', '5');
    await tid('button-add-medicine-row').click();
    await page.fill('input[name=medicine_name_1]', 'E2E-Vitamin');
    await page.fill('input[name=dosage_1]', '1 tablet');
    await tid('input-frequency-1').fill('Once daily');
    await tid('input-prescription-file').setInputFiles(PNG);
    await tid('button-save-prescription').click();
    await notice(/prescription saved/i);
  });
  const rxCard = () => page.locator('[data-testid^="card-prescription-"]', { hasText: 'Dr. E2E Test' }).first();
  await step('card shows doctor, hospital, exact date + time, medicines, dosage, frequency, duration', async () => {
    await rxCard().waitFor();
    const txt = await rxCard().innerText();
    has(txt, 'Dr. E2E Test');
    has(txt, 'E2E General Hospital');
    has(txt, String(now0.getFullYear()), 'year');
    assert(timeRe(RX_TIME).test(txt), `time ${RX_TIME} not shown: ${txt.slice(0, 200)}`);
    has(txt, 'E2E-Amoxil');
    has(txt, '500 mg');
    has(txt, 'Twice daily');
    has(txt, '5 days');
    has(txt, 'E2E-Vitamin');
    has(txt, 'Active');
  });
  await step('data is stored with a private per-user storage path', async () => {
    const r = await rest('/rest/v1/prescriptions?doctor_name=eq.Dr.%20E2E%20Test&select=*');
    eq(r.json.length, 1);
    const p = r.json[0];
    const uid = p.user_id;
    assert(p.storage_path.startsWith(`${uid}/prescriptions/`), `path ${p.storage_path}`);
    eq(p.prescription_time.slice(0, 5), RX_TIME);
    eq(p.prescription_date, TODAY);
    created.rx = p;
    const m = await rest(`/rest/v1/medicines?prescription_id=eq.${p.id}&select=*`);
    eq(m.json.length, 2);
  });
  await step('prescription file opens through a short-lived signed URL', async () => {
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      rxCard().locator('[data-testid^="button-view-prescription-file-"]').click(),
    ]);
    const url = popup.url();
    has(url, '/storage/v1/object/sign/medical-records/');
    const res = await context.request.get(url);
    eq(res.status(), 200, 'signed URL status');
    has(res.headers()['content-type'], 'image/png');
    await popup.close();
  });
  await step('the same file is NOT readable without a signed URL (bucket is private)', async () => {
    const direct = await fetch(`${SB_URL}/storage/v1/object/public/medical-records/${created.rx.storage_path}`);
    assert(direct.status >= 400, `public URL returned ${direct.status}`);
    const anon = await fetch(`${SB_URL}/storage/v1/object/medical-records/${created.rx.storage_path}`, { headers: { apikey: SB_KEY } });
    assert(anon.status >= 400, `anonymous object read returned ${anon.status}`);
  });
  await step('edit: change hospital, remove a medicine, add one', async () => {
    await rxCard().locator('[data-testid^="button-edit-prescription-"]').click();
    await page.fill('input[name=hospital_name]', 'E2E Updated Hospital');
    await tid('button-remove-medicine-1').click();
    await tid('button-add-medicine-row').click();
    await page.fill('input[name=medicine_name_1]', 'E2E-Cough');
    await page.fill('input[name=dosage_1]', '10 ml');
    await tid('input-frequency-1').fill('Three times daily');
    await page.fill('input[name=duration_days_1]', '3');
    await tid('button-save-prescription').click();
    await notice(/prescription updated/i);
    const txt = await rxCard().innerText();
    has(txt, 'E2E Updated Hospital');
    has(txt, 'E2E-Cough');
    assert(!txt.includes('E2E-Vitamin'), 'removed medicine still shown');
    has(txt, 'E2E-Amoxil');
  });
  await step('replacing the file removes the old object from storage', async () => {
    const before = created.rx.storage_path;
    await rxCard().locator('[data-testid^="button-edit-prescription-"]').click();
    await tid('input-prescription-file').setInputFiles(PDF);
    await tid('button-save-prescription').click();
    await notice(/prescription updated/i);
    const r = await rest('/rest/v1/prescriptions?doctor_name=eq.Dr.%20E2E%20Test&select=*');
    assert(r.json[0].storage_path !== before, 'path unchanged');
    eq(r.json[0].mime_type, 'application/pdf');
    created.rx = r.json[0];
    const old = await rest(`/storage/v1/object/authenticated/medical-records/${before}`);
    assert(old.status >= 400, `old file still readable (${old.status})`);
  });
  await step('invalid file type is rejected in the UI', async () => {
    await rxCard().locator('[data-testid^="button-edit-prescription-"]').click();
    const bad = path.join(TMP, 'notes.txt');
    fs.writeFileSync(bad, 'not allowed');
    await tid('input-prescription-file').setInputFiles(bad);
    await tid('status-prescription-error').waitFor();
    has(await tid('status-prescription-error').innerText(), 'Invalid file format');
    await tid('button-close-dialog').click();
  });
  await shot('medicines-desktop');

  // ------------------------------------------------------------ receipts
  section('Medicine receipts');
  await step('receipt requires a file', async () => {
    await go('/receipts');
    await tid('button-add-receipt').click();
    await page.fill('input[name=pharmacy_name]', 'E2E Pharmacy');
    await page.fill('input[name=amount]', '249.50');
    await tid('button-save-receipt').click();
    await tid('status-receipt-error').waitFor();
    has(await tid('status-receipt-error').innerText(), 'attach the receipt');
  });
  await step('add receipt (PDF) with pharmacy, date, time, amount, linked prescription', async () => {
    await tid('input-receipt-file').setInputFiles(PDF);
    await page.fill('input[name=purchase_date]', TODAY);
    await page.fill('input[name=purchase_time]', '10:15');
    await page.selectOption('select#currency', 'USD');
    await page.selectOption('select#prescription_id', { index: 1 });
    await tid('button-save-receipt').click();
    await notice(/receipt saved/i);
  });
  const rcRow = () => page.locator('[data-testid^="row-receipt-"]', { hasText: 'E2E Pharmacy' }).first();
  await step('receipt shows pharmacy, exact date + time, amount and linked doctor', async () => {
    await rcRow().waitFor();
    const txt = await rcRow().innerText();
    has(txt, 'E2E Pharmacy');
    has(txt, '$249.50');
    has(txt, String(now0.getFullYear()));
    assert(timeRe('10:15').test(txt), 'time not shown');
    has(txt, 'Dr. E2E Test');
    has(await tid('text-receipt-total').innerText(), '$249.50');
  });
  await step('receipt file is private, stored under <uid>/receipts/ and opens via signed URL', async () => {
    const r = await rest('/rest/v1/medicine_receipts?pharmacy_name=eq.E2E%20Pharmacy&select=*');
    eq(r.json.length, 1);
    created.rc = r.json[0];
    assert(created.rc.storage_path.startsWith(`${created.rc.user_id}/receipts/`), created.rc.storage_path);
    eq(Number(created.rc.amount), 249.5);
    const [popup] = await Promise.all([context.waitForEvent('page'), rcRow().locator('[data-testid^="button-view-receipt-"]').click()]);
    has(popup.url(), '/storage/v1/object/sign/');
    eq((await context.request.get(popup.url())).status(), 200);
    await popup.close();
  });
  await step('receipt search filters the list', async () => {
    await tid('input-search-receipts').fill('nonexistent-pharmacy');
    await page.getByText('No matching receipts').waitFor();
    await tid('input-search-receipts').fill('e2e pharm');
    await rcRow().waitFor();
  });
  await shot('receipts-desktop');

  // ------------------------------------------------------------ appointments / follow-ups
  section('Appointments & next-visit follow-ups');
  const soon = new Date(Date.now() + 30 * 60_000);
  await step('appointment requires an exact time', async () => {
    await go('/appointments');
    await tid('button-new-appointment').click();
    await page.fill('input[name=doctor_name]', 'Dr. E2E Other');
    const invalid = await page.locator('input[name=appointment_time]').evaluate((el) => el.required && !el.validity.valid);
    assert(invalid, 'time is not required');
    await tid('button-close-dialog').click();
  });
  await step('add a normal appointment with date + time', async () => {
    await tid('button-new-appointment').click();
    await page.fill('input[name=doctor_name]', 'Dr. E2E Other');
    await page.fill('input[name=hospital_name]', 'E2E Clinic');
    await page.fill('input[name=appointment_date]', NEXT_WEEK);
    await page.fill('input[name=appointment_time]', '16:45');
    await tid('button-save-appointment').click();
    await notice(/added to your schedule/i);
    const row = page.locator('[data-testid^="row-appointment-"]', { hasText: 'Dr. E2E Other' }).first();
    const txt = await row.innerText();
    assert(timeRe('16:45').test(txt), `time missing: ${txt}`);
    has(txt, String(addDaysDate(now0, 7).getFullYear()));
    assert(!txt.includes('Follow-up'), 'plain appointment labelled follow-up');
  });
  await step('add a follow-up (tomorrow 14:30, remind 1 day before)', async () => {
    await tid('button-new-followup').click();
    await page.fill('input[name=doctor_name]', 'Dr. E2E Test');
    await page.fill('input[name=hospital_name]', 'E2E Updated Hospital');
    await page.fill('input[name=appointment_date]', TOMORROW);
    await page.fill('input[name=appointment_time]', '14:30');
    await page.fill('input[name=reason]', 'E2E follow-up');
    eq(await page.locator('select#remind_before_minutes').inputValue(), '1440');
    await tid('button-save-appointment').click();
    await notice(/follow-up added/i);
    const row = page.locator('[data-testid^="row-appointment-"]', { hasText: 'E2E follow-up' }).first();
    const txt = await row.innerText();
    has(txt, 'Follow-up');
    has(txt, 'Reminder: 1 day before');
    assert(timeRe('14:30').test(txt), 'time missing');
  });
  await step('follow-up due NOW: visit in 30 min, remind 1 hour before -> banner + alert', async () => {
    await go('/reminders');
    await tid('button-add-followup').click();
    await page.fill('input[name=doctor_name]', 'Dr. E2E Soon');
    await page.fill('input[name=hospital_name]', 'E2E Soon Clinic');
    await page.fill('input[name=appointment_date]', ymd(soon));
    await page.fill('input[name=appointment_time]', hm(soon));
    await page.selectOption('select#remind_before_minutes', '60');
    await tid('button-save-appointment').click();
    await notice(/follow-up added/i);
    await tid('banner-due-reminders').waitFor({ timeout: 20000 });
    const b = await tid('banner-due-reminders').innerText();
    has(b, 'Dr. E2E Soon');
    assert(timeRe(hm(soon)).test(b), `visit time not in banner: ${b}`);
    await tid('button-dismiss-visit-' + (await rest('/rest/v1/appointments?doctor_name=eq.Dr.%20E2E%20Soon&select=id')).json[0].id).click();
    await page.waitForTimeout(500);
    assert(!(await tid('banner-due-reminders').isVisible().catch(() => false)) || !(await tid('banner-due-reminders').innerText()).includes('Dr. E2E Soon'), 'dismissed visit still in banner');
  });
  await step('upcoming visit reminders list shows exact date, time and reminder moment', async () => {
    await go('/reminders');
    const f = tid('section-followups');
    await f.waitFor();
    const txt = await f.innerText();
    has(txt, 'Dr. E2E Test');
    has(txt, 'Reminder: 1 day before');
    has(txt, 'Follow-up');
    assert(timeRe('14:30').test(txt), 'visit time missing');
  });
  await step('appointment edit keeps working', async () => {
    await go('/appointments');
    const row = page.locator('[data-testid^="row-appointment-"]', { hasText: 'Dr. E2E Other' }).first();
    await row.locator('[data-testid^="button-edit-appointment-"]').click();
    await page.fill('input[name=appointment_time]', '17:20');
    await tid('button-save-appointment').click();
    await notice(/appointment updated/i);
    assert(timeRe('17:20').test(await row.innerText()), 'edited time not shown');
  });
  await step('filters: type chips work', async () => {
    await tid('button-appointment-type-follow_up').click();
    const n = await page.locator('[data-testid^="row-appointment-"]').count();
    assert(n >= 2, `expected >=2 follow-ups, got ${n}`);
    assert(!(await page.locator('main').innerText()).includes('Dr. E2E Other'), 'plain appointment visible under Follow-ups filter');
    await tid('button-appointment-type-all').click();
  });

  // ------------------------------------------------------------ medication reminders
  section('Medication reminders');
  const dueTime = new Date(Date.now() - 2 * 60_000);
  await step('reminder form validates (needs a time and a day)', async () => {
    await go('/medicines');
    await rxCard().locator('[data-testid^="button-set-reminder-"]').first().click();
    await tid('form-med-reminder').waitFor();
    const invalid = await tid('input-reminder-time-0').evaluate((el) => el.required && !el.validity.valid);
    assert(invalid, 'time not required');
  });
  await step('create a schedule from user-entered times (one due now, one late tonight)', async () => {
    await tid('input-reminder-time-0').fill(hm(dueTime));
    await tid('button-add-reminder-time').click();
    await tid('input-reminder-time-1').fill('23:59');
    await tid('button-save-med-reminder').click();
    await notice(/medication reminder added/i);
    await rxCard().getByText('Reminders (1)').waitFor({ timeout: 15000 });
  });
  await step('stored exactly as entered: two times, every day, start today', async () => {
    const r = await rest('/rest/v1/medication_reminders?select=*');
    eq(r.json.length, 1);
    eq(r.json[0].reminder_times.map((t) => t.slice(0, 5)).sort().join(','), [hm(dueTime), '23:59'].sort().join(','));
    eq(r.json[0].days_of_week.length, 7);
    eq(r.json[0].start_date, TODAY);
    created.rem = r.json[0];
  });
  await step('Reminders page: today shows the due dose and the upcoming dose with exact times', async () => {
    await go('/reminders');
    const doses = page.locator('[data-testid^="row-dose-"]');
    await doses.first().waitFor({ timeout: 20000 });
    eq(await doses.count(), 2);
    const t0 = await doses.nth(0).innerText();
    const t1 = await doses.nth(1).innerText();
    has(t0, 'E2E-Amoxil');
    assert(timeRe(hm(dueTime)).test(t0), `first dose time: ${t0}`);
    has(t0, 'Due now');
    assert(timeRe('23:59').test(t1), `second dose time: ${t1}`);
    assert(/Upcoming/.test(t1), `second status: ${t1}`);
  });
  await step('banner appears for the due dose and offers Mark as taken', async () => {
    await tid('banner-due-reminders').waitFor();
    has(await tid('banner-due-reminders').innerText(), 'E2E-Amoxil');
  });
  await step('browser alert fires once for the due dose (after enabling alerts)', async () => {
    await tid('button-enable-notifications').click();
    await page.waitForFunction(() => window.__notifs.length >= 1, null, { timeout: 15000 });
    const n = await page.evaluate(() => window.__notifs);
    assert(n.some((x) => x.title === 'Medication reminder' && /E2E-Amoxil/.test(x.body || '')), JSON.stringify(n));
    has(await tid('status-notifications').innerText(), 'Browser alerts are on');
    // The dose is still due: a later engine tick (every 20s) must NOT fire the alert again.
    const before = await page.evaluate(() => window.__notifs.length);
    await page.waitForTimeout(23000);
    eq(await page.evaluate(() => window.__notifs.length), before, 'alert repeated for the same dose');
  });
  await step('Mark as taken (from banner) updates the dose and clears the banner', async () => {
    await tid('banner-due-reminders').locator('button', { hasText: 'Mark as taken' }).first().click();
    await page.locator('[data-testid^="row-dose-"]').first().getByText('Taken').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    assert(!(await tid('banner-due-reminders').isVisible().catch(() => false)), 'banner still visible');
  });
  await step('the taken status is saved in the database and survives reload', async () => {
    const r = await rest('/rest/v1/medication_reminder_logs?select=*');
    eq(r.json.length, 1);
    eq(r.json[0].status, 'taken');
    eq(r.json[0].scheduled_date, TODAY);
    await page.reload();
    await page.locator('[data-testid^="row-dose-"]').first().getByText('Taken').first().waitFor();
  });
  await step('Undo returns the dose to due; Skip marks it skipped (one row per dose)', async () => {
    const first = page.locator('[data-testid^="row-dose-"]').first();
    await first.locator('[data-testid^="button-dose-undo-"]').click();
    await first.getByText('Due now').waitFor();
    await first.locator('[data-testid^="button-dose-skip-"]').click();
    await first.getByText('Skipped').waitFor();
    const r = await rest('/rest/v1/medication_reminder_logs?select=*');
    eq(r.json.length, 1);
    eq(r.json[0].status, 'skipped');
  });
  await step('dashboard shows today\'s medicines and the next follow-up', async () => {
    await go('/dashboard');
    await tid('card-dashboard-doses').waitFor();
    has(await tid('card-dashboard-doses').innerText(), 'E2E-Amoxil');
    const f = await tid('card-next-followup').innerText();
    has(f, 'Dr. E2E Soon'); // the soonest upcoming follow-up
    assert(timeRe(hm(soon)).test(f), 'follow-up time missing on dashboard: ' + f);
  });
  await step('pause + edit + delete a schedule', async () => {
    await go('/reminders');
    const row = page.locator('[data-testid^="row-reminder-"]').first();
    await row.locator('[data-testid^="button-toggle-reminder-"]').click();
    await row.getByText('Paused').first().waitFor();
    await page.waitForTimeout(300);
    eq(await page.locator('[data-testid^="row-dose-"]').count(), 0, 'paused reminder still produces doses');
    await row.locator('[data-testid^="button-toggle-reminder-"]').click();
    await row.getByText('Active').first().waitFor();
    await row.locator('[data-testid^="button-edit-reminder-"]').click();
    await tid('button-day-sun').click();
    await tid('button-save-med-reminder').click();
    await notice(/reminder updated/i);
    await row.locator('[data-testid^="button-delete-reminder-"]').click();
    await notice(/reminder deleted/i);
    eq((await rest('/rest/v1/medication_reminders?select=id')).json.length, 0);
  });
  await shot('reminders-desktop');

  // ------------------------------------------------------------ records with exact time
  section('Exact date & time on medical records');
  await step('upload a record with a time of visit', async () => {
    await go('/records/upload');
    await tid('input-upload-file').setInputFiles(PNG);
    await page.fill('input[name=title]', 'E2E Lab Report');
    await page.selectOption('select#category', 'Lab result');
    await page.fill('input[name=document_date]', TODAY);
    await page.fill('input[name=document_time]', '08:45');
    await page.fill('input[name=doctor_name]', 'Dr. E2E Test');
    await tid('button-save-upload').click();
    await page.waitForURL('**/records', { timeout: 30000 });
    const row = page.locator('[data-testid^="row-record-"]', { hasText: 'E2E Lab Report' });
    assert(timeRe('08:45').test(await row.innerText()), 'time missing in list');
  });
  await step('record detail shows date & time; edit changes it', async () => {
    await page.locator('[data-testid^="link-record-"]', { hasText: 'E2E Lab Report' }).click();
    await tid('button-open-record').waitFor();
    assert(timeRe('08:45').test(await page.locator('main').innerText()), 'time missing in detail');
    await tid('button-edit-record').click();
    await page.fill('input[name=document_time]', '09:10');
    await page.fill('input[name=hospital_name]', 'E2E General Hospital');
    await tid('button-save-record-edit').click();
    await notice(/record details updated/i);
    assert(timeRe('09:10').test(await page.locator('main').innerText()), 'edited time missing');
    const r = await rest('/rest/v1/medical_documents?title=eq.E2E%20Lab%20Report&select=*');
    eq(r.json[0].document_time.slice(0, 5), '09:10');
    created.doc = r.json[0];
  });
  await step('existing records without a time still display fine (date only)', async () => {
    await go('/records');
    await noCrash();
  });

  // ------------------------------------------------------------ timeline
  section('Medical timeline');
  await step('timeline merges records, prescriptions, medicines, receipts and appointments', async () => {
    await go('/timeline');
    await page.locator('[data-testid^="timeline-event-"]').first().waitFor({ timeout: 20000 });
    const all = await page.locator('[data-testid^="timeline-event-"]').allInnerTexts();
    const txt = all.join('\n');
    for (const needle of ['E2E Lab Report', 'Prescription · Dr. E2E Test', 'Started E2E-Amoxil', 'Receipt · E2E Pharmacy', 'Dr. E2E Test', 'Dr. E2E Other']) has(txt, needle);
  });
  await step('events show exact time and are in chronological (newest first) order', async () => {
    const events = await page.locator('[data-testid^="timeline-event-"]').all();
    const rows = [];
    for (const e of events) rows.push({ txt: await e.innerText() });
    const find = (s) => rows.findIndex((r) => r.txt.includes(s));
    // all dated today: receipt 10:15 > prescription 09:30 ; record 09:10 is earliest
    const iReceipt = find('Receipt · E2E Pharmacy');
    const iRx = find('Prescription · Dr. E2E Test');
    const iLab = find('E2E Lab Report');
    assert(iReceipt >= 0 && iRx >= 0 && iLab >= 0, 'missing events');
    assert(iReceipt < iRx && iRx < iLab, `order wrong receipt=${iReceipt} rx=${iRx} lab=${iLab}`);
    assert(timeRe('10:15').test(rows[iReceipt].txt), 'receipt time');
    assert(timeRe('09:30').test(rows[iRx].txt), 'rx time');
    assert(timeRe('09:10').test(rows[iLab].txt), 'lab time');
    // future appointments are above (newer) today's items and flagged
    const iNextWeek = find('Dr. E2E Other');
    assert(iNextWeek >= 0 && iNextWeek < iReceipt, 'upcoming appointment should be above');
    has(rows[iNextWeek].txt, 'Upcoming');
  });
  await step('kind filters narrow the list', async () => {
    await tid('button-timeline-kind-receipts').click();
    let n = await page.locator('[data-testid^="timeline-event-"]').count();
    eq(n, 1, 'receipts only');
    await tid('button-timeline-kind-medicines').click();
    has(await page.locator('main').innerText(), 'Started E2E-Amoxil');
    await tid('button-timeline-kind-tests').click();
    has(await page.locator('main').innerText(), 'E2E Lab Report');
    await tid('button-timeline-kind-appointments').click();
    has(await page.locator('main').innerText(), 'Follow-up');
    await tid('button-timeline-kind-all').click();
  });
  await step('year filter works', async () => {
    await tid('select-timeline-year').selectOption(String(now0.getFullYear()));
    assert((await page.locator('[data-testid^="timeline-event-"]').count()) > 0);
    await tid('select-timeline-year').selectOption('all');
  });
  await shot('timeline-desktop');

  // ------------------------------------------------------------ search
  section('Search & filters');
  await step('medicine search finds the medicine and its prescription', async () => {
    await go('/search');
    await tid('input-global-search').fill('e2e-amoxil');
    await page.locator('[data-testid^="row-search-m-"]').first().waitFor();
    assert((await page.locator('[data-testid^="row-search-p-"]').count()) >= 1, 'prescription containing the medicine not found');
  });
  await step('doctor search matches records, prescriptions, appointments, medicines, receipts', async () => {
    await tid('input-global-search').fill('Dr. E2E Test');
    await page.waitForTimeout(300);
    for (const t of ['record', 'prescription', 'medicine', 'receipt', 'appointment']) {
      const c = await tid(`button-search-type-${t}`).innerText();
      assert(!/\(0\)/.test(c), `no ${t} results for doctor: ${c}`);
    }
  });
  await step('pharmacy search finds the receipt', async () => {
    await tid('input-global-search').fill('e2e pharmacy');
    await page.locator('[data-testid^="row-search-r-"]').first().waitFor();
    assert((await page.locator('[data-testid^="row-search-r-"]').count()) >= 1);
  });
  await step('type chip + doctor + hospital + date filters combine', async () => {
    await tid('button-search-clear').click();
    await tid('select-search-doctor').selectOption('Dr. E2E Test');
    await tid('select-search-hospital').selectOption('E2E Updated Hospital');
    await tid('button-search-type-appointment').click();
    const n = await page.locator('[data-testid^="row-search-a-"]').count();
    assert(n >= 1, 'appointment for doctor+hospital not found');
    eq(await page.locator('[data-testid^="row-search-p-"]').count(), 0, 'chip should hide prescriptions');
    await tid('input-search-from').fill(ymd(addDaysDate(now0, 30)));
    await page.getByText('No results').waitFor();
    await tid('button-search-clear').click();
  });
  await step('no-match query shows an empty state', async () => {
    await tid('input-global-search').fill('zzzzqqqq-nothing');
    await page.getByText('No results').waitFor();
  });
  await step('/search?q= pre-fills the query', async () => {
    await go('/search?q=e2e-amoxil');
    eq(await tid('input-global-search').inputValue(), 'e2e-amoxil');
  });

  // ------------------------------------------------------------ visit pack
  section('Doctor Visit Pack + secure sharing');
  let packLink = '';
  await step('prepare an UNSHARED private file to prove it stays private', async () => {
    created.unsharedPath = `${originalProfile.id}/e2e-unshared.png`;
    const up = await fetch(`${SB_URL}/storage/v1/object/medical-records/${created.unsharedPath}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: fs.readFileSync(PNG),
    });
    assert(up.status === 200, `could not upload fixture: ${up.status}`);
  });
  await step('cannot create a pack with nothing selected', async () => {
    await go('/visit-pack');
    await tid('pack-selection').waitFor();
    await page.waitForSelector('[data-testid^="check-pack-"]');
    assert(await tid('button-create-pack').isDisabled(), 'create button enabled with 0 items');
  });
  await step('select a record, a prescription, a receipt and ONE follow-up; fill details', async () => {
    await page.locator('[data-testid="pack-section-docs"] label', { hasText: 'E2E Lab Report' }).locator('input').check();
    await page.locator('[data-testid="pack-section-rx"] label', { hasText: 'Dr. E2E Test' }).locator('input').check();
    await page.locator('[data-testid="pack-section-receipts"] label', { hasText: 'E2E Pharmacy' }).locator('input').check();
    await page.locator('[data-testid="pack-section-appts"] label', { hasText: 'Follow-up' }).filter({ hasText: 'Dr. E2E Test' }).first().locator('input').check();
    eq((await tid('text-pack-count').innerText()).trim(), '4 items selected');
    await page.fill('input[name=pack_recipient]', 'Dr. E2E Recipient');
    await page.fill('input[name=pack_title]', 'E2E pack title');
    await page.fill('textarea[name=pack_note]', 'E2E note: please review my history.');
    await tid('check-pack-include-patient').check();
    await page.selectOption('select#pack_permission', 'VIEW_DOWNLOAD');
  });
  await step('create the pack and get a secure link', async () => {
    await tid('button-create-pack').click();
    await tid('input-pack-link').waitFor({ timeout: 20000 });
    packLink = await tid('input-pack-link').inputValue();
    assert(/\/share\/[0-9a-f]{64}$/.test(packLink), `link format ${packLink}`);
    await notice(/visit pack created/i);
  });
  await step('only a hash of the token is stored (raw token never saved)', async () => {
    const raw = packLink.split('/share/')[1];
    const r = await rest('/rest/v1/shares?recipient=eq.Dr.%20E2E%20Recipient&select=*');
    eq(r.json.length, 1);
    const s = r.json[0];
    created.share = s;
    eq(s.kind, 'visit_pack');
    eq(s.include_patient_info, true);
    assert(s.token_hash !== raw && s.token_hash.length === 64, 'token stored in clear?');
    assert(!JSON.stringify(s).includes(raw), 'raw token present in row');
    const items = await rest(`/rest/v1/share_items?share_id=eq.${s.id}&select=item_type`);
    eq(items.json.map((x) => x.item_type).sort().join(','), 'appointment,prescription,receipt');
    const docs = await rest(`/rest/v1/shared_documents?share_id=eq.${s.id}&select=id`);
    eq(docs.json.length, 1);
  });
  await step('audit log records the pack creation with counts only (no health data)', async () => {
    const a = await rest('/rest/v1/audit_logs?action=eq.visit_pack_created&select=*&order=created_at.desc&limit=1');
    eq(a.json.length, 1);
    const meta = JSON.stringify(a.json[0].metadata);
    assert(!/E2E|Dr\./.test(meta), `PHI in audit metadata: ${meta}`);
    has(meta, '"prescriptions":1');
  });

  let anon;
  await step('doctor opens the link WITHOUT logging in: header, note, patient name + age', async () => {
    anon = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await anon.newPage();
    await p.goto(packLink);
    await p.locator('[data-testid="share-header"]').waitFor({ timeout: 30000 });
    const head = await p.locator('[data-testid="share-header"]').innerText();
    has(head, 'E2E pack title');
    has(head, 'Dr. E2E Recipient');
    const patient = await p.locator('[data-testid="share-patient"]').innerText();
    has(patient, String(expectedAgeYears(DOB)));
    assert(!(await p.locator('body').innerText()).includes(DOB), 'date of birth leaked');
    has(await p.locator('[data-testid="share-note"]').innerText(), 'E2E note');
    created.anonPage = p;
  });
  await step('shared pack lists the selected items with exact date/time and medicines', async () => {
    const p = created.anonPage;
    const body = await p.locator('body').innerText();
    has(body, 'E2E Lab Report');
    assert(timeRe('09:10').test(body), 'record time');
    has(await p.locator('[data-testid="section-share-prescriptions"]').innerText(), 'E2E-Amoxil');
    has(await p.locator('[data-testid="section-share-prescriptions"]').innerText(), '500 mg');
    has(await p.locator('[data-testid="section-share-prescriptions"]').innerText(), 'E2E-Cough');
    has(await p.locator('[data-testid="section-share-receipts"]').innerText(), '$249.50');
    const ap = await p.locator('[data-testid="section-share-appointments"]').innerText();
    has(ap, 'Follow-up');
    assert(timeRe('14:30').test(ap), 'follow-up time');
  });
  await step('items that were NOT selected are not exposed', async () => {
    const body = await created.anonPage.locator('body').innerText();
    assert(!body.includes('Dr. E2E Other'), 'unselected appointment leaked');
    assert(!body.includes('Dr. E2E Soon'), 'unselected follow-up leaked');
  });
  await step('shared files (record, prescription, receipt) open via signed URLs', async () => {
    const p = created.anonPage;
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="link-open-shared-file"]').length >= 3, null, { timeout: 30000 });
    const hrefs = await p.locator('[data-testid="link-open-shared-file"]').evaluateAll((els) => els.map((e) => e.href));
    eq(hrefs.length, 3);
    for (const h of hrefs) {
      has(h, '/storage/v1/object/sign/');
      eq((await anon.request.get(h)).status(), 200, 'shared file');
    }
    has(await p.locator('[data-testid="link-open-shared-file"]').first().innerText(), 'Download');
  });
  await step('a file that was NOT shared cannot be read anonymously', async () => {
    const sign = (p) =>
      anon.request.post(`${SB_URL}/storage/v1/object/sign/medical-records/${p}`, {
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        data: { expiresIn: 60 },
      });
    eq((await sign(created.doc.storage_path)).status(), 200, 'a shared record should be signable');
    const r = await sign(created.unsharedPath);
    assert(r.status() >= 400, `unshared private file could be signed anonymously (${r.status()})`);
    const direct = await anon.request.get(`${SB_URL}/storage/v1/object/medical-records/${created.doc.storage_path}`, { headers: { apikey: SB_KEY } });
    assert(direct.status() >= 400, 'direct anonymous read allowed');
  });
  await step('anonymous API calls cannot read private tables', async () => {
    for (const t of ['prescriptions', 'medicines', 'medicine_receipts', 'medication_reminders', 'share_items', 'shares', 'profiles', 'appointments']) {
      const r = await fetch(`${SB_URL}/rest/v1/${t}?select=*`, { headers: { apikey: SB_KEY } });
      const j = await r.json().catch(() => []);
      assert(Array.isArray(j) ? j.length === 0 : true, `${t} readable anonymously: ${JSON.stringify(j).slice(0, 80)}`);
    }
  });
  await shot('share-public-desktop');
  await step('open count increments (one per open) on the Sharing page', async () => {
    await go('/sharing');
    const row = page.locator('[data-testid^="row-share-"]', { hasText: 'Dr. E2E Recipient' });
    await row.waitFor();
    has(await row.innerText(), 'Visit pack');
    const txt = await row.innerText();
    const m = /Opens:\s*(\d+)/.exec(txt);
    assert(m && Number(m[1]) === 1, `opens: ${txt}`);
  });
  await step('revoking the pack immediately blocks the doctor', async () => {
    const row = page.locator('[data-testid^="row-share-"]', { hasText: 'Dr. E2E Recipient' });
    await row.locator('[data-testid^="button-revoke-share-"]').click();
    await notice(/revoked/i);
    const p = await anon.newPage();
    await p.goto(packLink);
    await p.locator('[data-testid="status-public-share"]').waitFor({ timeout: 25000 });
    has(await p.locator('[data-testid="status-public-share"]').innerText(), 'invalid, expired, or has been revoked');
    await p.close();
    // previously issued signed URLs expire on their own; new ones can no longer be created
    const uid = created.rx.user_id;
    const sign = await anon.request.post(`${SB_URL}/storage/v1/object/sign/medical-records/${created.rx.storage_path}`, {
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      data: { expiresIn: 60 },
    });
    assert(sign.status() >= 400, `revoked share still signs URLs (${sign.status()})`);
  });
  await step('legacy documents-only share still works end to end', async () => {
    await go('/sharing');
    await page.locator('form[data-testid="form-create-share"] label', { hasText: 'E2E Lab Report' }).locator('input').check();
    await page.fill('input[name=recipient]', 'E2E Legacy Recipient');
    await tid('button-create-share').click();
    const link = await tid('input-generated-share-link').inputValue();
    const p = await anon.newPage();
    await p.goto(link);
    await p.getByText('E2E Lab Report').first().waitFor({ timeout: 25000 });
    await p.locator('[data-testid="link-open-shared-file"]').first().waitFor({ timeout: 25000 });
    await p.close();
  });
  await anon.close();

  // ------------------------------------------------------------ cross-feature data safety
  section('Safety & integrity');
  await step('deleting a prescription removes its medicines, reminders and the stored file', async () => {
    await rest('/rest/v1/prescriptions?doctor_name=eq.Dr.%20E2E%20Test', { method: 'GET' });
    await go('/medicines');
    await rxCard().locator('[data-testid^="button-delete-prescription-"]').click();
    await notice(/prescription deleted/i);
    eq((await rest('/rest/v1/prescriptions?select=id')).json.length, 0);
    eq((await rest('/rest/v1/medicines?select=id')).json.length, 0);
    const gone = await rest(`/storage/v1/object/authenticated/medical-records/${created.rx.storage_path}`);
    assert(gone.status >= 400, 'prescription file still in storage');
  });
  await step('the receipt survives, now unlinked from the deleted prescription', async () => {
    const r = await rest('/rest/v1/medicine_receipts?select=prescription_id');
    eq(r.json.length, 1);
    eq(r.json[0].prescription_id, null);
  });
  await step('prescription link is gone from the pack tables too', async () => {
    eq((await rest('/rest/v1/share_items?item_type=eq.prescription&select=id')).json.length, 0);
  });
  await step('deleting a receipt removes its file', async () => {
    await go('/receipts');
    await rcRow().locator('[data-testid^="button-delete-receipt-"]').click();
    await notice(/receipt deleted/i);
    const gone = await rest(`/storage/v1/object/authenticated/medical-records/${created.rc.storage_path}`);
    assert(gone.status >= 400, 'receipt file still in storage');
  });
  await step('a user cannot write into another user\'s storage folder or tables', async () => {
    const other = '00000000-0000-0000-0000-000000000000';
    const up = await fetch(`${SB_URL}/storage/v1/object/medical-records/${other}/receipts/hack.png`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: fs.readFileSync(PNG),
    });
    assert(up.status >= 400, `uploaded into foreign folder (${up.status})`);
    const ins = await rest('/rest/v1/prescriptions', { method: 'POST', body: { user_id: other, doctor_name: 'Dr. E2E Hack', prescription_date: TODAY } });
    assert(ins.status >= 400, `inserted a row for another user (${ins.status})`);
    const badPath = await rest('/rest/v1/prescriptions', {
      method: 'POST',
      body: { user_id: created.rx.user_id, doctor_name: 'Dr. E2E Hack', prescription_date: TODAY, file_name: 'x.pdf', storage_path: `${other}/prescriptions/x.pdf` },
    });
    assert(badPath.status >= 400, `row pointing at a foreign file path accepted (${badPath.status})`);
  });

  // ------------------------------------------------------------ responsive
  section('Responsive layout (mobile 390x844)');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ['/dashboard', '/medicines', '/receipts', '/reminders', '/visit-pack', '/search', '/timeline', '/appointments', '/profile']) {
    await step(`${p} has no horizontal overflow on mobile`, async () => {
      await go(p);
      await page.waitForTimeout(1500);
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert(w.sw <= w.iw + 1, `scrollWidth ${w.sw} > viewport ${w.iw}`);
      await shot(p.replace('/', '') || 'home', 'mobile');
    });
  }
  await step('mobile modals fit the screen (prescription form)', async () => {
    await go('/medicines');
    await tid('button-add-prescription').click();
    const box = await page.locator('[role=dialog]').boundingBox();
    assert(box.width <= 390 && box.x >= 0, `dialog box ${JSON.stringify(box)}`);
    await shot('prescription-modal', 'mobile');
    await tid('button-close-dialog').click();
  });
  await page.setViewportSize({ width: 1360, height: 900 });

  // ------------------------------------------------------------ cleanup
  section('Cleanup (leave the account as it was)');
  await step('delete every E2E row and file, restore the profile', async () => {
    const sh = await rest('/rest/v1/shares?or=(recipient.like.E2E*,recipient.like.Dr.%20E2E*)&select=id');
    for (const s of sh.json || []) await rest(`/rest/v1/shares?id=eq.${s.id}`, { method: 'DELETE' });
    const ap = await rest('/rest/v1/appointments?doctor_name=like.Dr.%20E2E*&select=id');
    for (const a of ap.json || []) await rest(`/rest/v1/appointments?id=eq.${a.id}`, { method: 'DELETE' });
    const docs = await rest('/rest/v1/medical_documents?title=like.E2E*&select=id,storage_path');
    for (const d of docs.json || []) {
      await rest('/storage/v1/object/medical-records', { method: 'DELETE', body: { prefixes: [d.storage_path] } });
      await rest(`/rest/v1/medical_documents?id=eq.${d.id}`, { method: 'DELETE' });
    }
    const rx = await rest('/rest/v1/prescriptions?doctor_name=like.Dr.%20E2E*&select=id,storage_path');
    for (const p of rx.json || []) {
      if (p.storage_path) await rest('/storage/v1/object/medical-records', { method: 'DELETE', body: { prefixes: [p.storage_path] } });
      await rest(`/rest/v1/prescriptions?id=eq.${p.id}`, { method: 'DELETE' });
    }
    const rc = await rest('/rest/v1/medicine_receipts?pharmacy_name=like.E2E*&select=id,storage_path');
    for (const r of rc.json || []) {
      await rest('/storage/v1/object/medical-records', { method: 'DELETE', body: { prefixes: [r.storage_path] } });
      await rest(`/rest/v1/medicine_receipts?id=eq.${r.id}`, { method: 'DELETE' });
    }
    const uid = originalProfile.id;
    await rest('/storage/v1/object/medical-records', { method: 'DELETE', body: { prefixes: [`${uid}/e2e-unshared.png`] } });
    await rest(`/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', body: { date_of_birth: originalProfile.date_of_birth } });
    // verify nothing is left behind
    for (const [t, filter] of [
      ['shares', 'recipient=like.*E2E*'],
      ['appointments', 'doctor_name=like.*E2E*'],
      ['medical_documents', 'title=like.E2E*'],
      ['prescriptions', 'doctor_name=like.*E2E*'],
      ['medicine_receipts', 'pharmacy_name=like.E2E*'],
    ]) {
      const left = await rest(`/rest/v1/${t}?${filter}&select=id`);
      eq((left.json || []).length, 0, `${t} leftovers`);
    }
    for (const folder of ['', 'prescriptions', 'receipts']) {
      const l = await rest('/storage/v1/object/list/medical-records', { method: 'POST', body: { prefix: `${uid}${folder ? '/' + folder : ''}`, limit: 100 } });
      const files = (l.json || []).filter((x) => x.id);
      eq(files.length, 0, `storage leftovers in /${folder}`);
    }
    const prof = await rest('/rest/v1/profiles?select=date_of_birth');
    eq(prof.json[0].date_of_birth, originalProfile.date_of_birth, 'profile DOB restored');
  });
}

main().catch(async (e) => {
  console.error('FATAL', e);
  try {
    await browser?.close();
  } catch {}
  process.exit(2);
});
