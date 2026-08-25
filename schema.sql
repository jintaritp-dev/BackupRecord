-- Backup dashboard — Postgres schema
--
-- รันครั้งเดียวด้วยผู้ใช้ที่มีสิทธิ์ superuser บนฐานข้อมูลที่ต้องการ:
--   psql -U postgres -d ชื่อฐานข้อมูล -f schema.sql
--
-- ไฟล์นี้สร้าง: ตารางประวัติ backup, ตารางผลทดสอบ restore, role สองตัว
-- (ตัวอ่านสำหรับหน้า dashboard และตัวเขียนสำหรับหน้ากรอกข้อมูล) และตัวอย่างข้อมูลไว้ทดสอบ
--
-- ถ้าเคยรันไฟล์นี้เวอร์ชันก่อนหน้าไปแล้ว ดูหัวข้อ "ย้ายข้อมูลจากเวอร์ชันเก่า" ท้ายไฟล์

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

  evidence_url             text,                              -- ลิงก์/พาธหลักฐาน เช่นไฟล์ log
  notes                    text,

  created_at               timestamptz not null default now() -- เวลาที่บันทึกลงตาราง (ไม่ใช่เวลาที่ backup)
);

-- หน้าเว็บดึงเรียงตามเวลาล่าสุดเสมอ และจัดกลุ่มตาม source
create index if not exists backup_records_backed_up_at_idx on backup_records (backed_up_at desc);
create index if not exists backup_records_source_idx       on backup_records (source);

-- ---------------------------------------------------------------------------
-- ผลทดสอบกู้คืน: หนึ่งแถว = หนึ่งครั้งที่ทดสอบ restore
--
-- backup ที่กู้คืนไม่ได้เท่ากับไม่มี backup จึงต้องติดตามเรื่องนี้แยก
-- เก็บเป็นตารางของตัวเองเพราะการทดสอบเป็น "เหตุการณ์" เหมือน backup ไม่ใช่คุณสมบัติ
-- ของแถว backup แถวใดแถวหนึ่ง — เก็บแบบนี้จึงได้ประวัติครบทุกครั้ง ไม่ใช่แค่ครั้งล่าสุด
-- และไม่ต้องให้ใครมีสิทธิ์ update ทับข้อมูลเก่า
-- ---------------------------------------------------------------------------
create table if not exists restore_tests (
  id         bigserial   primary key,
  tested_at  timestamptz not null,
  source     text        not null,              -- ต้องสะกดตรงกับ backup_records.source
  tested_by  text        not null,
  result     text        not null check (result in ('passed', 'failed')),
  notes      text,
  created_at timestamptz not null default now()
);

-- หน้าเว็บหาผลทดสอบล่าสุดของแต่ละระบบ
create index if not exists restore_tests_source_idx on restore_tests (source, tested_at desc);

-- ---------------------------------------------------------------------------
-- Role ตัวอ่าน: หน้า dashboard ใช้ตัวนี้ — select ได้อย่างเดียว
-- หน้า dashboard ไม่มีระบบล็อกอิน ถ้าโดนเจาะก็ยังแก้/ลบข้อมูลไม่ได้
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
grant select on restore_tests  to backup_dashboard_ro;

-- ---------------------------------------------------------------------------
-- Role ตัวเขียน: หน้ากรอกข้อมูล (/add) ใช้ตัวนี้ — insert ได้เท่านั้น
--
-- ไม่ให้ update ไม่ให้ delete โดยเจตนา ตารางนี้เป็นหลักฐานการดูแลระบบ
-- บันทึกแล้วต้องแก้ไม่ได้ ถึงแอปจะมีบั๊กหรือถูกเจาะก็ทำได้แค่เพิ่มแถวใหม่
-- แก้ผิดต้องบันทึกแถวใหม่พร้อมหมายเหตุ ซึ่งเป็นวิธีที่ตรวจย้อนหลังได้
--
-- แก้ 'CHANGE-ME-TOO' เป็นรหัสจริง แล้วเอาไปใส่ใน DATABASE_URL_WRITE ของไฟล์ .env
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_dashboard_rw') then
    create role backup_dashboard_rw login password 'CHANGE-ME-TOO';
  end if;

  execute format('grant connect on database %I to backup_dashboard_rw', current_database());
end
$$;

grant usage on schema public to backup_dashboard_rw;

-- select ด้วย เพราะหน้ากรอกต้องดึงรายชื่อระบบที่มีอยู่มาทำ dropdown กันสะกดผิด
grant select, insert on backup_records to backup_dashboard_rw;
grant select, insert on restore_tests  to backup_dashboard_rw;

-- bigserial ดึงเลข id จาก sequence — ไม่ให้สิทธิ์นี้ insert จะ error
grant usage, select on sequence backup_records_id_seq to backup_dashboard_rw;
grant usage, select on sequence restore_tests_id_seq  to backup_dashboard_rw;

-- ---------------------------------------------------------------------------
-- ตัวอย่างข้อมูล — รันแล้วเปิดหน้าเว็บจะเห็นข้อมูลทันที
-- ใช้เป็นแม่แบบให้สคริปต์ backup เดิมเขียน INSERT ต่อท้ายทุกครั้งที่ backup เสร็จ
-- ลบออกได้เมื่อข้อมูลจริงเริ่มไหลแล้ว (ดูวิธีใน SETUP.md ขั้น 5)
-- ---------------------------------------------------------------------------
insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type,
   destination, size_bytes, duration_seconds, retention_days, evidence_url, notes)
values
  (now() - interval '6 hours',
   'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'success', 'full',
   'NAS \\nas01\backup\pg', 4509715660, 742, 30,
   '\\nas01\backup\pg\logs\today.log', null),

  (now() - interval '1 day 6 hours',
   'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'success', 'full',
   'NAS \\nas01\backup\pg', 4498210304, 715, 30, null, null),

  (now() - interval '2 days 6 hours',
   'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'failed', 'full',
   'NAS \\nas01\backup\pg', null, 61, 30, null,
   'ดิสก์ปลายทางเต็ม — ล้างไฟล์เก่าแล้วรันซ้ำผ่าน'),

  (now() - interval '2 days',
   'ไฟล์เอกสารบัญชี (\\fileserver\accounting)', 'สมชาย ใจดี', 'success', 'manual',
   'External HDD (ตู้เซฟชั้น 3)', 128849018880, 5400, 365, null,
   'backup ประจำเดือน เก็บออฟไลน์ตามนโยบาย')
on conflict do nothing;

insert into restore_tests (tested_at, source, tested_by, result, notes)
values
  (now() - interval '12 days', 'PostgreSQL — ERP (prod)', 'สมชาย ใจดี', 'passed',
   'restore ลง staging แล้วเทียบจำนวนแถว 12 ตารางหลัก ตรงทั้งหมด'),

  (now() - interval '104 days', 'PostgreSQL — ERP (prod)', 'สมชาย ใจดี', 'passed', null),

  (now() - interval '90 days', 'ไฟล์เอกสารบัญชี (\\fileserver\accounting)', 'ปรีชา รักงาน', 'failed',
   'ไฟล์ปี 2567 บางส่วนเปิดไม่ได้ — รอเปลี่ยนฮาร์ดดิสก์')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- ย้ายข้อมูลจากเวอร์ชันเก่า
--
-- ข้ามส่วนนี้ได้ถ้าเพิ่งรัน schema.sql ครั้งแรก
--
-- เวอร์ชันก่อนหน้าเก็บผลทดสอบ restore เป็นสองคอลัมน์บน backup_records
-- (last_restore_test_at, last_restore_test_result) ตอนนี้ย้ายมาเป็นตาราง restore_tests
-- บล็อกนี้ปลอดภัยที่จะรันซ้ำ — ถ้าไม่มีคอลัมน์เก่าอยู่แล้วมันจะไม่ทำอะไรเลย
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'backup_records' and column_name = 'last_restore_test_at'
  ) then
    -- แถว backup ของระบบเดียวกันเก็บค่าซ้ำกันทุกแถว จึงต้อง distinct ไม่ให้ได้ประวัติซ้ำ
    insert into restore_tests (tested_at, source, tested_by, result, notes)
    select distinct
           last_restore_test_at, source, 'ย้ายจากข้อมูลเดิม', last_restore_test_result, null
      from backup_records
     where last_restore_test_at is not null
       and last_restore_test_result is not null;

    alter table backup_records drop column last_restore_test_at;
    alter table backup_records drop column last_restore_test_result;

    raise notice 'ย้ายผลทดสอบ restore เข้าตาราง restore_tests และลบคอลัมน์เก่าแล้ว';
  end if;
end
$$;
