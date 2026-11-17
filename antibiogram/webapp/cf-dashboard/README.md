# Deploy antibiogram dashboard ขึ้น Cloudflare Pages

dashboard เป็นไฟล์เดียว (`public/index.html`) อ่าน Google Sheet สดเอง — ไม่ต้องมี KV/Function/backend.

## วิธี A — drag & drop (30 วินาที ไม่ต้อง command line)
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. ตั้งชื่อโปรเจกต์ เช่น `antibiogram-dashboard` → **Create project**
3. ลากโฟลเดอร์ **`public`** (หรือไฟล์ `index.html`) เข้าไปวาง → **Deploy site**
4. ได้ URL `https://antibiogram-dashboard.pages.dev` — เปิดจากมือถือ/ที่ไหนก็ได้ (Sheet ID ฝังในไฟล์แล้ว)

## วิธี B — wrangler (ถ้ามี API token)
```bash
export CLOUDFLARE_API_TOKEN=<token ที่มีสิทธิ์ Pages:Edit>
export CLOUDFLARE_ACCOUNT_ID=<account id>
cd cf-dashboard
npx wrangler pages deploy public --project-name antibiogram-dashboard
```

สร้าง token: dash.cloudflare.com → My Profile → **API Tokens** → Create → template **"Edit Cloudflare Workers"**
(หรือ custom: Account › Cloudflare Pages › Edit) — ต้องการแค่สิทธิ์ Pages
