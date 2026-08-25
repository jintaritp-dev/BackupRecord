// ข้อมูลตัวอย่างสำหรับ "โหมดตัวอย่าง" — ใช้เมื่อยังไม่ได้ตั้ง DATABASE_URL
// เปิดหน้าเว็บดูหน้าตาและทดลองใช้ตัวกรองได้เลยโดยไม่ต้องมีฐานข้อมูล
//
// สร้างสดทุกครั้งโดยอิงเวลาปัจจุบัน (ไม่ hardcode วันที่) หน้าเว็บจะได้ไม่ดูเหมือนข้อมูลค้าง

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// พาธ Windows ในข้อมูลตัวอย่างเขียนด้วย String.raw เพื่อให้ backslash เป็นตัวอักษรจริง
// ส่วน BS ไว้ต่อพาธในเทมเพลต เพราะเทมเพลตที่ลงท้ายด้วย backslash เขียนตรงๆ ไม่ได้
const BS = String.fromCharCode(92);

// สุ่มแบบมี seed คงที่ — ตัวเลขตัวอย่างจะได้ไม่กระโดดทุกครั้งที่รีเฟรช
let seed = 20260825;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const vary = (base, pct) => Math.round(base * (1 + (rand() - 0.5) * 2 * pct));

/** ตารางงาน backup สมมติ — หนึ่งรายการต่อหนึ่ง "ระบบที่ถูก backup" */
const SCHEDULES = [
  {
    source: 'PostgreSQL — ERP (prod)',
    performedBy: 'cron: pg-nightly',
    startOffsetHours: 9,        // งานรอบดึกตี 1
    type: 'full',
    everyHours: 24,
    destination: String.raw`NAS \\nas01\backup\pg`,
    sizeBytes: 4_509_715_660,
    durationSeconds: 740,
    retentionDays: 30,
    restoreTestDaysAgo: 12,
    restoreTestResult: 'passed',
    evidenceDir: String.raw`\\nas01\backup\pg\logs`,
    failAt: [2, 17], // รอบที่ล้มเหลว นับถอยหลังเป็นวัน
  },
  {
    source: 'PostgreSQL — ERP (prod) — WAL archive',
    performedBy: 'cron: wal-archive',
    startOffsetHours: 1,
    type: 'incremental',
    everyHours: 6,
    destination: String.raw`NAS \\nas01\backup\pg-wal`,
    sizeBytes: 318_767_104,
    durationSeconds: 42,
    retentionDays: 14,
    restoreTestDaysAgo: 12,
    restoreTestResult: 'passed',
  },
  {
    source: String.raw`ไฟล์เอกสารบัญชี (\\fileserver\accounting)`,
    performedBy: 'cron: robocopy-accounting',
    startOffsetHours: 12,       // งานรอบค่ำ 4 ทุ่ม
    type: 'incremental',
    everyHours: 24,
    destination: String.raw`NAS \\nas01\backup\accounting`,
    sizeBytes: 2_147_483_648,
    durationSeconds: 610,
    retentionDays: 90,
    restoreTestDaysAgo: 40,
    restoreTestResult: 'passed',
  },
  {
    source: 'Google Workspace — Mail & Drive',
    performedBy: 'สมชาย ใจดี',
    startOffsetHours: 24 * 3,
    type: 'full',
    everyHours: 24 * 7,
    destination: String.raw`Google Vault export → NAS \\nas01\backup\gws`,
    sizeBytes: 64_424_509_440,
    durationSeconds: 9_800,
    retentionDays: 365,
    restoreTestDaysAgo: 210, // เกินรอบทดสอบ restore มานาน
    restoreTestResult: 'passed',
    notes: 'export ด้วยมือทุกวันอาทิตย์ ตามนโยบายเก็บอีเมล 1 ปี',
  },
  {
    source: 'เว็บไซต์บริษัท (WordPress)',
    performedBy: 'cron: wp-backup',
    startOffsetHours: 24 * 2,
    type: 'full',
    everyHours: 24 * 7,
    destination: 'Backblaze B2 (bucket: company-web)',
    sizeBytes: 1_932_735_283,
    durationSeconds: 380,
    retentionDays: 60,
    restoreTestDaysAgo: null, // ยังไม่เคยทดสอบ restore เลย
    restoreTestResult: null,
  },
  {
    source: 'ระบบกล้องวงจรปิด (CCTV NVR)',
    performedBy: 'ปรีชา รักงาน',
    type: 'manual',
    everyHours: 24 * 30,
    startOffsetHours: 24 * 47, // ครั้งล่าสุด 47 วันที่แล้ว — เลยรอบมาแล้ว หน้าเว็บต้องขึ้นสีแดง
    destination: 'External HDD (ตู้เซฟชั้น 3)',
    sizeBytes: 966_367_641_600,
    durationSeconds: 18_400,
    retentionDays: 180,
    restoreTestDaysAgo: 95,
    restoreTestResult: 'failed',
    notes: 'ไฟล์วิดีโอบางส่วนเปิดไม่ได้ตอนทดสอบกู้คืน — รอเปลี่ยนฮาร์ดดิสก์',
  },
];

const WINDOW_DAYS = 90;

/** คืนรายการ backup ย้อนหลัง 90 วัน ในรูปแบบเดียวกับที่ /api/backups ส่งออก */
export function makeSampleRecords(now = Date.now()) {
  const records = [];
  let id = 1;

  for (const job of SCHEDULES) {
    const stepMs = job.everyHours * HOUR;
    const startMs = now - (job.startOffsetHours ?? 0) * HOUR;

    for (let t = startMs; t > now - WINDOW_DAYS * DAY; t -= stepMs) {
      const daysAgo = Math.round((now - t) / DAY);
      const failed = job.failAt?.includes(daysAgo) ?? false;
      const at = new Date(t);
      const day = at.toISOString().slice(0, 10);

      records.push({
        id: id++,
        backed_up_at: at.toISOString(),
        source: job.source,
        performed_by: job.performedBy,
        status: failed ? 'failed' : 'success',
        backup_type: job.type,
        destination: job.destination,
        size_bytes: failed ? null : vary(job.sizeBytes, 0.06),
        duration_seconds: failed ? vary(60, 0.4) : vary(job.durationSeconds, 0.15),
        retention_days: job.retentionDays,
        last_restore_test_at:
          job.restoreTestDaysAgo == null ? null : new Date(now - job.restoreTestDaysAgo * DAY).toISOString(),
        last_restore_test_result: job.restoreTestResult,
        evidence_url: job.evidenceDir ? `${job.evidenceDir}${BS}${day}.log` : null,
        notes: failed ? 'ดิสก์ปลายทางเต็ม — ล้างไฟล์เก่าแล้วรันซ้ำผ่าน' : (job.notes ?? null),
      });
    }
  }

  return records.sort((a, b) => b.backed_up_at.localeCompare(a.backed_up_at));
}
