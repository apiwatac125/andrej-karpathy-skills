/**
 * แชทบอทค้นเอกสารในคลัง — ค้นเฉพาะคลังของระบบที่ผู้ใช้มีสิทธิ์เปิดเมนูคลังนั้น
 *
 * คลังระบบจัดซื้อ (SP-MT-07): อ่านแท็บ Submissions (แบบคัดเลือก) และ Summaries (แบบสรุปผลการประเมิน
 * ประจำปี) จากสเปรดชีตของ SP-MT-07 ตรงๆ แบบอ่านอย่างเดียว ตามชื่อคอลัมน์ใน SUBMISSION_COLUMNS /
 * SUMMARY_COLUMNS ของระบบนั้น — ระบบแยกโปรเจกต์กันจึงเรียกฟังก์ชันของกันและกันไม่ได้
 *   SPMT07_SHEET_ID  id สเปรดชีต "SP-MT-07 Selection Submissions" (บัญชีที่ deploy ต้องเปิดได้)
 *   SPMT07_APP_URL   URL เว็บแอป SP-MT-07 ใช้ทำลิงก์เปิดเอกสาร (ตัวเดียวกับเมนู)
 * คลัง WI, SP, SOP: ยังไม่ได้เชื่อม — ต้องมีโค้ดระบบ WI ก่อน
 */

var SEARCH_LIMIT = 8;

// ชื่อประเภทการประเมิน ตาม SUMMARY_EVAL_TYPES ใน Code.gs ของ SP-MT-07
var SPMT07_EVAL_TYPES = {
  vendor: 'ผู้ขายและผลิตภัณฑ์',
  referral: 'Out lab / Referral Lab',
  calibration: 'สอบเทียบเครื่องมือ'
};

var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** ทุกคำ (คั่นด้วยช่องว่าง ยาว 2 ตัวขึ้นไป) ต้องเจอในเอกสาร — คืนผลที่ตรงที่สุดก่อน */
function searchDocs(token, query) {
  var u = session_(token);
  var level = roleOf_(u.role).level;
  var terms = String(query || '').toLowerCase().split(/\s+/).filter(function (t) { return t.length >= 2; });
  if (!terms.length) return { query: query, tooShort: true };

  var hits = [];
  var sources = [];   // คลังที่ค้นแล้ว
  var missing = [];   // คลังที่มีสิทธิ์แต่ยังไม่ได้ตั้งค่า

  var spmt = findItem_('spmt-archive');
  if (spmt && level >= spmt.minLevel) {
    if (PropertiesService.getScriptProperties().getProperty('SPMT07_SHEET_ID')) {
      hits = hits.concat(searchSpmt07_(terms));
      sources.push('คลังเอกสารระบบจัดซื้อ');
    } else {
      missing.push('คลังเอกสารระบบจัดซื้อ');
    }
  }

  hits.sort(function (a, b) { return b.score - a.score || b.time - a.time; });
  return {
    query: query, terms: terms, total: hits.length, sources: sources, missing: missing,
    hits: hits.slice(0, SEARCH_LIMIT)
  };
}

function searchSpmt07_(terms) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SPMT07_SHEET_ID'));
  var app = props.getProperty('SPMT07_APP_URL') || '';
  var out = [];

  readColumns_(ss.getSheetByName('Submissions'), ['submission_id', 'timestamp', 'unit', 'form_label',
    'product_offered', 'companies_json', 'winner', 'status', 'token']).forEach(function (r) {
    var names = companyNames_(r.companies_json);
    var title = String(r.product_offered || r.form_label);
    var unit = unitDisplay_(r.unit);
    var date = thaiDate_(r.timestamp);
    var score = match_(terms, title, ['แบบคัดเลือก', r.form_label, r.unit, unit, r.winner, r.status, date].concat(names));
    if (!score) return;
    out.push({
      kind: 'แบบคัดเลือก', title: title,
      meta: [r.form_label, unit, date].filter(String).join(' · '),
      detail: r.winner ? 'ผู้ได้รับคัดเลือก: ' + r.winner : '',
      companies: matchedNames_(terms, names), status: String(r.status),
      links: app ? [{ label: 'เปิดเอกสาร', url: app + '?page=approve&id=' + encodeURIComponent(r.submission_id) +
        '&token=' + encodeURIComponent(r.token) }] : [],
      score: score, time: timeOf_(r.timestamp)
    });
  });

  readColumns_(ss.getSheetByName('Summaries'), ['summary_id', 'created_at', 'eval_type', 'unit', 'unit_display',
    'year_label', 'companies_json', 'total_count', 'pass_count', 'status', 'pdf_url', 'token']).forEach(function (r) {
    var names = companyNames_(r.companies_json);
    var title = 'สรุปผลการประเมินประจำปี ' + r.year_label + ' — ' + (SPMT07_EVAL_TYPES[r.eval_type] || SPMT07_EVAL_TYPES.vendor);
    var unit = String(r.unit_display || unitDisplay_(r.unit));
    var score = match_(terms, title, ['แบบสรุป', unit, r.unit, r.status].concat(names));
    if (!score) return;
    var links = [];
    if (app) {
      links.push({ label: 'เปิดเอกสาร', url: app + '?page=summary-approve&id=' + encodeURIComponent(r.summary_id) +
        '&token=' + encodeURIComponent(r.token) });
    }
    if (r.pdf_url) links.push({ label: 'PDF', url: String(r.pdf_url) });
    out.push({
      kind: 'แบบสรุปผลการประเมิน', title: title, meta: unit,
      detail: 'ผ่าน ' + Number(r.pass_count || 0) + ' จาก ' + Number(r.total_count || 0) + ' บริษัท',
      companies: matchedNames_(terms, names), status: String(r.status),
      links: links, score: score, time: timeOf_(r.created_at)
    });
  });
  return out;
}

/** อ่านเฉพาะคอลัมน์ที่ต้องใช้ทีละคอลัมน์ — แท็บของ SP-MT-07 มีรูปลายเซ็นขนาดใหญ่ ไม่อ่านทั้งแผ่น */
function readColumns_(sh, names) {
  if (!sh || sh.getLastRow() < 2) return [];
  var n = sh.getLastRow() - 1;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var cols = {};
  names.forEach(function (name) {
    var i = head.indexOf(name);
    cols[name] = i > -1 ? sh.getRange(2, i + 1, n, 1).getValues() : null;
  });
  var rows = [];
  for (var r = 0; r < n; r++) {
    var row = {};
    names.forEach(function (name) { row[name] = cols[name] ? cols[name][r][0] : ''; });
    rows.push(row);
  }
  return rows;
}

/** คะแนนความตรง: คำที่เจอในชื่อเอกสารได้ 3 ที่อื่นได้ 1 — มีคำไหนไม่เจอเลย = 0 */
function match_(terms, title, fields) {
  var t = String(title).toLowerCase();
  var rest = fields.map(String).join(' ').toLowerCase();
  var score = 0;
  for (var i = 0; i < terms.length; i++) {
    if (t.indexOf(terms[i]) > -1) score += 3;
    else if (rest.indexOf(terms[i]) > -1) score += 1;
    else return 0;
  }
  return score;
}

function companyNames_(json) {
  try {
    return (JSON.parse(json) || []).map(function (c) { return String(c.name || ''); }).filter(String);
  } catch (e) {
    return [];
  }
}

/** ชื่อบริษัทที่มีคำค้น — แสดงให้เห็นว่าเอกสารนี้ตรงเพราะบริษัทไหน */
function matchedNames_(terms, names) {
  return names.filter(function (name) {
    var low = name.toLowerCase();
    return terms.some(function (t) { return low.indexOf(t) > -1; });
  }).slice(0, 3);
}

// SP-MT-07 เก็บหน่วยงานเป็น "ห้อง..." และแสดงเป็น "งาน..."
function unitDisplay_(unit) { return String(unit || '').replace(/^ห้อง/, 'งาน'); }

function thaiDate_(v) {
  if (!(v instanceof Date)) return String(v || '');
  return v.getDate() + ' ' + THAI_MONTHS[v.getMonth()] + ' ' + (v.getFullYear() + 543);
}

function timeOf_(v) { return v instanceof Date ? v.getTime() : 0; }
