# Backup Dashboard

หน้าเว็บหน้าเดียวสำหรับดูว่า **backup เมื่อไหร่ · backup อะไร · ใครเป็นคนทำ**

- อ่านข้อมูลจากตาราง `backup_records` ใน Postgres
- **หน้า dashboard อ่านอย่างเดียว** — มีหน้า `/add` แยกสำหรับกรอกข้อมูล
- **บันทึกแล้วแก้ไม่ได้** — ไม่มีปุ่มแก้หรือลบ และ role ที่ใช้เขียนก็ไม่มีสิทธิ์ `update`/`delete` เลย
- ตารางประวัติแบ่งหน้า เลือกได้ 5 / 10 / 15 / 50 แถวต่อหน้า หรือดูทั้งหมด (จำค่าที่เลือกไว้ให้)
- สลับภาษาไทย/อังกฤษได้ รองรับโหมดมืดและจอมือถือ
- ไม่มี build step ไม่มี CDN — หน้าเว็บทั้งหมดอยู่ในไฟล์ [index.html](index.html) ไฟล์เดียว

> **ติดตั้งครั้งแรกบนเซิร์ฟเวอร์จริง → อ่าน [SETUP.md](SETUP.md)**
> เป็นคู่มือละเอียดตั้งแต่เช็กว่าเครื่องเป็น OS อะไร ไปจนถึงต่อสคริปต์ backup เข้าตาราง
> ไฟล์นี้เป็นคู่มืออ้างอิงแบบย่อสำหรับคนที่รู้สภาพเครื่องอยู่แล้ว

---

## รันในเครื่องเพื่อดูหน้าตา (ไม่ต้องมีฐานข้อมูล)

```bash
npm install
npm start
```

เปิด http://localhost:8790 — จะขึ้นแบนเนอร์ **"โหมดตัวอย่าง"** พร้อมข้อมูลสมมติ 90 วัน
ใช้ทดลองตัวกรอง เรียงคอลัมน์ และดาวน์โหลด CSV ได้ครบทุกอย่าง

---

## ต่อฐานข้อมูลจริง

**1. สร้างตารางและ role** (ทำครั้งเดียว ด้วยผู้ใช้ที่มีสิทธิ์ superuser)

```bash
psql -U postgres -d ชื่อฐานข้อมูล -f schema.sql
```

[schema.sql](schema.sql) สร้างตาราง `backup_records` กับ `restore_tests`,
role `backup_dashboard_ro` (select อย่างเดียว) กับ `backup_dashboard_rw` (insert อย่างเดียว)
และข้อมูลตัวอย่างไว้ทดสอบ

**2. เปลี่ยนรหัสผ่านของ role**

```sql
alter role backup_dashboard_ro password 'รหัสผ่านที่ตั้งเอง';
```

**3. สร้างไฟล์ `.env`** (คัดลอกจาก [.env.example](.env.example))

```
DATABASE_URL=postgres://backup_dashboard_ro:รหัสผ่านที่ตั้งเอง@localhost:5432/ชื่อฐานข้อมูล
HOST=127.0.0.1
PORT=8790
```

**4. รันใหม่** — แบนเนอร์โหมดตัวอย่างจะหายไป และเห็นข้อมูลจริง

ตรวจสถานะการเชื่อมต่อได้ที่ http://localhost:8790/healthz

---

## เปิดหน้ากรอกข้อมูล (`/add`)

หน้านี้ใช้บันทึก backup ที่ทำมือ และผลการทดสอบกู้คืน — **ปิดอยู่โดยค่าเริ่มต้น**
เปิดด้วยการตั้งค่านี้ใน `.env`

```
DATABASE_URL_WRITE=postgres://backup_dashboard_rw:รหัสของ_rw@localhost:5432/ชื่อฐานข้อมูล
```

`schema.sql` สร้าง role `backup_dashboard_rw` ไว้ให้แล้ว ตั้งรหัสด้วย

```sql
alter role backup_dashboard_rw password 'รหัสของ_rw';
```

role นี้ `insert` ได้อย่างเดียว ไม่มีสิทธิ์ `update` หรือ `delete` — ตารางนี้เป็นหลักฐานการดูแลระบบ
บันทึกแล้วต้องแก้ไม่ได้ ถึงแอปจะมีบั๊กหรือถูกเจาะก็ทำได้แค่เพิ่มแถวใหม่
กรอกผิดต้องบันทึกแถวใหม่พร้อมหมายเหตุ ซึ่งเป็นวิธีที่ตรวจย้อนหลังได้

รีสตาร์ทแล้วจะมีปุ่ม **"+ เพิ่มรายการ"** บน dashboard และ `/healthz` จะขึ้น `"writes":"on"`

### ใครเพิ่มรายการได้บ้าง

**ไม่มีรหัสกันหน้านี้** ใครที่เปิด URL ได้ก็เพิ่มรายการได้ ตารางนี้จึงเชื่อได้เท่าที่เชื่อคนในเครือข่ายได้
สิ่งที่กันไว้มีสองอย่าง

- **ขอบเขตเครือข่าย** — ไฟร์วอลล์เปิดเฉพาะ subnet ของออฟฟิศ ห้าม NAT ออกอินเทอร์เน็ต
- **สิทธิ์ระดับฐานข้อมูล** — role ที่ใช้เขียนมีแค่ `insert` เพิ่มแถวใหม่ได้เท่านั้น
  ต่อให้ใครยิง `curl` เข้ามาก็แก้หรือลบประวัติเดิมไม่ได้

ถ้าวันหนึ่งต้องการให้ต้องยืนยันตัวตนก่อนบันทึก วิธีที่ตรงที่สุดคือวางไว้หลัง reverse proxy
ที่มี auth อยู่แล้ว (nginx basic auth หรือ SSO ของบริษัท) โดยไม่ต้องแก้แอปเลย

---

## เพิ่มข้อมูล backup เข้าตาราง

งานที่มีสคริปต์อยู่แล้วควรให้สคริปต์เขียน `INSERT` ต่อท้ายทุกครั้งที่ทำงานเสร็จ — แม่นกว่าและไม่มีใครลืม
ส่วนงานที่ทำมือใช้หน้า [`/add`](#เปิดหน้ากรอกข้อมูล-add) จะสะดวกกว่า

```sql
insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type,
   destination, size_bytes, duration_seconds, retention_days, notes)
values
  (now(), 'PostgreSQL — ERP (prod)', 'cron: pg-nightly', 'success', 'full',
   'NAS \\nas01\backup\pg', 4509715660, 742, 30, null);
```

ตัวอย่างต่อท้ายสคริปต์ shell:

```bash
START=$(date +%s)
pg_dump -Fc erp > /mnt/nas/backup/pg/erp-$(date +%F).dump
STATUS=$([ $? -eq 0 ] && echo success || echo failed)
SIZE=$(stat -c%s /mnt/nas/backup/pg/erp-$(date +%F).dump)

psql -d ชื่อฐานข้อมูล -c "insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type, destination, size_bytes, duration_seconds, retention_days)
  values (now(), 'PostgreSQL — ERP (prod)', 'cron: pg-nightly', '$STATUS', 'full',
          '/mnt/nas/backup/pg', $SIZE, $(($(date +%s) - START)), 30)"
```

### ความหมายของแต่ละคอลัมน์

| คอลัมน์ | ความหมาย |
|---|---|
| `backed_up_at` | **backup เมื่อไหร่** |
| `source` | **backup อะไร** — ชื่อระบบ/ฐานข้อมูล/โฟลเดอร์ ใช้ชื่อเดิมทุกครั้ง หน้าเว็บจัดกลุ่มตามค่านี้ |
| `performed_by` | **ใครทำ** — ชื่อคน หรือชื่อ job เช่น `cron: pg-nightly` |
| `status` | `success` / `failed` / `running` |
| `backup_type` | `full` / `incremental` / `differential` / `manual` |
| `destination` | เก็บไว้ที่ไหน |
| `size_bytes` | ขนาดไฟล์ (ไบต์) |
| `duration_seconds` | ใช้เวลาไปกี่วินาที |
| `retention_days` | เก็บรักษากี่วันก่อนลบ |
| `evidence_url` | ลิงก์หรือพาธไฟล์ log |
| `notes` | หมายเหตุ |

### บันทึกผลทดสอบกู้คืน

ผลทดสอบ restore อยู่ในตาราง `restore_tests` แยก เพราะการทดสอบเป็นเหตุการณ์เหมือน backup
ไม่ใช่คุณสมบัติของแถว backup — เก็บแบบนี้จึงได้ประวัติครบทุกครั้ง ไม่ใช่แค่ครั้งล่าสุด

กรอกได้จากหน้า `/add` ส่วนล่าง หรือ `INSERT` ตรงๆ

```sql
insert into restore_tests (tested_at, source, tested_by, result, notes)
values (now(), 'PostgreSQL — ERP (prod)', 'สมชาย ใจดี', 'passed',
        'restore ลง staging แล้วเทียบจำนวนแถว 12 ตารางหลัก ตรงทั้งหมด');
```

`source` ต้องสะกดตรงกับที่ใช้ใน `backup_records` หน้าเว็บจับคู่ด้วยค่านี้
ดูประวัติทั้งหมดได้ในตาราง "ประวัติการทดสอบกู้คืน" ท้ายหน้า dashboard

> **หมายเหตุเรื่องสี** หน้าเว็บไม่ต้องตั้งตารางเวลาไว้ล่วงหน้า — มันคำนวณ "รอบปกติ" ของแต่ละระบบ
> จากค่ามัธยฐานของช่วงห่างจริงระหว่าง backup แต่ละครั้ง แล้วเทียบกับครั้งล่าสุด
> ห่างเกิน 1.5 เท่า = 🟡 เลยรอบ · เกิน 3 เท่า = 🔴 ขาดนาน · ครั้งล่าสุดล้มเหลว = 🔴
> ส่วน "ค้างทดสอบ restore" นับจากไม่เคยทดสอบ / ทดสอบไม่ผ่าน / เกิน 180 วัน

---

## ติดตั้งบนเซิร์ฟเวอร์ (เครื่องเดียวกับ Postgres)

**1.** คัดลอกโฟลเดอร์นี้ขึ้นเซิร์ฟเวอร์ เช่น `/opt/backup-dashboard`
(ไม่ต้องเอา `node_modules/` กับ `.env` ไป)

**2.** ติดตั้ง dependency (ต้องมี Node 18 ขึ้นไป)

```bash
cd /opt/backup-dashboard && npm install --omit=dev
```

**3.** ทำขั้นตอน "ต่อฐานข้อมูลจริง" ข้างบน แล้วแก้ `.env` เป็น

```
HOST=0.0.0.0
PORT=8790
```

`HOST=0.0.0.0` คือสิ่งที่ทำให้เครื่องอื่นใน LAN เปิดหน้าเว็บได้

**4a. Linux — ตั้งเป็น systemd service**

```bash
sudo cp deploy/backup-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now backup-dashboard
sudo systemctl status backup-dashboard
```

**4b. Windows Server — ตั้งเป็น Windows Service ด้วย [nssm](https://nssm.cc/)**

```
nssm install backup-dashboard "C:\Program Files\nodejs\node.exe" "C:\backup-dashboard\server.mjs"
nssm set backup-dashboard AppDirectory C:\backup-dashboard
nssm start backup-dashboard
```

**5.** เปิดไฟร์วอลล์เฉพาะ subnet ของออฟฟิศ (แก้ `192.168.1.0/24` ให้ตรงกับของจริง)

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8790 proto tcp
```

```
netsh advfirewall firewall add rule name="Backup dashboard" dir=in action=allow protocol=TCP localport=8790 remoteip=192.168.1.0/24
```

**6.** บอกทีมว่าเปิดที่ `http://<ip-ของเซิร์ฟเวอร์>:8790`

### ข้อควรระวังด้านความปลอดภัย

หน้าเว็บนี้ **ไม่มีระบบล็อกอิน** ตามที่ตกลงไว้ — ใครเปิด URL ได้ก็เห็นข้อมูลทั้งหมด
ข้อมูล backup บอกว่าบริษัทเก็บอะไรไว้ที่ไหน จึงต้องกันด้วยขอบเขตเครือข่ายแทน

- **ห้าม NAT / port-forward พอร์ต 8790 ออกอินเทอร์เน็ต**
- จำกัดไฟร์วอลล์เฉพาะ subnet ที่จำเป็น ไม่ใช่ `0.0.0.0/0`
- ใช้ role `backup_dashboard_ro` / `backup_dashboard_rw` เท่านั้น อย่าใส่รหัส `postgres` ลงใน `.env`
- หน้า `/add` เขียนข้อมูลได้และไม่มีรหัสกัน — ดู [ใครเพิ่มรายการได้บ้าง](#ใครเพิ่มรายการได้บ้าง)
- ถ้าวันหนึ่งต้องเปิดออกนอกออฟฟิศ ให้วางไว้หลัง reverse proxy ที่มี auth + HTTPS

---

## ส่งออกเป็นไฟล์เดียวจบ

```bash
npm run export
```

ได้ไฟล์ `backup-report-<วันที่>.html` ที่ฝังข้อมูล ณ ตอนนั้นไว้ในตัว
เปิดด้วยการดับเบิลคลิกได้เลยโดยไม่ต้องมีเซิร์ฟเวอร์ — เหมาะกับแนบอีเมลหรือเก็บเป็นหลักฐานรายเดือน

---

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| [index.html](index.html) | หน้าเว็บทั้งหมด — HTML + CSS + JS อยู่ในไฟล์เดียว |
| [server.mjs](server.mjs) | เสิร์ฟหน้าเว็บ, `GET /api/backups`, `GET /healthz`, โหมด `--export` |
| [schema.sql](schema.sql) | ตาราง + role อ่านอย่างเดียว + ข้อมูลตัวอย่าง |
| [add.html](add.html) | หน้ากรอกข้อมูล — ไฟล์เดียวจบเหมือนกัน |
| [sample-data.mjs](sample-data.mjs) | ข้อมูลสมมติสำหรับโหมดตัวอย่าง |
| [deploy/backup-dashboard.service](deploy/backup-dashboard.service) | systemd unit สำหรับ Linux |
| [.env.example](.env.example) | แม่แบบไฟล์ตั้งค่า |
| [SETUP.md](SETUP.md) | คู่มือติดตั้งจากศูนย์ พร้อมคำสั่งตรวจผลทุกขั้น |

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ขึ้น "โหมดตัวอย่าง" ทั้งที่ตั้ง `.env` แล้ว | `DATABASE_URL` ยังเป็นค่าตัวอย่างจาก `.env.example` — ต้องใส่ค่าจริง |
| ขึ้น "เชื่อมต่อฐานข้อมูลไม่ได้" | ดูรายละเอียดในแบนเนอร์ / รัน `curl localhost:8790/healthz` / ตรวจ `pg_hba.conf` |
| หน้าเว็บว่าง ไม่มีข้อมูล | ตาราง `backup_records` ยังไม่มีแถว — ลองรัน `INSERT` ตัวอย่างใน `schema.sql` |
| เครื่องอื่นใน LAN เปิดไม่ได้ | `HOST` ยังเป็น `127.0.0.1` หรือไฟร์วอลล์ยังไม่เปิดพอร์ต 8790 |
| หน้า `/add` ขึ้นว่าปิดอยู่ | ยังไม่ได้ตั้ง `DATABASE_URL_WRITE` ใน `.env` |
| ระบบหนึ่งขึ้นสีเหลือง/แดงทั้งที่ backup ปกติ | ค่า `source` สะกดไม่ตรงกับครั้งก่อน ทำให้ถูกนับเป็นคนละระบบ |
