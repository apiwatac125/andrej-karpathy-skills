/**
 * Antibiogram writer — เพิ่มเข้า GAS Web App เดิมของ AMR Alert (ตัวที่มี doPost + jsonResp_)
 * รับตารางสรุปจาก daily_etl.py (push_to_gas, action="antibiogram") แล้วเขียนทับ tab "Antibiogram"
 * ในสเปรดชีต 1Lijju… (ตัวเดียวกับ ชีต1 ที่ dashboard อ่านผ่าน gviz) — ไม่มี PHI
 *
 * ── วิธีติดตั้ง (ทำในโปรเจกต์ Apps Script ของ AMR Alert ที่ deploy เป็น GAS_URL) ──
 * 1) ในฟังก์ชัน doPost(e) เพิ่ม routing 1 บรรทัด (วางรวมกับ action อื่น ก่อน default handleAmrAlert_):
 *
 *        if (data.action === "antibiogram") {
 *          return handleAntibiogram_(data);
 *        }
 *
 *    (secret ตรวจที่ doPost อยู่แล้ว — ไม่ต้องเช็กซ้ำในฟังก์ชันนี้)
 *
 * 2) วางฟังก์ชัน handleAntibiogram_ ด้านล่างนี้ไว้ท้ายไฟล์
 * 3) Deploy → Manage deployments → Edit → New version → Deploy (URL เดิมไม่เปลี่ยน)
 *
 * สิทธิ์: โค้ดรันในนามเจ้าของโปรเจกต์ — ต้องมีสิทธิ์ "แก้ไข" สเปรดชีต AB_SHEET_ID
 * (เจ้าของ 1Lijju = apiwatac125; ถ้า GAS เป็นของบัญชีอื่น ต้องแชร์ชีตให้บัญชีนั้นเป็น Editor)
 */

var AB_SHEET    = 'Antibiogram';
var AB_SHEET_ID = '1LijjuAYdKmwqr2Daix-usN2FlZzMNbl62VPXMkCaSww';  // สเปรดชีตเดียวกับ ชีต1 (ที่ dashboard อ่าน)

function handleAntibiogram_(data) {
  var ss = SpreadsheetApp.openById(AB_SHEET_ID);
  var sh = ss.getSheetByName(AB_SHEET) || ss.insertSheet(AB_SHEET);
  var rows = data.rows || [];
  if (data.mode === 'overwrite') {            // ก้อนแรกของแต่ละวัน — ล้างของเดิมแล้วเขียนหัวตาราง
    sh.clearContents();
    if (data.header && data.header.length) {
      sh.getRange(1, 1, 1, data.header.length).setValues([data.header]);
    }
  }
  if (rows.length) {                          // ต่อท้ายข้อมูล (header อยู่แถว 1)
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  }
  return jsonResp_({ status: 'ok', wrote: rows.length, mode: data.mode });  // ใช้ jsonResp_ เดิมของโปรเจกต์
}
