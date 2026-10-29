# รัน antibiogram อัตโนมัติ "วันต่อวัน"

สรุปคำตอบ: ให้ `daily_etl.py` รัน **บนเครื่อง lab (patho13)** ทุกเช้าด้วย Windows Task Scheduler
อ่าน **ไฟล์ DBF รายวันของ MLAB** (แหล่งเดียวกับที่ AMR Alert ใช้ แต่คนละ "ด่าน") แล้วเขียน
**ตารางสรุปตัวเลข** (ไม่มี HN/ชื่อ) เป็น CSV และ/หรือขึ้น Google Sheet ให้เว็บแอป/แดชบอร์ดอ่านต่อ.

## ทำไมต้องอ่าน DBF ไม่ใช่ข้อมูลที่ AMR Alert ดึงทุกวัน

AMR Alert Dashboard ที่ดึงทุกวันเก็บลง Google Sheet **"Logs" เฉพาะเชื้อดื้อ + ธง** (CRE/CRAB/MRSA …)
— **ไม่มีผล S/I/R รายยา และไม่มี isolate ที่ยังไว** จึง **คิด %S ไม่ได้** (ไม่มีตัวหาร).
antibiogram ตาม CLSI M39 ต้องใช้ผล S/I/R ของ *ทุก* isolate ซึ่งอยู่ในไฟล์ DBF เท่านั้น.
→ เราจึง "ใช้โครงรายวันเดิม" (เครื่อง patho13 + สิทธิ์ gspread + Task Scheduler) แต่เปลี่ยน *input*
เป็นไฟล์ DBF ที่ MLAB ออกทุกวัน.

## ข้อมูลไม่ออกจากเครื่อง (PHI)

`daily_etl.py` อ่าน HN/ชื่อ **ในเครื่อง** เพื่อตัด isolate แรก/ผู้ป่วย และจับ CAI/HAI เท่านั้น.
Output มีแค่: `period, period_start, period_end, stratum_type, stratum, organism, drug,
n_tested, n_s, pct_s, lt30, intrinsic` — **ไม่มี HN/ชื่อ/AN** (มี `assert` กันพลาดในโค้ด).

## รันครั้งเดียวด้วยมือ (ทดสอบ)

```bat
cd /d D:\antibiogram
python daily_etl.py --dbf-dir D:\mlab_dbf --out D:\amr\antibiogram_summary.csv
REM + แยก CAI/HAI (ถ้ามี qr1020):   --his-dir D:\qr1020
REM + ขึ้น Google Sheet:            --sheet-id <id> --creds D:\amr\service_account.json
```

แต่ละรอบจะคำนวณใหม่ทั้งหมดสำหรับ **ทุกปีปฏิทินที่มีในโฟลเดอร์ + 12 เดือนล่าสุด (rolling)**
× กลุ่ม **All / รายสิ่งส่งตรวจ / CAI / HAI** แล้วเขียนทับ output (idempotent — รันกี่รอบก็ได้ผลเท่ากัน).

> **หน้าต่างข้อมูล:** ให้โฟลเดอร์ `--dbf-dir` มี DBF ย้อนหลังครบช่วงที่อยากรายงาน
> (เช่น export ทั้งปี + เดือนล่าสุด). rolling 12 เดือนนับถึง "วันล่าสุดในข้อมูล" อัตโนมัติ —
> พอมีไฟล์ของวันใหม่เข้ามา หน้าต่างก็ขยับเองวันต่อวัน.

## ตั้ง Task Scheduler (รันทุกวัน)

1. แก้ path 4 ตัวบนหัว `run_daily.bat` ให้ตรงเครื่อง (PROJECT / DBF_DIR / HIS_DIR / OUT; SHEET_ID ถ้าจะขึ้น Sheet)
2. เปิด **Task Scheduler → Create Task**
   - General: ตั้งชื่อ `Antibiogram Daily`; เลือก *Run whether user is logged on or not*
   - Triggers → New: *Daily* เวลาเช้า (เช่น 07:00 หลัง MLAB ออกไฟล์ของวัน)
   - Actions → New: *Start a program* = `D:\antibiogram\run_daily.bat`
   - Conditions: ติ๊กออก *Start only if on AC power* (ถ้าเป็นพีซี)
3. กด **Run** หนึ่งครั้งเพื่อทดสอบ แล้วดู log ที่ `D:\antibiogram\logs\etl_YYYYMMDD.log`

(เทียบเท่า schtasks:)
```bat
schtasks /Create /TN "Antibiogram Daily" /TR "D:\antibiogram\run_daily.bat" /SC DAILY /ST 07:00 /RL HIGHEST
```

## เชื่อมต่อให้เว็บแอป/แดชบอร์ดอ่าน

- **CSV** → ให้แดชบอร์ด/สคริปต์ build อ่านไฟล์นี้
- **Google Sheet** (ใส่ `--sheet-id --creds`) → เขียนทับ tab `Antibiogram`; แดชบอร์ดโหลดด้วย gviz JSONP
  ตามที่ระบุใน [`ROLLING_ANTIBIOGRAM_PLAN.md`](ROLLING_ANTIBIOGRAM_PLAN.md) *Part B*

## ตรวจความถูกต้อง (ทำครั้งแรก)

เทียบกับ **Antibiogram Lerdsin 2025.xlsx**: A. baumannii–MEM 18% (N≈517),
K. pneumoniae–MEM 82% (N≈927), E. coli–CRO 53% (N≈1101) — %S ควรต่าง ≤ ±2 จุด.
ไม่ตรง → ตรวจ field map ใน `config/mlab_profile.json`, `--drop-sources` (สิ่งส่งตรวจ screening),
และเกณฑ์ CAI/HAI (`hai_threshold_days`, qr1020).

## ถ้าอยากให้ผม (Claude) ตั้งให้ถึงเครื่องเลย

เครื่อง patho13 ต้องออนไลน์และเปิด **Remote Control** (Claude desktop → Settings → Claude Code →
Remote Control) โดยแชร์โฟลเดอร์โปรเจกต์ที่เป็น git repo. เมื่อเชื่อมแล้วผมเข้าไปวางไฟล์/ตั้ง Task ให้ได้.
ตอนนี้ยังไม่มีเครื่องเชื่อมเข้ามา จึงส่งเป็นชุดไฟล์พร้อมติดตั้งให้ก่อน.
