/**
 * ============================================================
 * ทะเบียนเอกสาร — ออกรหัสอัตโนมัติ · ขึ้นทะเบียนเอกสารเดิม · Master List
 * ============================================================
 * เพิ่ม 2026-10-31 ตามตัวอย่างระบบที่ผู้ใช้ส่งมา ใช้แท็บ Documents เดิมของ WI (1 แถว = 1 ฉบับ)
 *
 * รหัสเอกสาร 3 ส่วน <ชนิด>-<รหัสงาน>-<ลำดับ> เช่น WI-MB-08
 *   ชนิด = DOC_TYPES · รหัสงาน = คอลัมน์ unit_code ในแท็บ Units
 *   ลำดับนับแยกตามชนิด + งาน (WI-MB-08 แล้ว SP ฉบับแรกของงานเดียวกันได้ SP-MB-01) อย่างน้อย 2 หลัก
 *
 * ฟังก์ชันที่หน้าเว็บเรียกรับ session ของระบบงานเอกสาร (Auth.gs) เป็นตัวแรก แล้วตรวจสิทธิ์เอง
 */

const DOC_CODE_DIGITS = 2;

/** ข้อความในช่องสาระการแก้ไขของเอกสารที่ขึ้นทะเบียนจากฉบับกระดาษ */
const REGISTER_NOTE = 'ขึ้นทะเบียนเอกสารที่ประกาศใช้แล้ว (ลงนามบนกระดาษ)';

/** ทำงานทีละคำขอ — ออกรหัสกับบันทึกแถวต้องอยู่ใน lock เดียวกัน ไม่งั้นสองคนได้เลขเดียวกัน */
function withDocLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * อ่านแท็บ Documents เฉพาะคอลัมน์ที่ต้องใช้ ทีละคอลัมน์
 * ไม่ใช้ getDataRange เพราะคอลัมน์ลายเซ็นเป็น data URL ช่องละหลายหมื่นตัวอักษร
 */
function readDocColumns_(names) {
  const sh = getSheet_(SHEET_NAMES.DOCS);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const cols = names.map(function (name) {
    const c = header.indexOf(name);
    return c > -1 ? sh.getRange(2, c + 1, n, 1).getValues() : null;
  });
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = {};
    names.forEach(function (name, j) { r[name] = cols[j] ? cols[j][i][0] : ''; });
    rows.push(r);
  }
  return rows;
}

/**
 * รหัสถัดไปของชนิด + งาน — นับจากทุกแถวในแท็บ Documents (รวมฉบับที่ถูกตีกลับและยกเลิกใช้)
 * เลขที่เคยใช้แล้วจึงไม่ถูกนำกลับมาใช้ซ้ำ แม้เอกสารนั้นจะยกเลิกไปแล้ว
 */
function nextDocCode_(docType, unit) {
  if (!DOC_TYPES.some(function (t) { return t.value === docType; })) throw new Error('ประเภทเอกสารไม่ถูกต้อง');
  if (!unit) throw new Error('กรุณาเลือกงาน/หน่วยงาน');
  const u = getUnitMap_()[unit];
  if (!u || !u.unitCode) {
    throw new Error('งาน "' + unit + '" ยังไม่ได้ตั้งรหัสงาน — ใส่รหัส (เช่น MB) ในคอลัมน์ unit_code ' +
      'ของแท็บ Units ในชีต WI Document Control');
  }
  const prefix = docType + '-' + u.unitCode + '-';
  let max = 0;
  readDocColumns_(['doc_code']).forEach(function (r) {
    const code = String(r.doc_code || '').trim().toUpperCase();
    if (code.indexOf(prefix) !== 0) return;
    const seq = code.slice(prefix.length);
    if (/^\d+$/.test(seq)) max = Math.max(max, Number(seq));
  });
  return prefix + String(max + 1).padStart(DOC_CODE_DIGITS, '0');
}

/** ปรับแท็บ Units ตาม UNIT_LIST ครั้งเดียวต่อระบบ — หลังจากนั้นแก้ในชีตได้อิสระ ระบบไม่เขียนทับอีก */
function syncUnitsOnce_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('WI_UNITS_SYNCED')) return;
  try {
    syncUnits_();
    props.setProperty('WI_UNITS_SYNCED', new Date().toISOString());
  } catch (err) {
    Logger.log('ปรับรายชื่องานในแท็บ Units ไม่สำเร็จ: ' + err);
  }
}

/**
 * ทำให้แท็บ Units มีงานครบตาม UNIT_LIST โดยไม่ทิ้งค่าที่คนกรอกไว้
 * - งานที่มีอยู่แล้ว (ชื่อตรง หรือชื่อเดิม renamedFrom) → เปลี่ยนชื่อ + เติมรหัสงานถ้ายังว่าง เก็บอีเมล/ตำแหน่งเดิม
 * - งานที่ยังไม่มี → เพิ่มแถว ใช้ตำแหน่งผู้อนุมัติร่วมถ้าทุกงานใช้ตำแหน่งเดียวกันอยู่แล้ว
 * - งานใน RETIRED_UNITS → ลบ ถ้ายังไม่มีเอกสารหรือใบขออนุมัติอ้างถึง
 */
function syncUnits_() {
  const sh = ensureColumns_(SHEET_NAMES.UNITS, UNIT_COLUMNS);
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const col = function (name) { return header.indexOf(name); };
  const nameAt = function (i) { return String(data[i][col('unit')] || '').trim(); };

  const used = {};
  [SHEET_NAMES.DOCS, SHEET_NAMES.DOC_REQUESTS].forEach(function (name) {
    try {
      readTable_(name).forEach(function (r) { used[String(r.unit || '').trim()] = true; });
    } catch (err) { /* ยังไม่มีแท็บนี้ */ }
  });
  const titles = {};
  for (let i = 1; i < data.length; i++) {
    const t = String(data[i][col('approver_title')] || '').trim();
    if (t) titles[t] = true;
  }
  const sharedTitle = Object.keys(titles).length === 1 ? Object.keys(titles)[0] : '';
  const findRow = function (name) {
    for (let i = 1; i < data.length; i++) if (nameAt(i) === name) return i;
    return -1;
  };

  UNIT_LIST.forEach(function (spec) {
    let i = findRow(spec.unit);
    if (i < 0 && spec.renamedFrom && !used[spec.renamedFrom]) {
      i = findRow(spec.renamedFrom);
      if (i > -1) {
        sh.getRange(i + 1, col('unit') + 1).setValue(spec.unit);
        data[i][col('unit')] = spec.unit;
      }
    }
    if (i < 0) {
      const line = header.map(function (h) {
        if (h === 'unit') return spec.unit;
        if (h === 'unit_code') return spec.code;
        return h === 'approver_title' ? sharedTitle : '';
      });
      sh.appendRow(line);
      data.push(line);
    } else if (spec.code && !String(data[i][col('unit_code')] || '').trim()) {
      sh.getRange(i + 1, col('unit_code') + 1).setValue(spec.code);
    }
  });

  // ลบจากล่างขึ้นบน เลขแถวที่เหลือจะได้ไม่เลื่อน
  for (let i = data.length - 1; i >= 1; i--) {
    if (RETIRED_UNITS.indexOf(nameAt(i)) > -1 && !used[nameAt(i)]) sh.deleteRow(i + 1);
  }
}

/** หน้าส่งเอกสาร: ตัวอย่างรหัสที่เอกสารใหม่จะได้ (รหัสจริงออกตอนส่ง) */
function getNextDocCode(token, docType, unit) {
  requireLevel_(token, itemLevel_(wiItem_('upload')));
  return nextDocCode_(String(docType || '').trim(), String(unit || '').trim());
}

/** วันครบกำหนดทบทวน (yyyy-MM-dd) — คิดแบบเดียวกับตอนอนุมัติใน signDocument() */
function nextReviewDate_(effective, cycleMonths) {
  if (!(cycleMonths > 0)) return '';
  const base = new Date(effective);
  if (isNaN(base.getTime())) return '';
  base.setMonth(base.getMonth() + cycleMonths);
  return Utilities.formatDate(base, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * ขึ้นทะเบียนเอกสารที่ประกาศใช้แล้วบนกระดาษ (เฉพาะ QMR / ผู้ดูแลระบบ)
 * บันทึกเป็นฉบับ "อนุมัติแล้ว" ทันทีโดยไม่ผ่านการลงนามในระบบ — ลายมือชื่ออยู่บนต้นฉบับกระดาษ
 * จึงไม่สร้างใบปก · ใช้รหัสเดิมที่พิมพ์บนเอกสาร (ไม่ออกรหัสใหม่) แต่ต้องขึ้นต้นด้วยชนิดที่เลือก
 * payload: { docCode, docTitle, docType, unit, edition, amendment, effectiveDate (yyyy-MM-dd),
 *            reviewCycleMonths, controlType, copyNo, changeNote, file: { name, mime, dataBase64 } }
 */
function registerExistingDocument(token, payload) {
  const user = requireDuty_(token, 'qmr');
  const p = payload || {};
  const docCode = String(p.docCode || '').trim().toUpperCase();
  const docTitle = String(p.docTitle || '').trim();
  const docType = String(p.docType || '').trim();
  const unit = String(p.unit || '').trim();
  const edition = String(p.edition || '').trim();
  const amendment = Math.max(0, Math.floor(Number(p.amendment) || 0));
  const effective = String(p.effectiveDate || '').trim();

  if (!DOC_TYPES.some(function (t) { return t.value === docType; })) throw new Error('ประเภทเอกสารไม่ถูกต้อง');
  if (!/^[A-Z]{2,4}-[A-Z0-9]{2,8}-\d{1,3}$/.test(docCode)) {
    throw new Error('รหัสเอกสารต้องมี 3 ส่วน <ชนิด>-<งาน>-<ลำดับ> เช่น WI-MB-08');
  }
  if (docCode.split('-')[0] !== docType) {
    throw new Error('รหัสเอกสาร ' + docCode + ' ไม่ได้ขึ้นต้นด้วยชนิดที่เลือก (' + docType + ')');
  }
  if (!docTitle) throw new Error('กรุณากรอกชื่อเอกสาร');
  if (!unit) throw new Error('กรุณาเลือกงาน/หน่วยงาน');
  if (!edition) throw new Error('กรุณาระบุฉบับที่ตามที่พิมพ์บนเอกสาร');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) throw new Error('กรุณาระบุวันที่ประกาศใช้');

  const file = p.file || {};
  if (!file.dataBase64) throw new Error('กรุณาแนบไฟล์เอกสาร (สแกนจากต้นฉบับ หรือไฟล์ต้นฉบับ)');
  if (ALLOWED_MIME.indexOf(String(file.mime)) === -1) {
    throw new Error('ชนิดไฟล์ไม่รองรับ (รับ PDF / Word / Excel / PowerPoint / รูปภาพ)');
  }
  const editionLabel = editionLabel_(edition, amendment);
  const blob = Utilities.newBlob(Utilities.base64Decode(file.dataBase64), file.mime,
    safeFileName_(file.name) || (docCode + ' ฉบับที่ ' + editionLabel));
  if (blob.getBytes().length / (1024 * 1024) > MAX_FILE_MB) throw new Error('ไฟล์ใหญ่เกิน ' + MAX_FILE_MB + ' MB');

  const cycle = Number(p.reviewCycleMonths) || Number(getConfigValue_('default_review_cycle_months', 24)) || 24;
  const nextReview = nextReviewDate_(effective, cycle);
  const docId = Utilities.getUuid();

  withDocLock_(function () {
    if (getDocsByCode_(docCode).length) {
      throw new Error(docCode + ' มีในระบบแล้ว — ถ้าจะแก้ไขหรือทบทวน ใช้หน้าส่งเอกสาร');
    }
    ensureColumns_(SHEET_NAMES.DOCS, DOC_COLUMNS);
    const stored = saveSourceFile_(blob, {
      unit: unit, docType: docType, docCode: docCode, editionLabel: editionLabel, docTitle: docTitle
    });
    const now = new Date();
    const rowByName = {
      doc_id: docId, timestamp: now, doc_code: docCode, doc_title: docTitle,
      doc_type: docType, unit: unit, revision: 0,
      edition: edition, amendment: amendment, review_count: 0,
      edition_label: editionLabel, change_kind: '',
      effective_date: effective, review_cycle_months: cycle, next_review_date: nextReview,
      control_type: CONTROL_TYPES.some(function (c) { return c.value === p.controlType; })
        ? String(p.controlType) : 'controlled',
      copy_no: String(p.copyNo || '').trim(),
      change_note: (String(p.changeNote || '').trim() || REGISTER_NOTE).slice(0, 1000),
      file_id: stored.getId(), file_url: stored.getUrl(),
      file_name: stored.getName(), file_mime: file.mime,
      status: STATUS.APPROVED,
      registered_by: String(user.name || user.username), registered_at: now
    };
    const sh = getSheet_(SHEET_NAMES.DOCS);
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.appendRow(header.map(function (name) {
      return rowByName.hasOwnProperty(name) ? rowByName[name] : '';
    }));
  });
  clearArchiveCache_();

  // ดึงข้อความจากไฟล์ให้ค้นได้ — นอก lock เพราะแปลงไฟล์ใช้เวลา และพังก็ไม่ควรทำให้ขึ้นทะเบียนล้ม
  try { indexDocument_(docId); } catch (err) {
    Logger.log('ทำ index เนื้อหาไม่สำเร็จ (' + docId + '): ' + err);
  }
  return { docId: docId, docCode: docCode, editionLabel: editionLabel, nextReviewDate: formatThaiDate_(nextReview) };
}

/**
 * ทะเบียนเอกสารควบคุม (Master List) — 1 แถวต่อ 1 รหัสเอกสาร
 *   ใช้งาน = มีฉบับ "อนุมัติแล้ว" · ยกเลิก = ทุกฉบับถูกยกเลิกใช้ (แสดงฉบับสุดท้าย)
 *   รหัสที่ยังไม่เคยอนุมัติ (รอลงนาม / ถูกตีกลับ) ยังไม่ใช่เอกสารควบคุม จึงไม่ขึ้นในทะเบียน
 */
function getMasterList(token) {
  requireLevel_(token, itemLevel_(wiItem_('masterlist')));
  const rows = readDocColumns_(['doc_code', 'doc_title', 'doc_type', 'unit', 'revision', 'edition',
    'amendment', 'effective_date', 'next_review_date', 'status', 'file_url']);
  const byCode = {};
  rows.forEach(function (r) {
    const code = String(r.doc_code || '').trim().toUpperCase();
    if (!code || !String(r.unit || '').trim()) return;   // แถวข้อมูลไม่ครบ (เหมือนหน้าคลัง)
    (byCode[code] = byCode[code] || []).push(r);
  });

  const docs = [];
  Object.keys(byCode).forEach(function (code) {
    const revs = byCode[code].sort(function (a, b) { return (Number(b.revision) || 0) - (Number(a.revision) || 0); });
    const statusOf = function (r) { return String(r.status || ''); };
    const current = revs.filter(function (r) { return statusOf(r) === STATUS.APPROVED; })[0];
    const last = current || revs.filter(function (r) { return statusOf(r) === STATUS.OBSOLETE; })[0];
    if (!last) return;
    docs.push({
      docCode: code,
      title: String(last.doc_title || ''),
      docType: String(last.doc_type || ''),
      unit: String(last.unit || '').trim(),
      edition: String(last.edition || ''),
      amendment: Number(last.amendment) || 0,
      effectiveDate: formatThaiDate_(last.effective_date),
      nextReviewDate: current ? formatThaiDate_(last.next_review_date) : '',
      active: !!current,
      pending: revs.some(function (r) {
        return statusOf(r) === STATUS.WAIT_REVIEW || statusOf(r) === STATUS.WAIT_APPROVE;
      }),
      fileUrl: String(last.file_url || '')
    });
  });
  docs.sort(function (a, b) { return a.docCode.localeCompare(b.docCode, 'en', { numeric: true }); });

  const app = appInfo_();
  return {
    docs: docs,
    docTypes: DOC_TYPES,
    units: Object.keys(getUnitMap_()).sort(function (a, b) { return a.localeCompare(b, 'th'); }),
    org: app.org,     // หัวกระดาษตอนพิมพ์ ใช้ชื่อหน่วยงานและโลโก้ของระบบงานเอกสาร (หน้าตั้งค่าระบบ)
    logo: app.logo,
    printedAt: formatThaiDate_(new Date())
  };
}
