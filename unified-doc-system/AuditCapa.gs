/**
 * WI Document Control v2.0 — โมดูล Internal Audit + CAPA
 * ---------------------------------------------------------------------------
 * ต่อจากโมดูลเอกสารใน Code.gs (ใช้ helper ร่วมกัน: getSheet_, getConfigValue_,
 * validateSignature_, formatThaiDate_, getDriveRoot_ ฯลฯ)
 *
 * วงจรที่โมดูลนี้ปิด:
 *   WI (เขียนว่าจะทำอะไร) → Audit (ตรวจว่าทำจริงไหม) → Finding (ไม่ตรงตรงไหน)
 *   → CAPA (สาเหตุราก + แก้ + ทวนสอบประสิทธิผล) → มักจบด้วย WI ฉบับใหม่
 *
 * CAPA ไม่ได้มาจาก audit อย่างเดียว — ข้อร้องเรียน / งานที่ไม่สอดคล้องจากงานประจำ /
 * ผล EQA ผิดปกติ ก็เปิด CAPA ตรง ๆ ได้ (`CAPA_SOURCES`)
 */

// ============================================================
// 1. CONFIG ของโมดูล
// ============================================================

/** ข้อกำหนด ISO 15189:2022 ที่ใช้เป็นหัวข้อ checklist — แก้/ตัดได้ตามขอบเขตที่แล็บรับรอง */
const ISO15189_CLAUSES = [
  { no: '5', label: 'ข้อกำหนดด้านโครงสร้างและการกำกับดูแล' },
  { no: '6.2', label: 'บุคลากร' },
  { no: '6.3', label: 'สถานที่และภาวะแวดล้อม' },
  { no: '6.4', label: 'เครื่องมือ' },
  { no: '6.5', label: 'การสอบเทียบและความสอบกลับได้ทางมาตรวิทยา' },
  { no: '6.6', label: 'น้ำยา วัสดุสิ้นเปลือง' },
  { no: '7.2', label: 'กระบวนการก่อนการตรวจวิเคราะห์' },
  { no: '7.3', label: 'กระบวนการตรวจวิเคราะห์' },
  { no: '7.4', label: 'กระบวนการหลังการตรวจวิเคราะห์' },
  { no: '7.5', label: 'งานที่ไม่สอดคล้องตามข้อกำหนด' },
  { no: '7.6', label: 'การควบคุมข้อมูลและการจัดการสารสนเทศ' },
  { no: '8.2', label: 'เอกสารในระบบบริหารคุณภาพ' },
  { no: '8.3', label: 'การควบคุมเอกสาร' },
  { no: '8.4', label: 'การควบคุมบันทึก' },
  { no: '8.5', label: 'การดำเนินการเพื่อจัดการความเสี่ยงและโอกาส' },
  { no: '8.6', label: 'การปรับปรุง' },
  { no: '8.7', label: 'ความไม่สอดคล้องและการแก้ไข' },
  { no: '8.8', label: 'การประเมินภายใน' },
  { no: '8.9', label: 'การทบทวนการบริหาร' }
];

/**
 * ระดับผลการตรวจ — `needsCapa` ตัดสินว่าระบบจะบังคับให้เปิด CAPA ไหม
 * OFI เปิด CAPA ได้แต่ไม่บังคับ (เป็นโอกาสพัฒนา ไม่ใช่ความไม่สอดคล้อง)
 */
const FINDING_GRADES = [
  { value: 'NC_MAJOR', label: 'NC ร้ายแรง (Major)', needsCapa: true, dueDays: 30 },
  { value: 'NC_MINOR', label: 'NC ไม่ร้ายแรง (Minor)', needsCapa: true, dueDays: 60 },
  { value: 'OFI', label: 'ข้อสังเกต / โอกาสพัฒนา (OFI)', needsCapa: false, dueDays: 90 },
  { value: 'CONFORM', label: 'เป็นไปตามข้อกำหนด', needsCapa: false, dueDays: 0 }
];

const AUDIT_TYPES = [
  { value: 'internal', label: 'ตรวจติดตามภายใน (Internal audit)' },
  { value: 'followup', label: 'ตรวจติดตามผลการแก้ไข (Follow-up)' },
  { value: 'external', label: 'ตรวจจากภายนอก (External / สภาเทคนิคการแพทย์)' }
];

const CAPA_SOURCES = [
  { value: 'audit', label: 'ตรวจติดตามภายใน (Audit finding)' },
  { value: 'complaint', label: 'ข้อร้องเรียนจากผู้ใช้บริการ' },
  { value: 'nc_routine', label: 'งานที่ไม่สอดคล้องจากงานประจำ' },
  { value: 'eqa', label: 'ผล EQA / QC ผิดปกติ' },
  { value: 'risk', label: 'การประเมินความเสี่ยง' },
  { value: 'other', label: 'อื่น ๆ' }
];

/** วิธีวิเคราะห์สาเหตุราก — บันทึกไว้เพื่อให้ผู้ตรวจเห็นว่าใช้เครื่องมืออะไร */
const ROOT_CAUSE_METHODS = [
  '5 Why',
  'ผังก้างปลา (Fishbone / Ishikawa)',
  'FMEA',
  'การทบทวนกระบวนการร่วมกับผู้ปฏิบัติ',
  'อื่น ๆ'
];

const AUDIT_STATUS = {
  PLANNED: 'วางแผน',
  IN_PROGRESS: 'กำลังตรวจ',
  WAIT_SIGN: 'รอลงนามสรุปผล',
  CLOSED: 'ปิดรอบ'
};

const FINDING_STATUS = {
  OPEN: 'เปิด',
  IN_CAPA: 'อยู่ระหว่าง CAPA',
  CLOSED: 'ปิด'
};

const CAPA_STATUS = {
  OPEN: 'เปิด (รอวิเคราะห์สาเหตุ)',
  IN_ACTION: 'กำลังแก้ไข',
  WAIT_VERIFY: 'รอทวนสอบประสิทธิผล',
  CLOSED: 'ปิด',
  CANCELLED: 'ยกเลิก'
};

/** บทบาทในทะเบียน People — ใช้คุมสิทธิ์ได้ต่อเมื่อ deploy แบบ DOMAIN (ดู getCurrentUser) */
const ROLES = [
  { value: 'staff', label: 'ผู้ปฏิบัติงาน / ผู้จัดทำเอกสาร' },
  { value: 'head', label: 'หัวหน้างาน (ผู้ทบทวน)' },
  { value: 'qm', label: 'ผู้จัดการคุณภาพ (QM)' },
  { value: 'auditor', label: 'ผู้ตรวจติดตามภายใน' },
  { value: 'admin', label: 'ผู้ดูแลระบบ' }
];

const AUDIT_COLUMNS = [
  'audit_id', 'audit_no', 'audit_type', 'unit', 'scope_clauses',
  'planned_date', 'audit_date', 'lead_auditor', 'lead_auditor_email', 'auditors', 'auditee',
  'status', 'summary_note', 'created_at', 'created_by',
  'lead_name', 'lead_at', 'lead_signature',
  'qm_name', 'qm_at', 'qm_signature', 'qm_comment',
  'report_pdf_id', 'report_pdf_url', 'closed_at', 'token'
];

const FINDING_COLUMNS = [
  'finding_id', 'audit_id', 'finding_no', 'clause', 'grade',
  'title', 'description', 'evidence', 'related_doc_code',
  'status', 'capa_id', 'created_at', 'created_by'
];

const CAPA_COLUMNS = [
  'capa_id', 'capa_no', 'source', 'finding_id', 'unit', 'clause',
  'problem', 'immediate_correction',
  'root_cause', 'root_cause_method', 'action_plan',
  'owner_name', 'owner_email', 'due_date',
  'status', 'action_result', 'action_done_at',
  'effectiveness_due', 'effectiveness_result',
  'verifier_name', 'verified_at', 'verifier_signature', 'verifier_comment',
  'related_doc_code', 'related_doc_id',
  'pdf_id', 'pdf_url', 'created_at', 'created_by', 'closed_at', 'token'
];

const PEOPLE_COLUMNS = ['email', 'name', 'role', 'unit'];

// ============================================================
// 2. SETUP + helper กลางของโมดูล
// ============================================================

/** สร้างแท็บของโมดูลแบบ lazy — เรียกจาก runSetup() และจากทุก entry point ของโมดูล */
function ensureAuditSetup_() {
  const ss = getSS_();
  [
    [SHEET_NAMES.AUDITS, AUDIT_COLUMNS],
    [SHEET_NAMES.FINDINGS, FINDING_COLUMNS],
    [SHEET_NAMES.CAPAS, CAPA_COLUMNS],
    [SHEET_NAMES.PEOPLE, PEOPLE_COLUMNS]
  ].forEach(function (pair) {
    let sh = ss.getSheetByName(pair[0]);
    if (!sh) sh = ss.insertSheet(pair[0]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(pair[1]);
      sh.setFrozenRows(1);
      return;
    }
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    pair[1].forEach(function (name) {
      if (header.indexOf(name) === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue(name);
    });
  });

  const cfg = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (cfg) {
    const keys = cfg.getDataRange().getValues().map(function (r) { return r[0]; });
    [
      ['qm_email', ''],
      ['qm_title', 'ผู้จัดการคุณภาพ'],
      ['capa_default_due_days', '30'],
      ['effectiveness_check_days', '90'],
      ['enforce_roles', 'FALSE']
    ].forEach(function (row) {
      if (keys.indexOf(row[0]) === -1) cfg.appendRow(row);
    });
  }
}

function gradeDef_(value) {
  for (let i = 0; i < FINDING_GRADES.length; i++) {
    if (FINDING_GRADES[i].value === value) return FINDING_GRADES[i];
  }
  return { value: value, label: value, needsCapa: false, dueDays: 30 };
}

// helper กลาง (readTable_ / findRowById_ / appendByName_ / nextSerial_ / toIsoDate_ /
// addDaysIso_ / isOverdue_ / labelOf_ / sigHtml_ / pdfCss_) อยู่ใน Common.gs

// ============================================================
// 3. สิทธิ์ตามหน้าที่ (role)
// ============================================================

/**
 * ตัวตนผู้ใช้ปัจจุบัน
 * `known` เป็น false เมื่อ deploy แบบ access: ANYONE (getActiveUser คืนค่าว่าง)
 * — ในกรณีนั้นระบบ **ไม่บังคับสิทธิ์** และหน้าเว็บจะขึ้นแถบเตือนให้เห็นชัดว่าเปิดกว้างอยู่
 * จะบังคับสิทธิ์จริงต้องเปลี่ยน appsscript.json เป็น access: "DOMAIN" แล้วตั้ง Config.enforce_roles = TRUE
 */
function getCurrentUser() {
  ensureAuditSetup_();
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const enforce = String(getConfigValue_('enforce_roles', 'FALSE')).toUpperCase() === 'TRUE';
  if (!email) {
    return { email: '', name: '', roles: [], unit: '', known: false, enforce: enforce, allowAll: true };
  }
  const me = readTable_(SHEET_NAMES.PEOPLE).filter(function (p) {
    return String(p.email || '').trim().toLowerCase() === email;
  });
  const roles = me.map(function (p) { return String(p.role || '').trim(); }).filter(Boolean);
  return {
    email: email,
    name: me.length ? String(me[0].name || '') : '',
    unit: me.length ? String(me[0].unit || '') : '',
    roles: roles,
    known: true,
    enforce: enforce,
    // ไม่ได้ลงทะเบียนในแท็บ People = ยังให้ใช้งานได้ตามเดิม เว้นแต่เปิด enforce_roles
    allowAll: !enforce
  };
}

/** ใช้กับ action ที่สงวนไว้ (ปิดรอบ audit / ทวนสอบ CAPA) — เงียบไว้ถ้ายังไม่เปิด enforce */
function requireRole_(roleList) {
  const me = getCurrentUser();
  if (!me.enforce || !me.known) return me;
  const ok = roleList.some(function (r) { return me.roles.indexOf(r) > -1; });
  if (!ok) {
    throw new Error('บัญชี ' + me.email + ' ไม่มีสิทธิ์ทำรายการนี้ (ต้องเป็น ' +
      roleList.map(function (r) { return labelOf_(ROLES, r); }).join(' หรือ ') + ')');
  }
  return me;
}

function qmEmail_() {
  return String(getConfigValue_('qm_email', '') || '').trim();
}

// ============================================================
// 4. AUDIT — วางแผน / บันทึกผล / ปิดรอบ
// ============================================================

function getAuditInit() {
  ensureAuditSetup_();
  const units = Object.keys(getUnitMap_()).sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return {
    units: units.length ? units : DEFAULT_UNITS,
    clauses: ISO15189_CLAUSES,
    grades: FINDING_GRADES,
    auditTypes: AUDIT_TYPES,
    statuses: AUDIT_STATUS,
    findingStatuses: FINDING_STATUS,
    me: getCurrentUser(),
    nextAuditNo: nextSerial_(SHEET_NAMES.AUDITS, 'audit_no', 'IA', 2)
  };
}

/**
 * สร้างรอบตรวจ
 * payload: { auditType, unit, scopeClauses[], plannedDate, leadAuditor, leadAuditorEmail, auditors, auditee }
 */
function createAudit(payload) {
  ensureAuditSetup_();
  const p = payload || {};
  const unit = String(p.unit || '').trim();
  const lead = String(p.leadAuditor || '').trim();
  if (!unit) throw new Error('กรุณาเลือกงาน/หน่วยงานที่จะตรวจ');
  if (!lead) throw new Error('กรุณาระบุหัวหน้าทีมผู้ตรวจ');

  const auditeeEmail = String(p.auditeeEmail || '').trim();
  const leadEmail = String(p.leadAuditorEmail || '').trim();
  // ผู้ตรวจต้องไม่ตรวจงานตัวเอง (ISO 15189 ข้อ 8.8) — เตือนไว้ ไม่บล็อก เพราะแล็บเล็กอาจเลี่ยงไม่ได้
  const selfAudit = (leadEmail && auditeeEmail && leadEmail.toLowerCase() === auditeeEmail.toLowerCase());

  const auditId = Utilities.getUuid();
  const now = new Date();
  const row = {
    audit_id: auditId,
    audit_no: nextSerial_(SHEET_NAMES.AUDITS, 'audit_no', 'IA', 2),
    audit_type: String(p.auditType || 'internal'),
    unit: unit,
    scope_clauses: (p.scopeClauses || []).join(', '),
    planned_date: String(p.plannedDate || '').trim(),
    audit_date: '',
    lead_auditor: lead,
    lead_auditor_email: leadEmail,
    auditors: String(p.auditors || '').trim(),
    auditee: String(p.auditee || '').trim(),
    status: AUDIT_STATUS.PLANNED,
    summary_note: '',
    created_at: now,
    created_by: getCurrentUser().email || String(p.createdBy || ''),
    token: Utilities.getUuid()
  };
  appendByName_(SHEET_NAMES.AUDITS, row);

  if (leadEmail.indexOf('@') > -1) {
    const url = ScriptApp.getService().getUrl() + '?page=audit&id=' + auditId;
    MailApp.sendEmail(leadEmail,
      'มอบหมายรอบตรวจติดตามภายใน ' + row.audit_no + ' (' + unit + ')',
      'ท่านได้รับมอบหมายเป็นหัวหน้าทีมผู้ตรวจ\n\n' +
      'เลขที่รอบตรวจ: ' + row.audit_no + '\n' +
      'หน่วยงานที่ตรวจ: ' + unit + '\n' +
      'ประเภท: ' + labelOf_(AUDIT_TYPES, row.audit_type) + '\n' +
      'วันที่นัดตรวจ: ' + (row.planned_date || '-') + '\n' +
      'ขอบเขต (ข้อกำหนด): ' + (row.scope_clauses || '-') + '\n\n' +
      'บันทึกผลการตรวจที่: ' + url);
  }
  return { auditId: auditId, auditNo: row.audit_no, selfAudit: selfAudit };
}

function getAuditList() {
  ensureAuditSetup_();
  const findings = readTable_(SHEET_NAMES.FINDINGS);
  return readTable_(SHEET_NAMES.AUDITS).map(function (a) {
    const mine = findings.filter(function (f) { return f.audit_id === a.audit_id; });
    const nc = mine.filter(function (f) { return gradeDef_(String(f.grade)).needsCapa; }).length;
    const openNc = mine.filter(function (f) {
      return gradeDef_(String(f.grade)).needsCapa && String(f.status) !== FINDING_STATUS.CLOSED;
    }).length;
    return {
      auditId: a.audit_id, auditNo: a.audit_no,
      auditTypeLabel: labelOf_(AUDIT_TYPES, String(a.audit_type)),
      unit: a.unit, status: a.status,
      plannedDate: formatThaiDate_(a.planned_date),
      auditDate: formatThaiDate_(a.audit_date),
      leadAuditor: a.lead_auditor,
      findingCount: mine.length, ncCount: nc, openNcCount: openNc,
      reportPdfUrl: String(a.report_pdf_url || '')
    };
  }).sort(function (x, y) { return String(y.auditNo).localeCompare(String(x.auditNo)); });
}

function getAudit(auditId) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.AUDITS, 'audit_id', auditId);
  if (!row) throw new Error('ไม่พบรอบตรวจนี้');
  const a = row.toObject();
  const capas = readTable_(SHEET_NAMES.CAPAS);
  const findings = readTable_(SHEET_NAMES.FINDINGS)
    .filter(function (f) { return f.audit_id === auditId; })
    .map(function (f) {
      const capa = capas.filter(function (c) { return c.capa_id === f.capa_id; })[0];
      return {
        findingId: f.finding_id, findingNo: f.finding_no, clause: f.clause,
        grade: f.grade, gradeLabel: gradeDef_(String(f.grade)).label,
        needsCapa: gradeDef_(String(f.grade)).needsCapa,
        title: f.title, description: f.description, evidence: f.evidence,
        relatedDocCode: f.related_doc_code, status: f.status,
        capaId: f.capa_id || '',
        capaNo: capa ? capa.capa_no : '',
        capaStatus: capa ? capa.status : ''
      };
    })
    .sort(function (x, y) { return String(x.findingNo).localeCompare(String(y.findingNo)); });

  return {
    auditId: auditId, auditNo: a.audit_no,
    auditType: a.audit_type, auditTypeLabel: labelOf_(AUDIT_TYPES, String(a.audit_type)),
    unit: a.unit, scopeClauses: String(a.scope_clauses || ''),
    plannedDate: toIsoDate_(a.planned_date), plannedDateThai: formatThaiDate_(a.planned_date),
    auditDate: toIsoDate_(a.audit_date), auditDateThai: formatThaiDate_(a.audit_date),
    leadAuditor: a.lead_auditor, leadAuditorEmail: a.lead_auditor_email,
    auditors: a.auditors, auditee: a.auditee,
    status: a.status, summaryNote: String(a.summary_note || ''),
    leadName: String(a.lead_name || ''), leadAt: formatThaiDate_(a.lead_at),
    leadSignature: String(a.lead_signature || ''),
    qmTitle: String(getConfigValue_('qm_title', 'ผู้จัดการคุณภาพ')),
    qmName: String(a.qm_name || ''), qmAt: formatThaiDate_(a.qm_at),
    qmSignature: String(a.qm_signature || ''), qmComment: String(a.qm_comment || ''),
    reportPdfUrl: String(a.report_pdf_url || ''),
    orgLine: String(getConfigValue_('org_line', '') || ''),
    findings: findings,
    me: getCurrentUser()
  };
}

/**
 * บันทึก finding 1 ข้อ (สร้างใหม่ถ้าไม่ส่ง findingId มา)
 * payload: { auditId, findingId?, clause, grade, title, description, evidence, relatedDocCode }
 */
function saveFinding(payload) {
  ensureAuditSetup_();
  const p = payload || {};
  const audit = findRowById_(SHEET_NAMES.AUDITS, 'audit_id', p.auditId);
  if (!audit) throw new Error('ไม่พบรอบตรวจนี้');
  if (String(audit.get('status')) === AUDIT_STATUS.CLOSED) {
    throw new Error('รอบตรวจนี้ปิดแล้ว แก้ไขผลการตรวจไม่ได้');
  }
  const grade = String(p.grade || '');
  if (!gradeDef_(grade).label) throw new Error('ระดับผลการตรวจไม่ถูกต้อง');
  const title = String(p.title || '').trim();
  if (!title) throw new Error('กรุณากรอกหัวข้อสิ่งที่ตรวจพบ');

  if (p.findingId) {
    const row = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', p.findingId);
    if (!row) throw new Error('ไม่พบรายการตรวจพบนี้');
    row.set('clause', String(p.clause || ''));
    row.set('grade', grade);
    row.set('title', title);
    row.set('description', String(p.description || '').trim());
    row.set('evidence', String(p.evidence || '').trim());
    row.set('related_doc_code', String(p.relatedDocCode || '').trim().toUpperCase());
    return { findingId: p.findingId };
  }

  // เลขที่ finding ต่อรอบ: <เลขรอบ>/F01
  const existing = readTable_(SHEET_NAMES.FINDINGS).filter(function (f) { return f.audit_id === p.auditId; });
  let seq = String(existing.length + 1);
  while (seq.length < 2) seq = '0' + seq;

  const findingId = Utilities.getUuid();
  appendByName_(SHEET_NAMES.FINDINGS, {
    finding_id: findingId,
    audit_id: p.auditId,
    finding_no: audit.get('audit_no') + '/F' + seq,
    clause: String(p.clause || ''),
    grade: grade,
    title: title,
    description: String(p.description || '').trim(),
    evidence: String(p.evidence || '').trim(),
    related_doc_code: String(p.relatedDocCode || '').trim().toUpperCase(),
    status: gradeDef_(grade).needsCapa ? FINDING_STATUS.OPEN : FINDING_STATUS.CLOSED,
    capa_id: '',
    created_at: new Date(),
    created_by: getCurrentUser().email || ''
  });

  if (String(audit.get('status')) === AUDIT_STATUS.PLANNED) {
    audit.set('status', AUDIT_STATUS.IN_PROGRESS);
    if (!audit.get('audit_date')) audit.set('audit_date', toIsoDate_(new Date()));
  }
  return { findingId: findingId };
}

function deleteFinding(findingId) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', findingId);
  if (!row) throw new Error('ไม่พบรายการตรวจพบนี้');
  if (String(row.get('capa_id') || '')) {
    throw new Error('รายการนี้เปิด CAPA ไปแล้ว ลบไม่ได้ — ให้ยกเลิก CAPA ก่อน');
  }
  row.sheet.deleteRow(row.rowNum);
  return { ok: true };
}

/** จบการตรวจ -> ขอลงนามสรุปผล (หัวหน้าทีมผู้ตรวจ แล้วส่งต่อ QM) */
function submitAuditSummary(auditId, summaryNote) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.AUDITS, 'audit_id', auditId);
  if (!row) throw new Error('ไม่พบรอบตรวจนี้');
  if (String(row.get('status')) === AUDIT_STATUS.CLOSED) throw new Error('รอบตรวจนี้ปิดแล้ว');

  const findings = readTable_(SHEET_NAMES.FINDINGS).filter(function (f) { return f.audit_id === auditId; });
  if (!findings.length) throw new Error('ยังไม่มีผลการตรวจในรอบนี้');
  const ncNoCapa = findings.filter(function (f) {
    return gradeDef_(String(f.grade)).needsCapa && !String(f.capa_id || '');
  });
  if (ncNoCapa.length) {
    throw new Error('ยังมี NC ที่ยังไม่ได้เปิด CAPA จำนวน ' + ncNoCapa.length + ' ข้อ (' +
      ncNoCapa.map(function (f) { return f.finding_no; }).join(', ') + ') — ต้องเปิด CAPA ให้ครบก่อนปิดรอบ');
  }

  row.set('summary_note', String(summaryNote || '').trim().slice(0, 2000));
  row.set('status', AUDIT_STATUS.WAIT_SIGN);
  if (!row.get('audit_date')) row.set('audit_date', toIsoDate_(new Date()));

  const url = ScriptApp.getService().getUrl() + '?page=audit&id=' + auditId;
  const qm = qmEmail_();
  if (qm.indexOf('@') > -1) {
    MailApp.sendEmail(qm,
      'รอลงนามสรุปผลการตรวจติดตามภายใน ' + row.get('audit_no'),
      'รอบตรวจ ' + row.get('audit_no') + ' (' + row.get('unit') + ') บันทึกผลครบแล้ว รอการลงนาม\n\n' +
      'จำนวนสิ่งที่ตรวจพบ: ' + findings.length + ' ข้อ\n' +
      'NC: ' + findings.filter(function (f) { return gradeDef_(String(f.grade)).needsCapa; }).length + ' ข้อ\n\n' +
      'ลงนามที่: ' + url);
  }
  return { status: AUDIT_STATUS.WAIT_SIGN };
}

/** ลงนามปิดรอบตรวจ: หัวหน้าทีมผู้ตรวจ (stage=lead) แล้ว QM (stage=qm) -> สร้างรายงาน PDF */
function signAudit(auditId, stage, signerName, signature, comment) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.AUDITS, 'audit_id', auditId);
  if (!row) throw new Error('ไม่พบรอบตรวจนี้');
  if (String(row.get('status')) !== AUDIT_STATUS.WAIT_SIGN) {
    throw new Error('รอบตรวจนี้อยู่ในสถานะ "' + row.get('status') + '" ยังลงนามไม่ได้');
  }
  const name = String(signerName || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อผู้ลงนาม');
  const sig = validateSignature_(signature);
  if (!sig) throw new Error('ลายเซ็นไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');
  const now = new Date();

  if (stage === 'lead') {
    if (String(row.get('lead_signature') || '')) throw new Error('หัวหน้าทีมผู้ตรวจลงนามไปแล้ว');
    row.set('lead_name', name);
    row.set('lead_at', now);
    row.set('lead_signature', sig);
    return { status: AUDIT_STATUS.WAIT_SIGN, next: 'qm' };
  }

  requireRole_(['qm', 'admin']);
  if (!String(row.get('lead_signature') || '')) {
    throw new Error('ต้องให้หัวหน้าทีมผู้ตรวจลงนามก่อน');
  }
  row.set('qm_name', name);
  row.set('qm_at', now);
  row.set('qm_signature', sig);
  row.set('qm_comment', trimComment_(comment));
  row.set('status', AUDIT_STATUS.CLOSED);
  row.set('closed_at', now);

  let pdfUrl = '';
  try {
    const file = saveAuditReportPdf_(getAudit(auditId));
    pdfUrl = file.getUrl();
    row.set('report_pdf_id', file.getId());
    row.set('report_pdf_url', pdfUrl);
  } catch (err) {
    Logger.log('สร้างรายงานผลการตรวจไม่สำเร็จ (' + auditId + '): ' + err);
  }
  return { status: AUDIT_STATUS.CLOSED, reportPdfUrl: pdfUrl };
}

// ============================================================
// 5. CAPA
// ============================================================

function getCapaInit() {
  ensureAuditSetup_();
  const units = Object.keys(getUnitMap_()).sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return {
    units: units.length ? units : DEFAULT_UNITS,
    sources: CAPA_SOURCES,
    methods: ROOT_CAUSE_METHODS,
    clauses: ISO15189_CLAUSES,
    statuses: CAPA_STATUS,
    defaultDueDays: Number(getConfigValue_('capa_default_due_days', 30)) || 30,
    effectivenessDays: Number(getConfigValue_('effectiveness_check_days', 90)) || 90,
    me: getCurrentUser()
  };
}

/** ข้อมูล finding สำหรับเติมฟอร์มเปิด CAPA ให้อัตโนมัติ */
function getFindingForCapa(findingId) {
  ensureAuditSetup_();
  const f = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', findingId);
  if (!f) throw new Error('ไม่พบรายการตรวจพบนี้');
  if (String(f.get('capa_id') || '')) throw new Error('รายการตรวจพบนี้เปิด CAPA ไปแล้ว');
  const a = findRowById_(SHEET_NAMES.AUDITS, 'audit_id', f.get('audit_id'));
  const g = gradeDef_(String(f.get('grade')));
  const parts = [String(f.get('title') || '')];
  if (f.get('description')) parts.push(String(f.get('description')));
  if (f.get('evidence')) parts.push('หลักฐาน: ' + f.get('evidence'));
  return {
    findingId: findingId,
    findingNo: f.get('finding_no'),
    auditNo: a ? a.get('audit_no') : '',
    auditId: a ? a.get('audit_id') : '',
    unit: a ? a.get('unit') : '',
    clause: String(f.get('clause') || ''),
    gradeLabel: g.label,
    problem: parts.join('\n'),
    relatedDocCode: String(f.get('related_doc_code') || ''),
    suggestedDue: addDaysIso_(g.dueDays)
  };
}

/**
 * เปิด CAPA — มาจาก finding หรือเปิดตรง ๆ จากแหล่งอื่น
 * payload: { source, findingId?, unit, clause, problem, immediateCorrection, ownerName, ownerEmail, dueDate }
 */
function createCapa(payload) {
  ensureAuditSetup_();
  const p = payload || {};
  const problem = String(p.problem || '').trim();
  if (!problem) throw new Error('กรุณาอธิบายปัญหา/ความไม่สอดคล้องที่พบ');
  const unit = String(p.unit || '').trim();
  if (!unit) throw new Error('กรุณาเลือกงาน/หน่วยงาน');

  let finding = null;
  if (p.findingId) {
    finding = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', p.findingId);
    if (!finding) throw new Error('ไม่พบรายการตรวจพบที่อ้างถึง');
    if (String(finding.get('capa_id') || '')) throw new Error('รายการตรวจพบนี้เปิด CAPA ไปแล้ว');
  }

  const capaId = Utilities.getUuid();
  const token = Utilities.getUuid();
  const dueDays = finding
    ? gradeDef_(String(finding.get('grade'))).dueDays
    : Number(getConfigValue_('capa_default_due_days', 30)) || 30;

  appendByName_(SHEET_NAMES.CAPAS, {
    capa_id: capaId,
    capa_no: nextSerial_(SHEET_NAMES.CAPAS, 'capa_no', 'CAPA', 3),
    source: String(p.source || (finding ? 'audit' : 'other')),
    finding_id: p.findingId || '',
    unit: unit,
    clause: String(p.clause || (finding ? finding.get('clause') : '')),
    problem: problem,
    immediate_correction: String(p.immediateCorrection || '').trim(),
    owner_name: String(p.ownerName || '').trim(),
    owner_email: String(p.ownerEmail || '').trim(),
    due_date: String(p.dueDate || '').trim() || addDaysIso_(dueDays),
    status: CAPA_STATUS.OPEN,
    related_doc_code: String(p.relatedDocCode || (finding ? finding.get('related_doc_code') : '')).toUpperCase(),
    created_at: new Date(),
    created_by: getCurrentUser().email || '',
    token: token
  });

  if (finding) {
    finding.set('capa_id', capaId);
    finding.set('status', FINDING_STATUS.IN_CAPA);
  }

  const owner = String(p.ownerEmail || '').trim();
  if (owner.indexOf('@') > -1) sendCapaMail_(capaId, token, owner, 'มอบหมายให้ท่านวิเคราะห์สาเหตุและกำหนดแนวทางแก้ไข');
  return { capaId: capaId, token: token };
}

function sendCapaMail_(capaId, token, toEmail, headline) {
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) return;
  const url = ScriptApp.getService().getUrl() + '?page=capa&id=' + capaId + '&token=' + token;
  MailApp.sendEmail(toEmail,
    'CAPA ' + row.get('capa_no') + ' (' + row.get('unit') + '): ' + headline,
    headline + '\n\n' +
    'เลขที่ CAPA: ' + row.get('capa_no') + '\n' +
    'แหล่งที่มา: ' + labelOf_(CAPA_SOURCES, String(row.get('source'))) + '\n' +
    'หน่วยงาน: ' + row.get('unit') + '\n' +
    'ข้อกำหนดที่เกี่ยวข้อง: ' + (row.get('clause') || '-') + '\n' +
    'ปัญหาที่พบ: ' + row.get('problem') + '\n' +
    'กำหนดแล้วเสร็จ: ' + formatThaiDate_(row.get('due_date')) + '\n\n' +
    'เปิดแบบฟอร์ม CAPA ที่: ' + url);
}

function getCapaList(filter) {
  ensureAuditSetup_();
  const f = filter || {};
  const findings = readTable_(SHEET_NAMES.FINDINGS);
  return readTable_(SHEET_NAMES.CAPAS).map(function (c) {
    const fd = findings.filter(function (x) { return x.finding_id === c.finding_id; })[0];
    const open = (String(c.status) !== CAPA_STATUS.CLOSED && String(c.status) !== CAPA_STATUS.CANCELLED);
    return {
      capaId: c.capa_id, capaNo: c.capa_no, token: c.token,
      source: c.source, sourceLabel: labelOf_(CAPA_SOURCES, String(c.source)),
      unit: c.unit, clause: c.clause,
      problem: String(c.problem || ''),
      ownerName: c.owner_name, dueDate: formatThaiDate_(c.due_date),
      dueIso: toIsoDate_(c.due_date),
      status: c.status,
      overdue: open && isOverdue_(c.due_date),
      findingNo: fd ? fd.finding_no : '',
      relatedDocCode: String(c.related_doc_code || ''),
      pdfUrl: String(c.pdf_url || ''),
      closedAt: formatThaiDate_(c.closed_at)
    };
  }).filter(function (c) {
    if (f.unit && c.unit !== f.unit) return false;
    if (f.openOnly && (c.status === CAPA_STATUS.CLOSED || c.status === CAPA_STATUS.CANCELLED)) return false;
    return true;
  }).sort(function (a, b) { return String(b.capaNo).localeCompare(String(a.capaNo)); });
}

/** token ว่างได้ถ้าเปิดจากหน้ารายการในระบบ — ส่ง token มาเมื่อเข้าจากลิงก์ในอีเมล */
function getCapa(capaId, token) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  if (token && row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
  const c = row.toObject();

  let findingInfo = null;
  if (c.finding_id) {
    const f = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', c.finding_id);
    if (f) {
      const a = findRowById_(SHEET_NAMES.AUDITS, 'audit_id', f.get('audit_id'));
      findingInfo = {
        findingNo: f.get('finding_no'), clause: f.get('clause'),
        gradeLabel: gradeDef_(String(f.get('grade'))).label,
        title: f.get('title'), description: f.get('description'), evidence: f.get('evidence'),
        auditNo: a ? a.get('audit_no') : '', auditId: a ? a.get('audit_id') : ''
      };
    }
  }

  return {
    capaId: capaId, capaNo: c.capa_no, token: c.token,
    source: c.source, sourceLabel: labelOf_(CAPA_SOURCES, String(c.source)),
    unit: c.unit, clause: String(c.clause || ''),
    problem: String(c.problem || ''),
    immediateCorrection: String(c.immediate_correction || ''),
    rootCause: String(c.root_cause || ''),
    rootCauseMethod: String(c.root_cause_method || ''),
    actionPlan: String(c.action_plan || ''),
    ownerName: String(c.owner_name || ''), ownerEmail: String(c.owner_email || ''),
    dueDate: toIsoDate_(c.due_date), dueDateThai: formatThaiDate_(c.due_date),
    status: String(c.status || ''),
    overdue: isOverdue_(c.due_date) && String(c.status) !== CAPA_STATUS.CLOSED && String(c.status) !== CAPA_STATUS.CANCELLED,
    actionResult: String(c.action_result || ''),
    actionDoneAt: formatThaiDate_(c.action_done_at),
    effectivenessDue: toIsoDate_(c.effectiveness_due),
    effectivenessDueThai: formatThaiDate_(c.effectiveness_due),
    effectivenessResult: String(c.effectiveness_result || ''),
    verifierName: String(c.verifier_name || ''), verifiedAt: formatThaiDate_(c.verified_at),
    verifierSignature: String(c.verifier_signature || ''), verifierComment: String(c.verifier_comment || ''),
    relatedDocCode: String(c.related_doc_code || ''),
    relatedDocId: String(c.related_doc_id || ''),
    pdfUrl: String(c.pdf_url || ''),
    createdAt: formatThaiDate_(c.created_at),
    closedAt: formatThaiDate_(c.closed_at),
    orgLine: String(getConfigValue_('org_line', '') || ''),
    qmTitle: String(getConfigValue_('qm_title', 'ผู้จัดการคุณภาพ')),
    finding: findingInfo,
    me: getCurrentUser()
  };
}

/**
 * ขั้นที่ 1 ของ CAPA: วิเคราะห์สาเหตุราก + วางแผนแก้ไข
 * ระบบไม่ยอมให้ข้ามไปขั้นรายงานผลถ้ายังไม่มี root cause — นี่คือจุดที่ CAPA ต่างจาก "แก้เฉพาะหน้า"
 */
function saveCapaAnalysis(capaId, token, payload) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  if (token && row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
  const status = String(row.get('status'));
  if (status === CAPA_STATUS.CLOSED || status === CAPA_STATUS.CANCELLED) {
    throw new Error('CAPA นี้ปิดแล้ว แก้ไขไม่ได้');
  }

  const p = payload || {};
  const rootCause = String(p.rootCause || '').trim();
  const actionPlan = String(p.actionPlan || '').trim();
  if (!rootCause) throw new Error('กรุณาระบุสาเหตุราก (root cause) — ห้ามข้ามขั้นนี้');
  if (!actionPlan) throw new Error('กรุณาระบุแนวทางแก้ไขที่สาเหตุราก');

  row.set('root_cause', rootCause.slice(0, 2000));
  row.set('root_cause_method', String(p.rootCauseMethod || '').trim());
  row.set('action_plan', actionPlan.slice(0, 2000));
  row.set('immediate_correction', String(p.immediateCorrection || '').trim().slice(0, 1000));
  if (p.ownerName) row.set('owner_name', String(p.ownerName).trim());
  if (p.ownerEmail) row.set('owner_email', String(p.ownerEmail).trim());
  if (p.dueDate) row.set('due_date', String(p.dueDate).trim());
  if (p.relatedDocCode) row.set('related_doc_code', String(p.relatedDocCode).trim().toUpperCase());
  if (status === CAPA_STATUS.OPEN) row.set('status', CAPA_STATUS.IN_ACTION);
  return { status: CAPA_STATUS.IN_ACTION };
}

/** ขั้นที่ 2: รายงานว่าทำตามแผนแล้ว -> เข้าคิวรอทวนสอบประสิทธิผล */
function reportCapaAction(capaId, token, payload) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  if (token && row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
  if (!String(row.get('root_cause') || '')) {
    throw new Error('ยังไม่ได้บันทึกสาเหตุราก — กรอกขั้นวิเคราะห์ให้ครบก่อน');
  }
  const p = payload || {};
  const result = String(p.actionResult || '').trim();
  if (!result) throw new Error('กรุณาสรุปผลการดำเนินการแก้ไข');

  const days = Number(getConfigValue_('effectiveness_check_days', 90)) || 90;
  row.set('action_result', result.slice(0, 2000));
  row.set('action_done_at', new Date());
  row.set('effectiveness_due', String(p.effectivenessDue || '').trim() || addDaysIso_(days));
  row.set('status', CAPA_STATUS.WAIT_VERIFY);
  if (p.relatedDocCode) row.set('related_doc_code', String(p.relatedDocCode).trim().toUpperCase());

  const qm = qmEmail_();
  if (qm.indexOf('@') > -1) {
    sendCapaMail_(capaId, row.get('token'), qm,
      'ดำเนินการแก้ไขเสร็จแล้ว รอการทวนสอบประสิทธิผล (กำหนดทวนสอบ ' +
      formatThaiDate_(row.get('effectiveness_due')) + ')');
  }
  return { status: CAPA_STATUS.WAIT_VERIFY };
}

/**
 * ขั้นที่ 3: ทวนสอบประสิทธิผลแล้วลงนามปิด
 * ไม่ผ่าน = ตีกลับไปขั้นแก้ไข (CAPA ไม่ถูกปิด) ตามหลัก "ปิดได้ต่อเมื่อพิสูจน์ว่าได้ผลจริง"
 */
function verifyCapa(capaId, token, payload) {
  ensureAuditSetup_();
  requireRole_(['qm', 'admin']);
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  if (token && row.get('token') !== token) throw new Error('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
  if (String(row.get('status')) !== CAPA_STATUS.WAIT_VERIFY) {
    throw new Error('CAPA นี้อยู่ในสถานะ "' + row.get('status') + '" ยังทวนสอบไม่ได้');
  }

  const p = payload || {};
  const name = String(p.verifierName || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อผู้ทวนสอบ');
  const result = String(p.effectivenessResult || '').trim();
  if (!result) throw new Error('กรุณาบันทึกหลักฐาน/ผลการทวนสอบประสิทธิผล');
  const sig = validateSignature_(p.signature);
  if (!sig) throw new Error('ลายเซ็นไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');

  const now = new Date();
  row.set('effectiveness_result', result.slice(0, 2000));
  row.set('verifier_name', name);
  row.set('verified_at', now);
  row.set('verifier_signature', sig);
  row.set('verifier_comment', trimComment_(p.comment));

  if (!p.pass) {
    // ไม่ผ่าน -> กลับไปแก้ พร้อมกำหนดใหม่
    row.set('status', CAPA_STATUS.IN_ACTION);
    row.set('due_date', String(p.newDueDate || '').trim() ||
      addDaysIso_(Number(getConfigValue_('capa_default_due_days', 30)) || 30));
    const owner = String(row.get('owner_email') || '');
    if (owner.indexOf('@') > -1) {
      sendCapaMail_(capaId, row.get('token'), owner,
        'ผลการทวนสอบ "ไม่ผ่าน" — ต้องทบทวนแนวทางแก้ไขใหม่ (' + trimComment_(p.comment) + ')');
    }
    return { status: CAPA_STATUS.IN_ACTION, pass: false };
  }

  row.set('status', CAPA_STATUS.CLOSED);
  row.set('closed_at', now);

  // ปิด finding ต้นทางด้วย ถ้า CAPA นี้มาจาก audit
  const findingId = String(row.get('finding_id') || '');
  if (findingId) {
    const f = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', findingId);
    if (f) f.set('status', FINDING_STATUS.CLOSED);
  }

  let pdfUrl = '';
  try {
    const file = saveCapaPdf_(getCapa(capaId, ''));
    pdfUrl = file.getUrl();
    row.set('pdf_id', file.getId());
    row.set('pdf_url', pdfUrl);
  } catch (err) {
    Logger.log('สร้างแบบฟอร์ม CAPA (PDF) ไม่สำเร็จ (' + capaId + '): ' + err);
  }

  const owner = String(row.get('owner_email') || '');
  if (owner.indexOf('@') > -1) {
    MailApp.sendEmail(owner, 'ปิด CAPA ' + row.get('capa_no') + ' แล้ว',
      'ผลการทวนสอบประสิทธิผล: ผ่าน\n' +
      'ผู้ทวนสอบ: ' + name + '\n' +
      (pdfUrl ? '\nแบบฟอร์ม CAPA: ' + pdfUrl : ''));
  }
  return { status: CAPA_STATUS.CLOSED, pass: true, pdfUrl: pdfUrl };
}

/** ข้อมูล CAPA สำหรับเติมฟอร์มเปิดใบขออนุมัติเอกสาร (DAR) — ใช้จากปุ่มในหน้า CAPA */
function getCapaForDar(capaId) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  const parts = ['แก้ไขเอกสารตาม ' + row.get('capa_no')];
  if (row.get('problem')) parts.push('ปัญหาที่พบ: ' + row.get('problem'));
  if (row.get('root_cause')) parts.push('สาเหตุราก: ' + row.get('root_cause'));
  if (row.get('action_plan')) parts.push('แนวทางแก้ไข: ' + row.get('action_plan'));
  return {
    capaId: capaId,
    capaNo: String(row.get('capa_no')),
    unit: String(row.get('unit') || ''),
    clause: String(row.get('clause') || ''),
    docCode: String(row.get('related_doc_code') || ''),
    reason: parts.join('\n')
  };
}

function cancelCapa(capaId, reason) {
  ensureAuditSetup_();
  requireRole_(['qm', 'admin']);
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  if (String(row.get('status')) === CAPA_STATUS.CLOSED) throw new Error('CAPA ที่ปิดแล้วยกเลิกไม่ได้');
  row.set('status', CAPA_STATUS.CANCELLED);
  row.set('verifier_comment', trimComment_(reason));
  row.set('closed_at', new Date());
  const findingId = String(row.get('finding_id') || '');
  if (findingId) {
    const f = findRowById_(SHEET_NAMES.FINDINGS, 'finding_id', findingId);
    if (f) { f.set('capa_id', ''); f.set('status', FINDING_STATUS.OPEN); }
  }
  return { status: CAPA_STATUS.CANCELLED };
}

/**
 * ผูก CAPA กับเอกสารฉบับที่ออกมาแก้ — ปิดวง WI → Audit → CAPA → WI ฉบับใหม่
 * รับเลขเอกสาร แล้วหาฉบับล่าสุดของเลขนั้นให้เอง
 */
function linkCapaToDocument(capaId, docCode) {
  ensureAuditSetup_();
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  if (!row) throw new Error('ไม่พบ CAPA นี้');
  const rows = getDocsByCode_(docCode);
  if (!rows.length) throw new Error('ไม่พบเลขเอกสาร ' + docCode + ' ในคลัง');
  row.set('related_doc_code', String(docCode).trim().toUpperCase());
  row.set('related_doc_id', rows[0].docId);
  return {
    docCode: String(docCode).trim().toUpperCase(),
    revision: rows[0].revision,
    status: rows[0].status
  };
}

// ============================================================
// 6. PDF (รายงานผลการตรวจ + แบบฟอร์ม CAPA)
// ============================================================

function getQualityFolder_(sub) {
  return getOrCreateChild_(getDriveRoot_(), sub);
}

function buildAuditReportHtml_(a) {
  let rows = '';
  (a.findings || []).forEach(function (f) {
    rows += '<tr>' +
      '<td>' + htmlEscape_(f.findingNo) + '</td>' +
      '<td>' + htmlEscape_(f.clause) + '</td>' +
      '<td>' + htmlEscape_(f.gradeLabel) + '</td>' +
      '<td>' + htmlEscape_(f.title) +
      (f.description ? '<br><span style="color:#555">' + htmlEscape_(f.description) + '</span>' : '') +
      (f.evidence ? '<br><span style="color:#555">หลักฐาน: ' + htmlEscape_(f.evidence) + '</span>' : '') +
      (f.relatedDocCode ? '<br><span style="color:#555">เอกสารที่เกี่ยวข้อง: ' + htmlEscape_(f.relatedDocCode) + '</span>' : '') +
      '</td>' +
      '<td>' + htmlEscape_(f.capaNo || '-') + '</td>' +
      '</tr>';
  });

  const nc = (a.findings || []).filter(function (f) { return f.needsCapa; }).length;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + pdfCss_() + '</style></head><body>' +
    (a.orgLine ? '<div class="org">' + htmlEscape_(a.orgLine) + '</div>' : '') +
    '<h1>รายงานผลการตรวจติดตามภายใน</h1>' +
    '<div class="org">Internal Audit Report — ' + htmlEscape_(a.auditNo) + '</div>' +
    '<table class="meta">' +
    '<tr><th>เลขที่รอบตรวจ</th><td>' + htmlEscape_(a.auditNo) + '</td></tr>' +
    '<tr><th>ประเภทการตรวจ</th><td>' + htmlEscape_(a.auditTypeLabel) + '</td></tr>' +
    '<tr><th>หน่วยงานที่รับการตรวจ</th><td>' + htmlEscape_(a.unit) + '</td></tr>' +
    '<tr><th>ผู้รับการตรวจ</th><td>' + htmlEscape_(a.auditee || '-') + '</td></tr>' +
    '<tr><th>วันที่ตรวจ</th><td>' + htmlEscape_(a.auditDateThai || a.plannedDateThai) + '</td></tr>' +
    '<tr><th>หัวหน้าทีมผู้ตรวจ</th><td>' + htmlEscape_(a.leadAuditor) + '</td></tr>' +
    '<tr><th>ผู้ตรวจร่วม</th><td>' + htmlEscape_(a.auditors || '-') + '</td></tr>' +
    '<tr><th>ขอบเขต (ข้อกำหนด)</th><td>' + htmlEscape_(a.scopeClauses || '-') + '</td></tr>' +
    '<tr><th>สรุปจำนวน</th><td>ตรวจพบทั้งหมด ' + (a.findings || []).length + ' ข้อ · ความไม่สอดคล้อง (NC) ' + nc + ' ข้อ</td></tr>' +
    '</table>' +
    '<table class="list"><tr><th style="width:13%">เลขที่</th><th style="width:9%">ข้อกำหนด</th>' +
    '<th style="width:16%">ระดับ</th><th>สิ่งที่ตรวจพบ</th><th style="width:14%">CAPA</th></tr>' +
    (rows || '<tr><td colspan="5">ไม่มีสิ่งที่ตรวจพบ</td></tr>') + '</table>' +
    '<div class="block"><b>สรุปผลการตรวจโดยหัวหน้าทีมผู้ตรวจ</b>' + htmlEscape_(a.summaryNote || '-') + '</div>' +
    '<div class="sigs">' +
    sigHtml_('หัวหน้าทีมผู้ตรวจ', a.leadName, a.leadAt, a.leadSignature, '') +
    sigHtml_(a.qmTitle || 'ผู้จัดการคุณภาพ', a.qmName, a.qmAt, a.qmSignature, a.qmComment) +
    '</div>' +
    '<div class="foot">รายงานนี้ลงนามด้วยลายเซ็นอิเล็กทรอนิกส์ผ่านระบบคุณภาพออนไลน์</div>' +
    '</body></html>';
}

function saveAuditReportPdf_(a) {
  const html = buildAuditReportHtml_(a);
  const fileName = safeFileName_('รายงานผลการตรวจติดตามภายใน ' + a.auditNo + ' ' + a.unit) + '.pdf';
  const pdf = Utilities.newBlob(html, MimeType.HTML, fileName).getAs(MimeType.PDF).setName(fileName);
  const folder = getOrCreateChild_(getQualityFolder_('รายงานการตรวจติดตามภายใน (Audit)'), a.unit);
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(pdf);
  file.setDescription('รายงานผลการตรวจติดตามภายใน ' + a.auditNo + ' — ' + a.unit);
  return file;
}

function buildCapaHtml_(c) {
  const block = function (title, body) {
    return '<div class="block"><b>' + htmlEscape_(title) + '</b>' + htmlEscape_(body || '-') + '</div>';
  };
  const f = c.finding;
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + pdfCss_() + '</style></head><body>' +
    (c.orgLine ? '<div class="org">' + htmlEscape_(c.orgLine) + '</div>' : '') +
    '<h1>แบบฟอร์มการแก้ไขและป้องกัน (CAPA)</h1>' +
    '<div class="org">Corrective and Preventive Action — ' + htmlEscape_(c.capaNo) + '</div>' +
    '<table class="meta">' +
    '<tr><th>เลขที่ CAPA</th><td>' + htmlEscape_(c.capaNo) + '</td></tr>' +
    '<tr><th>แหล่งที่มา</th><td>' + htmlEscape_(c.sourceLabel) +
    (f ? ' — ' + htmlEscape_(f.auditNo + ' ข้อ ' + f.findingNo + ' (' + f.gradeLabel + ')') : '') + '</td></tr>' +
    '<tr><th>หน่วยงาน</th><td>' + htmlEscape_(c.unit) + '</td></tr>' +
    '<tr><th>ข้อกำหนดที่เกี่ยวข้อง</th><td>' + htmlEscape_(c.clause || '-') + '</td></tr>' +
    '<tr><th>ผู้รับผิดชอบ</th><td>' + htmlEscape_(c.ownerName || '-') + '</td></tr>' +
    '<tr><th>วันที่เปิด / กำหนดแล้วเสร็จ</th><td>' + htmlEscape_(c.createdAt) + ' / ' + htmlEscape_(c.dueDateThai) + '</td></tr>' +
    '<tr><th>เอกสารที่ออก/แก้ไขจาก CAPA นี้</th><td>' + htmlEscape_(c.relatedDocCode || '-') + '</td></tr>' +
    '</table>' +
    block('1. ปัญหา / ความไม่สอดคล้องที่พบ', c.problem) +
    block('2. การแก้ไขเฉพาะหน้า (Correction)', c.immediateCorrection) +
    block('3. สาเหตุราก (Root cause) — วิธีวิเคราะห์: ' + (c.rootCauseMethod || '-'), c.rootCause) +
    block('4. แนวทางแก้ไขที่สาเหตุราก (Corrective action)', c.actionPlan) +
    block('5. ผลการดำเนินการ (' + (c.actionDoneAt || '-') + ')', c.actionResult) +
    block('6. การทวนสอบประสิทธิผล (' + (c.effectivenessDueThai || '-') + ')', c.effectivenessResult) +
    '<div class="sigs">' +
    sigHtml_('ผู้รับผิดชอบดำเนินการ', c.ownerName, c.actionDoneAt, '', '') +
    sigHtml_(c.qmTitle || 'ผู้ทวนสอบประสิทธิผล', c.verifierName, c.verifiedAt, c.verifierSignature, c.verifierComment) +
    '</div>' +
    '<div class="foot">สถานะ: ' + htmlEscape_(c.status) + (c.closedAt ? ' · ปิดเมื่อ ' + htmlEscape_(c.closedAt) : '') + '</div>' +
    '</body></html>';
}

function saveCapaPdf_(c) {
  const html = buildCapaHtml_(c);
  const fileName = safeFileName_('CAPA ' + c.capaNo + ' ' + c.unit) + '.pdf';
  const pdf = Utilities.newBlob(html, MimeType.HTML, fileName).getAs(MimeType.PDF).setName(fileName);
  const folder = getOrCreateChild_(getQualityFolder_('แบบฟอร์ม CAPA'), c.unit);
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(pdf);
  file.setDescription('แบบฟอร์ม CAPA ' + c.capaNo + ' — ' + c.unit);
  return file;
}

function regenerateCapaPdf(capaId) {
  const c = getCapa(capaId, '');
  const file = saveCapaPdf_(c);
  const row = findRowById_(SHEET_NAMES.CAPAS, 'capa_id', capaId);
  row.set('pdf_id', file.getId());
  row.set('pdf_url', file.getUrl());
  return { pdfUrl: file.getUrl() };
}

// ============================================================
// 7. หน้ารวม (Home dashboard)
// ============================================================

/** ตัวเลขทั้งระบบในที่เดียว — เอกสาร + audit + CAPA */
function getHomeData() {
  ensureAuditSetup_();
  ensureDarSetup_();
  const docs = readTable_(SHEET_NAMES.DOCS);
  const audits = readTable_(SHEET_NAMES.AUDITS);
  const findings = readTable_(SHEET_NAMES.FINDINGS);
  const capas = readTable_(SHEET_NAMES.CAPAS);

  const waitingDocs = docs.filter(function (d) {
    return String(d.status) === STATUS.WAIT_REVIEW || String(d.status) === STATUS.WAIT_APPROVE;
  }).map(function (d) {
    return {
      docCode: d.doc_code, revision: d.revision, title: d.doc_title,
      unit: d.unit, status: d.status,
      signUrl: ScriptApp.getService().getUrl() + '?page=sign&id=' + d.doc_id + '&token=' + d.token
    };
  });

  const openCapas = capas.filter(function (c) {
    return String(c.status) !== CAPA_STATUS.CLOSED && String(c.status) !== CAPA_STATUS.CANCELLED;
  });
  const overdueCapas = openCapas.filter(function (c) { return isOverdue_(c.due_date); }).map(function (c) {
    return {
      capaId: c.capa_id, capaNo: c.capa_no, unit: c.unit,
      problem: String(c.problem || '').slice(0, 120),
      ownerName: c.owner_name, dueDate: formatThaiDate_(c.due_date), status: c.status
    };
  });

  const openFindings = findings.filter(function (f) {
    return String(f.status) !== FINDING_STATUS.CLOSED;
  }).length;

  const dars = readTable_(SHEET_NAMES.DOC_REQUESTS);
  const darWaiting = dars.filter(function (r) { return String(r.status) === DAR_STATUS.WAIT; });

  return {
    dars: {
      total: dars.length,
      waiting: darWaiting.length,
      approvedPending: dars.filter(function (r) { return String(r.status) === DAR_STATUS.APPROVED; }).length,
      waitingList: darWaiting.slice(0, 8).map(function (r) {
        return {
          darId: r.dar_id, darNo: r.dar_no,
          typeLabel: darTypeDef_(String(r.request_type)).label,
          docCode: String(r.doc_code || ''), docTitle: String(r.doc_title || ''),
          unit: r.unit, requesterName: r.requester_name,
          requestedAt: formatThaiDate_(r.requested_at)
        };
      })
    },
    docs: {
      total: docs.length,
      approved: docs.filter(function (d) { return String(d.status) === STATUS.APPROVED; }).length,
      waiting: waitingDocs.length,
      waitingList: waitingDocs.slice(0, 8),
      dueForReview: getDueForReview(90)
    },
    audits: {
      total: audits.length,
      open: audits.filter(function (a) { return String(a.status) !== AUDIT_STATUS.CLOSED; }).length,
      recent: getAuditList().slice(0, 5)
    },
    findings: { total: findings.length, open: openFindings },
    capas: {
      total: capas.length,
      open: openCapas.length,
      overdue: overdueCapas.length,
      overdueList: overdueCapas.slice(0, 8),
      waitVerify: openCapas.filter(function (c) { return String(c.status) === CAPA_STATUS.WAIT_VERIFY; }).length
    },
    me: getCurrentUser()
  };
}
