# รัน antibiogram อัตโนมัติ "วันต่อวัน" (patho13)

ต่อ `daily_etl.py` เป็น **step [4]** ของ `master_daily.bat` ที่รันอยู่แล้วทุกวัน 15:30 น.
ไม่ต้องตั้ง Task ใหม่ ไม่ต้องดึงข้อมูลใหม่ — ใช้ไฟล์ **DBF ที่ step [1] export อยู่แล้ว**
แล้วเขียน **ตารางสรุปตัวเลข (ไม่มี HN/ชื่อ)** เป็น CSV (+ขึ้น Google Sheet ได้).

## ทำไมต้องอ่าน DBF ไม่ใช่ข้อมูลที่ AMR Alert ส่งขึ้น Sheet ทุกวัน

`mlab_daily_report.py` ส่งขึ้น Sheet เฉพาะ **เชื้อดื้อเฝ้าระวัง + ค่าวิกฤติ** (แถวที่ map surveillance code)
— ไม่มีผล S/I/R ครบทุกยา และไม่มี isolate ที่ยังไว → **คิด %S ไม่ได้**.
antibiogram ตาม CLSI M39 ต้องใช้ผลยารายตัวของ *ทุก* isolate ซึ่งอยู่ในไฟล์ DBF.
→ `daily_etl.py` จึงอ่าน DBF ตรง (คนละด่านกับ daily report แต่ไฟล์เดียวกัน).

## ไฟล์ DBF สะสมอยู่แล้ว = ใช้ได้ทันที

`mlab_export.au3` export วันละ 1 ไฟล์ชื่อ `DDMMYY.DBF` ลง `cfg.DBF_FOLDER` (ชื่อไม่ซ้ำ → **สะสมทุกวัน**).
`daily_etl.py` อ่าน **ทุกไฟล์ในโฟลเดอร์** แล้วคิด antibiogram ของ **ทุกปีปฏิทิน + 12 เดือนล่าสุด (rolling)**
→ มีไฟล์ของวันใหม่เข้ามา หน้าต่างก็ขยับเองวันต่อวัน.

> **ประวัติย้อนหลัง:** rolling 12 เดือนและรายปีจะครบก็ต่อเมื่อโฟลเดอร์มี DBF ย้อนหลังพอ.
> ถ้าเพิ่งเริ่มสะสม ให้ **export ย้อนหลังครั้งเดียว** จากเมนู MLab (เมนู 4→8 ใส่ช่วง 01012025–วันนี้,
> Sort=SIR, All) เป็นไฟล์เดียววางในโฟลเดอร์ แล้ว `daily_etl.py` จะรวมให้เอง.

## field ที่ใช้ (ยืนยันจาก DBF จริง 291026.DBF, 211 fields)

`config/mlab_profile.json` ตั้งไว้ตรง schema จริงแล้ว:

| บทบาท | field DBF | หมายเหตุ |
|---|---|---|
| ผู้ป่วย (ตัดซ้ำ/CAI-HAI) | `HN` | 8 หลัก (ตรง qr1020 หลังตัด 2 หลักหน้า) |
| ชื่อเชื้อ | `CORGANISM` | เช่น "Escherichia coli" |
| โค้ดเชื้อ (กรอง) | `ORGANISM` | ตัดโค้ดขึ้นต้น `.`/NG (Gram/No growth) |
| กลุ่มสิ่งส่งตรวจ | `CSOURCE_A` | Respiratory Tract / Hemoculture-Blood / Urine … |
| วอร์ด | `CWARD` | ชื่อวอร์ด |
| วันเก็บสิ่งส่งตรวจ | `SPCDATE` | ใช้แบ่งช่วงรายปี/rolling |
| ผลยา | 28 คอลัมน์ (`MEM`,`CRO`,`CAZ`,…) | ค่า **S/I/R/N** |

isolate จริง = `METHOD=O` (ตัวกรองใน `daily_etl.filter_real_isolates`). `%S = S/(S+I+R+N)`,
Colistin = `I/(I+R)`, intrinsic (เช่น Acinetobacter–Ertapenem) = "R", N<30 ติดธง `lt30`.

## ต่อ step [4] เข้า master_daily.bat

วาง repo ไว้ที่ `D:\antibiogram` แล้วเติมท้าย `master_daily.bat` (ก่อน `MASTER DONE`):

```bat
REM ========== [4] Antibiogram cumulative + rolling ==========
echo [%date% %time%] [4] antibiogram ETL...>> "%LOG%"
python D:\antibiogram\daily_etl.py --dbf-dir "<cfg.DBF_FOLDER เดียวกับ daily report>" ^
   --out "D:\HIS_export\antibiogram_summary.csv" >> "%LOG%" 2>&1
```

ไม่มี GUI automation → ไม่ชนกับ step 1–3 (วางท้ายสุดได้เลย). `<cfg.DBF_FOLDER>` = ค่าเดียวกับใน `config.py`
ที่ `mlab_daily_report.py` ใช้ (ตัวแปร `DBF_FOLDER`).

ทดสอบ standalone ก่อน: แก้ path ใน `run_daily.bat` แล้วดับเบิลคลิก (log อยู่ `D:\antibiogram\logs\`).

## (ไม่บังคับ) แยก CAI/HAI ด้วย qr1020

`his_auto.py` เซฟ `qr1020_YYYYMMDD.xls` ไว้ที่ `H.EXPORT_DIR` อยู่แล้ว. เพิ่ม `--his-dir "<EXPORT_DIR>"`
ให้ `daily_etl.py` → จะได้กลุ่ม CAI/HAI เพิ่ม. `daily_etl` ตัด 2 หลักหน้า HN ของ qr1020 ให้ตรง DBF อัตโนมัติ.
⚠️ ก่อนใช้จริง ตรวจ 2 จุด: (1) ปี พ.ศ./ค.ศ. ในคอลัมน์ "วันที่ลงทะเบียน" (ถ้าเป็น พ.ศ. ต้องลบ 543 ก่อน
เทียบ SPCDATE) (2) `.xls` 65,536 แถว limit. เริ่มด้วยกลุ่ม All/specimen ก่อน แล้วค่อยเปิด CAI/HAI.

## (ไม่บังคับ) ขึ้น Google Sheet ให้แดชบอร์ด

- ง่ายสุด: ให้แดชบอร์ด/สคริปต์อ่าน **CSV** ตรง ๆ
- หรือ `--sheet-id <id> --creds <service_account.json>` → เขียนทับ tab `Antibiogram` ด้วย **gspread**
  (คนละทางกับ GAS Web App เดิม — ไม่ต้องแก้ GAS; แค่แชร์ Sheet ให้ service account)
- ถ้าจะใช้ GAS เดิม: เพิ่ม action ใหม่ฝั่ง GAS รับ rows ของตารางสรุป (ยังไม่ทำในชุดนี้)

## ตรวจความถูกต้อง (ทำครั้งแรกหลัง backfill)

เทียบ **Antibiogram Lerdsin 2025.xlsx**: A.baumannii–MEM 18% (N≈517),
K.pneumoniae–MEM 82% (N≈927), E.coli–CRO 53% (N≈1101) — %S ควรต่าง ≤ ±2 จุด.
ไม่ตรง → ตรวจช่วง backfill (ครบทั้งปีไหม), การตัด screening (`--drop-sources`), และเกณฑ์ CAI/HAI.
