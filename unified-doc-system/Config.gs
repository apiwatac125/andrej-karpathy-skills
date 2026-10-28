/**
 * ค่าตั้งของระบบงานเอกสาร — เพิ่มระบบ เมนู และระดับสิทธิ์ ที่ไฟล์นี้ไฟล์เดียว
 */

var APP = {
  title: 'ระบบงานเอกสาร',
  org: 'กลุ่มงานพยาธิวิทยาคลินิกและเทคนิคการแพทย์ โรงพยาบาลเลิดสิน',
  logoUrl: ''   // URL รูปโลโก้ที่เปิดดูได้สาธารณะ — เว้นว่าง = แสดงกรอบ "โลโก้"
};

/**
 * ระดับสิทธิ์ เรียงจากสูงไปต่ำ — level มากกว่า = เปิดเมนูได้มากกว่า
 * เพิ่มระดับใหม่ได้โดยเพิ่มแถวและกำหนด level ตามลำดับที่ต้องการ
 */
var ROLES = [
  { key: 'group_head', label: 'หัวหน้ากลุ่มงาน', level: 4 },
  { key: 'unit_head', label: 'หัวหน้างาน', level: 3 },
  { key: 'staff', label: 'ผู้ปฏิบัติงาน', level: 2 },
  { key: 'other', label: 'อื่นๆ', level: 1 }
];

/** ระดับต่ำสุดที่จัดการผู้ใช้และกำหนดสิทธิ์ได้ */
var ADMIN_LEVEL = 4;

/**
 * เมนูแถบซ้าย เรียงตามแบบร่าง
 *   minLevel  ระดับสิทธิ์ต่ำสุดที่เห็นและเปิดเมนูนี้ได้
 *   app+page  ระบบที่ deploy แยกโปรเจกต์ — app = ชื่อ Script Property ที่เก็บ URL เว็บแอป (/exec),
 *             page = ค่า ?page= ของระบบนั้น
 *   file      หน้าที่อยู่ในโปรเจกต์นี้เอง (ชื่อไฟล์ .html) — ใช้เมื่อย้ายระบบเข้ามารวมในโปรเจกต์เดียว
 *   ไม่มีทั้ง app และ file = ยังไม่มีระบบ แสดงหน้า "อยู่ระหว่างพัฒนา"
 *   { slot: true } = ช่องสำรองสำหรับระบบที่จะเพิ่มภายหลัง — แทนที่ด้วยกลุ่มเมนูจริงเมื่อพร้อม
 */
var MENU = [
  {
    group: 'WI, SP, SOP',
    items: [
      { id: 'wi-dar', label: 'ส่งคำขอแก้ไขเอกสาร', minLevel: 2, app: 'WI_APP_URL', page: 'dar' },
      { id: 'wi-upload', label: 'ส่งเอกสารที่แก้พร้อมลงนาม', minLevel: 2, app: 'WI_APP_URL', page: 'upload' },
      { id: 'wi-status', label: 'ติดตามสถานะ', minLevel: 2, app: 'WI_APP_URL', page: 'home' },
      { id: 'wi-archive', label: 'คลังเอกสาร', minLevel: 1, app: 'WI_APP_URL', page: 'archive' }
    ]
  },
  {
    group: 'ระบบจัดซื้อ',
    items: [
      { id: 'vendor-eval', label: 'ประเมินผู้ขาย', minLevel: 3 }
    ]
  },
  { slot: true },
  { slot: true },
  { slot: true }
];
