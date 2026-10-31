/**
 * โมดูล DAR — Document Approval Request (ใบขออนุมัติจัดทำ / แก้ไข / ยกเลิกเอกสาร)
 * ---------------------------------------------------------------------------
 * เติมขั้นที่หายไปหน้าโมดูลเอกสาร: เดิมระบบเริ่มที่ "อัปโหลดไฟล์ที่ร่างเสร็จแล้ว"
 * ซึ่งแปลว่าผู้จัดทำลงแรงร่างก่อน แล้วค่อยรู้ตอนทบทวนว่าไม่ควรแก้ตั้งแต่แรก
 *
 *   DAR (ขออนุญาต + ประเมินผลกระทบ) → ร่าง+อัปโหลด → ทบทวน → อนุมัติ → บังคับใช้
 *
 * ไฟล์นี้พึ่งพาแค่ Code.gs + Common.gs จึงใช้ได้ทั้งโปรเจกต์ที่มีเฉพาะโมดูลเอกสาร (v1.1)
 * และโปรเจกต์ที่มี Audit/CAPA ด้วย (v2.1) — ส่วนที่ผูกกับ CAPA ตรวจด้วย typeof ก่อนเรียกเสมอ
 */

// ============================================================
// 1. CONFIG ของโมดูล
// ============================================================

const DAR_TYPES = [
  { value: 'new', label: 'จัดทำเอกสารใหม่', needsExisting: false },
  { value: 'revise', label: 'แก้ไขเอกสาร (ออกฉบับใหม่)', needsExisting: true },
  { value: 'withdraw', label: 'ยกเลิกเอกสาร (ไม่มีฉบับใหม่มาแทน)', needsExisting: true }
];

const DAR_STATUS = {
  WAIT: 'รออนุมัติคำขอ',
  APPROVED: 'อนุมัติให้ดำเนินการ',
  REJECTED: 'ไม่อนุมัติคำขอ',
  DONE: 'ดำเนินการแล้ว',
  CANCELLED: 'ยกเลิกคำขอ'
};

/** แหล่งที่มาของคำขอ — ตัวเลือก CAPA จะโผล่เฉพาะโปรเจกต์ที่มีโมดูล CAPA */
function darSources_() {
  const list = [
    { value: 'routine', label: 'ทบทวนตามรอบที่กำหนด' },
    { value: 'external', label: 'มาตรฐาน/เอกสารอ้างอิงภายนอกเปลี่ยน' },
    { value: 'new_test', label: 'เปิดรายการตรวจ/เครื่องมือใหม่' },
    { value: 'complaint', label: 'ข้อร้องเรียนจากผู้ใช้บริการ' },
    { value: 'process', label: 'ปรับกระบวนการทำงานภายใน' },
    { value: 'other', label: 'อื่น ๆ' }
  ];
  if (SHEET_NAMES.CAPAS) list.splice(1, 0, { value: 'capa', label: 'ผลจาก CAPA (การแก้ไขและป้องกัน)' });
  return list;
}

const DAR_COLUMNS = [
  'dar_id', 'dar_no', 'request_type', 'source', 'capa_id', 'capa_no',
  'doc_code', 'doc_title', 'doc_type', 'unit', 'reason',
  'impact_training', 'impact_docs', 'impact_results', 'impact_note',
  'requester_name', 'requester_email', 'requested_at',
  'status', 'approver_name', 'approved_at', 'approver_signature', 'approver_comment',
  'resulting_doc_id', 'resulting_doc_code', 'resulting_edition',
  'pdf_id', 'pdf_url', 'closed_at', 'token'
];

// ============================================================
// 2. SETUP + helper
// ============================================================

function ensureDarSetup_() {
  const ss = getSS_();
  ensureSheet_(ss, SHEET_NAMES.DOC_REQUESTS, DAR_COLUMNS);
  ensureConfigKeys_(ss, [
    // TRUE = ส่งเอกสารเข้าระบบไม่ได้ถ้าไม่มี DAR ที่อนุมัติแล้ว (ค่าตั้งต้น FALSE เพื่อให้ทยอยปรับตัว)
    ['require_dar', 'FALSE'],
    ['dar_approver_title', 'ผู้อนุมัติคำขอ']
  ]);
}

function darTypeDef_(value) {
  for (let i = 0; i < DAR_TYPES.length; i++) if (DAR_TYPES[i].value === value) return DAR_TYPES[i];
  return DAR_TYPES[0];
}

/**
 * ใครเป็นคนอนุมัติคำขอ
 * v2.x มี qm_email (ผู้จัดการคุณภาพ) → ใช้คนนั้น
 * v1.x ไม่มี → ตกมาที่ approver_email ของงานนั้น (หัวหน้ากลุ่มงาน) ตามที่ตั้งไว้ในแท็บ Units/Config
 */
function darApprover_(unit) {
  const qm = String(getConfigValue_('qm_email', '') || '').trim();
  if (qm.indexOf('@') > -1) {
    return { email: qm, title: String(getConfigValue_('qm_title', 'ผู้จัดการคุณภาพ') || 'ผู้จัดการคุณภาพ') };
  }
  const s = resolveSigners_(unit);
  return {
    email: s.approverEmail,
    title: String(getConfigValue_('dar_approver_title', '') || '') || s.approverTitle
  };
}

/** บังคับสิทธิ์เฉพาะโปรเจกต์ที่มีโมดูล role (v2.x) — v1.x ไม่มีฟังก์ชันนี้ ก็ข้ามไป */
function darRequireApprover_() {
  if (typeof requireRole_ === 'function') requireRole_(['qm', 'admin']);
}

function boolCell_(v) {
  return (v === true || String(v).toUpperCase() === 'TRUE' || v === 'yes' || v === 1);
}

// ============================================================
// 3. CLIENT API
// ============================================================

function getDarInit() {
  ensureDarSetup_();
  const units = Object.keys(getUnitMap_()).sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return {
    units: units.length ? units : DEFAULT_UNITS,
    docTypes: DOC_TYPES,
    types: DAR_TYPES,
    sources: darSources_(),
    statuses: DAR_STATUS,
    nextDarNo: nextSerial_(SHEET_NAMES.DOC_REQUESTS, 'dar_no', 'DAR', 3),
    requireDar: String(getConfigValue_('require_dar', 'FALSE')).toUpperCase() === 'TRUE',
    userEmail: Session.getActiveUser().getEmail() || ''
  };
}

/** ข้อมูลเอกสารเดิมสำหรับฟอร์มขอแก้ไข/ยกเลิก */
function lookupDocForDar(docCode) {
  const rows = getDocsByCode_(docCode);
  if (!rows.length) return { exists: false };
  const current = rows.filter(function (r) { return r.status === STATUS.APPROVED; })[0] || rows[0];
  return {
    exists: true,
    docCode: String(docCode).trim().toUpperCase(),
    title: current.title, docType: current.docType, unit: current.unit,
    editionLabel: current.editionLabel, status: current.status,
    effectiveDate: formatThaiDate_(current.effectiveDate),
    hasApproved: rows.some(function (r) { return r.status === STATUS.APPROVED; })
  };
}

/**
 * ยื่นคำขอ
 * payload: { requestType, source, capaId, capaNo, docCode, docTitle, docType, unit, reason,
 *            impactTraining, impactDocs, impactResults, impactNote, requesterName, requesterEmail }
 */
function createDocRequest(payload) {
  ensureDarSetup_();
  const p = payload || {};
  const type = String(p.requestType || 'new');
  const typeDef = darTypeDef_(type);
  const unit = String(p.unit || '').trim();
  const reason = String(p.reason || '').trim();
  const requester = String(p.requesterName || '').trim();
  const requesterEmail = (Session.getActiveUser().getEmail() || String(p.requesterEmail || '')).trim();

  if (!unit) throw new Error('กรุณาเลือกงาน/หน่วยงาน');
  if (!reason) throw new Error('กรุณาระบุเหตุผลของคำขอ');
  if (!requester) throw new Error('กรุณากรอกชื่อผู้ขอ');
  if (requesterEmail.indexOf('@') === -1) throw new Error('กรุณากรอกอีเมลผู้ขอ (ใช้แจ้งผลกลับ)');

  // เอกสารใหม่ยังไม่มีเลขที่ — ระบบออกรหัสให้ตอนส่งเอกสาร (DocRegistry.gs) จึงไม่รับเลขที่จากคำขอ
  const docCode = typeDef.needsExisting ? String(p.docCode || '').trim().toUpperCase() : '';
  if (typeDef.needsExisting) {
    if (!docCode) throw new Error('คำขอประเภทนี้ต้องระบุเลขที่เอกสารเดิม');
    const rows = getDocsByCode_(docCode);
    if (!rows.length) throw new Error('ไม่พบเลขที่เอกสาร ' + docCode + ' ในคลัง');
    if (type === 'withdraw' && !rows.some(function (r) { return r.status === STATUS.APPROVED; })) {
      throw new Error('เอกสาร ' + docCode + ' ไม่มีฉบับที่บังคับใช้อยู่ จึงไม่มีอะไรให้ยกเลิก');
    }
  }
  // กันยื่นซ้อน: เลขเดียวกันมีคำขอค้างอยู่แล้ว
  if (docCode) {
    const pending = readTable_(SHEET_NAMES.DOC_REQUESTS).filter(function (r) {
      return String(r.doc_code || '').toUpperCase() === docCode &&
        (String(r.status) === DAR_STATUS.WAIT || String(r.status) === DAR_STATUS.APPROVED);
    })[0];
    if (pending) {
      throw new Error('เลขเอกสาร ' + docCode + ' มีคำขอ ' + pending.dar_no +
        ' สถานะ "' + pending.status + '" ค้างอยู่ — ต้องปิดคำขอนั้นก่อน');
    }
  }

  const darId = Utilities.getUuid();
  const token = Utilities.getUuid();
  const approver = darApprover_(unit);

  appendByName_(SHEET_NAMES.DOC_REQUESTS, {
    dar_id: darId,
    dar_no: nextSerial_(SHEET_NAMES.DOC_REQUESTS, 'dar_no', 'DAR', 3),
    request_type: type,
    source: String(p.source || 'other'),
    capa_id: String(p.capaId || ''),
    capa_no: String(p.capaNo || ''),
    doc_code: docCode,
    doc_title: String(p.docTitle || '').trim(),
    doc_type: String(p.docType || ''),
    unit: unit,
    reason: reason.slice(0, 2000),
    impact_training: boolCell_(p.impactTraining) ? 'TRUE' : 'FALSE',
    impact_docs: String(p.impactDocs || '').trim().slice(0, 500),
    impact_results: boolCell_(p.impactResults) ? 'TRUE' : 'FALSE',
    impact_note: String(p.impactNote || '').trim().slice(0, 1000),
    requester_name: requester,
    requester_email: requesterEmail,
    requested_at: new Date(),
    status: DAR_STATUS.WAIT,
    token: token
  });

  if (approver.email.indexOf('@') > -1) {
    const url = ScriptApp.getService().getUrl() + '?page=dar&id=' + darId + '&token=' + token;
    MailApp.sendEmail(approver.email,
      'รออนุมัติคำขอเอกสาร: ' + (docCode ? docCode + ' — ' : '') + String(p.docTitle || '').trim(),
      'มีคำขอดำเนินการกับเอกสารคุณภาพรอการพิจารณาจากท่าน (' + approver.title + ')\n\n' +
      'ประเภทคำขอ: ' + typeDef.label + '\n' +
      (docCode ? 'เลขที่เอกสาร: ' + docCode + '\n' : '') +
      'ชื่อเอกสาร: ' + String(p.docTitle || '-') + '\n' +
      'งาน/หน่วยงาน: ' + unit + '\n' +
      'ผู้ขอ: ' + requester + ' (' + requesterEmail + ')\n\n' +
      'เหตุผล:\n' + reason + '\n\n' +
      'ผลกระทบ:\n' +
      '- ต้องอบรม/สื่อสารผู้ปฏิบัติใหม่: ' + (boolCell_(p.impactTraining) ? 'ใช่' : 'ไม่') + '\n' +
      '- กระทบผลตรวจที่รายงานออกไปแล้ว: ' + (boolCell_(p.impactResults) ? 'ใช่' : 'ไม่') + '\n' +
      '- เอกสารอื่นที่เกี่ยวข้อง: ' + (String(p.impactDocs || '').trim() || '-') + '\n\n' +
      'พิจารณาคำขอที่: ' + url);
  } else {
    Logger.log('ยังไม่ได้ตั้งอีเมลผู้อนุมัติคำขอของ ' + unit + ' — ข้ามการส่งอีเมล');
  }

  return { darId: darId, token: token };
}

function getDarList(filter) {
  ensureDarSetup_();
  const f = filter || {};
  return readTable_(SHEET_NAMES.DOC_REQUESTS).map(function (r) {
    return {
      darId: r.dar_id, darNo: r.dar_no,
      requestType: r.request_type, typeLabel: darTypeDef_(String(r.request_type)).label,
      sourceLabel: labelOf_(darSources_(), String(r.source)),
      docCode: String(r.doc_code || ''), docTitle: String(r.doc_title || ''),
      unit: r.unit, reason: String(r.reason || ''),
      requesterName: r.requester_name,
      requestedAt: formatThaiDate_(r.requested_at),
      status: r.status,
      capaNo: String(r.capa_no || ''),
      resultingDocCode: String(r.resulting_doc_code || ''),
      resultingEdition: r.resulting_edition,
      pdfUrl: String(r.pdf_url || '')
    };
  }).filter(function (r) {
    if (f.unit && r.unit !== f.unit) return false;
    if (f.openOnly && (r.status === DAR_STATUS.DONE || r.status === DAR_STATUS.REJECTED ||
      r.status === DAR_STATUS.CANCELLED)) return false;
    return true;
  }).sort(function (a, b) { return String(b.darNo).localeCompare(String(a.darNo)); });
}

/** token ว่างได้ถ้าเปิดจากหน้ารายการในระบบ — ส่ง token มาเมื่อเข้าจากลิงก์ในอีเมล */
function getDocRequest(darId, token) {
  ensureDarSetup_();
  const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', darId);
  if (!row) throw new Error('ไม่พบคำขอนี้');
  if (token && row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
  const r = row.toObject();
  const approver = darApprover_(r.unit);

  let existing = null;
  if (r.doc_code) {
    const rows = getDocsByCode_(r.doc_code);
    if (rows.length) {
      const cur = rows.filter(function (x) { return x.status === STATUS.APPROVED; })[0] || rows[0];
      existing = {
        editionLabel: cur.editionLabel, status: cur.status, title: cur.title,
        effectiveDate: formatThaiDate_(cur.effectiveDate), unit: cur.unit
      };
    }
  }

  return {
    darId: darId, darNo: r.dar_no, token: r.token,
    requestType: r.request_type, typeLabel: darTypeDef_(String(r.request_type)).label,
    source: r.source, sourceLabel: labelOf_(darSources_(), String(r.source)),
    capaId: String(r.capa_id || ''), capaNo: String(r.capa_no || ''),
    docCode: String(r.doc_code || ''), docTitle: String(r.doc_title || ''),
    docType: String(r.doc_type || ''), docTypeLabel: docTypeLabel_(String(r.doc_type)),
    unit: r.unit, reason: String(r.reason || ''),
    impactTraining: boolCell_(r.impact_training),
    impactDocs: String(r.impact_docs || ''),
    impactResults: boolCell_(r.impact_results),
    impactNote: String(r.impact_note || ''),
    requesterName: r.requester_name, requesterEmail: r.requester_email,
    requestedAt: formatThaiDate_(r.requested_at),
    status: r.status,
    approverTitle: approver.title,
    approverName: String(r.approver_name || ''),
    approvedAt: formatThaiDate_(r.approved_at),
    approverSignature: String(r.approver_signature || ''),
    approverComment: String(r.approver_comment || ''),
    resultingDocId: String(r.resulting_doc_id || ''),
    resultingDocCode: String(r.resulting_doc_code || ''),
    resultingEdition: r.resulting_edition,
    pdfUrl: String(r.pdf_url || ''),
    closedAt: formatThaiDate_(r.closed_at),
    orgLine: String(getConfigValue_('org_line', '') || ''),
    existing: existing
  };
}

/**
 * พิจารณาคำขอ
 * อนุมัติ + ประเภท "ยกเลิก" -> ตีเอกสารเป็น "ยกเลิกใช้" ทันทีและปิดคำขอ (ไม่ต้องมีฉบับใหม่มาแทน)
 * อนุมัติ + ประเภทอื่น     -> รอผู้จัดทำอัปโหลดเอกสารตามคำขอ (ปิดคำขอตอนเอกสารอนุมัติครบ)
 */
function approveDocRequest(darId, token, approverName, decision, comment, signature) {
  ensureDarSetup_();
  darRequireApprover_();
  const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', darId);
  if (!row) throw new Error('ไม่พบคำขอนี้');
  if (token && row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
  if (String(row.get('status')) !== DAR_STATUS.WAIT) {
    throw new Error('คำขอนี้อยู่ในสถานะ "' + row.get('status') + '" แล้ว พิจารณาซ้ำไม่ได้');
  }

  const name = String(approverName || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อผู้พิจารณา');
  const sig = validateSignature_(signature);
  if (!sig) throw new Error('ลายเซ็นไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');

  const now = new Date();
  const note = trimComment_(comment);
  row.set('approver_name', name);
  row.set('approved_at', now);
  row.set('approver_signature', sig);
  row.set('approver_comment', note);

  const darNo = String(row.get('dar_no'));
  const type = String(row.get('request_type'));
  const docCode = String(row.get('doc_code') || '');
  const requester = String(row.get('requester_email') || '');

  if (decision !== 'approve') {
    row.set('status', DAR_STATUS.REJECTED);
    row.set('closed_at', now);
    notifyRequester_(requester, 'คำขอ ' + darNo + ' (' + darTypeDef_(type).label + ')',
      DAR_STATUS.REJECTED, name, note, '');
    return { status: DAR_STATUS.REJECTED };
  }

  // ---------- ยกเลิกเอกสาร: มีผลทันทีที่อนุมัติ ----------
  if (type === 'withdraw') {
    const rows = getDocsByCode_(docCode);
    let done = 0;
    rows.forEach(function (r) {
      if (r.status !== STATUS.APPROVED) return;
      const docRow = findDocRow_(r.docId);
      if (docRow) { docRow.set('status', STATUS.OBSOLETE); done++; }
    });
    clearArchiveCache_();
    row.set('status', DAR_STATUS.DONE);
    row.set('closed_at', now);
    row.set('resulting_doc_code', docCode);

    let pdfUrl = '';
    try {
      const file = saveDarPdf_(getDocRequest(darId, ''));
      pdfUrl = file.getUrl();
      row.set('pdf_id', file.getId());
      row.set('pdf_url', pdfUrl);
    } catch (err) {
      Logger.log('สร้างใบคำขอ (PDF) ไม่สำเร็จ (' + darId + '): ' + err);
    }

    notifyRequester_(requester, 'คำขอ ' + darNo + ' ยกเลิกเอกสาร ' + docCode,
      'อนุมัติแล้ว — ตีเอกสารเป็น "ยกเลิกใช้" ' + done + ' ฉบับ', name, note, pdfUrl);
    return { status: DAR_STATUS.DONE, obsoleted: done, pdfUrl: pdfUrl };
  }

  // ---------- จัดทำใหม่ / แก้ไข: รอผู้จัดทำอัปโหลด ----------
  row.set('status', DAR_STATUS.APPROVED);
  const uploadUrl = ScriptApp.getService().getUrl() + '?page=upload&dar=' + darId;
  if (requester.indexOf('@') > -1) {
    MailApp.sendEmail(requester,
      'อนุมัติคำขอ ' + darNo + ' — ดำเนินการจัดทำเอกสารได้',
      'คำขอของท่านได้รับอนุมัติแล้ว\n\n' +
      'เลขที่คำขอ: ' + darNo + '\n' +
      'ประเภท: ' + darTypeDef_(type).label + '\n' +
      (docCode ? 'เลขที่เอกสาร: ' + docCode + '\n' : '') +
      'ผู้พิจารณา: ' + name + '\n' +
      (note ? 'ความเห็น: ' + note + '\n' : '') +
      '\nอัปโหลดเอกสารตามคำขอนี้ที่ (ระบบจะเติมข้อมูลจากคำขอให้อัตโนมัติ):\n' + uploadUrl);
  }
  return { status: DAR_STATUS.APPROVED, uploadUrl: uploadUrl };
}

function cancelDocRequest(darId, reason) {
  ensureDarSetup_();
  const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', darId);
  if (!row) throw new Error('ไม่พบคำขอนี้');
  if (String(row.get('status')) === DAR_STATUS.DONE) throw new Error('คำขอที่ดำเนินการแล้วยกเลิกไม่ได้');
  row.set('status', DAR_STATUS.CANCELLED);
  row.set('approver_comment', trimComment_(reason));
  row.set('closed_at', new Date());
  return { status: DAR_STATUS.CANCELLED };
}

/** ข้อมูลคำขอที่อนุมัติแล้ว สำหรับเติมฟอร์มหน้าอัปโหลด */
function getDarForUpload(darId) {
  ensureDarSetup_();
  const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', darId);
  if (!row) throw new Error('ไม่พบคำขอนี้');
  const status = String(row.get('status'));
  if (status !== DAR_STATUS.APPROVED) {
    throw new Error('คำขอนี้อยู่ในสถานะ "' + status + '" — อัปโหลดเอกสารได้เฉพาะคำขอที่อนุมัติแล้ว');
  }
  if (String(row.get('request_type')) === 'withdraw') {
    throw new Error('คำขอประเภทยกเลิกเอกสารไม่ต้องอัปโหลดไฟล์');
  }
  return {
    darId: darId, darNo: String(row.get('dar_no')),
    requestType: String(row.get('request_type')),
    typeLabel: darTypeDef_(String(row.get('request_type'))).label,
    docCode: String(row.get('doc_code') || ''),
    docTitle: String(row.get('doc_title') || ''),
    docType: String(row.get('doc_type') || ''),
    unit: String(row.get('unit') || ''),
    reason: String(row.get('reason') || ''),
    requesterName: String(row.get('requester_name') || ''),
    requesterEmail: String(row.get('requester_email') || ''),
    approverName: String(row.get('approver_name') || ''),
    approvedAt: formatThaiDate_(row.get('approved_at'))
  };
}

/**
 * ตรวจก่อนบันทึกเอกสาร — เรียกจาก submitDocument()
 * คืน darId ที่ใช้ได้ หรือ '' ถ้าไม่ได้อ้าง DAR และ Config ไม่ได้บังคับ
 */
function validateDarForSubmit_(darId, docCode, requestKind) {
  ensureDarSetup_();
  const required = String(getConfigValue_('require_dar', 'FALSE')).toUpperCase() === 'TRUE';
  const id = String(darId || '').trim();
  if (!id) {
    if (required) {
      throw new Error('ระบบตั้งค่าให้ต้องมีใบขออนุมัติ (DAR) ที่อนุมัติแล้วก่อนส่งเอกสาร — ' +
        'ยื่นคำขอที่หน้า "คำขอเอกสาร" ก่อน');
    }
    return '';
  }
  const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', id);
  if (!row) throw new Error('ไม่พบใบขออนุมัติที่อ้างถึง');
  if (String(row.get('status')) !== DAR_STATUS.APPROVED) {
    throw new Error('ใบขออนุมัติ ' + row.get('dar_no') + ' อยู่ในสถานะ "' + row.get('status') + '"');
  }
  const darCode = String(row.get('doc_code') || '').toUpperCase();
  if (darCode && darCode !== String(docCode || '').toUpperCase()) {
    throw new Error('เลขที่เอกสารไม่ตรงกับใบขออนุมัติ ' + row.get('dar_no') + ' (ขอไว้: ' + darCode + ')');
  }
  if (String(row.get('request_type')) === 'revise' && requestKind === 'new') {
    throw new Error('ใบขออนุมัตินี้เป็นคำขอแก้ไขเอกสารเดิม แต่เลขที่เอกสารนี้ยังไม่มีในคลัง');
  }
  return id;
}

/** ปิดคำขอเมื่อเอกสารที่ออกตามคำขอได้รับอนุมัติครบ — เรียกจาก signDocument() */
function closeDarForDocument_(darId, docId, docCode, editionLabel) {
  if (!darId) return;
  try {
    const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', darId);
    if (!row) return;
    row.set('resulting_doc_id', docId);
    row.set('resulting_doc_code', docCode);
    row.set('resulting_edition', editionLabel);
    row.set('status', DAR_STATUS.DONE);
    row.set('closed_at', new Date());
    try {
      const file = saveDarPdf_(getDocRequest(darId, ''));
      row.set('pdf_id', file.getId());
      row.set('pdf_url', file.getUrl());
    } catch (err) {
      Logger.log('สร้างใบคำขอ (PDF) ไม่สำเร็จ (' + darId + '): ' + err);
    }
  } catch (err) {
    // ห้ามให้การปิด DAR ที่ผิดพลาดทำให้การอนุมัติเอกสารล้ม
    Logger.log('ปิดใบขออนุมัติไม่สำเร็จ (' + darId + '): ' + err);
  }
}

// ============================================================
// 4. PDF ใบคำขอ
// ============================================================

function buildDarHtml_(d) {
  const yn = function (b) { return b ? 'ใช่' : 'ไม่'; };
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + pdfCss_() + '</style></head><body>' +
    (d.orgLine ? '<div class="org">' + htmlEscape_(d.orgLine) + '</div>' : '') +
    '<h1>ใบขออนุมัติดำเนินการกับเอกสารคุณภาพ</h1>' +
    '<div class="org">Document Approval Request — ' + htmlEscape_(d.darNo) + '</div>' +
    '<table class="meta">' +
    '<tr><th>เลขที่คำขอ</th><td>' + htmlEscape_(d.darNo) + '</td></tr>' +
    '<tr><th>ประเภทคำขอ</th><td>' + htmlEscape_(d.typeLabel) + '</td></tr>' +
    '<tr><th>แหล่งที่มาของคำขอ</th><td>' + htmlEscape_(d.sourceLabel) +
    (d.capaNo ? ' — ' + htmlEscape_(d.capaNo) : '') + '</td></tr>' +
    '<tr><th>เลขที่เอกสาร</th><td>' + htmlEscape_(d.docCode || '(เอกสารใหม่ ยังไม่มีเลขที่)') + '</td></tr>' +
    '<tr><th>ชื่อเอกสาร</th><td>' + htmlEscape_(d.docTitle) + '</td></tr>' +
    '<tr><th>ประเภทเอกสาร</th><td>' + htmlEscape_(d.docTypeLabel) + '</td></tr>' +
    '<tr><th>งาน / หน่วยงาน</th><td>' + htmlEscape_(d.unit) + '</td></tr>' +
    (d.existing ? '<tr><th>ฉบับที่ใช้อยู่ปัจจุบัน</th><td>ฉบับที่ ' + htmlEscape_(String(d.existing.editionLabel)) +
      ' (' + htmlEscape_(d.existing.status) + ') บังคับใช้ ' + htmlEscape_(d.existing.effectiveDate) + '</td></tr>' : '') +
    '<tr><th>ผู้ขอ</th><td>' + htmlEscape_(d.requesterName) + ' (' + htmlEscape_(d.requesterEmail) + ')</td></tr>' +
    '<tr><th>วันที่ยื่นคำขอ</th><td>' + htmlEscape_(d.requestedAt) + '</td></tr>' +
    (d.resultingDocCode ? '<tr><th>ผลการดำเนินการ</th><td>' + htmlEscape_(d.resultingDocCode) +
      (d.resultingEdition !== '' && d.resultingEdition !== undefined ? ' ฉบับที่ ' + htmlEscape_(String(d.resultingEdition)) : '') +
      '</td></tr>' : '') +
    '</table>' +
    '<div class="block"><b>เหตุผลของคำขอ</b>' + htmlEscape_(d.reason) + '</div>' +
    '<div class="block"><b>การประเมินผลกระทบ</b>' +
    '1. ต้องอบรม/สื่อสารผู้ปฏิบัติใหม่: ' + yn(d.impactTraining) + '<br>' +
    '2. กระทบผลตรวจที่รายงานออกไปแล้ว: ' + yn(d.impactResults) + '<br>' +
    '3. เอกสารอื่นที่ต้องแก้ตาม: ' + htmlEscape_(d.impactDocs || '-') +
    (d.impactNote ? '<br>หมายเหตุ: ' + htmlEscape_(d.impactNote) : '') +
    '</div>' +
    '<div class="sigs">' +
    sigHtml_('ผู้ขอ', d.requesterName, d.requestedAt, '', '') +
    sigHtml_(d.approverTitle || 'ผู้อนุมัติคำขอ', d.approverName, d.approvedAt, d.approverSignature, d.approverComment) +
    '</div>' +
    '<div class="foot">สถานะ: ' + htmlEscape_(d.status) +
    (d.closedAt ? ' · ปิดคำขอเมื่อ ' + htmlEscape_(d.closedAt) : '') + '</div>' +
    '</body></html>';
}

function saveDarPdf_(d) {
  const html = buildDarHtml_(d);
  const fileName = safeFileName_('ใบขออนุมัติเอกสาร ' + d.darNo) + '.pdf';
  const pdf = Utilities.newBlob(html, MimeType.HTML, fileName).getAs(MimeType.PDF).setName(fileName);
  const folder = getOrCreateChild_(getOrCreateChild_(getDriveRoot_(), 'ใบขออนุมัติเอกสาร (DAR)'), d.unit);
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(pdf);
  file.setDescription('ใบขออนุมัติดำเนินการกับเอกสารคุณภาพ ' + d.darNo + ' — ' + d.unit);
  return file;
}

function regenerateDarPdf(darId) {
  const d = getDocRequest(darId, '');
  const file = saveDarPdf_(d);
  const row = findRowById_(SHEET_NAMES.DOC_REQUESTS, 'dar_id', darId);
  row.set('pdf_id', file.getId());
  row.set('pdf_url', file.getUrl());
  return { pdfUrl: file.getUrl() };
}
