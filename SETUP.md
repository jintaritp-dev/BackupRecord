# คู่มือติดตั้งจากศูนย์

สำหรับคนที่ยังไม่รู้ว่าเครื่องเซิร์ฟเวอร์เป็น OS อะไร และยังไม่แน่ใจว่าตอนนี้ backup ทำด้วยอะไร
ทำตามลำดับ ขั้นไหนที่มีคำสั่ง "ตรวจผล" ให้รันด้วย ถ้าผลไม่ตรงอย่าข้ามไปขั้นถัดไป

[README.md](README.md) เป็นคู่มืออ้างอิงแบบย่อ ไฟล์นี้คือฉบับละเอียดสำหรับติดตั้งครั้งแรก

---

## ขั้น 0 — สำรวจเครื่องก่อน

SSH หรือ Remote Desktop เข้าเครื่องที่ลง Postgres แล้วรัน 4 อย่างนี้ จดผลไว้

### 0.1 เครื่องเป็น OS อะไร

Linux:

```
cat /etc/os-release
```

Windows (PowerShell):

```
systeminfo | Select-String "^OS Name"
```

ถ้าคำสั่งแรกใช้ไม่ได้ก็ลองคำสั่งที่สอง — อันไหนตอบมาได้ นั่นคือ OS ของเครื่อง

### 0.2 Postgres รุ่นอะไร เข้าถึงได้ไหม

```
psql --version
```

| ผลที่ได้ | ความหมาย |
|---|---|
| `psql (PostgreSQL) 16.x` | ดี — Postgres ลงอยู่บนเครื่องนี้ ไปขั้น 0.3 |
| `command not found` | Postgres อาจรันใน Docker หรืออยู่เครื่องอื่น → ดู [ถ้า Postgres อยู่ใน Docker](#ถ้า-postgres-อยู่ใน-docker) |

### 0.3 มีฐานข้อมูลอะไรอยู่แล้ว

Linux:

```
sudo -u postgres psql -l
```

Windows:

```
psql -U postgres -l
```

จดชื่อฐานข้อมูลที่เห็นไว้ — จะใช้ตัดสินใจในขั้น 1

### 0.4 มี Node.js ไหม

```
node -v
```

ต้องได้ `v18` ขึ้นไป ถ้ายังไม่มีจะติดตั้งในขั้น 3

---

## ขั้น 1 — เลือกที่เก็บตาราง

ตาราง `backup_records` มีแถวไม่กี่พันแถวต่อปี เบามาก วางที่ไหนก็ได้ แต่**แนะนำสร้างฐานข้อมูลใหม่แยก**
เพราะตารางนี้เป็นบันทึกการดูแลระบบ ไม่ใช่ข้อมูลของแอปตัวไหน ปนกันแล้วเวลา dump/restore แอปจะยุ่ง

Linux:

```
sudo -u postgres createdb backup_log
```

Windows:

```
createdb -U postgres backup_log
```

ถ้าอยากใช้ฐานข้อมูลเดิมที่มีอยู่แล้วก็ได้ — แค่จำชื่อไว้แทน `backup_log` ในขั้นต่อไปทั้งหมด

---

## ขั้น 2 — สร้างตารางและ role

**2.1** คัดลอกไฟล์ [schema.sql](schema.sql) ขึ้นเครื่องเซิร์ฟเวอร์ (จะ `git clone` ในขั้น 3 ก็ได้ แล้วย้อนมาทำขั้นนี้)

**2.2** แก้รหัสผ่านในไฟล์ก่อนรัน — มีสอง role สองรหัส (สุ่มยาวๆ ไม่ต้องจำ เดี๋ยวไปอยู่ในไฟล์ `.env`)

| บรรทัดในไฟล์ | role | ใช้ทำอะไร |
|---|---|---|
| `create role backup_dashboard_ro ... 'CHANGE-ME'` | ตัวอ่าน | หน้า dashboard — select อย่างเดียว |
| `create role backup_dashboard_rw ... 'CHANGE-ME-TOO'` | ตัวเขียน | หน้ากรอกข้อมูล `/add` — insert อย่างเดียว |

แยกสอง role เพราะ path อ่านจะเขียนอะไรไม่ได้เลยแม้โค้ดจะมีบั๊ก และ role ตัวเขียนเองก็แก้/ลบไม่ได้

**2.3** รัน

Linux:

```
sudo -u postgres psql -d backup_log -f schema.sql
```

Windows:

```
psql -U postgres -d backup_log -f schema.sql
```

**2.4 ตรวจผล** — ต้องได้ `4` (ข้อมูลตัวอย่างที่ไฟล์ใส่ให้)

```
psql -U postgres -d backup_log -c "select count(*) from backup_records"
```

**2.5 ตรวจว่า role อ่านได้จริง** — ใส่รหัสที่ตั้งไว้ในข้อ 2.2

```
psql "postgres://backup_dashboard_ro:รหัสที่ตั้ง@localhost:5432/backup_log" -c "select count(*) from backup_records"
```

ถ้าข้อนี้ผ่าน แปลว่า `DATABASE_URL` ที่จะใส่ในขั้น 3 ใช้ได้แน่นอน

> ผ่านแล้วลองอีกอันเพื่อความมั่นใจ — คำสั่งนี้ **ต้อง error** ว่า permission denied
> เพราะ role นี้ตั้งใจให้อ่านอย่างเดียว ถ้าเขียนได้แปลว่า grant ผิด
>
> ```
> psql "postgres://backup_dashboard_ro:รหัสที่ตั้ง@localhost:5432/backup_log" -c "delete from backup_records"
> ```

**2.6 ตรวจ role ตัวเขียน** — สามคำสั่งนี้ต้องได้ผลตามที่เขียนไว้ ไม่งั้นแปลว่า grant ผิด

เพิ่มได้ (ต้องสำเร็จ):

```
psql "postgres://backup_dashboard_rw:รหัสของ_rw@localhost:5432/backup_log" -c "insert into restore_tests (tested_at, source, tested_by, result) values (now(), 'ทดสอบสิทธิ์', 'setup', 'passed')"
```

แก้ไม่ได้ (**ต้อง error**):

```
psql "postgres://backup_dashboard_rw:รหัสของ_rw@localhost:5432/backup_log" -c "update backup_records set source = 'x'"
```

ลบไม่ได้ (**ต้อง error**):

```
psql "postgres://backup_dashboard_rw:รหัสของ_rw@localhost:5432/backup_log" -c "delete from restore_tests"
```

แถวทดสอบสิทธิ์ที่เพิ่งเพิ่มลบทิ้งด้วย superuser ทีหลังได้:

```
psql -U postgres -d backup_log -c "delete from restore_tests where source = 'ทดสอบสิทธิ์'"
```

---

## ขั้น 3 — ติดตั้งหน้าเว็บ

### 3.1 ติดตั้ง Node.js (ข้ามได้ถ้าขั้น 0.4 ได้ v18+)

Ubuntu/Debian:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

RHEL/Rocky:

```
sudo dnf module install nodejs:22
```

Windows: ดาวน์โหลด LTS installer จาก https://nodejs.org แล้วติดตั้งตามปกติ

### 3.2 ดึงโค้ดลงเครื่อง

Linux:

```
sudo git clone https://github.com/jintaritp-dev/BackupRecord.git /opt/backup-dashboard
```

Windows: clone ลง `C:\backup-dashboard`

ถ้าเซิร์ฟเวอร์ออกอินเทอร์เน็ตไม่ได้ ก็คัดลอกโฟลเดอร์ไปทาง SCP หรือ USB ได้ (ไม่ต้องเอา `node_modules/` กับ `.env` ไป)

### 3.3 ติดตั้ง dependency

```
cd /opt/backup-dashboard && npm install --omit=dev
```

มี dependency ตัวเดียวคือ `pg`

### 3.4 สร้างไฟล์ `.env`

สร้างไฟล์ชื่อ `.env` ในโฟลเดอร์เดียวกับ `server.mjs`

```
DATABASE_URL=postgres://backup_dashboard_ro:รหัสที่ตั้ง@localhost:5432/backup_log
DATABASE_URL_WRITE=postgres://backup_dashboard_rw:รหัสของ_rw@localhost:5432/backup_log
WRITE_PASSWORD=รหัสที่ทีมใช้กดบันทึก
HOST=0.0.0.0
PORT=8790
```

- `localhost` ใช้ได้เพราะหน้าเว็บรันบนเครื่องเดียวกับ Postgres — ไม่ต้องเปิดพอร์ต 5432 ออกนอกเครื่องเลย
- `HOST=0.0.0.0` คือสิ่งที่ทำให้เครื่องอื่นใน LAN เปิดได้ ถ้าใส่ `127.0.0.1` จะเปิดได้แค่บนเซิร์ฟเวอร์เอง
- `DATABASE_URL_WRITE` กับ `WRITE_PASSWORD` เป็นของหน้ากรอกข้อมูล `/add`
  **ขาดค่าใดค่าหนึ่งหน้านั้นจะปิดทั้งหมด** ถ้ายังไม่อยากเปิดก็เว้นว่างไว้ dashboard ยังทำงานปกติ
- `WRITE_PASSWORD` วิ่งเป็น plain text เพราะยังไม่มี HTTPS — ตั้งให้ยาว
  และอย่าใช้รหัสเดียวกับอย่างอื่นในบริษัท

Linux — กันไม่ให้คนอื่นบนเครื่องอ่านรหัสในไฟล์นี้:

```
sudo chmod 600 /opt/backup-dashboard/.env
```

### 3.5 ลองรันด้วยมือก่อน

```
node server.mjs
```

ต้องขึ้นข้อความว่า **"ต่อฐานข้อมูลจริงแล้ว"** ถ้าขึ้น "โหมดตัวอย่าง" แปลว่าอ่าน `.env` ไม่เจอหรือ `DATABASE_URL` ยังเป็นค่าตัวอย่าง

**ตรวจผล** — เปิดอีก terminal บนเครื่องเดียวกัน

```
curl http://localhost:8790/healthz
```

ต้องได้ `{"ok":true,"db":"up","writes":"on"}`

| ผลที่ได้ | ความหมาย |
|---|---|
| `"db":"demo"` | ยังอ่าน `.env` ไม่เจอ หรือ `DATABASE_URL` ยังเป็นค่าตัวอย่าง |
| `"db":"down"` | รหัสหรือชื่อฐานข้อมูลผิด — ดูรายละเอียดใน `detail` |
| `"writes":"off (no_password)"` | ยังไม่ได้ตั้ง `WRITE_PASSWORD` — หน้า `/add` จะปิด |
| `"writes":"off (no_write_database_url)"` | ตั้งรหัสแล้วแต่ขาด `DATABASE_URL_WRITE` |

กด `Ctrl+C` เพื่อหยุด แล้วไปตั้งเป็นเซอร์วิส

### 3.6 ตั้งให้รันเองตอนบูต

**Linux** — ปรับ `User=` ในไฟล์ [deploy/backup-dashboard.service](deploy/backup-dashboard.service) ให้เป็นผู้ใช้ที่มีอยู่จริงก่อน แล้ว

```
sudo cp deploy/backup-dashboard.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now backup-dashboard
```

ตรวจผล:

```
systemctl status backup-dashboard
```

**Windows** — ติดตั้ง [nssm](https://nssm.cc/) แล้ว

```
nssm install backup-dashboard "C:\Program Files\nodejs\node.exe" "C:\backup-dashboard\server.mjs"
```

```
nssm set backup-dashboard AppDirectory C:\backup-dashboard
```

```
nssm start backup-dashboard
```

---

## ขั้น 4 — เปิดให้ LAN เข้าถึง

หา IP ของเซิร์ฟเวอร์ก่อน — Linux `ip -4 addr` / Windows `ipconfig`

เปิดไฟร์วอลล์**เฉพาะ subnet ของออฟฟิศ** แก้ `192.168.1.0/24` ให้ตรงกับของจริง

Linux:

```
sudo ufw allow from 192.168.1.0/24 to any port 8790 proto tcp
```

Windows:

```
netsh advfirewall firewall add rule name="Backup dashboard" dir=in action=allow protocol=TCP localport=8790 remoteip=192.168.1.0/24
```

**ตรวจผล** — ไปเปิด `http://<ip-เซิร์ฟเวอร์>:8790` จากคอมเครื่องอื่นในออฟฟิศ ต้องเห็นข้อมูลตัวอย่าง 4 แถวจากขั้น 2

> **ห้าม NAT หรือ port-forward พอร์ตนี้ออกอินเทอร์เน็ต** หน้าเว็บไม่มีระบบล็อกอิน
> ใครเปิด URL ได้ก็เห็นว่าบริษัทเก็บ backup อะไรไว้ที่ไหนทั้งหมด

---

## ขั้น 5 — เอาข้อมูลจริงเข้าตาราง

ตรงนี้คือหัวใจ — หน้าเว็บแสดงได้แค่สิ่งที่มีในตาราง ถ้าไม่มีใครเขียนเข้าไปมันก็ว่างเปล่าตลอด

ก่อนเลือกวิธี ไปหาให้ได้ก่อนว่าตอนนี้ backup เกิดขึ้นได้ยังไง ลองดูจาก:

Linux:

```
sudo crontab -l ; ls -la /etc/cron.d/ /etc/cron.daily/
```

Windows:

```
Get-ScheduledTask | Where-Object {$_.TaskName -match "backup|dump|copy"} | Format-Table TaskName,State
```

แล้วเลือกตามที่เจอ

### แบบ A — มีสคริปต์/cron อยู่แล้ว (ดีที่สุด)

เติม `INSERT` ต่อท้ายสคริปต์เดิม ให้มันบันทึกตัวเองทุกครั้งที่ทำงานจบ

Linux (bash):

```bash
#!/bin/bash
FILE=/mnt/nas/backup/pg/erp-$(date +%F).dump
START=$(date +%s)

pg_dump -Fc erp > "$FILE"
STATUS=$([ $? -eq 0 ] && echo success || echo failed)

SIZE=$(stat -c%s "$FILE" 2>/dev/null || echo NULL)
psql -U postgres -d backup_log -c "insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type,
   destination, size_bytes, duration_seconds, retention_days, evidence_url)
  values (now(), 'PostgreSQL — ERP (prod)', 'cron: pg-nightly', '$STATUS', 'full',
          '/mnt/nas/backup/pg', $SIZE, $(($(date +%s) - START)), 30, '$FILE')"
```

Windows (PowerShell):

```powershell
$file  = "\\nas01\backup\accounting"
$start = Get-Date

robocopy "D:\accounting" $file /MIR /LOG+:C:\logs\accounting.log
$status = if ($LASTEXITCODE -lt 8) { "success" } else { "failed" }
$secs   = [int]((Get-Date) - $start).TotalSeconds

$sql = "insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type, destination, duration_seconds, retention_days)
  values (now(), 'ไฟล์เอกสารบัญชี', 'Task Scheduler: accounting-sync', '$status', 'incremental',
          '$file', $secs, 90)"
psql -U postgres -d backup_log -c $sql
```

> robocopy คืนค่า exit code 0–7 เมื่อทำงานสำเร็จ (มีการคัดลอกไฟล์ก็ยังนับว่าสำเร็จ) ตั้งแต่ 8 ขึ้นไปคือมีข้อผิดพลาดจริง

### แบบ B — ใช้โปรแกรม backup สำเร็จรูป (Veeam, Acronis, Synology ฯลฯ)

โปรแกรมพวกนี้ส่วนใหญ่ตั้ง "run script after job" หรือส่งรายงานเป็นอีเมล/ไฟล์ได้ วิธีที่ยั่งยืนที่สุดคือ
ตั้ง post-job script ให้ยิง `INSERT` แบบเดียวกับแบบ A โดยอ่านสถานะจากตัวแปรที่โปรแกรมส่งให้

ถ้าโปรแกรมไม่มี post-job hook ก็เขียนสคริปต์อ่านไฟล์ log ของมันวันละครั้งแล้ว insert แทน
บอกผมว่าใช้โปรแกรมอะไรกับตัวอย่าง log สัก 5–10 บรรทัด ผมเขียน parser ให้ได้

### แบบ C — ยังไม่มีระบบ หรือทำมือ

เริ่มจากบันทึกด้วยมือไปก่อนก็ได้ — ดีกว่าไม่มีบันทึกเลย ทำไฟล์ย่อไว้เรียกสั้นๆ

Linux — สร้าง `/usr/local/bin/log-backup`:

```bash
#!/bin/bash
# ใช้: log-backup "ชื่อระบบ" "คนทำ" success full "ที่เก็บ" [หมายเหตุ]
psql -U postgres -d backup_log -c "insert into backup_records
  (backed_up_at, source, performed_by, status, backup_type, destination, notes)
  values (now(), '$1', '$2', '$3', '$4', '$5', nullif('$6',''))"
```

แล้วเรียก

```
log-backup "ระบบกล้องวงจรปิด" "ปรีชา" success manual "External HDD ตู้เซฟชั้น 3"
```

### แบบ D — กรอกผ่านหน้าเว็บ

เปิดหน้า `/add` แล้วกรอก — ต้องตั้ง `WRITE_PASSWORD` กับ `DATABASE_URL_WRITE` ไว้ก่อน (ดูขั้น 3.4)

เหมาะกับงานที่ทำมือ ข้อดีคือช่อง "ระบบ / ข้อมูล" มี dropdown ดึงชื่อที่เคยใช้มาให้เลือก
กันปัญหาสะกดไม่ตรงตามข้อ 1 ข้างล่าง และขนาดไฟล์กรอกเป็น GB/TB ได้ ไม่ต้องคิดเป็นไบต์

**แต่งานที่มีสคริปต์อยู่แล้วให้ใช้แบบ A** — คนลืมกรอก แต่ cron ไม่ลืม

### บันทึกผลทดสอบกู้คืน

ผลทดสอบอยู่ในตาราง `restore_tests` แยกจาก `backup_records` เพราะการทดสอบเป็นเหตุการณ์
เหมือน backup ไม่ใช่คุณสมบัติของแถว backup — จึงเก็บประวัติได้ครบทุกครั้ง ไม่ใช่แค่ครั้งล่าสุด

กรอกได้จากส่วนล่างของหน้า `/add` หรือ `INSERT` ตรงๆ

```sql
insert into restore_tests (tested_at, source, tested_by, result, notes)
values (now(), 'PostgreSQL — ERP (prod)', 'สมชาย ใจดี', 'passed',
        'restore ลง staging แล้วเทียบจำนวนแถว 12 ตารางหลัก ตรงทั้งหมด');
```

หน้าเว็บอ่านผลล่าสุดของแต่ละระบบมาแสดงในการ์ด และขึ้นเตือนใน KPI ถ้าเกิน 180 วัน
ไม่ผ่าน หรือยังไม่เคยทดสอบเลย ประวัติทั้งหมดดูได้ที่ตาราง "ประวัติการทดสอบกู้คืน" ท้ายหน้า dashboard

`source` ต้องสะกดตรงกับใน `backup_records` เพราะหน้าเว็บจับคู่ด้วยค่านี้ — ฟอร์มใน `/add`
จะเตือนให้เองถ้าพิมพ์ชื่อที่ยังไม่มีในระบบ

### สองข้อที่พลาดกันบ่อย

1. **`source` ต้องสะกดเหมือนเดิมทุกครั้ง** — หน้าเว็บจัดกลุ่มระบบตามค่านี้ตรงๆ พิมพ์ `ERP (prod)` วันนี้
   แล้ว `ERP prod` วันหน้า จะกลายเป็นสองระบบแยกกัน แล้วทั้งคู่จะขึ้นสีแดงว่าขาด backup
   ทางกันคือประกาศชื่อไว้ในสคริปต์เป็นตัวแปร ไม่พิมพ์ซ้ำ
2. **`status = 'failed'` ต้องบันทึกด้วย** — ถ้าสคริปต์ insert แต่ตอนสำเร็จ หน้าเว็บจะดูสวยตลอดทั้งที่งานล่ม
   ประโยชน์หลักของหน้านี้คือเห็นว่าอะไรพัง จึงต้องเขียนทั้งสองกรณี

**ลบข้อมูลตัวอย่าง 4 แถวจากขั้น 2 ออกเมื่อข้อมูลจริงเริ่มไหลแล้ว**

ดูก่อนว่าแถวไหนเป็นของตัวอย่าง — `schema.sql` ใส่ไว้เป็นแถวแรกๆ จึงได้ `id` 1–4

```
psql -U postgres -d backup_log -c "select id, backed_up_at, source, performed_by from backup_records order by id limit 10"
```

ยืนยันด้วยตาว่า 4 แถวแรกคือของตัวอย่างจริง แล้วจึงลบ

```
psql -U postgres -d backup_log -c "delete from backup_records where id <= 4"
```

---

## ถ้า Postgres อยู่ใน Docker

รันหน้าเว็บเป็น container ในเน็ตเวิร์กเดียวกัน แล้วใช้**ชื่อ service** แทน `localhost` ใน `DATABASE_URL`
เช่น `postgres://backup_dashboard_ro:รหัส@db:5432/backup_log` โดย `db` คือชื่อ service ของ Postgres

`docker-compose.yml` ย่อๆ:

```yaml
services:
  backup-dashboard:
    image: node:22-alpine
    working_dir: /app
    volumes: ['./:/app']
    command: sh -c "npm install --omit=dev && node server.mjs"
    environment:
      DATABASE_URL: postgres://backup_dashboard_ro:รหัส@db:5432/backup_log
      HOST: 0.0.0.0
    ports: ['8790:8790']
    networks: [default]
```

ถ้าอยากได้ Dockerfile จริงจังบอกได้ครับ

---

## เช็กลิสต์ปิดงาน

- [ ] `psql -d backup_log -c "select count(*) from backup_records"` ทำงานได้
- [ ] role `backup_dashboard_ro` อ่านได้ แต่ `delete` ต้อง error
- [ ] role `backup_dashboard_rw` `insert` ได้ แต่ `update` กับ `delete` ต้อง error (ข้อ 2.6)
- [ ] `curl localhost:8790/healthz` ได้ `{"ok":true,"db":"up","writes":"on"}`
- [ ] เปิด `/add` กรอกทดสอบหนึ่งรายการ แล้วรายการนั้นโผล่ในหน้า dashboard
- [ ] กรอกรหัสผิดแล้วขึ้นข้อความว่ารหัสไม่ถูกต้อง ไม่ใช่บันทึกผ่าน
- [ ] เซอร์วิสรันเอง — ลอง reboot เครื่องแล้วหน้าเว็บยังขึ้น
- [ ] เครื่องอื่นใน LAN เปิด `http://<ip>:8790` ได้
- [ ] พอร์ต 8790 **ไม่ได้** ถูก forward ออกอินเทอร์เน็ต
- [ ] สคริปต์ backup ตัวจริงเขียน `INSERT` เข้าตารางแล้ว ทั้งกรณีสำเร็จและล้มเหลว
- [ ] ลบข้อมูลตัวอย่างออกแล้ว

---

## ติดปัญหาตรงไหน

ส่งผลของคำสั่งที่ค้างมาให้ผมได้เลย โดยเฉพาะ

Linux:

```
sudo journalctl -u backup-dashboard -n 50 --no-pager
```

Windows:

```
Get-Content C:\backup-dashboard\service.log -Tail 50
```

พร้อมผลของ `curl localhost:8790/healthz` — สองอย่างนี้บอกสาเหตุได้เกือบทุกเคส
