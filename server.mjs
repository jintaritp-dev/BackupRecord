// Backup dashboard — เสิร์ฟหน้าเว็บ + ดึงข้อมูลจาก Postgres
//
//   node server.mjs            เปิดเซิร์ฟเวอร์ (อ่านค่าจาก .env)
//   node server.mjs --export   เขียนไฟล์ HTML ที่ฝังข้อมูลไว้ในตัว เปิดแบบ file:// ได้
//
// ไม่ตั้ง DATABASE_URL = รันในโหมดตัวอย่าง (ข้อมูลสมมติ) ใช้ดูหน้าตาได้โดยไม่ต้องมี DB

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeSampleRecords } from './sample-data.mjs';

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
const HOST = env.HOST?.trim() || '127.0.0.1';
const PORT = Number(env.PORT ?? 8790);
const DEMO = !DATABASE_URL || DATABASE_URL.includes('ชื่อฐานข้อมูล');

// คิวรีเดียวคงที่ ไม่มีส่วนไหนประกอบจาก input ของผู้ใช้ — การกรอง/เรียงทำฝั่งเบราว์เซอร์ทั้งหมด
const QUERY = `
  select id, backed_up_at, source, performed_by, status, backup_type,
         destination, size_bytes, duration_seconds, retention_days,
         last_restore_test_at, last_restore_test_result, evidence_url, notes
    from backup_records
   order by backed_up_at desc
   limit 5000
`;

let pool = null;

// import 'pg' แบบ lazy เพื่อให้โหมดตัวอย่างรันได้แม้ยังไม่ได้ npm install
async function getPool() {
  if (pool) return pool;
  const { default: pg } = await import('pg');
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 4,
    statement_timeout: 15_000,       // กันคิวรีค้างจนหน้าเว็บหมุนไม่จบ
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => console.error('pg pool error:', err.message));
  return pool;
}

/** คืน { records, demo } — โยน error ออกไปให้ผู้เรียกจัดการถ้าต่อ DB ไม่ได้ */
async function fetchRecords() {
  if (DEMO) return { records: makeSampleRecords(), demo: true };
  const { rows } = await (await getPool()).query(QUERY);
  return { records: rows, demo: false };
}

// --- โหมด --export: ฝังข้อมูลลงใน HTML แล้วเขียนเป็นไฟล์เดียวจบ ------------------
if (process.argv.includes('--export')) {
  const { records, demo } = await fetchRecords();
  const html = await readFile(join(here, 'index.html'), 'utf8');

  // </script> ในข้อมูลจะปิด tag ก่อนเวลา — หนีด้วยการแทรก backslash ตามวิธีมาตรฐาน
  const payload = JSON.stringify({ records, demo, exportedAt: new Date().toISOString() })
    .replace(/</g, '\\u003c');
  const out = html.replace('</head>', `<script>window.__BACKUP_DATA__ = ${payload};</script>\n</head>`);

  const name = `backup-report-${new Date().toISOString().slice(0, 10)}.html`;
  await writeFile(join(here, name), out, 'utf8');
  console.log(`เขียนไฟล์ ${name} แล้ว (${records.length} รายการ${demo ? ' — ข้อมูลตัวอย่าง' : ''})`);
  console.log('เปิดไฟล์นี้ได้เลยโดยไม่ต้องมีเซิร์ฟเวอร์ ส่งต่อ/แนบอีเมลได้');
  await pool?.end();
  process.exit(0);
}

// --- โหมดเซิร์ฟเวอร์ ---------------------------------------------------------
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

  if (path === '/api/backups') {
    try {
      const { records, demo } = await fetchRecords();
      return json(res, 200, { records, demo, fetchedAt: new Date().toISOString() });
    } catch (err) {
      console.error('อ่านข้อมูลจากฐานข้อมูลไม่สำเร็จ:', err.message);
      // 503 พร้อมข้อความ เพื่อให้หน้าเว็บบอกสาเหตุได้ แทนที่จะขาวเปล่า
      return json(res, 503, { error: 'database_unavailable', detail: err.message });
    }
  }

  if (path === '/healthz') {
    if (DEMO) return json(res, 200, { ok: true, db: 'demo' });
    try {
      await (await getPool()).query('select 1');
      return json(res, 200, { ok: true, db: 'up' });
    } catch (err) {
      return json(res, 503, { ok: false, db: 'down', detail: err.message });
    }
  }

  if (path === '/' || path === '/index.html') {
    try {
      const html = await readFile(join(here, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    } catch {
      res.writeHead(500).end('index.html not found');
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'ทุก interface' : HOST;
  console.log(`Backup dashboard: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (bind: ${shown})`);
  if (DEMO) {
    console.log('โหมดตัวอย่าง — ยังไม่ได้ตั้ง DATABASE_URL ใน .env (คัดลอกจาก .env.example)');
  } else {
    console.log('ต่อฐานข้อมูลจริงแล้ว — ตรวจสถานะได้ที่ /healthz');
  }
  if (HOST === '0.0.0.0') {
    console.log('เปิดให้ LAN เข้าถึง — อย่า port-forward พอร์ตนี้ออกอินเทอร์เน็ต (หน้าเว็บไม่มีระบบล็อกอิน)');
  }
});

// systemd ส่ง SIGTERM ตอน restart — ปิด pool ให้เรียบร้อยเพื่อไม่ให้ connection ค้างที่ Postgres
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await pool?.end();
      process.exit(0);
    });
  });
}
