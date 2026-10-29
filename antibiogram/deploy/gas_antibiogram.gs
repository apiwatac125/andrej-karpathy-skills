/**
 * Antibiogram writer — เพิ่มเข้า GAS Web App เดิม (ตัวที่รับ action append_data / ward_sync)
 * รับตารางสรุปจาก daily_etl.py (push_to_gas) แล้วเขียนทับ tab "Antibiogram"
 * ไม่มี PHI (period, stratum, organism, drug, n_tested, n_s, pct_s, lt30, intrinsic)
 *
 * ── วิธีติดตั้ง ──
 * 1) เปิด Apps Script project เดิมของ Sheet (Extensions → Apps Script)
 * 2) วางฟังก์ชันด้านล่างนี้ไว้ท้ายไฟล์ Code.gs
 * 3) ใน doPost(e) เดิม เพิ่มการแยก action ก่อน return เดิม เช่น:
 *
 *       var data = JSON.parse(e.postData.contents);
 *       if (data.action === 'antibiogram') return abWrite_(data);     // <-- เพิ่มบรรทัดนี้
 *       // ... (append_data / ward_sync / daily_report เดิม)
 *
 * 4) Deploy → Manage deployments → Edit → New version → Deploy (URL เดิมไม่เปลี่ยน)
 */

var AB_SHEET = 'Antibiogram';

function abWrite_(data) {
  // ตรวจ secret เหมือน action อื่น (ใช้ค่าเดียวกับ API_SECRET ใน config.py)
  if (!data || data.secret !== _ab_secret_()) {
    return _ab_json_({status: 'error', error: 'bad secret'});
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AB_SHEET) || ss.insertSheet(AB_SHEET);

  var rows = data.rows || [];
  if (data.mode === 'overwrite') {
    sh.clearContents();
    if (data.header && data.header.length) {
      sh.getRange(1, 1, 1, data.header.length).setValues([data.header]);
    }
  }
  if (rows.length) {
    var startRow = sh.getLastRow() + 1;              // ต่อท้ายข้อมูลที่มี (header อยู่แถว 1)
    sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  }
  return _ab_json_({status: 'ok', wrote: rows.length, mode: data.mode});
}

/** คืนค่า API secret — ถ้าโปรเจกต์มีตัวแปร/ฟังก์ชันเดิมอยู่แล้ว ให้ชี้มาที่ตัวนั้นแทน */
function _ab_secret_() {
  // เปลี่ยนให้ตรงกับที่โปรเจกต์ใช้ เช่น return API_SECRET; หรือ
  return PropertiesService.getScriptProperties().getProperty('API_SECRET');
}

function _ab_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
}
