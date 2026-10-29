/**
 * ตั้งค่าระบบ (เฉพาะระดับ ADMIN_LEVEL) — เก็บใน Script Properties ค่าที่ยังไม่ได้ตั้งใช้ค่าใน Config.gs
 *   APP_SETTINGS   JSON { title, org, logoUrl }   ชื่อระบบ หน่วยงาน โลโก้
 *   MENU_LEVELS    JSON { <id เมนู>: level }      ระดับต่ำสุดของเมนูที่แก้จากค่าเริ่มต้น (minLevel)
 *   SETTING_LINKS  ใน Config.gs                   ลิงก์เชื่อมระบบอื่น เก็บเป็น Script Property ชื่อตาม key
 */

/** ชื่อระบบ หน่วยงาน โลโก้ ที่ใช้จริง */
function appInfo_() {
  var saved = readJsonProp_('APP_SETTINGS');
  return {
    title: saved.title || APP.title,
    org: saved.org || APP.org,
    logoUrl: saved.logoUrl === undefined ? APP.logoUrl : saved.logoUrl
  };
}

/** ระดับต่ำสุดของเมนูที่ใช้จริง — ส่ง levels (ผลของ menuLevels_) มาด้วยเมื่อต้องเรียกหลายครั้ง */
function itemLevel_(item, levels) {
  return (levels || menuLevels_())[item.id] || item.minLevel;
}

function menuLevels_() { return readJsonProp_('MENU_LEVELS'); }

function readJsonProp_(key) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || '{}');
  } catch (e) {
    return {};
  }
}

function adminGetSettings(token) {
  requireLevel_(token, ADMIN_LEVEL);
  var props = PropertiesService.getScriptProperties();
  var levels = menuLevels_();
  return {
    app: appInfo_(),
    links: SETTING_LINKS.map(function (l) {
      return { key: l.key, label: l.label, hint: l.hint, value: props.getProperty(l.key) || '' };
    }),
    items: allItems_().map(function (x) {
      return { id: x.item.id, group: x.group, label: x.item.label, level: itemLevel_(x.item, levels), defaultLevel: x.item.minLevel };
    }),
    roles: ROLES
  };
}

/** ตรวจทุกช่องก่อน แล้วค่อยบันทึกทั้งหมด — ช่องไหนผิดจะไม่บันทึกอะไรเลย */
function adminSaveSettings(token, data) {
  requireLevel_(token, ADMIN_LEVEL);
  var props = PropertiesService.getScriptProperties();

  var app = {
    title: String(data.app.title || '').trim(),
    org: String(data.app.org || '').trim(),
    logoUrl: String(data.app.logoUrl || '').trim()
  };
  checkUrl_(app.logoUrl, 'URL รูปโลโก้');

  var links = {};
  SETTING_LINKS.forEach(function (l) {
    var v = String((data.links || {})[l.key] || '').trim();
    if (/_URL$/.test(l.key)) checkUrl_(v, l.label);
    else if (v && !/^[A-Za-z0-9_-]{20,}$/.test(v)) {
      throw new Error(l.label + ' ไม่ถูกต้อง — คัดลอกส่วนที่อยู่ระหว่าง /d/ กับ /edit ในลิงก์ของชีต');
    }
    links[l.key] = v;
  });

  var levels = {};
  var valid = ROLES.map(function (r) { return r.level; });
  allItems_().forEach(function (x) {
    var lv = Number((data.levels || {})[x.item.id]);
    if (valid.indexOf(lv) === -1) throw new Error('ระดับสิทธิ์ของเมนู "' + x.item.label + '" ไม่ถูกต้อง');
    if (lv !== x.item.minLevel) levels[x.item.id] = lv;
  });

  props.setProperty('APP_SETTINGS', JSON.stringify(app));
  props.setProperty('MENU_LEVELS', JSON.stringify(levels));
  Object.keys(links).forEach(function (k) {
    if (links[k]) props.setProperty(k, links[k]);
    else props.deleteProperty(k);
  });
  return { app: appInfo_() };
}

/** ลิงก์ต้องเป็น https:// เท่านั้น — กันค่าแบบ javascript: ที่จะไปอยู่ใน src ของกรอบเนื้อหาหรือรูปโลโก้ */
function checkUrl_(v, label) {
  if (v && !/^https:\/\/[^\s"'<>]+$/.test(v)) throw new Error(label + ' ต้องขึ้นต้นด้วย https://');
}
