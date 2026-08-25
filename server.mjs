// Backup dashboard — เสิร์ฟหน้าเว็บ + อ่าน/เขียนข้อมูลกับ Postgres
//
//   node server.mjs            เปิดเซิร์ฟเวอร์ (อ่านค่าจาก .env)
//   node server.mjs --export   เขียนไฟล์ HTML ที่ฝังข้อมูลไว้ในตัว เปิดแบบ file:// ได้
//
// ไม่ตั้ง DATABASE_URL = รันในโหมดตัวอย่าง (ข้อมูลสมมติในหน่วยความจำ) ใช้ดูหน้าตาได้โดยไม่ต้องมี DB
//
// การอ่านกับการเขียนใช้ connection แยกกันคนละ role โดยเจตนา:
// path อ่านต่อด้วย role ที่ select ได้อย่างเดียว จึงเขียนอะไรไม่ได้เลยแม้โค้ดจะมีบั๊ก

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { makeSampleData } from './sample-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// อ่าน .env เองเพื่อไม่ต้องพึ่ง dependency เพิ่ม — รองรับแค่รูปแบบ KEY=value ที่ใช้จริง
function loadEnvFile() {
  const path = join(here, '.env');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// ตัวแปรใน environment จริงมาก่อน .env เสมอ — systemd/Docker จะได้ override ได้
const env = { ...loadEnvFile(), ...process.env };
const DATABASE_URL = env.DATABASE_URL?.trim() || '';
const DATABASE_URL_WRITE = env.DATABASE_URL_WRITE?.trim() || '';
const WRITE_PASSWORD = env.WRITE_PASSWORD?.trim() || '';
const HOST = env.HOST?.trim() || '127.0.0.1';
const PORT = Number(env.PORT ?? 8790);
const DEMO = !DATABASE_URL || DATABASE_URL.includes('ชื่อฐานข้อมูล');

// สวิตช์เปิดการเขียนคือ DATABASE_URL_WRITE — ต้องตั้งใจตั้งบนเซิร์ฟเวอร์เท่านั้นจึงเปิด
const WRITE_DISABLED_REASON = !DEMO && !DATABASE_URL_WRITE ? 'no_write_database_url' : null;
const WRITES_ENABLED = WRITE_DISABLED_REASON === null;

// รหัสผ่านเป็นตัวเลือก ไม่ตั้งก็กรอกข้อมูลได้เลยโดยไม่ต้องใส่รหัส
// เปิดใช้ทีหลังได้ด้วยการเติมค่าเดียวใน .env ไม่ต้องแก้โค้ด
const PASSWORD_REQUIRED = Boolean(WRITE_PASSWORD);

// --- คิวรี ------------------------------------------------------------------
// ทุกคิวรีเป็น string คงที่ ไม่มีส่วนไหนประกอบจาก input ของผู้ใช้
// การกรอง/เรียง/แบ่งหน้าทำฝั่งเบราว์เซอร์ทั้งหมด

const RECORDS_QUERY = `
  select id, backed_up_at, source, performed_by, status, backup_type,
         destination, size_bytes, duration_seconds, retention_days, evidence_url, notes
    from backup_records
   order by backed_up_at desc
   limit 5000
`;

const RESTORE_TESTS_QUERY = `
  select id, tested_at, source, tested_by, result, notes
    from restore_tests
   order by tested_at desc
   limit 2000
`;

// union กรองค่าซ้ำให้เอง — ได้ค่าที่เคยใช้ของทั้งสามฟิลด์ในคิวรีเดียว
const SUGGESTIONS_QUERY = `
  select 'source' as kind, source as value from backup_records
  union
  select 'performed_by', performed_by from backup_records
  union
  select 'destination', destination from backup_records where destination is not null
  order by 1, 2
`;

const INSERT_RECORD = `
  insert into backup_records
    (backed_up_at, source, performed_by, status, backup_type,
     destination, size_bytes, duration_seconds, retention_days, evidence_url, notes)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  returning id, backed_up_at, source, performed_by, status, backup_type,
            destination, size_bytes, duration_seconds, retention_days, evidence_url, notes
`;

const INSERT_RESTORE_TEST = `
  insert into restore_tests (tested_at, source, tested_by, result, notes)
  values ($1, $2, $3, $4, $5)
  returning id, tested_at, source, tested_by, result, notes
`;

// --- connection pool -------------------------------------------------------
// เก็บ pool ต่อ connection string หนึ่งตัว — อ่านกับเขียนใช้ต่างกัน จึงมีได้สองตัว
const pools = new Map();

// import 'pg' แบบ lazy เพื่อให้โหมดตัวอย่างรันได้แม้ยังไม่ได้ npm install
async function getPool(connectionString) {
  if (pools.has(connectionString)) return pools.get(connectionString);
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    statement_timeout: 15_000,       // กันคิวรีค้างจนหน้าเว็บหมุนไม่จบ
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => console.error('pg pool error:', err.message));
  pools.set(connectionString, pool);
  return pool;
}

const readPool = () => getPool(DATABASE_URL);
const writePool = () => getPool(DATABASE_URL_WRITE);

// โหมดตัวอย่างเก็บข้อมูลไว้ในหน่วยความจำ เพิ่มรายการได้จริงเพื่อทดลองใช้ฟอร์มทั้งกระบวนการ
// แต่หายเมื่อรีสตาร์ท — response ทุกอันจึงติด flag demo ไปให้หน้าเว็บบอกผู้ใช้
let demoStore = null;
const getDemoStore = () => (demoStore ??= makeSampleData());

/** คืน { records, restoreTests, demo } — โยน error ออกไปให้ผู้เรียกจัดการถ้าต่อ DB ไม่ได้ */
async function fetchData() {
  if (DEMO) {
    const store = getDemoStore();
    return { records: store.records, restoreTests: store.restoreTests, demo: true };
  }
  const pool = await readPool();
  const [records, restoreTests] = await Promise.all([
    pool.query(RECORDS_QUERY),
    pool.query(RESTORE_TESTS_QUERY),
  ]);
  return { records: records.rows, restoreTests: restoreTests.rows, demo: false };
}

async function fetchSuggestions() {
  if (DEMO) {
    const { records } = getDemoStore();
    const pick = (key) => [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
    return { source: pick('source'), performed_by: pick('performed_by'), destination: pick('destination') };
  }
  const { rows } = await (await readPool()).query(SUGGESTIONS_QUERY);
  const out = { source: [], performed_by: [], destination: [] };
  for (const row of rows) out[row.kind]?.push(row.value);
  return out;
}

// --- ตรวจสอบข้อมูลที่ส่งเข้ามา ------------------------------------------------
// validation ในหน้าเว็บกันคนพิมพ์ผิด ไม่ได้กันคนยิง curl ตรงๆ — ฉะนั้นตรวจซ้ำที่นี่ทุกฟิลด์

class FieldError extends Error {
  constructor(field, reason) {
    super(reason);
    this.field = field;
    this.httpStatus = 400;
  }
}

const STATUSES = ['success', 'failed', 'running'];
const BACKUP_TYPES = ['full', 'incremental', 'differential', 'manual'];
const TEST_RESULTS = ['passed', 'failed'];
const INT4_MAX = 2_147_483_647;

function readText(body, field, { required = false, max = 200 } = {}) {
  const raw = body?.[field];
  if (raw == null || String(raw).trim() === '') {
    if (required) throw new FieldError(field, 'ต้องกรอกช่องนี้');
    return null;
  }
  const value = String(raw).trim();
  if (value.length > max) throw new FieldError(field, `ยาวเกิน ${max} ตัวอักษร`);
  return value;
}

function readEnum(body, field, allowed) {
  const value = readText(body, field, { required: true, max: 40 });
  if (!allowed.includes(value)) throw new FieldError(field, `ต้องเป็นหนึ่งใน ${allowed.join(' / ')}`);
  return value;
}

function readInteger(body, field, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = body?.[field];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new FieldError(field, 'ต้องเป็นจำนวนเต็มไม่ติดลบ');
  if (n > max) throw new FieldError(field, 'ค่าเกินช่วงที่รับได้');
  return n;
}

function readTimestamp(body, field) {
  const raw = body?.[field];
  if (raw == null || String(raw).trim() === '') throw new FieldError(field, 'ต้องกรอกช่องนี้');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new FieldError(field, 'รูปแบบวันเวลาไม่ถูกต้อง');
  // พิมพ์ปีเกินไปตัวเดียวก็ได้ปี 20268 — กันไว้ก่อนเข้าฐานข้อมูล
  if (date.getFullYear() < 2000 || date.getTime() > Date.now() + 86_400_000) {
    throw new FieldError(field, 'วันเวลาต้องอยู่ระหว่างปี 2000 ถึงไม่เกินวันพรุ่งนี้');
  }
  return date.toISOString();
}

async function insertBackupRecord(body) {
  const values = [
    readTimestamp(body, 'backed_up_at'),
    readText(body, 'source', { required: true, max: 200 }),
    readText(body, 'performed_by', { required: true, max: 200 }),
    readEnum(body, 'status', STATUSES),
    readEnum(body, 'backup_type', BACKUP_TYPES),
    readText(body, 'destination', { max: 400 }),
    readInteger(body, 'size_bytes'),
    readInteger(body, 'duration_seconds', { max: INT4_MAX }),
    readInteger(body, 'retention_days', { max: 36_500 }),
    readText(body, 'evidence_url', { max: 1000 }),
    readText(body, 'notes', { max: 2000 }),
  ];

  if (DEMO) {
    const store = getDemoStore();
    const [backed_up_at, source, performed_by, status, backup_type,
           destination, size_bytes, duration_seconds, retention_days, evidence_url, notes] = values;
    const saved = { id: Date.now(), backed_up_at, source, performed_by, status, backup_type,
                    destination, size_bytes, duration_seconds, retention_days, evidence_url, notes };
    store.records.push(saved);
    store.records.sort((a, b) => b.backed_up_at.localeCompare(a.backed_up_at));
    return saved;
  }

  const { rows } = await (await writePool()).query(INSERT_RECORD, values);
  return rows[0];
}

async function insertRestoreTest(body) {
  const values = [
    readTimestamp(body, 'tested_at'),
    readText(body, 'source', { required: true, max: 200 }),
    readText(body, 'tested_by', { required: true, max: 200 }),
    readEnum(body, 'result', TEST_RESULTS),
    readText(body, 'notes', { max: 2000 }),
  ];

  if (DEMO) {
    const store = getDemoStore();
    const [tested_at, source, tested_by, result, notes] = values;
    const saved = { id: Date.now(), tested_at, source, tested_by, result, notes };
    store.restoreTests.push(saved);
    store.restoreTests.sort((a, b) => b.tested_at.localeCompare(a.tested_at));
    return saved;
  }

  const { rows } = await (await writePool()).query(INSERT_RESTORE_TEST, values);
  return rows[0];
}

// --- รหัสผ่านสำหรับเขียน (ใช้เมื่อตั้ง WRITE_PASSWORD ไว้) --------------------------
// hash ทั้งสองฝั่งก่อนเทียบ เพื่อให้ buffer ยาวเท่ากันเสมอ — timingSafeEqual โยน error
// ถ้าความยาวไม่เท่ากัน และการเทียบความยาวตรงๆ ก็เปิดเผยความยาวรหัสจริงออกไป
const sha256 = (value) => createHash('sha256').update(String(value ?? ''), 'utf8').digest();
const passwordMatches = (given) => timingSafeEqual(sha256(given), sha256(WRITE_PASSWORD));

// รหัสที่ใช้ร่วมกันทั้งทีมมักสั้น ต้องกัน brute force ด้วยตัวนับต่อ IP
const MAX_FAILURES = 10;
const LOCKOUT_WINDOW_MS = 5 * 60_000;
const failures = new Map();

const clientIp = (req) => req.socket.remoteAddress ?? 'unknown';

function isLockedOut(ip) {
  const record = failures.get(ip);
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    failures.delete(ip);
    return false;
  }
  return record.count >= MAX_FAILURES;
}

function noteFailure(ip) {
  const record = failures.get(ip);
  if (!record || Date.now() > record.resetAt) {
    failures.set(ip, { count: 1, resetAt: Date.now() + LOCKOUT_WINDOW_MS });
  } else {
    record.count += 1;
  }
}

// --- อ่าน body -------------------------------------------------------------
const MAX_BODY_BYTES = 32 * 1024;

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('body_too_large');
      err.httpStatus = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const err = new Error('invalid_json');
    err.httpStatus = 400;
    throw err;
  }
}

// --- โหมด --export: ฝังข้อมูลลงใน HTML แล้วเขียนเป็นไฟล์เดียวจบ ------------------
if (process.argv.includes('--export')) {
  const { records, restoreTests, demo } = await fetchData();
  const html = await readFile(join(here, 'index.html'), 'utf8');

  // </script> ในข้อมูลจะปิด tag ก่อนเวลา — หนีด้วยการแทรก backslash ตามวิธีมาตรฐาน
  const payload = JSON.stringify({ records, restoreTests, demo, exportedAt: new Date().toISOString() })
    .replace(/</g, '\\u003c');
  const out = html.replace('</head>', `<script>window.__BACKUP_DATA__ = ${payload};</script>\n</head>`);

  const name = `backup-report-${new Date().toISOString().slice(0, 10)}.html`;
  await writeFile(join(here, name), out, 'utf8');
  console.log(`เขียนไฟล์ ${name} แล้ว (${records.length} รายการ${demo ? ' — ข้อมูลตัวอย่าง' : ''})`);
  console.log('เปิดไฟล์นี้ได้เลยโดยไม่ต้องมีเซิร์ฟเวอร์ ส่งต่อ/แนบอีเมลได้');
  for (const pool of pools.values()) await pool.end();
  process.exit(0);
}

// --- โหมดเซิร์ฟเวอร์ ---------------------------------------------------------
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function sendHtml(res, file) {
  try {
    const html = await readFile(join(here, file));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`${file} not found`);
  }
}

async function handleWrite(req, res, insert) {
  // ตอบกลับก่อนอ่าน body ได้ แต่ต้องระบายทิ้งไม่ให้ socket ค้างรอ
  const reject = (code, body) => { req.resume(); return json(res, code, body); };

  if (!WRITES_ENABLED) return reject(403, { error: 'writes_disabled', reason: WRITE_DISABLED_REASON });

  const ip = clientIp(req);
  if (PASSWORD_REQUIRED && isLockedOut(ip)) return reject(429, { error: 'too_many_attempts' });

  // รหัสเดินทางมาใน body ไม่ใช่ header เพราะค่า header รับได้แค่ ISO-8859-1
  // รหัสที่มีอักษรไทยจะทำให้ fetch ในเบราว์เซอร์โยน error ทิ้งก่อนส่งออกมาเลย
  // จึงต้องอ่าน body ก่อนตรวจรหัส — ปลอดภัยเพราะมีเพดาน 32 KB คุมอยู่แล้ว
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return json(res, err.httpStatus ?? 400, { error: err.message });
  }

  if (PASSWORD_REQUIRED) {
    if (!passwordMatches(body?.password)) {
      noteFailure(ip);
      return json(res, 401, { error: 'bad_password' });
    }
    failures.delete(ip);   // รหัสถูกแล้ว ล้างตัวนับของ IP นี้
  }

  try {
    // ตัว insert อ่านเฉพาะฟิลด์ที่รู้จัก คีย์ password ที่ติดมาจึงถูกมองข้ามไปเอง
    const saved = await insert(body);
    return json(res, 201, { saved, demo: DEMO });
  } catch (err) {
    if (err instanceof FieldError) {
      return json(res, 400, { error: 'invalid_field', field: err.field, detail: err.message });
    }
    if (err.httpStatus) return json(res, err.httpStatus, { error: err.message });
    console.error('บันทึกข้อมูลไม่สำเร็จ:', err.message);
    return json(res, 503, { error: 'database_unavailable', detail: err.message });
  }
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  if (req.method === 'POST') {
    if (path === '/api/backups') return handleWrite(req, res, insertBackupRecord);
    if (path === '/api/restore-tests') return handleWrite(req, res, insertRestoreTest);
    req.resume();
    return json(res, 404, { error: 'not_found' });
  }

  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  if (path === '/api/backups') {
    try {
      const data = await fetchData();
      return json(res, 200, { ...data, fetchedAt: new Date().toISOString() });
    } catch (err) {
      console.error('อ่านข้อมูลจากฐานข้อมูลไม่สำเร็จ:', err.message);
      // 503 พร้อมข้อความ เพื่อให้หน้าเว็บบอกสาเหตุได้ แทนที่จะขาวเปล่า
      return json(res, 503, { error: 'database_unavailable', detail: err.message });
    }
  }

  if (path === '/api/suggestions') {
    try {
      return json(res, 200, { ...(await fetchSuggestions()), writesEnabled: WRITES_ENABLED,
                              writeDisabledReason: WRITE_DISABLED_REASON,
                              passwordRequired: PASSWORD_REQUIRED, demo: DEMO });
    } catch (err) {
      return json(res, 503, { error: 'database_unavailable', detail: err.message });
    }
  }

  if (path === '/healthz') {
    const writes = !WRITES_ENABLED ? `off (${WRITE_DISABLED_REASON})`
      : (DEMO ? 'demo' : 'on') + (PASSWORD_REQUIRED ? '' : ' (no password)');
    if (DEMO) return json(res, 200, { ok: true, db: 'demo', writes });
    try {
      await (await readPool()).query('select 1');
      return json(res, 200, { ok: true, db: 'up', writes });
    } catch (err) {
      return json(res, 503, { ok: false, db: 'down', writes, detail: err.message });
    }
  }

  if (path === '/' || path === '/index.html') return sendHtml(res, 'index.html');
  if (path === '/add' || path === '/add.html') return sendHtml(res, 'add.html');

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'ทุก interface' : HOST;
  console.log(`Backup dashboard: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (bind: ${shown})`);

  if (DEMO) {
    console.log('โหมดตัวอย่าง — ยังไม่ได้ตั้ง DATABASE_URL ใน .env (คัดลอกจาก .env.example)');
    console.log('  ข้อมูลที่กรอกผ่านหน้า /add จะอยู่แค่ในหน่วยความจำ หายเมื่อรีสตาร์ท');
  } else {
    console.log('ต่อฐานข้อมูลจริงแล้ว — ตรวจสถานะได้ที่ /healthz');
  }

  if (!WRITES_ENABLED) {
    console.log('หน้ากรอกข้อมูลปิดอยู่ — ตั้ง DATABASE_URL_WRITE ใน .env เพื่อเปิดใช้ (role ที่ insert ได้)');
  } else if (PASSWORD_REQUIRED) {
    console.log('หน้ากรอกข้อมูล: /add  (ต้องกรอกรหัสตาม WRITE_PASSWORD)');
  } else {
    console.log('หน้ากรอกข้อมูล: /add  ⚠ ไม่ได้ตั้งรหัส — ใครเปิดหน้านี้ได้ก็เพิ่มรายการได้');
    console.log('  ตั้ง WRITE_PASSWORD ใน .env เมื่อต้องการให้ต้องกรอกรหัสก่อนบันทึก');
  }

  if (HOST === '0.0.0.0') {
    console.log('เปิดให้ LAN เข้าถึง — อย่า port-forward พอร์ตนี้ออกอินเทอร์เน็ต (ไม่มีระบบล็อกอิน)');
  }
});

// systemd ส่ง SIGTERM ตอน restart — ปิด pool ให้เรียบร้อยเพื่อไม่ให้ connection ค้างที่ Postgres
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      for (const pool of pools.values()) await pool.end();
      process.exit(0);
    });
  });
}
