# บันทึกการวิเคราะห์ข้อมูลจริง (Lerdsin Hospital)

สรุปจากไฟล์จริงใน Google Drive (โฟลเดอร์ `Antibiogram Lerdsin Hospital`)
เพื่อใช้ออกแบบโปรแกรมให้ตรงกับข้อมูลและวิธีทำเดิมของทีม

## โครงสร้างโฟลเดอร์ (ต่อปี)
```
<ปี>/
├── raw data/   # ATB<ปี>.xlsx = line-list ดิบจาก MLAB (ทั้งหมด), + ไฟล์ export WHONET ราย specimen/ward
├── process/    # ระหว่างทำ
└── publish/    # Antibiogram Lerdsin Hospital <ปี>.xlsx = ผลสุดท้าย
```

## ไฟล์ข้อมูลดิบ: `ATB2025.xlsx` (line-list, ~14.5MB, 1 แถว = 1 ผล)
ระบบต้นทาง = **MLAB** โครงสร้างแบบ WHONET/MLAB มี ~180 คอลัมน์

คอลัมน์ที่ใช้ (mapping -> ฟิลด์มาตรฐานของโปรแกรม):

| ฟิลด์โปรแกรม | คอลัมน์จริง | หมายเหตุ |
|---|---|---|
| hn | `HN` | มี HN9_MLAB, HN9_HIS, HN7_HIS ให้เลือกด้วย |
| organism (code) | `ORGANISM` | โค้ดเชื้อ (ใช้ vlookup -> ชื่อเต็ม) |
| organism (ชื่อ) | `SORGANISM` / `CORGANISM` | ชื่ออ่านออก |
| specimen | `CSOURCE` (อ่านออก) / `SOURCE` (code) / `CSOURCE_A` (กลุ่ม) | เช่น ERSP -> Sputum -> Respiratory Tract |
| ward | `CWARD` (อ่านออก) / `WARD` (code) / `WARD_TYPE` (OPD/IPD) / `DEPARTMENT` | |
| วันที่ส่งตรวจ | `SPCDATE` + `SPCTIME` | **มีทั้งวันและเวลา** -> คำนวณ 48 ชม. ได้แม่น |
| วันที่ admit | **ไม่มีในไฟล์นี้** | ⚠️ ดูหัวข้อ CAI/HAI |
| ผลยา (S/I/R) | โค้ดยา WHONET: `AK, AP, AUG, C, CAZ, CRO, CTX, FEP, FOX, GM, IPM, MEM, SXT, TZP, VA, OX, ...` | ~130 คอลัมน์ยา |

คอลัมน์วันที่อื่น: `DATE, CDATE, RCVTIME, RPTDATE, CRPTDATE, RPTTIME` (ล้วนเป็นวัน/เวลาในกระบวนการแลป ไม่มีวัน admit)

### การล้างข้อมูล (สำคัญ)
line-list มีแถวที่ไม่ใช่เชื้อเพาะจริงปนอยู่มาก เช่น ผล Gram stain (WBC, Epithelial cells, Yeast)
วิธีเดิมกรองออกโดย: **ตัดแถวที่คอลัมน์ ORGANISM code มี `.` หรือช่องว่าง** ออก

## ตรรกะการทำ (จากเอกสาร "การทำ Antibiogram" ของทีม — ต้องทำตาม)
1. กรองแถวที่ไม่ใช่เชื้อ (organism code มี `.` หรือ space) ออก
2. vlookup organism code -> ชื่อมาตรฐาน (**รวมเป็น genus ได้เมื่อเหมาะสมและ n>30**) — นี่คือ dictionary
3. dedup: key = **HN + ":" + organism_name** -> เก็บตัวแรก (**first isolate per patient per species**)
4. นับจำนวนต่อเชื้อ -> **กรองเฉพาะเชื้อที่ n ≥ 30**
5. pivot: rows = Organism, Drug; ค่า = SIR; แสดงเป็น **% of row total** -> ได้ %S

> หมายเหตุ dedup ทำแบบ global (HN+เชื้อ ทั้งชุด) แล้วค่อย filter — ต่างจากที่โปรแกรม
> ตอนนี้ filter ก่อน dedup ต้องยืนยันกับผู้ใช้ว่าเมื่อ stratify ตาม ward/specimen
> จะ dedup ภายใน stratum หรือ dedup รวมก่อน (ผลต่างกันได้)

## หน้าตา output สุดท้าย: `Antibiogram Lerdsin Hospital 2025.xlsx`
- หัวเรื่อง: "Percentage of susceptible bacteria / Lerdsin Hospital / 1 January 2025 - 31 December 2025"
- บรรทัดกำกับขอบเขต เช่น "All specimen & ward"
- ตารางไขว้:
  - แถว = ชื่อเชื้อ (แต่ละเชื้อใช้ **2 แถว**: บน = %S, ล่าง = จำนวน N ที่ทดสอบ)
  - คอลัมน์ = ยา **จัดกลุ่มตาม class** (Penicillins / Cephalosporins / β-lactam+inhibitor / ...)
  - คอลัมน์ Quality = จำนวน isolate รวมของเชื้อนั้น
  - ช่องที่เชื้อดื้อโดยธรรมชาติ (intrinsic R) แสดง **"R"** แทนตัวเลข
- ไฟล์ publish 1 ไฟล์มีได้หลาย sheet ตามขอบเขต (ALL, ราย specimen/ward)

## แหล่งวันที่ admit: ไฟล์ HIS (รายงาน QR-10-020 จาก SoftCon Phoenix)
ผู้ใช้ยืนยัน: ดึงวัน admit จากไฟล์ HIS แยก แล้ว **join ด้วย HN**
(จากสคริปต์เดิม `his_capture.py` = ตัว export อัตโนมัติ, `his_ward_sync.py` = ตัวอ่าน+ประมวลผล)

คอลัมน์ในรายงาน QR-10-020 (ภาษาไทย):
| ฟิลด์ | คอลัมน์จริง | หมายเหตุ |
|---|---|---|
| HN | `HN` | |
| เลข admit | `AN` | ไม่ว่าง = ผู้ป่วยใน (IPD) |
| ward | `หน่วยบริการ` | มี WARD_MAP แปลงชื่อ SoftCon -> ชื่อ AMR |
| **วัน admit** | `วันที่ลงทะเบียน` | รูปแบบ `%d/%m/%Y` — **มีแต่วันที่ ไม่มีเวลา** |
| วัน/เวลา discharge | `วันที่จำหน่าย`, `เวลาที่จำหน่าย` | |
| สถานะ | `สถานะจำหน่าย` | admit / discharge / death |

### วิธี normalize HN ก่อน join (สำคัญ — จากโค้ดเดิม)
```
norm_hn(s): เอาเฉพาะตัวเลข -> ถ้ายาว >= 10 หลัก ตัด 2 หลักหน้าออก
เช่น 0166022745 -> 66022745
```
ฝั่ง MLAB มี HN หลายแบบ: `HN` (8 หลัก), `HN9_MLAB`/`HN9_HIS` (9), `HN7_HIS` (7)
-> ต้อง normalize ทั้ง 2 ฝั่งให้ตรงกันก่อน join (ยืนยันคอลัมน์ที่ match กับไฟล์จริงอีกครั้ง)

### การเลือก admit ที่ตรงกับ specimen (ผู้ป่วย 1 คนมีได้หลาย admit)
- QR-10-020 1 แถว = 1 admission (มี AN)
- เลือก admission ที่ `วันที่ลงทะเบียน` <= วันส่งตรวจ และใกล้ที่สุด (หรือช่วง admit-discharge ครอบคลุมวันส่งตรวจ)

### หมายเหตุเรื่องวันที่
- ผู้ใช้ยืนยัน: ใช้ **วันที่อย่างเดียว** ไม่ต้องคิดชั่วโมง -> เทียบส่วนต่างเป็นวันปฏิทิน
  (`วันที่ลงทะเบียน` มีแต่วันที่พอดีกับเกณฑ์นี้)

## Intrinsic resistance (แสดง "R")
- ตาราง `config/intrinsic_resistance.csv` (organism, drug, source) — คู่เชื้อ×ยาที่ดื้อโดยธรรมชาติ
- **ตั้งต้นจากไฟล์ publish 2025** (ช่อง "R" 64 คู่ = ตารางที่ทีมใช้จริง ตรงกับ M100 Appendix B)
  เช่น Klebsiella→Ampicillin, Pseudomonas→Ceftriaxone/Cefotaxime/SXT, Enterococcus→cephalosporins,
  Stenotrophomonas→carbapenems/aminoglycosides, Proteus/Serratia→Colistin
- โมดูล `ab/intrinsic.py` · จับคู่ด้วยชื่อมาตรฐาน (report_organism × standard drug)
- **ข้อจำกัด**: ไฟล์ CLSI M100 Ed.36 (18.6MB) เกินลิมิต 10MB ของ connector + ตัวอ่านข้อความตัดจบ
  ก่อนถึง Appendix B (หน้า 310) จึงยังอ่านตารางจาก M100 ตรงๆ ไม่ได้ — ถ้าต้องการ re-parse ตรงจาก
  M100 ให้ export เฉพาะหน้า Appendix B (<10MB) มาไว้ใน Drive

## การรวมกลุ่มเชื้อ (rollup) เมื่อไม่ถึงเกณฑ์ — CLSI M39
- เชื้อ n >= min (30) -> แถวของตัวเอง
- เชื้อ n < min -> รวมเป็น "<Genus> species"; genus ยัง < min -> "Other <Family>"; ยังไม่พอ -> "Other organisms"
- **เชื้อหลัก (primary)** ดึงจาก publish (แก้ได้ที่ `config/primary_organisms.csv`) ถ้า < min
  จะรวมได้แค่ระดับ genus ของตัวเอง ("<Genus> species") ไม่ถูกโยนลงถัง Other รวมกับเชื้ออื่น
- taxonomy genus->family ที่ `config/taxonomy.csv` · โมดูล `ab/rollup.py`

## เกณฑ์ที่ยืนยันแล้ว
- CAI/HAI นับเป็น **วัน** (ไม่คิดชั่วโมง): (วันส่งตรวจ - วัน admit) **>= 2 วัน = HAI**, < 2 วัน = CAI
- dedup = first isolate per patient per species (HN + organism)
- min isolates = 30
- รายงาน %Susceptible

## อ้างอิงมาตรฐาน
- `M39Ed5E.pdf` (CLSI M39 Ed.5) — โฟลเดอร์ clsi
- `CLSI M100 Ed36_2026.pdf` — breakpoints / intrinsic resistance
