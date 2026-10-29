/**
 * จุดเข้าเว็บแอป
 *   ไม่มี ?page=              → หน้าหลัก (เข้าสู่ระบบ + แถบเมนู + กรอบเนื้อหา + แชทบอท)
 *   ?page=<หน้าของ WI>|sign   → ระบบ WI (wiDoGet_ ใน Code.gs) ผ่าน routeWi_
 *   ?page=<id>&s=…            → หน้าระบบอื่นในโปรเจกต์นี้ (เมนูที่มี file) ตรวจสิทธิ์ก่อนแสดง
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.page === 'sign' || wiItem_(p.page)) return routeWi_(p, e);
  if (p.page) return renderPage_(p.page, p.s);
  return renderShell_(null);
}

/** next = หน้าของ WI ที่จะเปิดต่อในกรอบเนื้อหาหลัง login (มาจากลิงก์ที่ยังไม่ได้ login) */
function renderShell_(next) {
  var app = appInfo_();
  var t = HtmlService.createTemplateFromFile('Index');
  // พิมพ์ลง <script> ด้วย <?!= ?> — กันค่าใน URL ที่มีแท็กปิด script ปิดแท็กก่อนเวลา
  t.appJson = JSON.stringify(app).replace(/</g, '\\u003c');
  t.nextJson = JSON.stringify(next).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(app.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- ระบบ WI (อยู่ในโปรเจกต์เดียวกัน: Code.gs, DocRequest.gs, DocSearch.gs, AuditCapa.gs) ----------

/** พารามิเตอร์ของหน้า WI ที่ส่งต่อได้ (นอกจาก page) */
var WI_PARAMS = ['id', 'token', 'dar', 'capa', 'finding'];

/** เมนูที่เปิดหน้า WI นั้น — ใช้ตัดสินระดับสิทธิ์ของหน้า (หน้า sign ไม่มีเมนู เปิดด้วย token เสมอ) */
function wiItem_(page) {
  if (!page) return null;
  var hit = allItems_().filter(function (x) { return x.item.wi === page; })[0];
  return hit ? hit.item : null;
}

function wiParams_(p) {
  var out = { page: String(p.page || 'home') };
  WI_PARAMS.forEach(function (k) {
    if (p[k]) out[k] = String(p[k]);
  });
  return out;
}

/** URL หน้า WI ในกรอบเนื้อหา — แนบ session ให้ doGet ตรวจสิทธิ์ */
function wiUrl_(params, token) {
  var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); });
  return ScriptApp.getService().getUrl() + '?' + q.join('&') + '&embed=1&s=' + encodeURIComponent(token);
}

/**
 * หน้าของ WI
 * - มี session และระดับสิทธิ์ถึงเมนูของหน้านั้น → เปิดได้ (embed=1 = ในกรอบเนื้อหาของหน้าหลัก)
 * - ลิงก์จากอีเมลที่มี token (หน้าลงนาม, DAR / Audit / CAPA ที่มี id + token) → เปิดได้โดยไม่ต้อง login
 *   ผู้ลงนามอาจไม่มีบัญชีในระบบงานเอกสาร และหน้าของ WI ตรวจ token เองอยู่แล้ว
 * - นอกนั้น → หน้าหลัก แล้วเปิดหน้านี้ต่อในกรอบเนื้อหาหลัง login (เช่นลิงก์อีเมล ?page=upload&dar=…)
 */
function routeWi_(p, e) {
  var item = wiItem_(p.page);
  var allowed = false;
  if (item) {
    try {
      requireLevel_(p.s, itemLevel_(item));
      allowed = true;
    } catch (err) { /* ไม่มี session / สิทธิ์ไม่พอ */ }
  }
  if (allowed) {
    var embed = p.embed === '1';
    var out = wiDoGet_(e, embed);
    return embed ? out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) : out;
  }
  if (p.page === 'sign' || (p.id && p.token)) return wiDoGet_(e, false);
  return renderShell_(wiParams_(p));
}

/** เปิดหน้า WI ในกรอบเนื้อหา — จากลิงก์ภายในหน้า WI (Nav.html → WiNav.go) และลิงก์ที่รอเปิดหลัง login */
function openWi(token, params) {
  var p = wiParams_(params || {});
  var item = wiItem_(p.page);
  if (!item) throw new Error('ไม่พบหน้านี้');
  requireLevel_(token, itemLevel_(item));
  return { url: wiUrl_(p, token), item: item.id };
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** ข้อมูลหน้าหลักหลังเข้าสู่ระบบ — ส่งเฉพาะเมนูที่ระดับสิทธิ์นี้เปิดได้ */
function getShell(token) {
  var u = session_(token);
  var level = roleOf_(u.role).level;
  var levels = menuLevels_();
  var menu = [];
  MENU.forEach(function (g) {
    if (g.slot) {
      menu.push({ slot: true });
      return;
    }
    var items = g.items.filter(function (it) { return level >= itemLevel_(it, levels); }).map(function (it) {
      return { id: it.id, label: it.label, ready: !!(it.app || it.file || it.wi) };
    });
    if (items.length) menu.push({ group: g.group, items: items });
  });

  var shell = {
    user: publicUser_(u), menu: menu, isAdmin: level >= ADMIN_LEVEL,
    baseUrl: ScriptApp.getService().getUrl()   // หน้าเว็บใช้ตรวจว่าลิงก์จากกรอบ WI เป็นของระบบนี้
  };
  if (shell.isAdmin) {
    // ใช้ในหน้าจัดการผู้ใช้: ตัวเลือกระดับสิทธิ์ + ตารางว่าระดับไหนเปิดเมนูไหนได้
    shell.roles = ROLES;
    shell.adminLevel = ADMIN_LEVEL;
    shell.access = allItems_().map(function (x) {
      return { group: x.group, label: x.item.label, minLevel: itemLevel_(x.item, levels) };
    });
  }
  return shell;
}

/** เปิดเมนู — ตรวจสิทธิ์ทุกครั้ง แล้วคืน URL ที่จะโหลดในกรอบเนื้อหา */
function openItem(token, id) {
  var item = findItem_(id);
  if (!item) throw new Error('ไม่พบเมนูนี้');
  requireLevel_(token, itemLevel_(item));

  if (item.wi) return { url: wiUrl_({ page: item.wi }, token) };
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
    user = requireLevel_(token, itemLevel_(item));
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
