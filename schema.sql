-- Backup dashboard — Postgres schema
--
-- รันครั้งเดียวด้วยผู้ใช้ที่มีสิทธิ์ superuser บนฐานข้อมูลที่ต้องการ:
--   psql -U postgres -d ชื่อฐานข้อมูล -f schema.sql
--
-- ไฟล์นี้สร้าง 3 อย่าง: ตารางเก็บประวัติ backup, role สำหรับหน้าเว็บ (อ่านอย่างเดียว),
-- และตัวอย่างข้อมูลไว้ทดสอบ

-- ---------------------------------------------------------------------------
-- ตารางหลัก: หนึ่งแถว = หนึ่งครั้งที่ backup
-- ---------------------------------------------------------------------------
create table if not exists backup_records (
  id                       bigserial   primary key,

  -- สามคำถามหลักที่หน้าเว็บต้องตอบให้ได้
  backed_up_at             timestamptz not null,              -- backup เมื่อไหร่
  source                   text        not null,              -- backup อะไร (ระบบ/ฐานข้อมูล/โฟลเดอร์)
  performed_by             text        not null,              -- ใครทำ — ชื่อคน หรือชื่อ job เช่น 'cron: pg-nightly'

  status                   text        not null default 'success'
                             check (status in ('success', 'failed', 'running')),
  backup_type              text        not null default 'full'
                             check (backup_type in ('full', 'incremental', 'differential', 'manual')),

  destination              text,                              -- เก็บไว้ที่ไหน: NAS / Google Drive / External HDD
  size_bytes               bigint,                            -- ขนาดไฟล์ backup
  duration_seconds         integer,                           -- ใช้เวลาไปเท่าไหร่
  retention_days           integer,                           -- เก็บรักษากี่วันก่อนลบ

  -- backup ที่กู้คืนไม่ได้เท่ากับไม่มี backup — จึงติดตามรอบทดสอบ restore ด้วย
  last_restore_test_at     timestamptz,
  last_restore_test_result text check (last_restore_test_result in ('passed', 'failed')),

  evidence_url             text,                              -- ลิงก์/พาธหลักฐาน เช่นไฟล์ log
  notes                    text,

  created_at               timestamptz not null default now() -- เวลาที่บันทึกลงตาราง (ไม่ใช่เวลาที่ backup)
);

-- หน้าเว็บดึงเรียงตามเวลาล่าสุดเสมอ และจัดกลุ่มตาม source
create index if not exists backup_records_backed_up_at_idx on backup_records (backed_up_at desc);
create index if not exists backup_records_source_idx       on backup_records (source);

-- ---------------------------------------------------------------------------
-- Role สำหรับหน้าเว็บ: select ได้อย่างเดียว บนตารางเดียว
-- หน้าเว็บไม่มีระบบล็อกอิน ถ้าโดนเจาะก็ยังแก้/ลบข้อมูลไม่ได้
--
-- แก้ 'CHANGE-ME' เป็นรหัสจริง แล้วเอาไปใส่ใน DATABASE_URL ของไฟล์ .env
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_dashboard_ro') then
    create role backup_dashboard_ro login password 'CHANGE-ME';
  end if;

  -- grant connect ระบุชื่อ database เป็นตัวแปรตรงๆ ไม่ได้ ต้องประกอบคำสั่งเอง
  execute format('grant connect on database %I to backup_dashboard_ro', current_database());
end
$$;

grant usage  on schema public  to backup_dashboard_ro;
grant select on backup_records to backup_dashboard_ro;

-- ---------------------------------------------------------------------------
-- ตัวอย่างข้อมูล — รันแล้วเปิดหน้าเว็บจะเห็นข้อมูลทันที
-- ใช้เป็นแม่แบบให้สคริปต์ backup เดิมเขียน INSERT ต่อท้ายทุกครั้งที่ backup เสร็จ
-- ---------------------------------------------------------------------------
insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type,
   destination, size_bytes, duration_seconds, retention_days,
   last_restore_test_at, last_restore_test_result, evidence_url, notes)
values
  (now() - interval '6 hours',
   'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'success', 'full',
   'NAS \\nas01\backup\pg', 4509715660, 742, 30,
   now() - interval '12 days', 'passed',
   '\\nas01\backup\pg\logs\2026-08-25.log', null),

  (now() - interval '1 day 6 hours',
   'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'success', 'full',
   'NAS \\nas01\backup\pg', 4498210304, 715, 30,
   now() - interval '12 days', 'passed', null, null),

  (now() - interval '2 days 6 hours',
   'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'failed', 'full',
   'NAS \\nas01\backup\pg', null, 61, 30,
   now() - interval '12 days', 'passed', null,
   'ดิสก์ปลายทางเต็ม — ล้างไฟล์เก่าแล้วรันซ้ำผ่าน'),

  (now() - interval '2 days',
   'ไฟล์เอกสารบัญชี (\\fileserver\accounting)', 'สมชาย ใจดี', 'success', 'manual',
   'External HDD (ตู้เซฟชั้น 3)', 128849018880, 5400, 365,
   now() - interval '90 days', 'passed', null,
   'backup ประจำเดือน เก็บออฟไลน์ตามนโยบาย')
on conflict do nothing;
