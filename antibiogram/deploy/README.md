# ติดตั้ง antibiogram ETL บน patho13 (step [4] ของ master_daily.bat)

ตั้งครั้งเดียว แล้ว CSV จะอัปเดต **อัตโนมัติทุกวัน** ไปพร้อม `master_daily.bat` (15:30 น.).

## 1. วางโค้ด
clone repo ให้ `daily_etl.py` อยู่ที่ **`D:\antibiogram\daily_etl.py`**
(ถ้าวางที่อื่น แก้ตัวแปร `ABPY` ใน `master_daily.bat` step [4])

```bat
cd /d D:\
git clone <repo-url> antibiogram-repo
move antibiogram-repo\antibiogram D:\antibiogram
```
(หรือ copy เฉพาะโฟลเดอร์ `antibiogram\` ไปเป็น `D:\antibiogram`)

## 2. ติดตั้ง dependency ที่ยังขาด
daily report มี pandas/dbfread อยู่แล้ว เหลือแค่:
```bat
pip install pyyaml
```

## 3. เปลี่ยน master_daily.bat
แทนที่ `master_daily.bat` เดิมด้วยไฟล์ในโฟลเดอร์นี้ (`deploy\master_daily.bat`)
— เหมือนเดิมทุกอย่าง เพิ่มแค่ **step [4]** ท้ายสุด. step [4] ดึง `DBF_FOLDER` จาก `config.py`
ของคุณเองอัตโนมัติ จึง **ไม่ต้องกรอก path**.

> output: `D:\HIS_export\antibiogram_summary.csv` (อยากเปลี่ยนที่เก็บ แก้ `ABOUT`)

## 4. Backfill ครั้งเดียว (ให้รายปี/rolling ครบ)
โฟลเดอร์ DBF สะสมไฟล์รายวันอยู่แล้ว แต่ถ้าประวัติยังไม่ครบปี ให้ export ย้อนหลังครั้งเดียว
จากเมนู MLab (4 → 8 → ใส่ช่วง `01012025` ถึงวันนี้ → 6 → S → A → F10 → ตั้งชื่อไฟล์ → F10 F2 F10)
วางไฟล์ไว้ในโฟลเดอร์ DBF เดียวกัน แล้ว `daily_etl.py` จะรวมให้เอง.

## 5. ทดสอบ
```bat
cd /d D:\Users\patho13
for /f "usebackq delims=" %i in (`python -c "import config as cfg; print(cfg.DBF_FOLDER)"`) do set ABDIR=%i
python D:\antibiogram\daily_etl.py --dbf-dir "%ABDIR%" --out D:\HIS_export\antibiogram_summary.csv
```
ควรได้บรรทัดสรุป เช่น `สรุป N แถว · 2 ช่วง · 7 กลุ่ม -> ...`. ดู log รวมที่
`D:\HIS_export\logs\master_daily.log` (บรรทัด `[4] antibiogram ETL`).

## ผลลัพธ์
`antibiogram_summary.csv` คอลัมน์:
`period, period_start, period_end, stratum_type, stratum, organism, drug, n_tested, n_s, pct_s, lt30, intrinsic`
— **ไม่มี HN/ชื่อ** (มี assert กันพลาด). `period` = ทุกปี + `rolling12m`; `stratum` = All / กลุ่มสิ่งส่งตรวจ.

ดูภาพรวม/ข้อควรระวัง (CAI/HAI, ขึ้น Google Sheet) ที่ [`../docs/DAILY_AUTOMATION.md`](../docs/DAILY_AUTOMATION.md).
