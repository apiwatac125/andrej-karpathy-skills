# Mockup — Cumulative Antibiogram (ตารางคู่)

ตัวอย่างหน้าตา (visual reference) ของ card **"🧫 Cumulative Antibiogram"** ที่อธิบายไว้ใน
[`../ROLLING_ANTIBIOGRAM_PLAN.md`](../ROLLING_ANTIBIOGRAM_PLAN.md) → *Part B* — ใช้อ้างอิงตอนสร้าง section จริงใน
`amr-live-dashboard.html` (ระบบ AMR Integrated Dashboard ซึ่งอยู่คนละ repo และสถานะ *พักไว้*)

- **`cumulative-antibiogram-paired.html`** — ไฟล์พร้อมดู (เปิดในเบราว์เซอร์ได้เลย, ฝังข้อมูลไว้แล้ว)
- **`cumulative-antibiogram-paired.template.html`** — เทมเพลต (มี `__MOCK_DATA__` placeholder)
- **`mock_data.json`** — ข้อมูลที่ฝัง

Live preview: <https://claude.ai/artifact/6SD5q1oEoeF8yTeh3XyxNF>

## สิ่งที่ mockup แสดง
- **ตารางคู่ heatmap เชื้อ×ยา**: ซ้าย = *รายปี 2568* · ขวา = *12 เดือนล่าสุด* (สลับ คู่/รายปี/12เดือน ได้)
- ช่อง = **%S + (N)**, แถบสี 5 ระดับตามเล่ม antibiogram ของห้องแล็บ (≥90 / 80–89 / 70–79 / 51–69 / ≤50)
- **"R" = ดื้อโดยธรรมชาติ** (CLSI M100) · เทา/`N<30` = ไม่รายงาน
- ตัวเลือกกลุ่ม (All / specimen / ward / CAI / HAI) แบบสาธิต

## ข้อมูล
- คอลัมน์ **รายปี = ข้อมูลจริง** "All specimen & ward" ปี 2568 (จาก `webapp/src/DATA.json`) —
  ตรงกับเป้า verification ใน plan (เช่น K. pneumoniae–MEM 82% N=927, E. coli–CRO 53% N=1101)
- คอลัมน์ **12 เดือนล่าสุด = ค่าสาธิต** (pooled ข้ามปี) — ของจริงต้องคำนวณจาก isolate รายวันผ่านโปรแกรม
  (`ab/rolling.py`) ไม่ใช่ตัวเลขสรุปรายปี

## สร้างใหม่
```bash
python3 -c "import json; t=open('cumulative-antibiogram-paired.template.html').read(); \
d=json.load(open('mock_data.json')); \
open('cumulative-antibiogram-paired.html','w').write(t.replace('__MOCK_DATA__', json.dumps(d,ensure_ascii=False,separators=(',',':'))))"
```
