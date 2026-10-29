/**
 * Helper กลางที่ใช้ร่วมกันระหว่างโมดูล (DocRequest.gs, AuditCapa.gs)
 * ---------------------------------------------------------------------------
 * GAS มองทุกไฟล์ .gs เป็น global scope เดียวกัน จึงแยกไฟล์ได้โดยเรียกข้ามกันตรง ๆ
 * ไฟล์นี้ต้องไม่อ้างถึงแท็บหรือค่าคงที่ของโมดูลใดโมดูลหนึ่ง — เอาไปวางในโปรเจกต์ที่มี
 * เฉพาะโมดูลเอกสาร (v1.1) ได้โดยไม่ต้องแก้
 *
 * helper ของเอกสารโดยเฉพาะ (getSheet_, validateSignature_, formatThaiDate_ ฯลฯ) อยู่ใน Code.gs
 */

/** อ่านทั้งแท็บเป็น array ของ object (คีย์ = ชื่อคอลัมน์) ข้ามแถวที่ว่างทั้งแถว */
function readTable_(sheetName) {
  const data = getSheet_(sheetName).getDataRange().getValues();
  if (data.length < 2) return [];
  const header = data[0];
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const o = {};
    let empty = true;
    for (let c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      o[header[c]] = data[i][c];
      if (data[i][c] !== '' && data[i][c] !== null) empty = false;
    }
    if (empty) continue;
    o._row = i + 1;
    out.push(o);
  }
  return out;
}

/** หา 1 แถวตาม id — คืน accessor get/set/toObject ตามชื่อคอลัมน์ */
function findRowById_(sheetName, idColumn, idValue) {
  const sh = getSheet_(sheetName);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const idCol = header.indexOf(idColumn);
  if (idCol === -1) return null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] !== idValue) continue;
    const row = data[i];
    const rowNum = i + 1;
    return {
      sheet: sh, rowNum: rowNum, header: header,
      get: function (name) {
        const c = header.indexOf(name);
        return c > -1 ? row[c] : '';
      },
      set: function (name, value) {
        const c = header.indexOf(name);
        if (c > -1) sh.getRange(rowNum, c + 1).setValue(value);
      },
      toObject: function () {
        const o = {};
        for (let c = 0; c < header.length; c++) if (header[c]) o[header[c]] = row[c];
        return o;
      }
    };
  }
  return null;
}

/** เขียนแถวใหม่โดยจับคู่ตามชื่อคอลัมน์ (ลำดับคอลัมน์ในชีทไม่สำคัญ) */
function appendByName_(sheetName, rowByName) {
  const sh = getSheet_(sheetName);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(header.map(function (name) {
    return rowByName.hasOwnProperty(name) ? rowByName[name] : '';
  }));
}

/** สร้างแท็บ + เติมคอลัมน์ที่ขาดให้ครบ (idempotent — เรียกซ้ำได้) */
function ensureSheet_(ss, name, columns) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(columns);
    sh.setFrozenRows(1);
    return sh;
  }
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  columns.forEach(function (c) {
    if (header.indexOf(c) === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue(c);
  });
  return sh;
}

/** เติมคีย์ Config ที่ยังไม่มี (ไม่ทับค่าที่ผู้ใช้ตั้งไว้แล้ว) */
function ensureConfigKeys_(ss, pairs) {
  const cfg = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!cfg) return;
  if (cfg.getLastRow() === 0) cfg.appendRow(['key', 'value']);
  const keys = cfg.getDataRange().getValues().map(function (r) { return r[0]; });
  pairs.forEach(function (p) {
    if (keys.indexOf(p[0]) === -1) cfg.appendRow(p);
  });
}

function thaiYear_() {
  return new Date().getFullYear() + 543;
}

/** เลขที่ถัดไปในชุดเดียวกัน เช่น DAR-2569-003 — คำนวณจากแถวที่มีอยู่ ไม่เก็บ counter แยก */
function nextSerial_(sheetName, column, prefix, width) {
  const head = prefix + '-' + thaiYear_() + '-';
  let max = 0;
  readTable_(sheetName).forEach(function (r) {
    const v = String(r[column] || '');
    if (v.indexOf(head) !== 0) return;
    const n = parseInt(v.slice(head.length), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  let s = String(max + 1);
  while (s.length < (width || 2)) s = '0' + s;
  return head + s;
}

function labelOf_(list, value) {
  for (let i = 0; i < list.length; i++) if (list[i].value === value) return list[i].label;
  return value || '-';
}

function toIsoDate_(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function addDaysIso_(days) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(days) || 0));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** เกินกำหนดไหม (เทียบวันนี้แบบไม่สนเวลา) */
function isOverdue_(dateValue) {
  if (!dateValue) return false;
  const dt = (dateValue instanceof Date) ? dateValue : new Date(dateValue);
  if (isNaN(dt.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dt < today;
}

/** บล็อกลายเซ็นสำหรับ HTML ที่จะแปลงเป็น PDF */
function sigHtml_(role, name, at, signature, comment) {
  return '<div class="sig">' +
    (comment ? '<div class="sig-note">ความเห็น: ' + htmlEscape_(comment) + '</div>' : '') +
    (signature ? '<img src="' + htmlEscape_(signature) + '" alt="">' : '<div class="sig-blank"></div>') +
    '<div class="sig-line"></div>' +
    '<div class="sig-name">(' + htmlEscape_(name || '.....................') + ')</div>' +
    '<div class="sig-title">' + htmlEscape_(role) + '</div>' +
    '<div class="sig-date">วันที่ ' + htmlEscape_(at || '............') + '</div>' +
    '</div>';
}

/** CSS กลางของเอกสาร PDF ทุกชนิดในระบบ */
function pdfCss_() {
  return 'body{font-family:"Sarabun","TH SarabunPSK",sans-serif;font-size:14px;color:#1a1a2e;margin:28px}' +
    'h1{font-size:19px;text-align:center;margin:0 0 2px}' +
    '.org{text-align:center;font-size:14px;color:#555;margin-bottom:16px}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:14px}' +
    'th,td{border:1px solid #999;padding:6px 9px;text-align:left;vertical-align:top}' +
    'table.meta th{width:30%;background:#f3f4f6;font-weight:600}' +
    'table.list th{background:#f3f4f6;font-weight:600}' +
    '.block{border:1px solid #999;padding:8px 10px;margin-bottom:12px}' +
    '.block b{display:block;margin-bottom:4px}' +
    '.sigs{display:flex;gap:14px;justify-content:space-between;margin-top:24px}' +
    '.sig{flex:1;text-align:center;font-size:13px}' +
    '.sig img{max-height:70px;max-width:100%;display:block;margin:0 auto 2px}' +
    '.sig-blank{height:70px}' +
    '.sig-line{border-top:1px dotted #333;margin:0 6px 4px}' +
    '.sig-name{font-weight:600}.sig-title{color:#444}.sig-date{color:#666;font-size:12px}' +
    '.sig-note{font-size:12px;background:#f8f9fa;border:1px solid #ddd;border-radius:4px;' +
    'padding:4px 6px;margin-bottom:6px;text-align:left}' +
    '.foot{margin-top:20px;font-size:11px;color:#777;text-align:center}';
}
