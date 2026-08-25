# Backup Dashboard

หน้าเว็บหน้าเดียวสำหรับดูว่า **backup เมื่อไหร่ · backup อะไร · ใครเป็นคนทำ**

- อ่านข้อมูลจากตาราง `backup_records` ใน Postgres
- **อ่านอย่างเดียว** — ไม่มีปุ่มเพิ่ม/แก้/ลบ ข้อมูลเข้าผ่าน SQL หรือสคริปต์ backup ที่มีอยู่
- สลับภาษาไทย/อังกฤษได้ รองรับโหมดมืดและจอมือถือ
- ไม่มี build step ไม่มี CDN — หน้าเว็บทั้งหมดอยู่ในไฟล์ [index.html](index.html) ไฟล์เดียว

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

[schema.sql](schema.sql) จะสร้าง 3 อย่าง: ตาราง `backup_records`, role `backup_dashboard_ro`
ที่มีสิทธิ์ `select` อย่างเดียว และข้อมูลตัวอย่าง 4 แถวไว้ทดสอบ

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

## เพิ่มข้อมูล backup เข้าตาราง

หน้าเว็บไม่มีฟอร์มเพิ่มข้อมูล — ให้สคริปต์ backup เขียน `INSERT` ต่อท้ายทุกครั้งที่ทำงานเสร็จ

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
| `last_restore_test_at` / `last_restore_test_result` | ทดสอบกู้คืนล่าสุดเมื่อไหร่ ผลเป็นยังไง |
| `evidence_url` | ลิงก์หรือพาธไฟล์ log |
| `notes` | หมายเหตุ |

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
- ใช้ role `backup_dashboard_ro` เท่านั้น อย่าใส่รหัส `postgres` ลงใน `.env`
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
| [sample-data.mjs](sample-data.mjs) | ข้อมูลสมมติสำหรับโหมดตัวอย่าง |
| [deploy/backup-dashboard.service](deploy/backup-dashboard.service) | systemd unit สำหรับ Linux |
| [.env.example](.env.example) | แม่แบบไฟล์ตั้งค่า |

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ขึ้น "โหมดตัวอย่าง" ทั้งที่ตั้ง `.env` แล้ว | `DATABASE_URL` ยังเป็นค่าตัวอย่างจาก `.env.example` — ต้องใส่ค่าจริง |
| ขึ้น "เชื่อมต่อฐานข้อมูลไม่ได้" | ดูรายละเอียดในแบนเนอร์ / รัน `curl localhost:8790/healthz` / ตรวจ `pg_hba.conf` |
| หน้าเว็บว่าง ไม่มีข้อมูล | ตาราง `backup_records` ยังไม่มีแถว — ลองรัน `INSERT` ตัวอย่างใน `schema.sql` |
| เครื่องอื่นใน LAN เปิดไม่ได้ | `HOST` ยังเป็น `127.0.0.1` หรือไฟร์วอลล์ยังไม่เปิดพอร์ต 8790 |
| ระบบหนึ่งขึ้นสีเหลือง/แดงทั้งที่ backup ปกติ | ค่า `source` สะกดไม่ตรงกับครั้งก่อน ทำให้ถูกนับเป็นคนละระบบ |
