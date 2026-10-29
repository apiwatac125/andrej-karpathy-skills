/**
 * WI Document Control — ระบบส่งไฟล์ WI ขอลงนามออนไลน์ + คลังเอกสาร
 * ---------------------------------------------------------------------------
 * โครงเดียวกับ SP-MT-07 Selection Web App (Google Apps Script + Sheets + Drive)
 * ต่างกันที่ "ตัวเอกสาร" เป็นไฟล์ที่ผู้ใช้อัปโหลด ไม่ใช่ฟอร์มที่กรอกในเว็บ
 *
 * flow: ผู้จัดทำ (อัปโหลด + เซ็น) -> ผู้ทบทวน (เซ็น) -> ผู้อนุมัติ (เซ็น)
 *       -> ระบบสร้าง "ใบปกควบคุมเอกสาร" เป็น PDF เก็บคู่กับไฟล์ใน Drive
 *       -> ฉบับก่อนหน้าของเลขเอกสารเดียวกันถูกตีสถานะ "ยกเลิกใช้" อัตโนมัติ
 *
 * วิธีติดตั้ง: ดู README.md (ต้องรัน runSetup() หนึ่งครั้งก่อนใช้งาน)
 */

// ============================================================
// 0. CONFIG
// ============================================================

const SHEET_NAMES = {
  DOCS: 'Documents',
  CONFIG: 'Config',
  UNITS: 'Units',
  // v2.1 — ใบขออนุมัติดำเนินการกับเอกสาร (logic อยู่ใน DocRequest.gs)
  DOC_REQUESTS: 'DocRequests',
  // v2.2 — ข้อความที่ดึงจากไฟล์ ใช้ค้นเนื้อหาในคลัง (logic อยู่ใน DocSearch.gs)
  DOC_TEXT: 'DocText',
  // v2.0 — โมดูล Audit / CAPA และทะเบียนสิทธิ์ (logic อยู่ใน AuditCapa.gs)
  AUDITS: 'Audits',
  FINDINGS: 'Findings',
  CAPAS: 'CAPAs',
  PEOPLE: 'People'
};

/**
 * ประเภทเอกสาร = หมวดในหน้าคลัง (แก้ที่นี่ที่เดียว)
 * รหัสตามที่กลุ่มงานใช้จริง: WI-MB-08, SP-ICT-019, ED-WIMB08-01, LB-WIMB08-01
 */
const DOC_TYPES = [
  { value: 'WI', label: 'วิธีปฏิบัติงาน (WI)' },
  { value: 'SP', label: 'ระเบียบปฏิบัติ (SP)' },
  { value: 'ED', label: 'เอกสารสนับสนุน (ED)' },
  { value: 'LB', label: 'สมุดบันทึก / ทะเบียน (LB)' },
  { value: 'FM', label: 'แบบฟอร์มบันทึก (FM)' },
  { value: 'QM', label: 'คู่มือคุณภาพ (QM)' }
];

/** หัวเอกสารจริงมีช่อง "เอกสารฉบับนี้เป็น: ( เอกสารควบคุม สำเนาฉบับที่ __ / ( เอกสารไม่ควบคุม" */
const CONTROL_TYPES = [
  { value: 'controlled', label: 'เอกสารควบคุม' },
  { value: 'uncontrolled', label: 'เอกสารไม่ควบคุม' }
];

/**
 * ชนิดการเปลี่ยนแปลง — ตรงกับตาราง "บันทึกประวัติการใช้งาน การทบทวน และ การแก้ไขเอกสาร"
 * ของเอกสารจริง ซึ่งแยก "ฉบับที่" / "ทบทวนครั้งที่" / "แก้ไขครั้งที่" ออกจากกัน
 * ของจริงมีแถวแบบ "ทบทวนเอกสาร (ไม่มีแก้ไข)" ที่ฉบับที่ไม่เปลี่ยน — ต้องรองรับ
 */
const CHANGE_KINDS = [
  { value: 'new', label: 'ประกาศใช้ฉบับแรก' },
  { value: 'edition', label: 'ประกาศใช้ฉบับใหม่ (เปลี่ยนฉบับที่)' },
  { value: 'amend', label: 'แก้ไขภายในฉบับเดิม' },
  { value: 'review', label: 'ทบทวนเอกสาร (ไม่มีแก้ไขเนื้อหา)' }
];

const STATUS = {
  WAIT_REVIEW: 'รอทบทวน',
  WAIT_APPROVE: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED_REVIEW: 'ไม่ผ่านการทบทวน',
  REJECTED_APPROVE: 'ไม่อนุมัติ',
  OBSOLETE: 'ยกเลิกใช้'
};

/** สถานะที่ถือว่ายังอยู่ในสาย (ใช้หาฉบับปัจจุบันของเลขเอกสาร / กันยื่นซ้อน) */
const ACTIVE_STATUSES = [STATUS.WAIT_REVIEW, STATUS.WAIT_APPROVE, STATUS.APPROVED];

const MAX_FILE_MB = 10;

/** ชนิดไฟล์ที่รับ — payload มาจาก client จึงต้องตรวจฝั่ง server ด้วย */
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg'
];

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const DEFAULT_UNITS = [
  'งานจุลชีววิทยา',
  'งานเคมีคลินิก',
  'งานโลหิตวิทยา',
  'งานภูมิคุ้มกันวิทยา',
  'งานธนาคารเลือด',
  'งานรับสิ่งส่งตรวจ'
];

// ============================================================
// 1. ROUTER
// ============================================================

function doGet(e) {
  const page = e && e.parameter && e.parameter.page;

  // หน้าที่มีลิงก์ข้ามหน้าต้อง render ผ่าน template เพื่อฝัง URL เต็มของ web app
  // (HtmlService เสิร์ฟในกรอบ iframe บน googleusercontent.com — ลิงก์ "?page=x" แบบ relative วิ่งผิดโดเมน)
  if (page === 'dar') {
    const darTpl = HtmlService.createTemplateFromFile('Dar');
    darTpl.baseUrl = ScriptApp.getService().getUrl();
    darTpl.darId = (e.parameter.id || '');
    darTpl.token = (e.parameter.token || '');
    darTpl.capaId = (e.parameter.capa || ''); // เปิดคำขอต่อจาก CAPA
    return darTpl.evaluate()
      .setTitle('คำขอดำเนินการกับเอกสาร (DAR)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  if (page === 'upload') {
    const upTpl = HtmlService.createTemplateFromFile('Upload');
    upTpl.baseUrl = ScriptApp.getService().getUrl();
    upTpl.darId = (e.parameter.dar || ''); // อัปโหลดตามใบขออนุมัติที่ผ่านแล้ว
    return upTpl.evaluate()
      .setTitle('ส่งเอกสารขอลงนาม (WI / SP / ED / LB)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  if (page === 'audit') {
    const auTpl = HtmlService.createTemplateFromFile('Audit');
    auTpl.baseUrl = ScriptApp.getService().getUrl();
    auTpl.auditId = (e.parameter.id || '');
    auTpl.token = (e.parameter.token || '');
    return auTpl.evaluate()
      .setTitle('ตรวจติดตามภายใน (Internal Audit)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  if (page === 'capa') {
    const caTpl = HtmlService.createTemplateFromFile('Capa');
    caTpl.baseUrl = ScriptApp.getService().getUrl();
    caTpl.capaId = (e.parameter.id || '');
    caTpl.token = (e.parameter.token || '');
    caTpl.findingId = (e.parameter.finding || ''); // เปิด CAPA ใหม่จากข้อตรวจพบ
    return caTpl.evaluate()
      .setTitle('การแก้ไขและป้องกัน (CAPA)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  if (page === 'sign') {
    const signTpl = HtmlService.createTemplateFromFile('Sign');
    signTpl.docId = (e.parameter.id || '');
    signTpl.token = (e.parameter.token || '');
    signTpl.baseUrl = ScriptApp.getService().getUrl();
    return signTpl.evaluate()
      .setTitle('ลงนามเอกสารคุณภาพ')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  if (page === 'archive') {
    const arcTpl = HtmlService.createTemplateFromFile('Archive');
    arcTpl.baseUrl = ScriptApp.getService().getUrl();
    return arcTpl.evaluate()
      .setTitle('คลังเอกสารคุณภาพ')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // ค่าตั้งต้น v2.0 = หน้ารวม (เอกสาร + Audit + CAPA) ส่วนหน้าส่งเอกสารย้ายไป ?page=upload
  const tpl = HtmlService.createTemplateFromFile('Home');
  tpl.baseUrl = ScriptApp.getService().getUrl();
  return tpl.evaluate()
    .setTitle('ระบบคุณภาพห้องปฏิบัติการ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
// 2. SHEET HELPERS
// ============================================================

function getSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) {
    throw new Error('ยังไม่ได้ตั้งค่า SHEET_ID — กรุณารันฟังก์ชัน runSetup() ก่อน (เมนู Run > runSetup)');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีท: ' + name + ' — กรุณารัน runSetup() อีกครั้ง');
  return sh;
}

/** คอลัมน์แท็บ Documents — โค้ดอ่าน/เขียนตาม "ชื่อคอลัมน์" ลำดับไม่สำคัญ เพิ่มต่อท้ายได้ */
const DOC_COLUMNS = [
  'doc_id', 'timestamp', 'doc_code', 'doc_title', 'doc_type', 'unit',
  // revision = ลำดับภายในสำหรับเรียงฉบับ (0,1,2,...) ไม่ใช่เลขที่แสดงบนเอกสาร
  // เลขที่แสดงจริงคือ edition + amendment -> "D" หรือ "D/1" (editionLabel_)
  'revision', 'edition', 'amendment', 'review_count', 'edition_label', 'change_kind',
  'effective_date', 'review_cycle_months', 'next_review_date',
  'control_type', 'copy_no',
  'change_note', 'change_pages', 'supersedes_doc_id', 'dar_id',
  'file_id', 'file_url', 'file_name', 'file_mime',
  'author_email', 'author_name', 'author_at', 'author_signature',
  'reviewer_email', 'reviewer_name', 'reviewer_at', 'reviewer_signature', 'reviewer_comment',
  'approver_email', 'approver_name', 'approved_at', 'approver_signature', 'approver_comment',
  'status', 'cover_pdf_id', 'cover_pdf_url', 'token'
];

const UNIT_COLUMNS = ['unit', 'reviewer_email', 'reviewer_title', 'approver_email', 'approver_title'];

/** เติมคอลัมน์ให้ครบแบบ lazy (เรียกจาก submitDocument เผื่อชีทเก่ายังไม่มีคอลัมน์ใหม่) */
function ensureColumns_(sheetName, columns) {
  const sh = getSheet_(sheetName);
  if (sh.getLastRow() === 0) {
    sh.appendRow(columns);
    sh.setFrozenRows(1);
    return sh;
  }
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  columns.forEach(function (name) {
    if (header.indexOf(name) === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue(name);
  });
  return sh;
}

/**
 * รันครั้งเดียวตอนติดตั้ง: สร้าง Spreadsheet + แท็บ Documents / Config / Units
 * รันซ้ำได้ (idempotent) — ใช้ migrate ชีทเก่าให้มีคอลัมน์/คีย์ครบด้วย
 */
function runSetup() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('WI Document Control');
    props.setProperty('SHEET_ID', ss.getId());
  }

  [[SHEET_NAMES.DOCS, DOC_COLUMNS], [SHEET_NAMES.UNITS, UNIT_COLUMNS]].forEach(function (pair) {
    let sh = ss.getSheetByName(pair[0]);
    if (!sh) sh = ss.insertSheet(pair[0]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(pair[1]);
      sh.setFrozenRows(1);
    } else {
      const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      pair[1].forEach(function (name) {
        if (header.indexOf(name) === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue(name);
      });
    }
  });

  let cfg = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!cfg) cfg = ss.insertSheet(SHEET_NAMES.CONFIG);
  if (cfg.getLastRow() === 0) cfg.appendRow(['key', 'value']);
  const cfgKeys = cfg.getDataRange().getValues().map(function (r) { return r[0]; });
  // อีเมลเว้นว่างเป็นค่าตั้งต้น: ระบบยังบันทึกเอกสารได้ปกติ แค่ข้ามการส่งอีเมลขั้นที่ยังไม่ตั้งค่า
  [
    ['reviewer_email', ''],
    ['reviewer_title', 'ผู้ทบทวน (หัวหน้างาน)'],
    ['approver_email', ''],
    ['approver_title', 'ผู้อนุมัติ (หัวหน้ากลุ่มงาน)'],
    ['org_line', 'กลุ่มงานเทคนิคการแพทย์'],
    ['default_review_cycle_months', '24'],
    ['drive_root_id', '']
  ].forEach(function (row) {
    if (cfgKeys.indexOf(row[0]) === -1) cfg.appendRow(row);
  });

  // รายชื่องานตั้งต้น (แก้/เพิ่มได้ในแท็บ Units — อีเมลต่องานจะ override ค่าใน Config)
  const unitSh = ss.getSheetByName(SHEET_NAMES.UNITS);
  if (unitSh.getLastRow() <= 1) {
    DEFAULT_UNITS.forEach(function (u) { unitSh.appendRow([u, '', '', '', '']); });
  }

  ensureDarSetup_();   // v2.1 — แท็บ DocRequests (DocRequest.gs)
  ensureSearchSetup_();// v2.2 — แท็บ DocText (DocSearch.gs)
  ensureAuditSetup_(); // v2.0 — แท็บ Audits / Findings / CAPAs / People (AuditCapa.gs)

  Logger.log('ตั้งค่าเสร็จแล้ว: ' + ss.getUrl());
  Logger.log('ขั้นถัดไป: ใส่อีเมลผู้ทบทวน/ผู้อนุมัติในแท็บ Units (หรือ Config เป็นค่ากลาง)');
  return ss.getUrl();
}

function getConfigValue_(key, fallback) {
  const data = getSheet_(SHEET_NAMES.CONFIG).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return fallback;
}

function setConfigValue_(key, value) {
  const sh = getSheet_(SHEET_NAMES.CONFIG);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

/** แผนที่งาน -> อีเมล/ตำแหน่งผู้ลงนาม (ว่าง = ใช้ค่ากลางใน Config) */
function getUnitMap_() {
  const data = getSheet_(SHEET_NAMES.UNITS).getDataRange().getValues();
  if (data.length < 2) return {};
  const header = data[0];
  const col = function (name) { return header.indexOf(name); };
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const unit = String(data[i][col('unit')] || '').trim();
    if (!unit) continue;
    map[unit] = {
      unit: unit,
      reviewerEmail: String(data[i][col('reviewer_email')] || '').trim(),
      reviewerTitle: String(data[i][col('reviewer_title')] || '').trim(),
      approverEmail: String(data[i][col('approver_email')] || '').trim(),
      approverTitle: String(data[i][col('approver_title')] || '').trim()
    };
  }
  return map;
}

/** ผู้ลงนามที่ใช้จริงของงานนั้น (ค่าต่องาน -> ค่ากลางใน Config -> ว่าง) */
function resolveSigners_(unit) {
  const u = getUnitMap_()[String(unit || '').trim()] || {};
  return {
    reviewerEmail: u.reviewerEmail || String(getConfigValue_('reviewer_email', '') || '').trim(),
    reviewerTitle: u.reviewerTitle || String(getConfigValue_('reviewer_title', 'ผู้ทบทวน') || ''),
    approverEmail: u.approverEmail || String(getConfigValue_('approver_email', '') || '').trim(),
    approverTitle: u.approverTitle || String(getConfigValue_('approver_title', 'ผู้อนุมัติ') || '')
  };
}

// ============================================================
// 3. UTIL
// ============================================================

function htmlEscape_(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

function formatThaiDate_(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.getDate() + ' ' + THAI_MONTHS[dt.getMonth()] + ' ' + (dt.getFullYear() + 543);
}

function safeFileName_(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function docTypeLabel_(value) {
  for (let i = 0; i < DOC_TYPES.length; i++) {
    if (DOC_TYPES[i].value === value) return DOC_TYPES[i].label;
  }
  return value || '-';
}

function changeKindLabel_(value) {
  for (let i = 0; i < CHANGE_KINDS.length; i++) {
    if (CHANGE_KINDS[i].value === value) return CHANGE_KINDS[i].label;
  }
  return value || '-';
}

/** เลขที่ฉบับอย่างที่พิมพ์บนหัวเอกสารจริง: "D" เมื่อยังไม่มีการแก้ไข, "D/1" เมื่อแก้ครั้งที่ 1 */
function editionLabel_(edition, amendment) {
  const e = String(edition === undefined || edition === null ? '' : edition).trim();
  const a = Number(amendment) || 0;
  if (!e) return '-';
  return a > 0 ? (e + '/' + a) : e;
}

/**
 * เดาฉบับถัดไป: ตัวเลข -> +1, ตัวอักษรเดี่ยว -> ตัวถัดไป
 * เป็นแค่ค่าตั้งต้นให้คนกรอก — ของจริงเคยกระโดดจาก "2" ไป "C" ตอนเปลี่ยนระบบเลขเอกสาร
 * จึงต้องให้แก้ทับได้เสมอ ห้ามบังคับ
 */
function nextEdition_(current) {
  const e = String(current || '').trim();
  if (!e) return '1';
  if (/^[0-9]+$/.test(e)) return String(Number(e) + 1);
  if (/^[A-Za-z]$/.test(e)) {
    const c = e.toUpperCase();
    return c === 'Z' ? 'AA' : String.fromCharCode(c.charCodeAt(0) + 1);
  }
  return e;
}

/**
 * ตรวจลายเซ็น (data URL) — ต้องตรวจฝั่ง server เสมอ เพราะ client แก้ค่าที่ส่งมาได้
 * เพดาน 50,000 ตัวอักษร = ขีดจำกัดต่อเซลล์ของ Google Sheets
 */
function validateSignature_(signature) {
  return (typeof signature === 'string' &&
    /^data:image\/(png|jpeg);base64,/.test(signature) &&
    signature.length < 50000) ? signature : '';
}

/** ความเห็นถูกพิมพ์ลงใบปก จึงตัดความยาวกันล้นช่องลงนาม */
function trimComment_(comment) {
  return String(comment || '').trim().slice(0, 500);
}

function clearArchiveCache_() {
  try { CacheService.getScriptCache().remove('wi_archive_v1'); } catch (err) { /* cache ใช้ไม่ได้ไม่ใช่เรื่องคอขาดบาดตาย */ }
}

/** หา row ของเอกสารตาม doc_id — คืน accessor get/set ตามชื่อคอลัมน์ */
function findDocRow_(docId) {
  const sh = getSheet_(SHEET_NAMES.DOCS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idCol = header.indexOf('doc_id');
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] !== docId) continue;
    const row = data[i];
    const rowNum = i + 1;
    return {
      sheet: sh, rowNum: rowNum, header: header, values: row,
      get: function (name) {
        const c = header.indexOf(name);
        return c > -1 ? row[c] : '';
      },
      set: function (name, value) {
        const c = header.indexOf(name);
        if (c > -1) sh.getRange(rowNum, c + 1).setValue(value);
      }
    };
  }
  return null;
}

/** ทุกแถวของเลขเอกสารนี้ เรียงฉบับใหม่ -> เก่า */
function getDocsByCode_(docCode) {
  const code = String(docCode || '').trim().toUpperCase();
  if (!code) return [];
  const data = getSheet_(SHEET_NAMES.DOCS).getDataRange().getValues();
  if (data.length < 2) return [];
  const header = data[0];
  const col = function (name) { return header.indexOf(name); };
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col('doc_code')] || '').trim().toUpperCase() !== code) continue;
    out.push({
      docId: data[i][col('doc_id')],
      rowNum: i + 1,
      revision: Number(data[i][col('revision')]) || 0,   // ลำดับภายใน ใช้เรียงเท่านั้น
      edition: String(data[i][col('edition')] || ''),
      amendment: Number(data[i][col('amendment')]) || 0,
      reviewCount: Number(data[i][col('review_count')]) || 0,
      editionLabel: editionLabel_(data[i][col('edition')], data[i][col('amendment')]),
      changeKind: String(data[i][col('change_kind')] || ''),
      status: String(data[i][col('status')] || ''),
      title: String(data[i][col('doc_title')] || ''),
      docType: String(data[i][col('doc_type')] || ''),
      unit: String(data[i][col('unit')] || ''),
      effectiveDate: data[i][col('effective_date')],
      fileUrl: String(data[i][col('file_url')] || ''),
      coverPdfUrl: String(data[i][col('cover_pdf_url')] || '')
    });
  }
  out.sort(function (a, b) { return b.revision - a.revision; });
  return out;
}

// ============================================================
// 4. CLIENT API — หน้าส่งเอกสาร
// ============================================================

function getUploadInit() {
  const units = Object.keys(getUnitMap_()).sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return {
    units: units.length ? units : DEFAULT_UNITS,
    docTypes: DOC_TYPES,
    changeKinds: CHANGE_KINDS,
    controlTypes: CONTROL_TYPES,
    userEmail: Session.getActiveUser().getEmail() || '',
    defaultReviewCycle: Number(getConfigValue_('default_review_cycle_months', 24)) || 24,
    maxFileMB: MAX_FILE_MB
  };
}

/**
 * ให้หน้าเว็บเช็คเลขเอกสารก่อนส่ง: มีอยู่แล้วไหม / ฉบับที่ถัดไปควรเป็นอะไร
 * ค่าที่คืนเป็นแค่ค่าแนะนำให้คนกรอกเห็น — ตอน submit server คำนวณ/ตรวจซ้ำเสมอ
 */
function lookupDocCode(docCode) {
  const rows = getDocsByCode_(docCode);
  if (!rows.length) {
    return { exists: false, suggest: { changeKind: 'new', edition: '1', amendment: 0 } };
  }
  const current = rows.filter(function (r) { return r.status === STATUS.APPROVED; })[0] || rows[0];
  const pending = rows.filter(function (r) {
    return r.status === STATUS.WAIT_REVIEW || r.status === STATUS.WAIT_APPROVE;
  })[0] || null;
  return {
    exists: true,
    current: {
      edition: current.edition, amendment: current.amendment,
      editionLabel: current.editionLabel, reviewCount: current.reviewCount,
      status: current.status, title: current.title,
      docType: current.docType, unit: current.unit,
      effectiveDate: formatThaiDate_(current.effectiveDate)
    },
    // ค่าตั้งต้นของแต่ละชนิดการเปลี่ยนแปลง ให้หน้าเว็บเติมช่องให้อัตโนมัติ
    suggest: {
      edition: { changeKind: 'edition', edition: nextEdition_(current.edition), amendment: 0 },
      amend: { changeKind: 'amend', edition: current.edition, amendment: current.amendment + 1 },
      review: { changeKind: 'review', edition: current.edition, amendment: current.amendment }
    },
    pending: pending ? { editionLabel: pending.editionLabel, status: pending.status } : null
  };
}

/**
 * ผู้จัดทำส่งเอกสาร: อัปโหลดไฟล์ + กรอกข้อมูลควบคุมเอกสาร + เซ็นชื่อตัวเอง
 * payload: { docCode, docTitle, docType, unit, effectiveDate, reviewCycleMonths,
 *            changeNote, authorName, authorSignature, file: { name, mime, dataBase64 } }
 */
function submitDocument(payload) {
  const p = payload || {};
  const docCode = String(p.docCode || '').trim().toUpperCase();
  const docTitle = String(p.docTitle || '').trim();
  const docType = String(p.docType || '').trim();
  const unit = String(p.unit || '').trim();
  const authorName = String(p.authorName || '').trim();

  if (!docCode) throw new Error('กรุณากรอกเลขที่เอกสาร');
  if (!docTitle) throw new Error('กรุณากรอกชื่อเอกสาร');
  if (!unit) throw new Error('กรุณาเลือกงาน/หน่วยงาน');
  if (!authorName) throw new Error('กรุณากรอกชื่อผู้จัดทำ');
  if (!DOC_TYPES.some(function (t) { return t.value === docType; })) {
    throw new Error('ประเภทเอกสารไม่ถูกต้อง');
  }

  const authorSignature = validateSignature_(p.authorSignature);
  if (!authorSignature) throw new Error('ลายเซ็นผู้จัดทำไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');

  const file = p.file || {};
  if (!file.dataBase64) throw new Error('กรุณาแนบไฟล์เอกสาร');
  if (ALLOWED_MIME.indexOf(String(file.mime)) === -1) {
    throw new Error('ชนิดไฟล์ไม่รองรับ (รับ PDF / Word / Excel / PowerPoint / รูปภาพ)');
  }

  ensureColumns_(SHEET_NAMES.DOCS, DOC_COLUMNS);

  const existing = getDocsByCode_(docCode);
  const pending = existing.filter(function (r) {
    return r.status === STATUS.WAIT_REVIEW || r.status === STATUS.WAIT_APPROVE;
  });
  if (pending.length) {
    throw new Error('เลขเอกสาร ' + docCode + ' มีฉบับที่ ' + pending[0].editionLabel +
      ' อยู่ในสถานะ "' + pending[0].status + '" อยู่แล้ว — กรุณารอให้ฉบับนั้นเสร็จสิ้นก่อน');
  }
  // revision = ลำดับภายใน คำนวณฝั่ง server เสมอ ห้ามเชื่อค่าจาก client
  const revision = existing.length ? existing[0].revision + 1 : 0;
  const supersedesDocId = existing.length
    ? (existing.filter(function (r) { return r.status === STATUS.APPROVED; })[0] || {}).docId || ''
    : '';

  // ---- ฉบับที่ / แก้ไขครั้งที่ / ทบทวนครั้งที่ ----
  // ฉบับที่เป็นได้ทั้งตัวเลขและตัวอักษร (ของจริงเดิน 1 -> 2 -> C -> D -> D/1) จึงให้คนกรอกระบุเอง
  // แต่ server ตรวจความสมเหตุสมผลและกันซ้ำ
  const cur = existing[0] || null;
  let changeKind = String(p.changeKind || '').trim();
  if (!CHANGE_KINDS.some(function (k) { return k.value === changeKind; })) {
    changeKind = cur ? 'amend' : 'new';
  }
  if (!cur && changeKind !== 'new') changeKind = 'new';
  if (cur && changeKind === 'new') changeKind = 'edition';

  let edition, amendment, reviewCount;
  if (changeKind === 'new') {
    edition = String(p.edition || '').trim() || '1';
    amendment = 0;
    reviewCount = 0;
  } else if (changeKind === 'edition') {
    edition = String(p.edition || '').trim() || nextEdition_(cur.edition);
    amendment = 0;
    reviewCount = cur.reviewCount;
  } else if (changeKind === 'amend') {
    edition = String(p.edition || '').trim() || cur.edition;
    amendment = (edition === cur.edition) ? cur.amendment + 1 : (Number(p.amendment) || 1);
    reviewCount = cur.reviewCount;
  } else { // review — ฉบับที่ไม่เปลี่ยน นับเฉพาะ "ทบทวนครั้งที่"
    edition = cur.edition;
    amendment = cur.amendment;
    reviewCount = cur.reviewCount + 1;
  }
  if (!String(edition).trim()) throw new Error('กรุณาระบุฉบับที่ของเอกสาร');

  // กันฉบับซ้ำ (ยกเว้นการทบทวนที่ไม่แก้ไข ซึ่งตั้งใจให้ฉบับที่เท่าเดิม)
  if (changeKind !== 'review') {
    const clash = existing.filter(function (r) {
      return r.edition === String(edition) && r.amendment === Number(amendment);
    })[0];
    if (clash) {
      throw new Error('ฉบับที่ ' + editionLabel_(edition, amendment) + ' ของ ' + docCode +
        ' มีอยู่แล้วในคลัง (สถานะ "' + clash.status + '") — กรุณาระบุฉบับที่ใหม่');
    }
  }

  const controlType = CONTROL_TYPES.some(function (c) { return c.value === p.controlType; })
    ? String(p.controlType) : 'controlled';

  // ใบขออนุมัติ (DAR) — บังคับหรือไม่ขึ้นกับ Config.require_dar
  const darId = validateDarForSubmit_(p.darId, docCode, existing.length ? 'revise' : 'new');

  const blob = Utilities.newBlob(
    Utilities.base64Decode(file.dataBase64),
    file.mime,
    safeFileName_(file.name) || (docCode + ' ฉบับที่ ' + editionLabel_(edition, amendment))
  );
  const sizeMB = blob.getBytes().length / (1024 * 1024);
  if (sizeMB > MAX_FILE_MB) throw new Error('ไฟล์ใหญ่เกิน ' + MAX_FILE_MB + ' MB');

  const docId = Utilities.getUuid();
  const token = Utilities.getUuid();
  const now = new Date();
  // webapp ที่ deploy แบบ access: ANYONE จะได้ getActiveUser() เป็นค่าว่าง (เหมือน SP-MT-07
  // ที่ผู้ใช้เป็นบัญชี Gmail ส่วนตัว ไม่ได้อยู่ใน Workspace domain) จึงรับอีเมลจากฟอร์มเป็นตัวสำรอง
  const authorEmail = Session.getActiveUser().getEmail() || String(p.authorEmail || '').trim();
  if (authorEmail.indexOf('@') === -1) throw new Error('กรุณากรอกอีเมลผู้จัดทำ (ใช้แจ้งผลการลงนามกลับ)');
  const signers = resolveSigners_(unit);
  const hasReviewer = signers.reviewerEmail.indexOf('@') > -1;
  const status = hasReviewer ? STATUS.WAIT_REVIEW : STATUS.WAIT_APPROVE;

  const stored = saveSourceFile_(blob, {
    unit: unit, docType: docType, docCode: docCode,
    editionLabel: editionLabel_(edition, amendment), docTitle: docTitle
  });
  // ผู้ลงนามต้องเปิดไฟล์ได้ตอนกดลิงก์ในอีเมล จึงแชร์เป็นรายคน (ไม่เปิด link sharing ทั้งโดเมน)
  shareViewer_(stored, hasReviewer ? signers.reviewerEmail : signers.approverEmail);

  const cycle = Number(p.reviewCycleMonths) || Number(getConfigValue_('default_review_cycle_months', 24)) || 24;
  const rowByName = {
    doc_id: docId, timestamp: now, doc_code: docCode, doc_title: docTitle,
    doc_type: docType, unit: unit, revision: revision,
    edition: String(edition), amendment: amendment, review_count: reviewCount,
    edition_label: editionLabel_(edition, amendment), change_kind: changeKind,
    effective_date: String(p.effectiveDate || '').trim(),
    review_cycle_months: cycle, next_review_date: '',
    control_type: controlType, copy_no: String(p.copyNo || '').trim(),
    change_note: String(p.changeNote || '').trim().slice(0, 1000),
    change_pages: String(p.changePages || '').trim().slice(0, 200),
    supersedes_doc_id: supersedesDocId, dar_id: darId,
    file_id: stored.getId(), file_url: stored.getUrl(),
    file_name: stored.getName(), file_mime: file.mime,
    author_email: authorEmail, author_name: authorName, author_at: now,
    author_signature: authorSignature,
    reviewer_email: hasReviewer ? signers.reviewerEmail : '',
    reviewer_name: '', reviewer_at: '', reviewer_signature: '', reviewer_comment: '',
    approver_email: signers.approverEmail, approver_name: '', approved_at: '',
    approver_signature: '', approver_comment: '',
    status: status, cover_pdf_id: '', cover_pdf_url: '', token: token
  };
  const sh = getSheet_(SHEET_NAMES.DOCS);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(header.map(function (name) {
    return rowByName.hasOwnProperty(name) ? rowByName[name] : '';
  }));
  clearArchiveCache_();

  const info = buildDocInfo_(rowByName, signers);
  if (hasReviewer) {
    sendSignRequest_(signers.reviewerEmail, signers.reviewerTitle + ' (ขั้นที่ 1 — ทบทวน)', docId, token, info);
  } else if (signers.approverEmail.indexOf('@') > -1) {
    sendSignRequest_(signers.approverEmail, signers.approverTitle + ' (อนุมัติ)', docId, token, info,
      'ยังไม่ได้ตั้งค่าอีเมลผู้ทบทวนของ ' + unit + ' ระบบจึงข้ามขั้นทบทวน');
  } else {
    Logger.log('ยังไม่ได้ตั้งค่าอีเมลผู้ลงนามของ ' + unit + ' — ข้ามการส่งอีเมล');
  }

  return {
    docId: docId, status: status, fileUrl: stored.getUrl(),
    editionLabel: editionLabel_(edition, amendment), changeKind: changeKind
  };
}

/** ข้อมูลย่อของเอกสารสำหรับใส่ในอีเมล */
function buildDocInfo_(row, signers) {
  return {
    docCode: row.doc_code, docTitle: row.doc_title,
    docTypeLabel: docTypeLabel_(row.doc_type), unit: row.unit,
    editionLabel: row.edition_label, changeKindLabel: changeKindLabel_(row.change_kind),
    authorName: row.author_name, authorEmail: row.author_email,
    changeNote: row.change_note, fileUrl: row.file_url,
    reviewerTitle: (signers || {}).reviewerTitle || '', approverTitle: (signers || {}).approverTitle || ''
  };
}

function sendSignRequest_(toEmail, stageTitle, docId, token, info, extraNote) {
  const url = ScriptApp.getService().getUrl() + '?page=sign&id=' + docId + '&token=' + token;
  const label = info.docCode + ' ฉบับที่ ' + info.editionLabel + ' ' + info.docTitle;
  const body =
    'มีเอกสารคุณภาพรอการลงนามจากท่าน (' + stageTitle + ')\n\n' +
    'เลขที่เอกสาร: ' + info.docCode + '  (ฉบับที่ ' + info.editionLabel + ')\n' +
    'ชื่อเอกสาร: ' + info.docTitle + '\n' +
    'ประเภท: ' + info.docTypeLabel + '\n' +
    'งาน/หน่วยงาน: ' + info.unit + '\n' +
    (info.changeKindLabel ? 'ลักษณะการเปลี่ยนแปลง: ' + info.changeKindLabel + '\n' : '') +
    'ผู้จัดทำ: ' + info.authorName + ' (' + info.authorEmail + ')\n' +
    (info.changeNote ? 'สาระการแก้ไข: ' + info.changeNote + '\n' : '') +
    '\nไฟล์เอกสาร: ' + info.fileUrl + '\n' +
    (extraNote ? '\n' + extraNote + '\n' : '') +
    '\nกรุณาตรวจสอบและลงนามที่ลิงก์นี้:\n' + url;
  MailApp.sendEmail(toEmail, 'รอลงนาม (' + stageTitle + '): ' + label, body);
}

function notifyAuthor_(authorEmail, docLabel, status, signerName, comment, link) {
  if (!authorEmail || authorEmail.indexOf('@') === -1) return;
  const body =
    'เอกสาร "' + docLabel + '" ที่ท่านส่งเข้าระบบมีผลการพิจารณาแล้ว\n\n' +
    'สถานะ: ' + status + '\n' +
    'ผู้ลงนาม: ' + (signerName || '-') + '\n' +
    (comment ? 'ความเห็น: ' + comment + '\n' : '') +
    (link ? '\nดูเอกสาร: ' + link + '\n' : '');
  MailApp.sendEmail(authorEmail, '[' + status + '] ' + docLabel, body);
}

// ============================================================
// 5. CLIENT API — หน้าลงนาม
// ============================================================

/** ดึงข้อมูลสำหรับหน้าลงนาม (ตรวจ token ก่อนเปิดเผยข้อมูล) */
function getDocForSigning(docId, token) {
  const row = findDocRow_(docId);
  if (!row) throw new Error('ไม่พบเอกสารนี้');
  if (row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');

  const status = String(row.get('status'));
  const signers = resolveSigners_(row.get('unit'));
  // ขั้นที่รอ: ระบบตัดสินจาก status เอง — client ข้ามขั้นไม่ได้
  let pendingStage = '';
  if (status === STATUS.WAIT_REVIEW) pendingStage = 'review';
  else if (status === STATUS.WAIT_APPROVE) pendingStage = 'approve';

  const fileId = String(row.get('file_id') || '');
  return {
    docId: docId,
    docCode: String(row.get('doc_code')),
    docTitle: String(row.get('doc_title')),
    docTypeLabel: docTypeLabel_(String(row.get('doc_type'))),
    unit: String(row.get('unit')),
    editionLabel: String(row.get('edition_label') || editionLabel_(row.get('edition'), row.get('amendment'))),
    edition: String(row.get('edition') || ''),
    amendment: Number(row.get('amendment')) || 0,
    reviewCount: Number(row.get('review_count')) || 0,
    changeKindLabel: changeKindLabel_(String(row.get('change_kind') || '')),
    controlTypeLabel: labelOf_(CONTROL_TYPES, String(row.get('control_type') || 'controlled')),
    copyNo: String(row.get('copy_no') || ''),
    effectiveDate: String(row.get('effective_date') || ''),
    reviewCycleMonths: Number(row.get('review_cycle_months')) || 0,
    nextReviewDate: formatThaiDate_(row.get('next_review_date')),
    changeNote: String(row.get('change_note') || ''),
    changePages: String(row.get('change_pages') || ''),
    orgLine: String(getConfigValue_('org_line', '') || ''),
    fileUrl: String(row.get('file_url') || ''),
    filePreviewUrl: fileId ? ('https://drive.google.com/file/d/' + fileId + '/preview') : '',
    fileName: String(row.get('file_name') || ''),
    createdAt: formatThaiDate_(row.get('timestamp')),
    authorName: String(row.get('author_name') || ''),
    authorAt: formatThaiDate_(row.get('author_at')),
    authorSignature: String(row.get('author_signature') || ''),
    reviewerTitle: signers.reviewerTitle,
    reviewerName: String(row.get('reviewer_name') || ''),
    reviewerAt: formatThaiDate_(row.get('reviewer_at')),
    reviewerSignature: String(row.get('reviewer_signature') || ''),
    reviewerComment: String(row.get('reviewer_comment') || ''),
    approverTitle: signers.approverTitle,
    approverName: String(row.get('approver_name') || ''),
    approverAt: formatThaiDate_(row.get('approved_at')),
    approverSignature: String(row.get('approver_signature') || ''),
    approverComment: String(row.get('approver_comment') || ''),
    coverPdfUrl: String(row.get('cover_pdf_url') || ''),
    status: status,
    pendingStage: pendingStage
  };
}

/**
 * ลงนาม 1 ขั้น — ขั้นไหนขึ้นกับ status ปัจจุบันเท่านั้น
 * review  : อนุมัติ -> รออนุมัติ (ส่งอีเมลผู้อนุมัติ) / ไม่ผ่าน -> ไม่ผ่านการทบทวน
 * approve : อนุมัติ -> อนุมัติแล้ว + สร้างใบปก PDF + ตีฉบับก่อนเป็นยกเลิกใช้ / ไม่อนุมัติ -> ไม่อนุมัติ
 */
function signDocument(docId, token, signerName, decision, comment, signature) {
  const row = findDocRow_(docId);
  if (!row) throw new Error('ไม่พบเอกสารนี้');
  if (row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');

  const name = String(signerName || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อผู้ลงนาม');
  const sig = validateSignature_(signature);
  if (!sig) throw new Error('ลายเซ็นไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');
  const note = trimComment_(comment);
  const approve = (decision === 'approve');

  const status = String(row.get('status'));
  const unit = String(row.get('unit'));
  const signers = resolveSigners_(unit);
  const editionLabel = String(row.get('edition_label') || editionLabel_(row.get('edition'), row.get('amendment')));
  const docLabel = row.get('doc_code') + ' ฉบับที่ ' + editionLabel + ' ' + row.get('doc_title');
  const viewUrl = ScriptApp.getService().getUrl() + '?page=sign&id=' + docId + '&token=' + token;
  const now = new Date();
  clearArchiveCache_();

  // ---------- ขั้นที่ 1: ทบทวน ----------
  if (status === STATUS.WAIT_REVIEW) {
    row.set('reviewer_name', name);
    row.set('reviewer_at', now);
    row.set('reviewer_signature', sig);
    row.set('reviewer_comment', note);
    if (!approve) {
      row.set('status', STATUS.REJECTED_REVIEW);
      notifyAuthor_(row.get('author_email'), docLabel, STATUS.REJECTED_REVIEW, name, note, viewUrl);
      return { status: STATUS.REJECTED_REVIEW };
    }
    row.set('status', STATUS.WAIT_APPROVE);
    if (signers.approverEmail.indexOf('@') > -1) {
      try { shareViewer_(DriveApp.getFileById(String(row.get('file_id'))), signers.approverEmail); } catch (err) {
        Logger.log('แชร์ไฟล์ให้ผู้อนุมัติไม่สำเร็จ (' + docId + '): ' + err);
      }
      const info = {
        docCode: row.get('doc_code'), docTitle: row.get('doc_title'),
        docTypeLabel: docTypeLabel_(String(row.get('doc_type'))), unit: unit,
        editionLabel: editionLabel,
        changeKindLabel: changeKindLabel_(String(row.get('change_kind') || '')),
        authorName: row.get('author_name'),
        authorEmail: row.get('author_email'), changeNote: row.get('change_note'),
        fileUrl: row.get('file_url')
      };
      sendSignRequest_(signers.approverEmail, signers.approverTitle + ' (ขั้นที่ 2 — อนุมัติ)',
        docId, token, info,
        'ทบทวนแล้วโดย ' + name + (note ? '\nความเห็นผู้ทบทวน: ' + note : ''));
    }
    return { status: STATUS.WAIT_APPROVE };
  }

  // ---------- ขั้นที่ 2: อนุมัติ ----------
  if (status === STATUS.WAIT_APPROVE) {
    const newStatus = approve ? STATUS.APPROVED : STATUS.REJECTED_APPROVE;
    row.set('approver_name', name);
    row.set('approved_at', now);
    row.set('approver_signature', sig);
    row.set('approver_comment', note);
    row.set('status', newStatus);

    if (!approve) {
      notifyAuthor_(row.get('author_email'), docLabel, newStatus, name, note, viewUrl);
      return { status: newStatus };
    }

    // วันที่มีผลบังคับใช้: ถ้าผู้จัดทำไม่ได้ระบุ ให้ใช้วันอนุมัติ
    let effective = String(row.get('effective_date') || '').trim();
    if (!effective) {
      effective = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      row.set('effective_date', effective);
    }
    const cycle = Number(row.get('review_cycle_months')) || 0;
    let nextReview = '';
    if (cycle > 0) {
      const base = new Date(effective);
      if (!isNaN(base.getTime())) {
        base.setMonth(base.getMonth() + cycle);
        nextReview = Utilities.formatDate(base, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        row.set('next_review_date', nextReview);
      }
    }

    // ฉบับก่อนหน้าที่ยังบังคับใช้ -> ยกเลิกใช้ (ควบคุมเอกสารต้องมีฉบับบังคับใช้เดียว)
    obsoletePrevious_(String(row.get('doc_code')), docId);

    // ปิดใบขออนุมัติที่เป็นต้นเรื่อง (ถ้ามี) — ภายในหุ้ม try/catch ไว้แล้ว
    closeDarForDocument_(String(row.get('dar_id') || ''), docId,
      String(row.get('doc_code')), editionLabel);

    // ดึงข้อความจากไฟล์เก็บไว้ให้ค้นได้ — ห้ามทำให้การอนุมัติล้ม
    try { indexDocument_(docId); } catch (err) {
      Logger.log('ทำ index เนื้อหาไม่สำเร็จ (' + docId + '): ' + err);
    }

    // ใบปก PDF พังห้ามทำให้การอนุมัติล้ม จึงหุ้ม try/catch
    let coverUrl = '';
    try {
      const cover = saveCoverPdf_({
        docCode: row.get('doc_code'), docTitle: row.get('doc_title'),
        docTypeLabel: docTypeLabel_(String(row.get('doc_type'))), docType: row.get('doc_type'),
        unit: unit, editionLabel: editionLabel,
        reviewCount: Number(row.get('review_count')) || 0,
        changeKindLabel: changeKindLabel_(String(row.get('change_kind') || '')),
        controlTypeLabel: labelOf_(CONTROL_TYPES, String(row.get('control_type') || 'controlled')),
        copyNo: String(row.get('copy_no') || ''),
        orgLine: String(getConfigValue_('org_line', '') || ''),
        createdAt: formatThaiDate_(row.get('timestamp')),
        effectiveDate: formatThaiDate_(effective),
        nextReviewDate: formatThaiDate_(nextReview),
        reviewCycleMonths: cycle,
        changeNote: row.get('change_note'),
        changePages: row.get('change_pages'),
        fileName: row.get('file_name'), fileUrl: row.get('file_url'),
        authorName: row.get('author_name'), authorAt: formatThaiDate_(row.get('author_at')),
        authorSignature: row.get('author_signature'),
        reviewerTitle: signers.reviewerTitle,
        reviewerName: row.get('reviewer_name'), reviewerAt: formatThaiDate_(row.get('reviewer_at')),
        reviewerSignature: row.get('reviewer_signature'), reviewerComment: row.get('reviewer_comment'),
        approverTitle: signers.approverTitle,
        approverName: name, approverAt: formatThaiDate_(now),
        approverSignature: sig, approverComment: note
      });
      coverUrl = cover.getUrl();
      row.set('cover_pdf_id', cover.getId());
      row.set('cover_pdf_url', coverUrl);
    } catch (err) {
      Logger.log('สร้างใบปกควบคุมเอกสารไม่สำเร็จ (' + docId + '): ' + err);
    }

    // ผู้จัดทำต้องเปิดไฟล์ฉบับที่อนุมัติแล้วได้
    try { shareViewer_(DriveApp.getFileById(String(row.get('file_id'))), String(row.get('author_email'))); } catch (err) {
      Logger.log('แชร์ไฟล์ให้ผู้จัดทำไม่สำเร็จ (' + docId + '): ' + err);
    }
    notifyAuthor_(row.get('author_email'), docLabel, newStatus, name, note, coverUrl || viewUrl);
    return { status: newStatus, coverPdfUrl: coverUrl, effectiveDate: formatThaiDate_(effective) };
  }

  throw new Error('เอกสารนี้อยู่ในสถานะ "' + status + '" แล้ว ไม่สามารถลงนามซ้ำได้');
}

/** ตีสถานะฉบับก่อนหน้าของเลขเอกสารเดียวกันเป็น "ยกเลิกใช้" */
function obsoletePrevious_(docCode, keepDocId) {
  const sh = getSheet_(SHEET_NAMES.DOCS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const codeCol = header.indexOf('doc_code');
  const idCol = header.indexOf('doc_id');
  const statusCol = header.indexOf('status');
  const code = String(docCode || '').trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][codeCol] || '').trim().toUpperCase() !== code) continue;
    if (data[i][idCol] === keepDocId) continue;
    if (String(data[i][statusCol]) !== STATUS.APPROVED) continue;
    sh.getRange(i + 1, statusCol + 1).setValue(STATUS.OBSOLETE);
  }
}

// ============================================================
// 6. DRIVE (ไฟล์ต้นฉบับ + ใบปก PDF)
// ============================================================

/** โฟลเดอร์ราก — จำ id ไว้ใน Config เพื่อครั้งต่อไปไม่ต้องค้นชื่อซ้ำ */
function getDriveRoot_() {
  const configId = String(getConfigValue_('drive_root_id', '') || '');
  if (configId) return DriveApp.getFolderById(configId);
  const name = 'คลังเอกสารคุณภาพ (WI Document Control)';
  const it = DriveApp.getFoldersByName(name);
  const root = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  setConfigValue_('drive_root_id', root.getId());
  return root;
}

function getOrCreateChild_(parent, name) {
  const safe = safeFileName_(name) || 'ไม่ระบุ';
  const it = parent.getFoldersByName(safe);
  return it.hasNext() ? it.next() : parent.createFolder(safe);
}

/** โครง Drive: ราก / งาน / ประเภทเอกสาร */
function getDocFolder_(unit, docType) {
  return getOrCreateChild_(getOrCreateChild_(getDriveRoot_(), unit), docTypeLabel_(docType));
}

function shareViewer_(file, email) {
  const addr = String(email || '').trim();
  if (!addr || addr.indexOf('@') === -1) return;
  try { file.addViewer(addr); } catch (err) {
    Logger.log('แชร์ไฟล์ให้ ' + addr + ' ไม่สำเร็จ: ' + err);
  }
}

/** บันทึกไฟล์ต้นฉบับที่อัปโหลด -> คืน File */
function saveSourceFile_(blob, meta) {
  const ext = (function () {
    const m = String(blob.getName() || '').match(/\.[A-Za-z0-9]+$/);
    return m ? m[0] : '';
  })();
  const fileName = safeFileName_(meta.docCode + ' ฉบับที่ ' + meta.editionLabel + ' ' + meta.docTitle) + ext;
  blob.setName(fileName);
  const file = getDocFolder_(meta.unit, meta.docType).createFile(blob);
  file.setDescription(meta.docCode + ' ฉบับที่ ' + meta.editionLabel + ' — ' + meta.docTitle + ' (' + meta.unit + ')');
  return file;
}

/** render ใบปกควบคุมเอกสารเป็น PDF เก็บคู่กับไฟล์ต้นฉบับ -> คืน File */
function saveCoverPdf_(d) {
  const html = buildCoverHtml_(d);
  const fileName = safeFileName_('ใบปกควบคุมเอกสาร ' + d.docCode + ' ฉบับที่ ' + d.editionLabel) + '.pdf';
  const pdf = Utilities.newBlob(html, MimeType.HTML, fileName).getAs(MimeType.PDF).setName(fileName);
  const folder = getDocFolder_(d.unit, d.docType);
  // ฉบับก่อนถูกปฏิเสธแล้วทำใหม่ อาจมีไฟล์ชื่อเดียวกันค้างอยู่
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(pdf);
  file.setDescription('ใบปกควบคุมเอกสาร ' + d.docCode + ' ฉบับที่ ' + d.editionLabel + ' — ' + d.docTitle);
  return file;
}

/** สร้าง HTML ใบปก (ใช้กับตัวแปลง HTML->PDF ของ Apps Script และ render เหมือนกันในหน้าเว็บ) */
function buildCoverHtml_(d) {
  const sigBlock = function (title, name, at, signature, comment) {
    return '<div class="sig">' +
      (comment ? '<div class="sig-note">ความเห็น: ' + htmlEscape_(comment) + '</div>' : '') +
      (signature ? '<img src="' + htmlEscape_(signature) + '" alt="">' : '<div class="sig-blank"></div>') +
      '<div class="sig-line"></div>' +
      '<div class="sig-name">(' + htmlEscape_(name || '.....................') + ')</div>' +
      '<div class="sig-title">' + htmlEscape_(title) + '</div>' +
      '<div class="sig-date">วันที่ ' + htmlEscape_(at || '............') + '</div>' +
      '</div>';
  };

  // ชื่อช่องใช้คำเดียวกับหัวเอกสารจริงของกลุ่มงาน (ฉบับที่ / วันที่ประกาศใช้ / เอกสารควบคุม)
  const rows = [
    ['เลขที่เอกสาร', d.docCode],
    ['ชื่อเอกสาร', d.docTitle],
    ['ประเภทเอกสาร', d.docTypeLabel],
    ['งาน / หน่วยงาน', d.unit],
    ['ฉบับที่', d.editionLabel],
    ['ลักษณะการเปลี่ยนแปลง', d.changeKindLabel || '-'],
    ['ทบทวนครั้งที่', d.reviewCount ? String(d.reviewCount) : '-'],
    ['วันที่จัดทำ', d.createdAt],
    ['วันที่ประกาศใช้', d.effectiveDate],
    ['รอบทบทวน', d.reviewCycleMonths ? (d.reviewCycleMonths + ' เดือน') : '-'],
    ['กำหนดทบทวนครั้งถัดไป', d.nextReviewDate || '-'],
    ['เอกสารฉบับนี้เป็น', (d.controlTypeLabel || 'เอกสารควบคุม') +
      (d.copyNo ? '  สำเนาฉบับที่ ' + d.copyNo : '')],
    ['ไฟล์เอกสารแนบ', d.fileName]
  ].map(function (r) {
    return '<tr><th>' + htmlEscape_(r[0]) + '</th><td>' + htmlEscape_(r[1]) + '</td></tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:"Sarabun","TH SarabunPSK",sans-serif;font-size:14px;color:#1a1a2e;margin:28px}' +
    'h1{font-size:19px;text-align:center;margin:0 0 2px}' +
    '.org{text-align:center;font-size:14px;color:#555;margin-bottom:16px}' +
    'table.meta{width:100%;border-collapse:collapse;margin-bottom:18px}' +
    'table.meta th,table.meta td{border:1px solid #999;padding:6px 10px;text-align:left;vertical-align:top}' +
    'table.meta th{width:34%;background:#f3f4f6;font-weight:600}' +
    '.note{border:1px solid #999;padding:8px 10px;margin-bottom:18px;min-height:46px}' +
    '.note b{display:block;margin-bottom:4px}' +
    '.sigs{display:flex;gap:14px;justify-content:space-between;margin-top:26px}' +
    '.sig{flex:1;text-align:center;font-size:13px}' +
    '.sig img{max-height:70px;max-width:100%;display:block;margin:0 auto 2px}' +
    '.sig-blank{height:70px}' +
    '.sig-line{border-top:1px dotted #333;margin:0 6px 4px}' +
    '.sig-name{font-weight:600}.sig-title{color:#444}.sig-date{color:#666;font-size:12px;margin-top:2px}' +
    '.sig-note{font-size:12px;color:#333;background:#f8f9fa;border:1px solid #ddd;border-radius:4px;' +
    'padding:4px 6px;margin-bottom:6px;text-align:left}' +
    '.foot{margin-top:22px;font-size:11px;color:#777;text-align:center}' +
    '</style></head><body>' +
    (d.orgLine ? '<div class="org">' + htmlEscape_(d.orgLine) + '</div>' : '') +
    '<h1>ใบปกควบคุมเอกสารคุณภาพ</h1>' +
    '<div class="org">Document Control Cover Sheet</div>' +
    '<table class="meta">' + rows + '</table>' +
    '<div class="note"><b>สาระสำคัญของการจัดทำ / แก้ไข' +
    (d.changePages ? ' (หน้าที่ ' + htmlEscape_(d.changePages) + ')' : '') + '</b>' +
    htmlEscape_(d.changeNote || '-') + '</div>' +
    '<div class="sigs">' +
    sigBlock('ผู้จัดทำ', d.authorName, d.authorAt, d.authorSignature, '') +
    sigBlock(d.reviewerTitle || 'ผู้ทบทวน', d.reviewerName, d.reviewerAt, d.reviewerSignature, d.reviewerComment) +
    sigBlock(d.approverTitle || 'ผู้อนุมัติ', d.approverName, d.approverAt, d.approverSignature, d.approverComment) +
    '</div>' +
    '<div class="foot">เอกสารนี้ลงนามด้วยลายเซ็นอิเล็กทรอนิกส์ผ่านระบบควบคุมเอกสารออนไลน์ — ' +
    'ไฟล์ต้นฉบับ: ' + htmlEscape_(d.fileUrl) + '</div>' +
    '</body></html>';
}

/** สร้างใบปกย้อนหลังสำหรับฉบับที่อนุมัติแล้วแต่ยังไม่มีไฟล์ PDF (เช่นตอนอนุมัติ DriveApp ยังไม่ได้ authorize) */
function regenerateCoverPdf(docId) {
  const row = findDocRow_(docId);
  if (!row) throw new Error('ไม่พบเอกสารนี้');
  if (String(row.get('status')) !== STATUS.APPROVED) {
    throw new Error('สร้างใบปกได้เฉพาะเอกสารที่อนุมัติแล้ว');
  }
  const signers = resolveSigners_(row.get('unit'));
  const cover = saveCoverPdf_({
    docCode: row.get('doc_code'), docTitle: row.get('doc_title'),
    docTypeLabel: docTypeLabel_(String(row.get('doc_type'))), docType: row.get('doc_type'),
    unit: row.get('unit'),
    editionLabel: String(row.get('edition_label') || editionLabel_(row.get('edition'), row.get('amendment'))),
    reviewCount: Number(row.get('review_count')) || 0,
    changeKindLabel: changeKindLabel_(String(row.get('change_kind') || '')),
    controlTypeLabel: labelOf_(CONTROL_TYPES, String(row.get('control_type') || 'controlled')),
    copyNo: String(row.get('copy_no') || ''),
    orgLine: String(getConfigValue_('org_line', '') || ''),
    createdAt: formatThaiDate_(row.get('timestamp')),
    effectiveDate: formatThaiDate_(row.get('effective_date')),
    nextReviewDate: formatThaiDate_(row.get('next_review_date')),
    reviewCycleMonths: Number(row.get('review_cycle_months')) || 0,
    changeNote: row.get('change_note'),
    changePages: row.get('change_pages'),
    fileName: row.get('file_name'), fileUrl: row.get('file_url'),
    authorName: row.get('author_name'), authorAt: formatThaiDate_(row.get('author_at')),
    authorSignature: row.get('author_signature'),
    reviewerTitle: signers.reviewerTitle,
    reviewerName: row.get('reviewer_name'), reviewerAt: formatThaiDate_(row.get('reviewer_at')),
    reviewerSignature: row.get('reviewer_signature'), reviewerComment: row.get('reviewer_comment'),
    approverTitle: signers.approverTitle,
    approverName: row.get('approver_name'), approverAt: formatThaiDate_(row.get('approved_at')),
    approverSignature: row.get('approver_signature'), approverComment: row.get('approver_comment')
  });
  row.set('cover_pdf_id', cover.getId());
  row.set('cover_pdf_url', cover.getUrl());
  clearArchiveCache_();
  return { coverPdfUrl: cover.getUrl() };
}

// ============================================================
// 7. CLIENT API — คลังเอกสาร
// ============================================================

/**
 * คลังเอกสาร 3 ระดับ: การ์ดงาน -> หมวดประเภทเอกสาร -> รายการเลขเอกสาร (+ ประวัติ revision)
 * cache 5 นาที (ล้างทุกครั้งที่มีการส่ง/ลงนาม ผ่าน clearArchiveCache_)
 */
function getArchiveData() {
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get('wi_archive_v1');
    if (hit) return JSON.parse(hit);
  } catch (err) { /* cache ใช้ไม่ได้ก็อ่านสดไป */ }

  const data = getSheet_(SHEET_NAMES.DOCS).getDataRange().getValues();
  const units = {};
  if (data.length > 1) {
    const header = data[0];
    const col = function (name) { return header.indexOf(name); };
    for (let i = 1; i < data.length; i++) {
      const unit = String(data[i][col('unit')] || '').trim();
      const code = String(data[i][col('doc_code')] || '').trim();
      if (!unit || !code) continue; // แถวที่ข้อมูลไม่ครบ ไม่ขึ้นในคลัง
      const docType = String(data[i][col('doc_type')] || 'WI');
      if (!units[unit]) units[unit] = { unit: unit, types: {}, total: 0 };
      const u = units[unit];
      if (!u.types[docType]) u.types[docType] = { type: docType, label: docTypeLabel_(docType), docs: {} };
      const bucket = u.types[docType].docs;
      if (!bucket[code]) bucket[code] = { docCode: code, title: '', revisions: [] };
      const rev = {
        docId: data[i][col('doc_id')],
        revision: Number(data[i][col('revision')]) || 0,   // ลำดับภายใน ใช้เรียงเท่านั้น
        editionLabel: String(data[i][col('edition_label')] ||
          editionLabel_(data[i][col('edition')], data[i][col('amendment')])),
        reviewCount: Number(data[i][col('review_count')]) || 0,
        changeKindLabel: changeKindLabel_(String(data[i][col('change_kind')] || '')),
        changePages: String(data[i][col('change_pages')] || ''),
        status: String(data[i][col('status')] || ''),
        title: String(data[i][col('doc_title')] || ''),
        effectiveDate: formatThaiDate_(data[i][col('effective_date')]),
        nextReviewDate: formatThaiDate_(data[i][col('next_review_date')]),
        authorName: String(data[i][col('author_name')] || ''),
        reviewerName: String(data[i][col('reviewer_name')] || ''),
        approverName: String(data[i][col('approver_name')] || ''),
        changeNote: String(data[i][col('change_note')] || ''),
        fileUrl: String(data[i][col('file_url')] || ''),
        coverPdfUrl: String(data[i][col('cover_pdf_url')] || ''),
        updatedAt: formatThaiDate_(data[i][col('approved_at')] || data[i][col('timestamp')])
      };
      bucket[code].revisions.push(rev);
      u.total++;
    }
  }

  // แปลง map -> array เรียงลำดับให้หน้าเว็บใช้ตรง ๆ
  const result = Object.keys(units).sort(function (a, b) { return a.localeCompare(b, 'th'); })
    .map(function (unitName) {
      const u = units[unitName];
      const types = DOC_TYPES.map(function (t) { return u.types[t.value]; })
        .filter(function (t) { return !!t; })
        .map(function (t) {
          const docs = Object.keys(t.docs).sort().map(function (code) {
            const d = t.docs[code];
            d.revisions.sort(function (a, b) { return b.revision - a.revision; });
            const current = d.revisions.filter(function (r) { return r.status === STATUS.APPROVED; })[0] ||
              d.revisions.filter(function (r) { return ACTIVE_STATUSES.indexOf(r.status) > -1; })[0] ||
              d.revisions[0];
            return {
              docCode: d.docCode, title: current.title, current: current,
              revisions: d.revisions, revCount: d.revisions.length
            };
          });
          return { type: t.type, label: t.label, count: docs.length, docs: docs };
        });
      return { unit: unitName, total: u.total, types: types };
    });

  const payload = { units: result, statusLabels: STATUS };
  try { cache.put('wi_archive_v1', JSON.stringify(payload), 300); } catch (err) { /* payload ใหญ่เกิน cache ก็ข้ามไป */ }
  return payload;
}

/** รายการที่ใกล้ถึงกำหนดทบทวน (ใช้เตือนก่อน ISO audit) */
function getDueForReview(daysAhead) {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + (Number(daysAhead) || 90));
  const data = getSheet_(SHEET_NAMES.DOCS).getDataRange().getValues();
  if (data.length < 2) return [];
  const header = data[0];
  const col = function (name) { return header.indexOf(name); };
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col('status')]) !== STATUS.APPROVED) continue;
    const next = data[i][col('next_review_date')];
    if (!next) continue;
    const dt = (next instanceof Date) ? next : new Date(next);
    if (isNaN(dt.getTime()) || dt > horizon) continue;
    out.push({
      docCode: String(data[i][col('doc_code')]),
      docTitle: String(data[i][col('doc_title')]),
      unit: String(data[i][col('unit')]),
      editionLabel: String(data[i][col('edition_label')] ||
        editionLabel_(data[i][col('edition')], data[i][col('amendment')])),
      nextReviewDate: formatThaiDate_(dt),
      overdue: dt < new Date()
    });
  }
  out.sort(function (a, b) { return a.nextReviewDate < b.nextReviewDate ? -1 : 1; });
  return out;
}

// ============================================================
// 8. HTML PARTIALS
// ============================================================

/** ใช้ใน template: <?!= include('Styles') ?> — แชร์ CSS / signature pad ระหว่างหน้า */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
