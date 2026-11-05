// Cloudflare Pages Function — ตัวนับผู้ใช้งาน
// Endpoint: POST /api/hit  (และ GET /api/hit สำหรับอ่านค่าเฉยๆ)
// ต้องผูก (bind) KV namespace ชื่อ "COUNTER" ให้ Pages project นี้
// คืนค่า { visits, users }  (visits = จำนวนครั้งที่เข้าชม, users = จำนวนคนไม่ซ้ำ)

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.COUNTER;
  if (!kv) {
    return new Response(JSON.stringify({ error: "KV 'COUNTER' not bound" }), { status: 500, headers: JSON_HEADERS });
  }
  let cid = "";
  try { const b = await request.json(); cid = String(b.cid || "").slice(0, 64); } catch (e) {}

  let visits = parseInt((await kv.get("visits")) || "0", 10) + 1;
  await kv.put("visits", String(visits));

  let users = parseInt((await kv.get("users")) || "0", 10);
  if (cid) {
    const key = "u:" + cid;
    const seen = await kv.get(key);
    if (seen === null) {
      await kv.put(key, "1");
      users += 1;
      await kv.put("users", String(users));
    }
  }
  return new Response(JSON.stringify({ visits, users }), { headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const kv = context.env.COUNTER;
  const visits = parseInt((kv && (await kv.get("visits"))) || "0", 10);
  const users = parseInt((kv && (await kv.get("users"))) || "0", 10);
  return new Response(JSON.stringify({ visits, users }), { headers: JSON_HEADERS });
}
