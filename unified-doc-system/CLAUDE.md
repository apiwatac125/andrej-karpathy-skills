# ระบบงานเอกสาร (หน้าหลักรวมระบบ) — Project Context for Claude Code

## สิ่งที่โปรเจกต์นี้ทำ

Google Apps Script web app หน้าหลักของกลุ่มงานพยาธิวิทยาคลินิกและเทคนิคการแพทย์ โรงพยาบาลเลิดสิน
ตามแบบร่างของผู้ใช้: แถบซ้าย (ข้อมูลผู้ใช้ + เมนูแยกกลุ่ม + ช่องสำรอง) · หัว (โลโก้ + ชื่อระบบ) ·
กรอบเนื้อหาแสดงหน้าของระบบที่เลือก · แชทบอทมุมขวาล่างค้นเอกสารในคลัง · login 5 ระดับ
ขั้นตอนติดตั้ง ตารางสิทธิ์ และวิธีเพิ่มระบบ: `README.md`

## ระบบที่รวมเข้ามา

| ระบบ | โค้ดอยู่ที่ | สถานะ | เชื่อมแบบ |
|---|---|---|---|
| **SP-MT-07** คัดเลือก/ประเมินผู้ขาย (กลุ่ม "ระบบจัดซื้อ") | repo `Unlucky125/spmt07-webapp` (private) — เดิมคือ `D:\SP Medtech project` | ใช้งานจริง production @28 รองรับ `?embed=1` | deploy แยก ฝังในกรอบ (`SPMT07_APP_URL`) + แชทบอทอ่านชีตตรง (`SPMT07_SHEET_ID`) |
| **WI Document Control** ควบคุมเอกสารคุณภาพ ISO 15189:2022 (กลุ่ม "WI, SP, SOP") | เครื่องผู้ใช้ `D:\claude amass\wi-doc-control` — **ยังไม่อยู่บน GitHub** | **ยังไม่เคย deploy** | ยังไม่ได้เชื่อม — เมนูขึ้น "ยังไม่ได้เชื่อมต่อ" |

### ระบบ WI — สรุปจาก CLAUDE.md ของ `D:\claude amass` (ผู้ใช้ส่งมา 2026-10-29)

- Apps Script web app ส่งไฟล์ WI ขอลงนามออนไลน์ + คลังเอกสาร มี 5 โฟลเดอร์ 2 สาย:
  v1.x = เอกสารล้วน · v2.x = + ตรวจติดตามภายใน (Audit) และ CAPA
  - `wi-doc-control` = **v2.2 สายหลักปัจจุบัน** (+ DAR + ค้นหาเนื้อหา) ← ตัวที่จะรวมเข้าระบบนี้
  - `wi-doc-control-v1.1` = v1.2 สายปัจจุบันของ v1.x (ชื่อโฟลเดอร์ไม่ตรงเวอร์ชัน — ยึด `VERSION.md`)
  - `wi-doc-control-v1.0`, `wi-doc-control-v2.0` = **freeze ห้ามแก้**
- `wi-doc-control` กับ `-v1.1` ใช้ไฟล์ชุดเดียวกัน 9 ตัว: `Common.gs`, `DocRequest.gs`, `DocSearch.gs`,
  `Dar.html`, `Upload.html`, `Sign.html`, `Archive.html`, `Styles.html`, `SigPad.html` — แก้ที่ไหนต้อง
  คัดลอกไปอีกฝั่ง · `Code.gs` / `Nav.html` ต่างกันเล็กน้อย
- **ยังไม่เคย deploy สักเวอร์ชัน** ผ่านแค่ `node --check` — ห้ามรายงานว่า "ทำงานได้แล้ว"
- data model ยึด WI ของจริง (`WI-MB-08`, `WI-MB-07`): ฉบับที่แบบ `1 → 2 → C → D → D/1`,
  ประเภท WI / SP / ED / LB
- ยืมโครงจาก SP-MT-07: token approval, signature pad, HTML→PDF, `runSetup()` idempotent
- รายละเอียดสถาปัตยกรรม (40 ข้อ) อยู่ใน `wi-doc-control/CLAUDE.md` ซึ่งยังไม่ได้ส่งมา

เมนู WI ตอนนี้ชี้ไปที่ `?page=dar` / `upload` / `home` / `archive` (เดาจากหน้าตัวอย่างที่ session WI
publish ไว้) — ต้องเทียบกับ `doGet` จริงของ WI ตอนรวม

**แผนรวม WI (เมื่อได้โค้ด):** WI ยังไม่มี production จึงรวมเข้าโปรเจกต์ Apps Script นี้เลย แทนการ deploy แยก
— เมนูใช้แบบ `file`, ฟังก์ชันฝั่ง server ของ WI ตรวจ `requireLevel_(token, …)`, รวม `doGet` ให้หน้าลงนามจาก
อีเมล (`?page=sign&id&token`) ยังเปิดได้โดยไม่ต้อง login, แชทบอทเรียกฟังก์ชันค้นหาใน `DocSearch.gs` ตรง
ระวังชื่อไฟล์ชนกัน: ทั้งสองระบบมี `Code.gs` และ `Styles.html`

## สถาปัตยกรรม / การตัดสินใจสำคัญ

1. **Apps Script + Sheets** แบบเดียวกับ WI และ SP-MT-07 เพื่อให้รวมเป็นโปรเจกต์เดียวได้
2. **login ของระบบเอง** (ชีต `Users`, รหัสผ่าน SHA-256 + salt เก็บเป็น hex) ไม่ใช้บัญชี Google เพราะ
   deploy แบบ Anyone/Execute as me แล้ว `Session.getActiveUser()` ใช้กับ gmail คนนอกโดเมนไม่ได้
   · session ใน CacheService 6 ชม. เก็บแค่ username — อ่านระดับสิทธิ์จากชีตใหม่ทุกครั้ง
3. **5 ระดับ** ใน `ROLES` (`Config.gs`): admin 5 › หัวหน้ากลุ่มงาน 4 › หัวหน้างาน 3 › ผู้ปฏิบัติงาน 2 › อื่นๆ 1
   · `ADMIN_LEVEL = 5` จัดการผู้ใช้ + ตั้งค่าระบบ (ผู้ใช้ขอ "admin แก้ไขได้ทั้งหมด" 2026-10-29)
4. **เมนู** (`MENU` ใน `Config.gs`) มี 4 แบบ: `app+page` = ระบบ deploy แยก โหลด `URL?page=…&embed=1`
   ใน iframe · `file` = หน้าในโปรเจกต์นี้ (`?page=<id>&s=<token>`) · ไม่มีทั้งคู่ = "เร็วๆ นี้" ·
   `{ slot: true }` = ช่องสำรองตามแบบร่าง
5. **หน้าที่ฝังในกรอบต้องซ่อนเมนูของตัวเอง** — หน้า HtmlService มี `<base target="_top">` กดลิงก์แล้วพา
   ออกจากหน้าหลัก และ `target="_self"` / ชื่อ frame ใช้ข้ามชั้น sandbox ไม่ได้ (SP-MT-07 ใช้ `body.embed`)
6. **ตั้งค่าระบบ** (`Settings.gs`) เก็บใน Script Properties: `APP_SETTINGS` (ชื่อ/หน่วยงาน/โลโก้),
   `MENU_LEVELS` (ระดับเมนูที่ต่างจาก `minLevel`), ลิงก์ตาม `SETTING_LINKS` — ทุกที่ที่ตรวจสิทธิ์เมนูต้องใช้
   `itemLevel_()` ไม่ใช่ `item.minLevel` ตรงๆ · ตรวจครบก่อนบันทึก · ลิงก์ต้อง `https://`
7. **แชทบอทอ่านชีต SP-MT-07 ตรง** (`Search.gs`) เพราะคนละโปรเจกต์เรียกฟังก์ชันกันไม่ได้ และ SP-MT-07
   ต้อง login Google ทำให้ UrlFetch ไม่ได้ — ผูกกับชื่อคอลัมน์ `SUBMISSION_COLUMNS` / `SUMMARY_COLUMNS`
   อ่านทีละคอลัมน์เพราะแท็บมีรูปลายเซ็นใหญ่ · ค้นเฉพาะคลังที่ผู้ใช้มีสิทธิ์เปิดเมนู · ล้างประวัติตอน logout
8. **repo นี้เป็น public** — ห้าม commit URL production / deploymentId / id ชีตของโรงพยาบาล
   ใส่ใน `LocalProps.gs` (gitignore) แล้ว `setup()` คัดลอกลง Script Properties เฉพาะตัวที่ยังว่าง
   (README เคยมี URL ของ SP-MT-07 — ลบแล้วแต่ยังอยู่ในประวัติ commit แนะนำผู้ใช้ให้ทำ repo เป็น private)
9. **หน้าตัวอย่าง** `preview/build.py` รัน `.gs` จริงบนบริการ Apps Script จำลอง (`preview/mock.js`)
   ห่อในฟังก์ชันเดียวกันกันชื่อชนกับสคริปต์หน้าเว็บ · id ชีตจำลองต้องยาว 44 ตัวเหมือนจริง

## Deploy

- clasp 3.3.0 · `.clasp.json` → scriptId `15CBP0pFQ2EoU0TAY39lLqAkklccs13JoSx8eGNF8zSrD5WPO6JfMFGhj`
  (โปรเจกต์ "ระบบงานเอกสาร" อยู่ในบัญชี Google เดียวกับเจ้าของ SP-MT-07 และชีตของมัน — ไม่เขียนอีเมลไว้เพราะ repo เปิดสาธารณะ)
- deploymentId ไม่เก็บใน repo — ดูด้วย `clasp list-deployments` (ตัวที่มีคำอธิบาย ไม่ใช่ `@HEAD`)
- ทุกครั้ง: `clasp push` แล้ว `clasp deploy --deploymentId <id> --description "..."` (push อย่างเดียวลิงก์ไม่เปลี่ยน)
- ก่อน push ควร `clasp clone` ลงโฟลเดอร์ชั่วคราวเทียบกับ git ว่าไม่มีใครแก้ใน editor
- cloud session: `clasp login --no-localhost` ผู้ใช้เปิดลิงก์ login แล้วคัดลอก URL `http://localhost:8888/?code=…`
  กลับมา (หน้านั้นขึ้น error เป็นเรื่องปกติ) · เครือข่ายของ cloud session เปิด `script.google.com` ไม่ได้
  จึงตรวจหน้าจริงเองไม่ได้
- สถานะ 2026-10-29: deploy @2 ("เพิ่มระดับผู้ดูแลระบบ (admin) + หน้าตั้งค่าระบบ") — ผู้ใช้ต้องรัน `setup()`
  ใน editor หนึ่งครั้งเพื่อ authorize + สร้างบัญชี admin (รันซ้ำได้ ปรับ admin เดิมเป็นผู้ดูแลระบบ)

## รูปแบบการทำงาน

- สรุปงานให้ผู้ใช้เป็นภาษาไทยกระชับ อ่านง่าย · comment ในโค้ดเป็นภาษาไทยตามโค้ดที่มีอยู่
- ผู้ใช้มักสั่งงานจากมือถือ — ขั้นตอนที่ต้องให้ผู้ใช้ทำเองให้สั้นและเป็นข้อๆ
