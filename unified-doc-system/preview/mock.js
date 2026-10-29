// ============================================================
// บริการ Apps Script จำลอง สำหรับหน้าตัวอย่างเท่านั้น — build.py ห่อไฟล์นี้กับ .gs ไว้ในฟังก์ชันเดียวกัน
// ข้อมูลอยู่ในหน่วยความจำ รีเฟรชแล้วหาย, computeDigest ไม่ใช่ SHA-256 จริง
// ============================================================
var __props = {}, __cache = {}, __books = {};

var PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return __props.hasOwnProperty(k) ? __props[k] : null; },
      setProperty: function (k, v) { __props[k] = String(v); },
      deleteProperty: function (k) { delete __props[k]; }
    };
  }
};

var CacheService = {
  getScriptCache: function () {
    return {
      get: function (k) { return __cache.hasOwnProperty(k) ? __cache[k] : null; },
      put: function (k, v) { __cache[k] = String(v); },
      remove: function (k) { delete __cache[k]; }
    };
  }
};

function __Sheet() { this.rows = []; }
__Sheet.prototype.getLastRow = function () { return this.rows.length; };
__Sheet.prototype.getLastColumn = function () {
  return this.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
};
__Sheet.prototype.appendRow = function (r) { this.rows.push(r.slice()); return this; };
__Sheet.prototype.setFrozenRows = function () { return this; };
__Sheet.prototype.getDataRange = function () { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); };
__Sheet.prototype.getRange = function (row, col, nr, nc) {
  var rows = this.rows;
  return {
    getValues: function () {
      var out = [];
      for (var i = 0; i < nr; i++) {
        var src = rows[row - 1 + i] || [], line = [];
        for (var j = 0; j < nc; j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]);
        out.push(line);
      }
      return out;
    },
    setValues: function (v) {
      for (var i = 0; i < v.length; i++) {
        var dst = rows[row - 1 + i] = rows[row - 1 + i] || [];
        for (var j = 0; j < v[i].length; j++) dst[col - 1 + j] = v[i][j];
      }
      return this;
    }
  };
};

function __Book(id) { this.id = id; this.sheets = {}; }
__Book.prototype.getId = function () { return this.id; };
__Book.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
__Book.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
__Book.prototype.insertSheet = function (n) { return (this.sheets[n] = new __Sheet()); };

var SpreadsheetApp = {
  create: function () {
    // ยาวเท่า id จริงของ Google Sheets (44 ตัว) เพราะหน้าตั้งค่าตรวจรูปแบบ id
    var id = ('previewSpreadsheet' + Object.keys(__books).length + '_').padEnd(44, 'x');
    return (__books[id] = new __Book(id));
  },
  openById: function (id) { return __books[id]; }
};

var Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  getUuid: function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },
  // ไบต์ 32 ตัวที่ขึ้นกับข้อความ (FNV-1a) — พอให้ตรวจรหัสผ่านในหน้าตัวอย่างได้ ไม่ใช่การเข้ารหัสจริง
  computeDigest: function (alg, text) {
    var out = [], h = 2166136261;
    for (var i = 0; i < 32; i++) {
      for (var j = 0; j < text.length; j++) {
        h ^= text.charCodeAt(j) + i;
        h = Math.imul(h, 16777619);
      }
      out.push((h & 0xff) - 128);
    }
    return out;
  }
};

var ScriptApp = {
  getService: function () {
    return { getUrl: function () { return 'https://script.google.com/macros/s/PREVIEW/exec'; } };
  }
};

var Logger = { log: function (m) { console.log(m); } };

/** สร้างผู้ใช้ตัวอย่างระดับละหนึ่งคน แล้วต่อ google.script.run เข้ากับฟังก์ชันฝั่ง server */
function __start(api, app) {
  setup();
  var demo = [
    { username: 'admin', name: 'ตัวอย่าง ผู้ดูแลระบบ', unit: 'กลุ่มงานพยาธิวิทยาคลินิกฯ', role: 'admin' },
    { username: 'head.group', name: 'ตัวอย่าง หัวหน้ากลุ่มงาน', unit: 'กลุ่มงานพยาธิวิทยาคลินิกฯ', role: 'group_head' },
    { username: 'head.micro', name: 'ตัวอย่าง หัวหน้างาน', unit: 'งานจุลชีววิทยาคลินิก', role: 'unit_head' },
    { username: 'staff.micro', name: 'ตัวอย่าง ผู้ปฏิบัติงาน', unit: 'งานจุลชีววิทยาคลินิก', role: 'staff' },
    { username: 'guest', name: 'ตัวอย่าง ผู้ใช้อื่นๆ', unit: 'หน่วยงานภายนอก', role: 'other' }
  ];
  demo.forEach(function (u) {
    u.active = true;
    u.password = 'demo1234';
    saveUser_(u);
  });

  // คลังระบบจัดซื้อ (SP-MT-07) ตัวอย่าง ให้แชทบอทมีเอกสารให้ค้น — ชื่อบริษัทและเอกสารเป็นตัวอย่างทั้งหมด
  // ไม่ตั้ง SPMT07_APP_URL จึงไม่มีลิงก์ "เปิดเอกสาร" และเมนูระบบจัดซื้อขึ้นว่ายังไม่ได้เชื่อมต่อ
  var spmt = SpreadsheetApp.create();
  __props.SPMT07_SHEET_ID = spmt.getId();
  function co(names) { return JSON.stringify(names.map(function (n) { return { name: n }; })); }
  var sub = spmt.insertSheet('Submissions');
  sub.appendRow(['submission_id', 'timestamp', 'form_type', 'unit', 'form_label', 'product_offered',
    'companies_json', 'winner', 'status', 'supervisor_signature', 'token']);
  sub.appendRow(['s1', new Date(2026, 8, 12), 'vendor_product', 'ห้องจุลชีววิทยาคลินิก', 'ผู้ขายและผลิตภัณฑ์',
    'ขวดเพาะเชื้อในเลือด (Hemoculture bottle)', co(['บริษัท ตัวอย่าง ไดแอกนอสติกส์ จำกัด', 'บริษัท สาธิต เมดิคอล จำกัด']),
    'บริษัท ตัวอย่าง ไดแอกนอสติกส์ จำกัด', 'อนุมัติแล้ว', 'data:image/png;base64,AAAA', 't1']);
  sub.appendRow(['s2', new Date(2026, 9, 20), 'calibration_lab', 'ทีมเครื่องมือ', 'บริษัทสอบเทียบเครื่องมือ (Calibration Laboratory)',
    'สอบเทียบปิเปตอัตโนมัติ', co(['บริษัท ทดลอง คาลิเบรชั่น จำกัด', 'บริษัท สาธิต เมดิคอล จำกัด']),
    'บริษัท ทดลอง คาลิเบรชั่น จำกัด', 'รอหัวหน้ากลุ่มงานอนุมัติ', '', 't2']);
  sub.appendRow(['s3', new Date(2026, 6, 3), 'referral_lab', 'ห้องชีวโมเลกุล', 'ห้องปฏิบัติการรับตรวจต่อ (Referral Lab)',
    'ตรวจยีนดื้อยา carbapenemase', co(['แล็บตัวอย่าง รับตรวจต่อ']), 'แล็บตัวอย่าง รับตรวจต่อ', 'ไม่อนุมัติ (หัวหน้างาน)', '', 't3']);
  var sum = spmt.insertSheet('Summaries');
  sum.appendRow(['summary_id', 'created_at', 'eval_type', 'unit', 'unit_display', 'year_label', 'companies_json',
    'total_count', 'pass_count', 'fail_count', 'status', 'pdf_url', 'token']);
  sum.appendRow(['m1', new Date(2026, 0, 15), 'vendor', 'ห้องจุลชีววิทยาคลินิก', 'งานจุลชีววิทยาคลินิก', '2568',
    co(['บริษัท ตัวอย่าง ไดแอกนอสติกส์ จำกัด', 'บริษัท สาธิต เมดิคอล จำกัด', 'บริษัท ทดลอง ซัพพลาย จำกัด']),
    3, 2, 1, 'อนุมัติแล้ว', '', 'k1']);
  sum.appendRow(['m2', new Date(2026, 1, 10), 'calibration', 'ทีมเครื่องมือ', 'ทีมเครื่องมือ', '2568',
    co(['บริษัท ทดลอง คาลิเบรชั่น จำกัด']), 1, 1, 0, 'รอหัวหน้างานอนุมัติ', '', 'k2']);

  function runner(ok, fail) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); }
    };
    Object.keys(api).forEach(function (name) {
      r[name] = function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        setTimeout(function () {
          var res;
          try {
            res = JSON.parse(JSON.stringify(api[name].apply(null, args)) || 'null');
          } catch (err) {
            if (fail) fail(new Error(err.message));
            return;
          }
          if (ok) ok(res);
        }, 200);
      };
    });
    return r;
  }

  window.google = { script: { run: runner() } };
  window.__APP = app;
  window.__mock = { props: __props, cache: __cache };

  // ปุ่มเข้าสู่ระบบด้วยบัญชีตัวอย่าง — มีเฉพาะในหน้าตัวอย่าง
  document.addEventListener('DOMContentLoaded', function () {
    var box = document.createElement('div');
    box.className = 'subform';
    box.style.marginTop = '18px';
    box.innerHTML = '<b>หน้าตัวอย่าง</b><div class="mini" style="margin:2px 0 10px">' +
      'ลองเข้าสู่ระบบด้วยบัญชีตัวอย่างแต่ละระดับ (รหัสผ่าน demo1234) ข้อมูลอยู่ในหน้านี้เท่านั้น</div>' +
      '<div class="links">' + demo.map(function (u) {
        return '<button type="button" class="go" data-demo="' + u.username + '">' +
          ROLES.filter(function (r) { return r.key === u.role; })[0].label +
          '<span class="soon mono">' + u.username + '</span></button>';
      }).join('') + '</div>';
    box.onclick = function (e) {
      var b = e.target.closest('[data-demo]');
      if (!b) return;
      document.getElementById('lg-user').value = b.getAttribute('data-demo');
      document.getElementById('lg-pass').value = 'demo1234';
      document.getElementById('lg-btn').click();
    };
    document.getElementById('login-form').appendChild(box);
  });
}
