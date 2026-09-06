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

## เกณฑ์ที่ยืนยันแล้ว
- CAI/HAI = 48 ชม. (specimen date/time เทียบ admit date/time)
- dedup = first isolate per patient per species (HN + organism)
- min isolates = 30
- รายงาน %Susceptible

## อ้างอิงมาตรฐาน
- `M39Ed5E.pdf` (CLSI M39 Ed.5) — โฟลเดอร์ clsi
- `CLSI M100 Ed36_2026.pdf` — breakpoints / intrinsic resistance
