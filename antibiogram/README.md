# Antibiogram Generator (CLSI M39)

เว็บแอปรันในเครื่อง (Streamlit) สำหรับสร้าง antibiogram จากไฟล์ Excel
โดยอ้างอิงหลัก CLSI M39 — ข้อมูลผู้ป่วยไม่ออกนอกเครื่อง (เหมาะกับ PDPA)

> สถานะ: **โครงเริ่มต้น (scaffold)** — logic หลักพร้อมใช้กับข้อมูลที่ map แล้ว
> ยังรอไฟล์ตัวอย่างจริงเพื่อยืนยันรูปแบบวันที่/เวลา และค่าผล S/I/R

## ความสามารถ
- อัปโหลดไฟล์ Excel แล้วเลือกวิเคราะห์ผ่านหน้าจอ
- **จับคู่คอลัมน์** อัตโนมัติ + ปรับเองได้ (รองรับชื่อคอลัมน์ต่างระบบ)
- **Dictionary** แปลงชื่อเชื้อ/ยา ให้เป็นชื่อมาตรฐาน (แก้ใน Excel/CSV ได้)
- แยก **CAI / HAI** ด้วยเกณฑ์ 48 ชม. (ปรับได้)
- **First isolate per patient/species** (dedup ตาม M39)
- รายงาน **%Susceptible** พร้อมเกณฑ์จำนวน isolate ขั้นต่ำ (default 30)
- กรองตาม **specimen / ward / CAI-HAI**
- ดาวน์โหลดผลเป็น Excel

## โครงสร้าง
```
antibiogram/
├── app.py                  # หน้าจอ Streamlit
├── requirements.txt
├── config/
│   ├── conditions.yaml     # เงื่อนไขวิเคราะห์ (default, ปรับใน UI ได้)
│   ├── organisms.csv       # dictionary ชื่อเชื้อ (raw -> standard)
│   ├── antibiotics.csv     # dictionary ชื่อยา (raw -> standard)
│   └── column_profiles.json# profile การ map คอลัมน์ที่บันทึกไว้
└── ab/                     # โมดูลหลัก
    ├── config.py           # โหลด/บันทึก conditions
    ├── dictionary.py       # normalize ชื่อเชื้อ/ยา
    ├── mapping.py          # เดา/บันทึก column mapping
    ├── loader.py           # อ่าน Excel + apply mapping
    ├── classify.py         # แยก CAI/HAI (48 ชม.)
    ├── dedup.py            # first isolate per patient/species
    ├── antibiogram.py      # คำนวณ %S + เกณฑ์ min isolate
    └── export.py           # ส่งออก Excel
```

## การใช้งาน
```bash
pip install -r requirements.txt
streamlit run app.py
```

## สิ่งที่จะยืนยันหลังได้ไฟล์จริง
- รูปแบบวันที่/เวลา (มีเวลาด้วยไหม เพื่อคำนวณ 48 ชม. แม่นยำ)
- ค่าผลจริงเป็น S/I/R หรือรูปแบบอื่น
- ชื่อเชื้อ/ยา/คอลัมน์จริง → เติมลง dictionary ตั้งต้นให้
- หน้าตาไฟล์ผลปีที่แล้ว → จัด format output ให้ตรง
