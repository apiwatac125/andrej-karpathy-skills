# Plan — Rolling / Cumulative Antibiogram (เก็บไว้อ้างอิง)

> **สถานะ: พักไว้ (parked) — บันทึก 2026-10-26.** แผนนี้เป็นของ **AMR Integrated Dashboard**
> (ระบบ `lab-daily-report` ETL + `amr-live-dashboard.html`) ซึ่งเป็น *คนละระบบ* กับโปรแกรม/เว็บแอป
> ในโฟลเดอร์นี้ และต้องรันบนเครื่อง lab (patho13) กับไฟล์ DBF ที่มีข้อมูลระบุตัวคน (PHI ห้ามออกจากเครื่อง)
> เรียกแผนนี้ว่า **"plan rolling antibiogram"**. ไฟล์นี้เก็บไว้เพื่อให้สเปกไม่หาย และเพื่อให้โปรแกรมใน repo นี้
> คิด %S ให้ "ตรงกฎเดียวกัน" กับที่ lab ใช้ (ดูหัวข้อ *Mapping* ท้ายไฟล์)

## เป้าหมาย
หน้า antibiogram ใน integrate dashboard ที่เลือก **ปี / ช่วง 12 เดือนล่าสุด / วอร์ด / สิ่งส่งตรวจ** ได้เอง
คำนวณตาม **CLSI M39** อัปเดตได้บ่อยกว่าปีละครั้ง (cumulative + rolling) — จากผล S/I/R รายเชื้อ (ไม่ใช่ตารางสรุป)

## ต้นทางข้อมูล
- **MLAB DBF รายวัน** (เช่น `D:\241026.DBF`) — 1 ไฟล์ = ผลที่รายงานวันนั้น (dBASE III, cp874). มีไฟล์ใหม่ทุกวัน + export เป็นช่วงวันที่ได้
  - ผู้ป่วย/ตัดซ้ำ: `HN` (8 หลัก ตรง AMR Logs)
  - วันที่: `SPCDATE` (วันเก็บสิ่งส่งตรวจ = ใช้แบ่งช่วง) · `RPTDATE` (เลือกฉบับล่าสุด)
  - วอร์ด: `WARD` (รหัส MLAB → `ward_std` ผ่าน `amr_dictionary.json`) · `WARD_TYPE` (IPD/OPD/ICU)
  - กลุ่มสิ่งส่งตรวจ: `CSOURCE_A` (Respiratory / Hemoculture-Blood / Urine / Pus / Fluid …)
  - เชื้อ: `ORGANISM`+`CORGANISM` — เป็น isolate จริงเมื่อ `METHOD=O`, ไม่ขึ้นต้นด้วย `.`/`NG`, และมีผลยา ≥1 ตัว
  - ผลยา: field 1 ตัวอักษรระหว่าง `RESIST`…`SS_NS` (AK, AP, AUG, CAZ, CRO, CTX, FEP, ETP, IPM, MEM, DOR, TZP, SCFP, SAM, GM, LVX, SXT, TGC, CL, VA, LNZ, …) ค่า **S/I/R/N**
  - **PHI (ห้ามออกจากเครื่อง):** `PRENAME, NAME, BIRTH` (+ HN ใช้ในเครื่อง)
  - `INFECTION, DEPARTMENT` ว่างทั้งไฟล์ → แยก CAI/HAI จาก DBF อย่างเดียวไม่ได้ ต้องใช้ qr1020
- **SoftCon QR-10-020** (เช่น `D:\qr1020_20261025.xls`) — visit OPD+IPD: `HN`(10 หลัก), `AN`(เฉพาะ IPD), วัน admit (= วันลงทะเบียนเมื่อมี AN), วันจำหน่าย/สถานะ
  - จับคู่ DBF: ตัด 2 หลักหน้า HN 10→8 หลัก แล้วหา admission ที่ `admit ≤ SPCDATE ≤ จำหน่าย`
  - **HAI** = `SPCDATE − admit ≥ hai_min_days` (config, ตั้งต้น 2 ≈ วันที่ 3 ตาม NHSN/AMASS; GLASS = ">2 calendar days")
  - **CAI** = ก่อนถึงเกณฑ์ หรือ OPD/ER ที่ไม่มี admission คร่อม · จับคู่ไม่ได้ + IPD/ICU = **ไม่ทราบ** (ไม่นับเข้า CAI/HAI)
  - .xls เก็บ ~25 วัน/ไฟล์ → อ่านหลายไฟล์ต่อกัน, ตัดซ้ำด้วย AN, ไฟล์ต้องเริ่มก่อนช่วงวิเคราะห์ ~90 วัน
  - ไม่บังคับ: ไม่มีไฟล์นี้ก็คำนวณ antibiogram ได้ แค่ไม่มีกลุ่ม CAI/HAI

## กฎการคำนวณ (CLSI M39)
1. รวมทุกไฟล์ DBF → ตัดซ้ำด้วย `REF_NO+LAB_NO+ORGANISM` เก็บ `RPTDATE` ล่าสุด
2. เก็บเฉพาะ isolate จริง + ตัด screening (`CSOURCE_A` ที่กำหนดใน config)
3. **isolate แรกต่อ HN ต่อชนิดเชื้อ ต่อช่วงวิเคราะห์** (ไม่สนสิ่งส่งตรวจ/ผลดื้อ) — ช่วง = ทุกปีปฏิทินที่มีข้อมูล + **12 เดือนล่าสุด (rolling)**
4. **`%S = S/(S+I+R+N)`** ต่อ (เชื้อ × ยา) — **N (=NS/SDD) นับเป็นตัวหาร ไม่นับเป็น S** · **Colistin = I/(I+R)**
5. **คู่ intrinsic resistance แสดง "R"** (ตาม CLSI M100 Appendix B — เช่น P. aeruginosa–CRO/ETP/TGC/SXT, A. baumannii–ETP, Enterococcus–cephalosporins, S. maltophilia–carbapenem/aminoglycoside)
6. กลุ่มย่อย: All · ประเภทหอ (ICU/IPD/OPD) · รายวอร์ด · กลุ่มสิ่งส่งตรวจ (Blood/Respiratory/Urine) · CAI/HAI · สิ่งส่งตรวจ×CAI/HAI
7. ติดธง **`lt30`** เมื่อ isolate ที่ทดสอบ < 30 (dashboard แสดงสีเทา)

## สถาปัตยกรรม
- **Part A — `lab-daily-report/antibiogram_etl.py`** (รันในเครื่อง, PHI ไม่ออก): อ่าน DBF (Python ล้วน ~20 บรรทัด, ไม่เพิ่ม dependency), ใช้ `amr_dictionary.json`+`config.json`+gspread เดิม → output **ตัวเลขสรุป (ไม่มี HN)** ลง Google Sheet tab `Antibiogram`: `period, stratum_type, stratum, organism, drug, n_tested, n_s, pct_s, lt30, intrinsic`. รัน backfill (1 ม.ค. 2568–ปัจจุบัน) แล้วตั้ง Task Scheduler รายวันบน patho13
- **Part B — card ใหม่ใน `amr-live-dashboard.html`**: "🧫 Cumulative Antibiogram" โหลด tab ด้วย gviz JSONP, ตัวเลือกช่วง/กลุ่มของ card เอง, heatmap เชื้อ×ยา (%S+(N) แถบสี ≥90/80–89/70–79/51–69/≤50, "R"=intrinsic, เทา+"N<30"), คลิกช่อง → กราฟเส้น %S ย้อนหลังทุกปี (Chart.js)

## Verification (ทำเมื่อ un-park)
เทียบ **Antibiogram Lerdsin 2025.xlsx** (ต้อง export DBF 1 ม.ค.–31 ธ.ค. 2568): All/Hemoculture/Sputum/Urine/MICU — N ใกล้เคียง, %S ต่าง ≤ ±2 จุด. ตัวเลขอ้างอิง:
- A. baumannii–MEM: All **18% (517)** · CAI 29% (173) · HAI 10% (307) · MICU 8%
- K. pneumoniae–MEM: All **82% (927)** · CAI 91% · HAI 75% · MICU 68%
- E. coli–CRO: All **53% (1101)**

## ยังไม่ทำในรอบนี้ (ต่อยอด)
อัตราตายเชื้อดื้อยาในเลือดแบบ AMASS · outbreak alert เฉพาะ HAI · WISCA · ส่ง LINE/MDRO API

## หลักฐานสนับสนุน
- Barlam et al. 2016 SHEA/IDSA ASP (CID 62:e51–e77) ข้อ 15 — antibiogram แยกกลุ่ม
- Xie et al. 2025 (Ann Clin Microbiol Antimicrob 24:21) — ICU/ER ต่างจากภาพรวม
- Markham et al. 2025 (J Hosp Med) — hospitalist ~75% ไม่เปิด antibiogram ประจำ
- Srisuphan et al. 2023 (JAC-AMR 5:dlad088) — AMASS 25 รพ.ไทย
- CLSI M39 first-isolate (PMC7600976) — นับทุก isolate ทำ %S ต่ำเกินจริง
- Hebert et al. 2012 WISCA (ICHE 33:381–388)

---

## Mapping เข้ากับ repo นี้ (ส่วนที่ทำแล้ว)
โปรแกรม/เว็บแอปในโฟลเดอร์นี้ *ไม่ใช่* ตัว integrate dashboard ข้างบน แต่ทำหน้าที่ "เครื่องคิดเลข" ที่ใช้
กฎ CLSI M39 เดียวกัน และรองรับ rolling แล้ว:

| กฎใน plan | ที่อยู่ในโค้ดนี้ |
|---|---|
| %S = S/(S+I+R+N), N=ไม่ไว นับตัวหาร | `config/conditions.yaml` (`resistant_values` รวม N/NS) + `ab/antibiogram.py` · เทสต์ `tests/test_susceptibility.py` |
| Colistin = I/(I+R) | `conditions.yaml` `intermediate_as_susceptible_drugs: [Colistin]` |
| isolate แรก/HN/เชื้อ/ช่วง | `ab/dedup.py` (กรองช่วงก่อน dedup ใน `ab/rolling.py`) |
| intrinsic = "R" | `ab/intrinsic.py` + `config/intrinsic_resistance.csv` |
| ปีปฏิทิน + 12 เดือนล่าสุด (rolling) | `ab/rolling.py` `annual()`/`rolling()`, CLI `--paired`, เทสต์ `tests/test_rolling.py` |
| กลุ่มย่อย All/ward/specimen/CAI/HAI | `ab/pipeline.py` `finalize(specimens/wards/origins=...)` |
| lt30 (N<30) | `reporting.min_isolates` + `reportable` flag |
| CAI/HAI จาก admission + hai_min_days | `ab/his_join.py` + `ab/classify.py` (`classification.hai_threshold_days`) |

**ต่างจาก plan:** repo นี้ยังอ่าน DBF ผ่าน `ab/loader.read_dbf` (ต้องชี้ field map ใน `config/mlab_profile.json`)
ไม่ใช่สคริปต์ `antibiogram_etl.py` แบบ 20 บรรทัด และยังไม่ทำ Part B dashboard card (เป็นของอีกระบบ)
