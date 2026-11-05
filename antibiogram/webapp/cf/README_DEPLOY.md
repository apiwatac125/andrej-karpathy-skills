# วิธี deploy เว็บ Antibiogram ขึ้น Cloudflare Pages (ฟรี)

เว็บนี้เป็น **static site + 1 Function** สำหรับตัวนับผู้ใช้ ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง
โครงไฟล์:

```
cf/
├─ public/
│  └─ index.html          ← ตัวเว็บ (ข้อมูล antibiogram ฝังอยู่ในไฟล์นี้)
└─ functions/
   └─ api/
      └─ hit.js            ← ตัวนับผู้ใช้ (Cloudflare Pages Function)
```

---

## เตรียมตัว (ครั้งเดียว)
1. สมัคร Cloudflare ฟรีที่ https://dash.cloudflare.com/sign-up
2. ล็อกอินเข้า Cloudflare dashboard

---

## วิธีที่ 1 — อัปโหลดผ่านหน้าเว็บ (ง่ายสุด ไม่ต้องใช้ command line)

### ก. สร้าง Pages project + อัปโหลดไฟล์
1. ใน dashboard เมนูซ้าย เลือก **Workers & Pages** → **Create** → แท็บ **Pages** → **Upload assets**
2. ตั้งชื่อโปรเจกต์ เช่น `antibiogram-lerdsin` → **Create project**
3. ลากทั้งโฟลเดอร์ **`public`** (หรือไฟล์ `index.html` ข้างใน) เข้าไปวาง → **Deploy site**
4. จะได้ URL เช่น `https://antibiogram-lerdsin.pages.dev` — เปิดดูได้เลย (ตอนนี้เว็บใช้งานได้ แต่ตัวนับยังไม่ขึ้นจนกว่าจะทำขั้น ข. และ ค.)

### ข. สร้าง KV (ที่เก็บตัวเลขของตัวนับ)
1. เมนูซ้าย **Storage & Databases** → **KV** → **Create a namespace**
2. ตั้งชื่อ เช่น `antibiogram_counter` → **Add**

### ค. ผูก KV เข้ากับโปรเจกต์ + อัปโหลด Function
1. กลับไปที่โปรเจกต์ Pages → **Settings** → **Bindings** (หรือ **Functions** → **KV namespace bindings**)
2. **Add binding**:
   - **Variable name:** `COUNTER`  ← ต้องสะกดแบบนี้เป๊ะ (ตัวใหญ่ทั้งหมด)
   - **KV namespace:** เลือก `antibiogram_counter`
   - **Save**
3. อัปโหลด Function: ไปที่แท็บ **Deployments** → **Create new deployment** แล้วอัปโหลด **ทั้งโฟลเดอร์** (ให้มีทั้ง `public/` และ `functions/` — ลากโฟลเดอร์ `cf` ทั้งก้อน หรือซิปไฟล์ในโฟลเดอร์ cf แล้วอัปโหลด)
   > การอัปโหลดแบบ drag-and-drop จะเห็น Function อัตโนมัติถ้ามีโฟลเดอร์ `functions/` อยู่ระดับเดียวกับ `public/`

เปิด URL อีกครั้ง — ตัวนับ "👥 ผู้ใช้งาน … คน · เข้าชม … ครั้ง" จะขึ้นที่มุมบนขวา

---

## วิธีที่ 2 — ใช้ command line (Wrangler) สำหรับคนที่ถนัด

```bash
# ติดตั้ง Node.js ก่อน (https://nodejs.org) แล้ว:
npm install -g wrangler
wrangler login

# สร้าง KV namespace (จดค่า id ที่ได้)
wrangler kv namespace create COUNTER

# deploy ทั้งโฟลเดอร์ cf (public = static, functions = ตัวนับ)
cd cf
wrangler pages deploy public --project-name antibiogram-lerdsin
```
จากนั้นเข้า dashboard → โปรเจกต์ → Settings → Bindings → เพิ่ม KV binding ชื่อ `COUNTER` ชี้ไปที่ namespace ที่สร้าง แล้ว deploy ซ้ำ 1 ครั้ง

---

## การอัปเดตข้อมูล antibiogram (รายปี)
- ข้อมูลทั้งหมดฝังอยู่ใน `public/index.html` (ตัวแปร `const DATA = {...}`)
- เมื่อมีผล antibiogram ปีใหม่ ให้แทนค่าในก้อน `DATA` แล้วอัปโหลด `index.html` ทับ (deploy ใหม่)
- แจ้งผมได้ เดี๋ยวแปลงผลจากโปรแกรม Python เป็นก้อน `DATA` ให้อัตโนมัติ

## การตั้งชื่อโดเมนของ รพ. (ถ้าต้องการ)
- โปรเจกต์ Pages → **Custom domains** → **Set up a domain** → ใส่โดเมน/ซับโดเมนของโรงพยาบาล แล้วทำตามขั้นตอน DNS

## หมายเหตุ
- ตัวนับ "คน" นับจาก id ที่สุ่มเก็บในเบราว์เซอร์ของผู้ใช้ (localStorage) — ถ้าล้างเบราว์เซอร์หรือเปลี่ยนเครื่องจะนับเป็นคนใหม่ (เป็นค่าประมาณการใช้งาน ไม่ใช่ตัวตนจริง — ไม่เก็บข้อมูลส่วนบุคคล)
- ข้อมูลที่โชว์เป็น **ผลรวม %S ไม่มีข้อมูลผู้ป่วยรายบุคคล** จึงเผยแพร่ภายนอกได้ตาม PDPA
- Cloudflare Pages ฟรี: 500 builds/เดือน, bandwidth ไม่จำกัด, KV ฟรีพอสำหรับงานนี้มาก
