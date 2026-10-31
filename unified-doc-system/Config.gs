/**
 * ค่าตั้งของระบบงานเอกสาร — เพิ่มระบบ เมนู และระดับสิทธิ์ ที่ไฟล์นี้ไฟล์เดียว
 */

var APP = {
  title: 'ระบบงานเอกสาร',
  org: 'กลุ่มงานพยาธิวิทยาคลินิกและเทคนิคการแพทย์ โรงพยาบาลเลิดสิน',
  logoUrl: ''   // URL รูปโลโก้ที่เปิดดูได้สาธารณะ — เว้นว่าง = โลโก้โรงพยาบาลเลิดสินที่ฝังไว้ใน Logo.gs
};

/**
 * ระดับสิทธิ์ เรียงจากสูงไปต่ำ — level มากกว่า = เปิดเมนูได้มากกว่า
 * เพิ่มระดับใหม่ได้โดยเพิ่มแถวและกำหนด level ตามลำดับที่ต้องการ
 */
var ROLES = [
  { key: 'admin', label: 'ผู้ดูแลระบบ (admin)', level: 5 },
  { key: 'group_head', label: 'หัวหน้ากลุ่มงาน', level: 4 },
  { key: 'unit_head', label: 'หัวหน้างาน', level: 3 },
  { key: 'staff', label: 'ผู้ปฏิบัติงาน', level: 2 },
  { key: 'other', label: 'อื่นๆ', level: 1 }
];

/** ระดับต่ำสุดที่จัดการผู้ใช้และตั้งค่าระบบได้ — เปลี่ยนเป็น 4 ถ้าให้หัวหน้ากลุ่มงานทำได้ด้วย */
var ADMIN_LEVEL = 5;

/**
 * หน้าที่ในระบบคุณภาพ — ติดที่ตัวผู้ใช้ แยกจากระดับสิทธิ์ เพราะเป็นหน้าที่ ไม่ใช่ลำดับสูงต่ำ
 * (ผู้ปฏิบัติงานเป็น Auditor ได้) · ผู้ดูแลระบบ (ADMIN_LEVEL) ทำได้ทุกหน้าที่
 */
var DUTIES = [
  { key: 'qmr', label: 'QMR (ผู้แทนฝ่ายบริหารคุณภาพ)', short: 'QMR' },
  { key: 'auditor', label: 'ผู้ตรวจติดตามภายใน (Auditor)', short: 'Auditor' }
];

/** ลิงก์เชื่อมระบบอื่น (เก็บเป็น Script Property ชื่อตาม key) ที่ผู้ดูแลระบบแก้ได้ในหน้า "ตั้งค่าระบบ" */
var SETTING_LINKS = [
  { key: 'SPMT07_APP_URL', label: 'URL เว็บแอประบบจัดซื้อ (SP-MT-07)', hint: 'ลงท้ายด้วย /exec' },
  { key: 'SPMT07_SHEET_ID', label: 'id สเปรดชีต SP-MT-07 Selection Submissions', hint: 'ใช้กับแชทบอทค้นคลัง' }
];

/**
 * เมนูแถบซ้าย เรียงตามแบบร่าง
 *   minLevel  ระดับสิทธิ์ต่ำสุดที่เห็นและเปิดเมนูนี้ได้
 *   app+page  ระบบที่ deploy แยกโปรเจกต์ — app = ชื่อ Script Property ที่เก็บ URL เว็บแอป (/exec),
 *             page = ค่า ?page= ของระบบนั้น
 *   wi        หน้าของระบบ WI ที่รวมอยู่ในโปรเจกต์นี้ (ค่า ?page= ของ WI, 'home' = หน้ารวม) — ดู routeWi_ ใน Shell.gs
 *   file      หน้าที่อยู่ในโปรเจกต์นี้เอง (ชื่อไฟล์ .html) ที่ระบบหลักเปิดให้พร้อมตัวแปร user/token
 *   ไม่มีทั้ง app / wi / file = ยังไม่มีระบบ แสดงหน้า "อยู่ระหว่างพัฒนา"
 *   { slot: true } = ช่องสำรองสำหรับระบบที่จะเพิ่มภายหลัง — แทนที่ด้วยกลุ่มเมนูจริงเมื่อพร้อม
 */
var MENU = [
  {
    // ระบบ WI Document Control v2.2 — รวมอยู่ในโปรเจกต์นี้ (Code.gs, DocRequest.gs, …) ดู wi/CLAUDE.md
    group: 'WI, SP, SOP',
    items: [
      { id: 'wi-dar', label: 'ส่งคำขอแก้ไขเอกสาร', minLevel: 2, wi: 'dar' },
      { id: 'wi-upload', label: 'ส่งเอกสารที่แก้พร้อมลงนาม', minLevel: 2, wi: 'upload' },
      { id: 'wi-status', label: 'ติดตามสถานะ', minLevel: 2, wi: 'home' },
      { id: 'wi-archive', label: 'คลังเอกสาร', minLevel: 1, wi: 'archive' },
      { id: 'wi-masterlist', label: 'ทะเบียนเอกสาร (Master List)', minLevel: 1, wi: 'masterlist' },
      { id: 'wi-audit', label: 'ตรวจติดตามภายใน', minLevel: 3, wi: 'audit' },
      { id: 'wi-capa', label: 'CAPA', minLevel: 2, wi: 'capa' }
    ]
  },
  {
    // ระบบ SP-MT-07 คัดเลือกและประเมินผู้ขาย (repo Unlucky125/spmt07-webapp) — deploy แยกโปรเจกต์
    group: 'ระบบจัดซื้อ',
    items: [
      { id: 'spmt-select', label: 'คัดเลือกผู้ขาย / ผู้ให้บริการ', minLevel: 2, app: 'SPMT07_APP_URL', page: '' },
      { id: 'spmt-eval', label: 'ประเมินผู้ขาย', minLevel: 2, app: 'SPMT07_APP_URL', page: 'summary' },
      { id: 'spmt-archive', label: 'คลังเอกสาร', minLevel: 2, app: 'SPMT07_APP_URL', page: 'archive' },
      { id: 'spmt-formtools', label: 'ดรอปดาวน์รายชื่อบริษัท', minLevel: 3, app: 'SPMT07_APP_URL', page: 'formtools' }
    ]
  },
  { slot: true },
  { slot: true },
  { slot: true }
];
