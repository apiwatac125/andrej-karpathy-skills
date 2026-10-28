/**
 * ผู้ใช้ รหัสผ่าน และ session
 * - ผู้ใช้เก็บในชีต Users ของสเปรดชีตที่ Script Property DB_SHEET_ID ชี้ไป (setup() สร้างให้)
 * - รหัสผ่านเก็บเป็น SHA-256 + salt ไม่เก็บตัวจริง
 * - session เก็บใน CacheService อายุ 6 ชม. (สูงสุดที่ CacheService ให้) เก็บแค่ชื่อผู้ใช้
 *   ระดับสิทธิ์อ่านจากชีตใหม่ทุกครั้ง — เปลี่ยนสิทธิ์หรือปิดบัญชีแล้วมีผลทันที
 */

var USER_HEADERS = ['username', 'name', 'email', 'unit', 'role', 'active', 'salt', 'hash', 'updatedAt'];
var SESSION_SECONDS = 6 * 60 * 60;
// หน้าเว็บดูคำว่า "เข้าสู่ระบบใหม่" ในข้อความนี้เพื่อพากลับหน้า login — แก้ข้อความต้องคงคำนี้ไว้
var SESSION_EXPIRED = 'หมดเวลาใช้งาน กรุณาเข้าสู่ระบบใหม่';

/**
 * รันครั้งเดียวจาก Apps Script editor: สร้างสเปรดชีตผู้ใช้ + บัญชี admin (หัวหน้ากลุ่มงาน)
 * ถ้าจะใช้สเปรดชีตที่มีอยู่แล้ว ให้ตั้ง Script Property DB_SHEET_ID ก่อนรัน
 * รหัสผ่านชั่วคราวของ admin ดูได้ที่ Execution log
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('ระบบงานเอกสาร — ผู้ใช้และสิทธิ์');
  props.setProperty('DB_SHEET_ID', ss.getId());

  var sh = ss.getSheetByName('Users') || ss.insertSheet('Users');
  if (sh.getLastRow() === 0) {
    sh.appendRow(USER_HEADERS);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 1) {
    var password = Utilities.getUuid().slice(0, 8);
    saveUser_({ username: 'admin', name: 'ผู้ดูแลระบบ', role: 'group_head', active: true, password: password });
    Logger.log('สร้างบัญชี admin แล้ว รหัสผ่านชั่วคราว: ' + password + ' — เข้าระบบแล้วเปลี่ยนรหัสผ่านทันที');
  }
  Logger.log('สเปรดชีตผู้ใช้: ' + ss.getUrl());
}

/** เข้าสู่ระบบ — คืน token ให้หน้าเว็บแนบไปกับทุกคำขอ */
function login(username, password) {
  var u = findUser_(username);
  if (!u || !isActive_(u) || hash_(u.salt, String(password || '')) !== u.hash) {
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, u.username, SESSION_SECONDS);
  return { token: token };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('session:' + token);
  return true;
}

/** เปลี่ยนรหัสผ่านของตัวเอง */
function changePassword(token, oldPassword, newPassword) {
  var u = session_(token);
  if (hash_(u.salt, String(oldPassword || '')) !== u.hash) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
  checkPassword_(newPassword);
  saveUser_({ username: u.username, password: newPassword });
  return true;
}

// ---------- จัดการผู้ใช้ (เฉพาะระดับ ADMIN_LEVEL) ----------

function adminListUsers(token) {
  requireLevel_(token, ADMIN_LEVEL);
  return readUsers_().map(publicUser_);
}

/** เพิ่มหรือแก้ผู้ใช้ — data.isNew = เพิ่มใหม่, data.password ว่าง = ไม่เปลี่ยนรหัสผ่าน */
function adminSaveUser(token, data) {
  var me = requireLevel_(token, ADMIN_LEVEL);
  var username = normName_(data.username);
  var existing = findUser_(username);
  var active = data.active === true;

  if (!/^[a-z][a-z0-9._-]{2,29}$/.test(username)) {
    throw new Error('ชื่อผู้ใช้ต้องขึ้นต้นด้วย a-z ตามด้วย a-z 0-9 . _ - รวม 3–30 ตัว');
  }
  if (!roleOf_(data.role).level) throw new Error('กรุณาเลือกระดับสิทธิ์');
  if (data.isNew && existing) throw new Error('มีชื่อผู้ใช้ "' + username + '" อยู่แล้ว');
  if (!data.isNew && !existing) throw new Error('ไม่พบผู้ใช้ "' + username + '"');
  if (data.isNew && !data.password) throw new Error('ผู้ใช้ใหม่ต้องตั้งรหัสผ่านชั่วคราว');
  if (normName_(me.username) === username && (data.role !== me.role || !active)) {
    throw new Error('ลดระดับสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้ เพื่อไม่ให้ระบบเหลือแต่ผู้ใช้ที่จัดการสิทธิ์ไม่ได้');
  }
  if (data.password) checkPassword_(data.password);

  saveUser_({
    username: username,
    name: String(data.name || '').trim(),
    email: String(data.email || '').trim(),
    unit: String(data.unit || '').trim(),
    role: data.role,
    active: active,
    password: data.password || ''
  });
  return true;
}

// ---------- ใช้ภายใน ----------

/** ผู้ใช้เจ้าของ token — ไม่มี/หมดอายุ/ถูกปิดบัญชี = โยน SESSION_EXPIRED */
function session_(token) {
  var username = token ? CacheService.getScriptCache().get('session:' + token) : null;
  var u = username ? findUser_(username) : null;
  if (!u || !isActive_(u)) throw new Error(SESSION_EXPIRED);
  return u;
}

function requireLevel_(token, level) {
  var u = session_(token);
  if (roleOf_(u.role).level < level) throw new Error('ระดับสิทธิ์ของคุณใช้เมนูนี้ไม่ได้');
  return u;
}

function roleOf_(key) {
  for (var i = 0; i < ROLES.length; i++) {
    if (ROLES[i].key === key) return ROLES[i];
  }
  return { key: key, label: '-', level: 0 };
}

/** ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บได้ (ไม่มี salt/hash) */
function publicUser_(u) {
  var r = roleOf_(u.role);
  return {
    username: u.username, name: u.name, email: u.email, unit: u.unit,
    role: r.key, roleLabel: r.label, level: r.level, active: isActive_(u)
  };
}

function isActive_(u) { return String(u.active).toUpperCase() === 'TRUE'; }

function normName_(s) { return String(s || '').trim().toLowerCase(); }

function checkPassword_(pw) {
  if (String(pw || '').length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
}

/** SHA-256 เป็นเลขฐาน 16 — ไม่ใช้ base64 เพราะขึ้นต้นด้วย + หรือ = แล้วชีตจะตีเป็นสูตร */
function hash_(salt, password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function usersSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
  if (!id) throw new Error('ระบบยังไม่ได้ตั้งค่า — ผู้ดูแลต้องรันฟังก์ชัน setup() ก่อน');
  return SpreadsheetApp.openById(id).getSheetByName('Users');
}

/** อ่านผู้ใช้ทุกแถวตามชื่อหัวคอลัมน์ (สลับลำดับคอลัมน์ในชีตได้) */
function readUsers_() {
  var rows = usersSheet_().getDataRange().getValues();
  var head = rows.shift();
  return rows.map(function (r, i) {
    var u = { row: i + 2 };
    head.forEach(function (h, j) { u[h] = r[j]; });
    return u;
  }).filter(function (u) { return u.username; });
}

function findUser_(username) {
  var name = normName_(username);
  return readUsers_().filter(function (u) { return normName_(u.username) === name; })[0] || null;
}

/** เพิ่มหรือแก้แถวผู้ใช้ — ใส่เฉพาะช่องที่ส่งมา, f.password มีค่า = ตั้งรหัสผ่านใหม่ */
function saveUser_(f) {
  var sh = usersSheet_();
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var u = findUser_(f.username) || { username: normName_(f.username) };
  ['name', 'email', 'unit', 'role', 'active'].forEach(function (k) {
    if (f[k] !== undefined) u[k] = f[k];
  });
  if (f.password) {
    u.salt = Utilities.getUuid();
    u.hash = hash_(u.salt, f.password);
  }
  u.updatedAt = new Date();

  var row = head.map(function (h) { return u[h] === undefined ? '' : u[h]; });
  if (u.row) sh.getRange(u.row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}
