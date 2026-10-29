/**
 * ค้นหาเนื้อหาในคลังเอกสาร — ไม่ใช้ LLM ไม่ส่งข้อมูลออกนอกบัญชี Google ขององค์กร
 * ---------------------------------------------------------------------------
 * ดึงข้อความจากไฟล์ "ครั้งเดียวตอนอนุมัติ" เก็บไว้ในแท็บ DocText แล้วค้นจากตรงนั้น
 * คำตอบที่คืนเป็น "ข้อความจริงจากเอกสาร" ไม่ใช่การเรียบเรียงใหม่ — ตรงตามที่งานคุณภาพต้องการ
 *
 * ต้องเปิด Advanced Drive Service (ประกาศไว้ใน appsscript.json แล้ว) เพราะใช้
 * Drive.Files.create แปลงไฟล์เป็น Google Doc ชั่วคราวเพื่ออ่านข้อความ
 */

const DOCTEXT_COLUMNS = ['doc_id', 'doc_code', 'part', 'chars', 'indexed_at', 'text'];

/** เพดานตัวอักษรต่อเซลล์ของ Sheets คือ 50,000 — เผื่อไว้ */
const DOCTEXT_CHUNK = 45000;

/** ชนิดไฟล์ที่ดึงข้อความได้ นอกเหนือจากนี้จะข้าม (เช่น .xlsx ที่ไม่มีเนื้อความให้ค้น) */
const INDEXABLE_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.document',
  'text/plain',
  'image/png',
  'image/jpeg'
];

function ensureSearchSetup_() {
  ensureSheet_(getSS_(), SHEET_NAMES.DOC_TEXT, DOCTEXT_COLUMNS);
}

// ============================================================
// 1. ดึงข้อความจากไฟล์
// ============================================================

/**
 * แปลงไฟล์เป็นข้อความ — คืน '' ถ้าทำไม่ได้ (ผู้เรียกต้องยอมรับได้)
 * PDF/รูปสแกนจะถูก OCR โดย Drive เองตอนแปลงเป็น Google Doc
 */
function extractText_(fileId, mime) {
  if (INDEXABLE_MIME.indexOf(String(mime)) === -1) return '';
  const src = DriveApp.getFileById(fileId);
  if (mime === 'text/plain') return src.getBlob().getDataAsString('UTF-8');
  if (mime === 'application/vnd.google-apps.document') {
    return DocumentApp.openById(fileId).getBody().getText();
  }

  let tempId = '';
  try {
    const temp = Drive.Files.create(
      { name: 'tmp-index-' + fileId, mimeType: MimeType.GOOGLE_DOCS },
      src.getBlob(),
      { ocrLanguage: 'th', supportsAllDrives: true }
    );
    tempId = temp.id;
    return DocumentApp.openById(tempId).getBody().getText();
  } finally {
    // ไฟล์ชั่วคราวต้องหายเสมอ แม้แปลงแล้วอ่านไม่ผ่าน
    if (tempId) {
      try { Drive.Files.remove(tempId); } catch (err) { Logger.log('ลบไฟล์ชั่วคราวไม่สำเร็จ: ' + err); }
    }
  }
}

/** ลบ index เดิมของเอกสารฉบับนั้น (ใช้ตอน reindex) */
function clearDocText_(docId) {
  const sh = getSheet_(SHEET_NAMES.DOC_TEXT);
  const data = sh.getDataRange().getValues();
  const idCol = data[0].indexOf('doc_id');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === docId) sh.deleteRow(i + 1);
  }
}

/**
 * ทำ index ให้เอกสาร 1 ฉบับ — เรียกตอนอนุมัติครบ และตอน reindex ย้อนหลัง
 * หุ้ม try/catch ที่ผู้เรียก: index พังห้ามทำให้การอนุมัติล้ม
 */
function indexDocument_(docId) {
  ensureSearchSetup_();
  const row = findDocRow_(docId);
  if (!row) return { ok: false, reason: 'ไม่พบเอกสาร' };

  const text = extractText_(String(row.get('file_id')), String(row.get('file_mime')));
  if (!text || !text.trim()) return { ok: false, reason: 'ดึงข้อความจากไฟล์ไม่ได้' };

  clearDocText_(docId);
  const code = String(row.get('doc_code'));
  const now = new Date();
  for (let i = 0, part = 1; i < text.length; i += DOCTEXT_CHUNK, part++) {
    const chunk = text.substr(i, DOCTEXT_CHUNK);
    appendByName_(SHEET_NAMES.DOC_TEXT, {
      doc_id: docId, doc_code: code, part: part,
      chars: chunk.length, indexed_at: now, text: chunk
    });
  }
  clearSearchCache_();
  return { ok: true, chars: text.length };
}

/**
 * ทำ index ย้อนหลังให้เอกสารที่อนุมัติแล้วแต่ยังไม่มีข้อความ
 * เรียกจาก Apps Script editor — GAS จำกัดการรัน 6 นาที จึงทำทีละ limit ฉบับ
 */
function reindexArchive(limit) {
  ensureSearchSetup_();
  const indexed = {};
  readTable_(SHEET_NAMES.DOC_TEXT).forEach(function (r) { indexed[r.doc_id] = true; });

  const todo = readTable_(SHEET_NAMES.DOCS).filter(function (d) {
    return String(d.status) === STATUS.APPROVED && d.file_id && !indexed[d.doc_id];
  }).slice(0, Number(limit) || 10);

  const out = { done: 0, failed: 0, detail: [] };
  todo.forEach(function (d) {
    let res;
    try {
      res = indexDocument_(d.doc_id);
    } catch (err) {
      res = { ok: false, reason: String(err) };
    }
    out[res.ok ? 'done' : 'failed']++;
    out.detail.push(d.doc_code + ' — ' + (res.ok ? res.chars + ' ตัวอักษร' : res.reason));
  });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ============================================================
// 2. ค้นหา
// ============================================================

function clearSearchCache_() {
  try { CacheService.getScriptCache().remove('wi_doctext_v1'); } catch (err) { /* cache ใช้ไม่ได้ก็ข้าม */ }
}

/** ข้อความทั้งคลัง รวมเป็นก้อนเดียวต่อเอกสาร */
function loadDocText_() {
  const byDoc = {};
  readTable_(SHEET_NAMES.DOC_TEXT)
    .sort(function (a, b) { return (Number(a.part) || 0) - (Number(b.part) || 0); })
    .forEach(function (r) {
      byDoc[r.doc_id] = (byDoc[r.doc_id] || '') + String(r.text || '');
    });
  return byDoc;
}

/** ตัดข้อความรอบ ๆ ตำแหน่ง at ±pad ตัวอักษร */
function snippetAt_(text, at, len, pad) {
  const from = Math.max(0, at - pad);
  const to = Math.min(text.length, at + len + pad);
  return (from > 0 ? '…' : '') +
    text.substring(from, to).replace(/\s+/g, ' ').trim() +
    (to < text.length ? '…' : '');
}

/**
 * ค้นหาในคลัง — ทุกคำต้องเจอ (AND) ทั้งใน metadata และเนื้อหาไฟล์
 * opts: { includeObsolete }  ค่าตั้งต้นคืนเฉพาะฉบับที่ "อนุมัติแล้ว"
 *
 * ตอบเฉพาะฉบับบังคับใช้เป็นค่าตั้งต้น เพราะถ้าโผล่ฉบับยกเลิกใช้ขึ้นมา
 * คนจะหยิบวิธีปฏิบัติเก่าไปใช้ ซึ่งผิด ISO 15189 ข้อ 8.3 ตรง ๆ
 */
function searchArchive(query, opts) {
  ensureSearchSetup_();
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, hits: [], tooShort: true };

  const terms = q.toLowerCase().split(/\s+/).filter(function (t) { return t.length >= 2; });
  if (!terms.length) return { query: q, hits: [], tooShort: true };

  const includeObsolete = !!(opts && opts.includeObsolete);
  const text = loadDocText_();
  const hits = [];

  readTable_(SHEET_NAMES.DOCS).forEach(function (d) {
    const status = String(d.status || '');
    if (!includeObsolete && status !== STATUS.APPROVED) return;

    const meta = [d.doc_code, d.doc_title, d.unit, docTypeLabel_(String(d.doc_type)),
      d.change_note, d.edition_label].join(' ');
    const body = text[d.doc_id] || '';
    const hayLower = (meta + ' ' + body).toLowerCase();
    if (!terms.every(function (t) { return hayLower.indexOf(t) > -1; })) return;

    // จำนวนครั้งที่เจอคำแรก ใช้จัดอันดับอย่างหยาบ ๆ ก็พอ
    let score = 0;
    const bodyLower = body.toLowerCase();
    terms.forEach(function (t) {
      let at = bodyLower.indexOf(t);
      while (at > -1) { score++; at = bodyLower.indexOf(t, at + t.length); }
      if (String(d.doc_code || '').toLowerCase().indexOf(t) > -1) score += 20;
      if (String(d.doc_title || '').toLowerCase().indexOf(t) > -1) score += 10;
    });

    // คำที่อยู่ติดกัน (เช่น "colony count") จะตัดข้อความทับกัน — ข้ามถ้าใกล้ของเดิม
    const snippets = [];
    const used = [];
    terms.forEach(function (t) {
      const at = bodyLower.indexOf(t);
      if (at === -1) return;
      if (used.some(function (u) { return Math.abs(u - at) < 200; })) return;
      used.push(at);
      snippets.push(snippetAt_(body, at, t.length, 110));
    });

    hits.push({
      docId: d.doc_id,
      docCode: String(d.doc_code || ''),
      docTitle: String(d.doc_title || ''),
      docTypeLabel: docTypeLabel_(String(d.doc_type)),
      unit: String(d.unit || ''),
      editionLabel: String(d.edition_label || editionLabel_(d.edition, d.amendment)),
      status: status,
      effectiveDate: formatThaiDate_(d.effective_date),
      fileUrl: String(d.file_url || ''),
      coverPdfUrl: String(d.cover_pdf_url || ''),
      indexed: !!body,
      score: score,
      snippets: snippets.slice(0, 3)
    });
  });

  hits.sort(function (a, b) { return b.score - a.score; });
  return { query: q, terms: terms, hits: hits.slice(0, 20), total: hits.length };
}

/** สถานะการทำ index ให้หน้าเว็บบอกผู้ใช้ได้ว่าค้นได้ครบคลังหรือยัง */
function getSearchStatus() {
  ensureSearchSetup_();
  const indexed = {};
  readTable_(SHEET_NAMES.DOC_TEXT).forEach(function (r) { indexed[r.doc_id] = true; });
  const approved = readTable_(SHEET_NAMES.DOCS).filter(function (d) {
    return String(d.status) === STATUS.APPROVED && d.file_id;
  });
  return {
    approved: approved.length,
    indexed: approved.filter(function (d) { return indexed[d.doc_id]; }).length
  };
}
