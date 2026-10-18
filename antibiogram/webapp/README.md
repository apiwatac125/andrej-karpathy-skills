# Antibiogram Advisor — เว็บช่วยแพทย์เลือกยาต้านจุลชีพ (โรงพยาบาลเลิดสิน)

เว็บแอปช่วยตัดสินใจเลือกยาปฏิชีวนะเชิงประจักษ์ (empiric) จากผล Antibiogram สะสมของโรงพยาบาลเลิดสิน
แพทย์เลือก “เชื้อก่อโรค” แล้วระบบจะแสดง

- ยาที่เชื้อยัง **ไวสูงสุด (%S)** 5–6 อันดับแรก
- **คำแนะนำ empiric** จัดกลุ่มตามหลัก antimicrobial stewardship (เลือกยาแคบก่อน / ทางเลือก / สงวนไว้ปรึกษา ID)
- **กราฟแนวโน้มการดื้อยาข้ามปี (2018–2025)**
- ตัวกรอง: สิ่งส่งตรวจ (เลือด/เสมหะ/ปัสสาวะ), กลุ่มผู้ป่วย (CAI/HAI), หอผู้ป่วย (MICU/SICU)
- ปุ่มดาวน์โหลด **Antibiogram รายปีเป็น PDF** และตัวนับผู้เข้าใช้งาน

> เป็นข้อมูลสนับสนุนการตัดสินใจ ไม่ใช่คำสั่งการรักษา — ต้องพิจารณาร่วมกับอาการและบริบทผู้ป่วย

## ข้อมูล (provenance)

ข้อมูลจริงจากไฟล์ Antibiogram ที่โรงพยาบาลเผยแพร่ ปี **2018–2025**:

| ปี | ที่มา | ชั้นข้อมูลที่มี |
|----|------|----------------|
| 2018 | โฟลเดอร์ `finish` (all ward / all specimen) | รวมทั้งหมด (ALL) |
| 2019 | โฟลเดอร์ `publish` (All Ward All Specimen) | รวมทั้งหมด (ALL) |
| 2020–2021 | `publish` (หลาย sheet) | ALL + specimen + MICU/SICU |
| 2022 | `publish` | ALL + specimen + MICU/SICU + **CAI/HAI** |
| 2023–2024 | `publish` | ALL + specimen + MICU/SICU |
| 2025 | `publish` | ALL + specimen + MICU/SICU + **CAI/HAI** |

- `%S` คำนวณแบบ first isolate ต่อผู้ป่วย ตามหลัก **CLSI M39**; รายงานเฉพาะกลุ่มที่ **N ≥ 30**
- Colistin ใช้การนับจาก %I (ตามข้อตกลงในโปรแกรมหลัก)
- เป็นข้อมูล **สรุป %S เท่านั้น ไม่มีข้อมูลผู้ป่วยรายบุคคล** → เผยแพร่ได้ตาม PDPA
- ปี 2018–2019 มีเฉพาะตารางรวม (ALL) จึงไม่มีให้กรองตาม specimen/ward/CAI-HAI; UI จะปิดปุ่มที่ไม่มีข้อมูลให้อัตโนมัติ

## โครงสร้าง

```
webapp/
├─ cf/                      ← ชุดไฟล์พร้อม deploy ขึ้น Cloudflare Pages
│  ├─ public/index.html     ← ตัวเว็บ (ฝังข้อมูลไว้ในไฟล์แล้ว) + logo.png
│  ├─ functions/api/hit.js  ← ตัวนับผู้ใช้ (Pages Function + KV "COUNTER")
│  └─ README_DEPLOY.md      ← วิธี deploy ทีละขั้น (ไทย)
└─ src/                     ← แหล่งที่มา + ไปป์ไลน์สร้างข้อมูล
   ├─ years/*.xlsx, 2019_overall.md   ← ไฟล์ Antibiogram ต้นฉบับรายปี
   ├─ parse_all.py          ← อ่านทุกปี → DATA.json (รวม strata/ปี, กรอง N≥30)
   ├─ build_index.py        ← ฝัง DATA.json ลง advisor.html → cf/public/index.html
   ├─ advisor.html          ← เทมเพลตหน้าเว็บ (มี __DATA__ เป็น placeholder)
   └─ DATA.json             ← ข้อมูลที่ประมวลแล้ว
```

## สร้างใหม่ (เมื่อมีข้อมูลปีใหม่)

```bash
cd src
# วางไฟล์ publish ปีใหม่ไว้ใน years/<ปี>.xlsx แล้วเพิ่มปีใน parse_all.py
python3 parse_all.py     # -> src/DATA.json
python3 build_index.py   # -> cf/public/index.html
```
จากนั้น deploy โฟลเดอร์ `cf/` ขึ้น Cloudflare Pages (ดู `cf/README_DEPLOY.md`)

## Deploy

เว็บนี้เป็น static site + 1 Pages Function (ตัวนับผู้ใช้) โฮสต์ฟรีบน **Cloudflare Pages**
ขั้นตอนละเอียดอยู่ใน [`cf/README_DEPLOY.md`](cf/README_DEPLOY.md)
