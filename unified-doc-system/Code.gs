/**
 * จุดเข้าเว็บแอป
 *   ไม่มี ?page=    → หน้าหลัก (เข้าสู่ระบบ + แถบเมนู + กรอบเนื้อหา + แชทบอท)
 *   ?page=<id>&s=…  → หน้าระบบที่อยู่ในโปรเจกต์นี้เอง (เมนูที่มี file) โหลดในกรอบเนื้อหา ตรวจสิทธิ์ก่อนแสดง
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.page) return renderPage_(p.page, p.s);

  var t = HtmlService.createTemplateFromFile('Index');
  t.app = APP;
  return t.evaluate()
    .setTitle(APP.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** ข้อมูลหน้าหลักหลังเข้าสู่ระบบ — ส่งเฉพาะเมนูที่ระดับสิทธิ์นี้เปิดได้ */
function getShell(token) {
  var u = session_(token);
  var level = roleOf_(u.role).level;
  var menu = [];
  MENU.forEach(function (g) {
    if (g.slot) {
      menu.push({ slot: true });
      return;
    }
    var items = g.items.filter(function (it) { return level >= it.minLevel; }).map(function (it) {
      return { id: it.id, label: it.label, ready: !!(it.app || it.file) };
    });
    if (items.length) menu.push({ group: g.group, items: items });
  });

  var shell = { user: publicUser_(u), menu: menu, isAdmin: level >= ADMIN_LEVEL };
  if (shell.isAdmin) {
    // ใช้ในหน้าจัดการผู้ใช้: ตัวเลือกระดับสิทธิ์ + ตารางว่าระดับไหนเปิดเมนูไหนได้
    shell.roles = ROLES;
    shell.adminLevel = ADMIN_LEVEL;
    shell.access = allItems_().map(function (x) {
      return { group: x.group, label: x.item.label, minLevel: x.item.minLevel };
    });
  }
  return shell;
}

/** เปิดเมนู — ตรวจสิทธิ์ทุกครั้ง แล้วคืน URL ที่จะโหลดในกรอบเนื้อหา */
function openItem(token, id) {
  var item = findItem_(id);
  if (!item) throw new Error('ไม่พบเมนูนี้');
  requireLevel_(token, item.minLevel);

  if (item.file) {
    return { url: ScriptApp.getService().getUrl() + '?page=' + encodeURIComponent(id) + '&s=' + encodeURIComponent(token) };
  }
  if (item.app) {
    var base = PropertiesService.getScriptProperties().getProperty(item.app);
    if (!base) return { missing: item.app };
    return { url: base + (base.indexOf('?') > -1 ? '&' : '?') + 'page=' + encodeURIComponent(item.page) + '&embed=1' };
  }
  return {};   // ยังไม่มีระบบ
}

/** หน้าระบบในโปรเจกต์นี้ — template ได้ตัวแปร user และ token ไว้เรียก server ต่อ */
function renderPage_(id, token) {
  var item = findItem_(id);
  var user;
  try {
    if (!item || !item.file) throw new Error('ไม่พบหน้านี้');
    user = requireLevel_(token, item.minLevel);
  } catch (err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">' + err.message + '</p>');
  }
  var t = HtmlService.createTemplateFromFile(item.file);
  t.user = publicUser_(user);
  t.token = token;
  return t.evaluate()
    .setTitle(item.label)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function allItems_() {
  var out = [];
  MENU.forEach(function (g) {
    (g.items || []).forEach(function (it) { out.push({ group: g.group, item: it }); });
  });
  return out;
}

function findItem_(id) {
  var hit = allItems_().filter(function (x) { return x.item.id === id; })[0];
  return hit ? hit.item : null;
}
