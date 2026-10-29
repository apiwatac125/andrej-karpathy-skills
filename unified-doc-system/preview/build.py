#!/usr/bin/env python3
"""สร้างหน้าตัวอย่าง HTML ไฟล์เดียวจากโค้ดจริงของระบบ — เปิดดูได้โดยไม่ต้อง deploy Apps Script

ใช้:  python3 preview/build.py <ไฟล์ปลายทาง.html>

ไฟล์ .gs ทั้งหมดรันในเบราว์เซอร์บนบริการ Apps Script จำลอง (preview/mock.js)
ห่อไว้ในฟังก์ชันเดียวกันเพื่อไม่ให้ชื่อฟังก์ชันชนกับสคริปต์ฝั่งหน้าเว็บ
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


server = '\n'.join(read(n) for n in ('Config.gs', 'Auth.gs', 'Code.gs', 'Search.gs', 'Settings.gs'))
# google.script.run เรียกได้เฉพาะฟังก์ชันที่ชื่อไม่ลงท้ายด้วย _ — จำลองตามนั้น
public = [n for n in re.findall(r'^function (\w+)\s*\(', server, re.M) if not n.endswith('_')]

index = read('Index.html')
head = index.split('<head>', 1)[1].split('</head>', 1)[0]
body = index.split('<body>', 1)[1].rsplit('</body>', 1)[0]
head = head.replace('<base target="_top">', '').replace("<?!= include('Styles'); ?>", read('Styles.html'))
body = body.replace('<?!= JSON.stringify(app) ?>', 'window.__APP')
assert '<?' not in head + body, 'มี scriptlet ที่ build.py ยังไม่รู้จัก'

exports = ', '.join(f'{n}: {n}' for n in public)
page = f"""<title>ระบบงานเอกสาร</title>
{head}
<script>
(function () {{
{read('preview/mock.js')}
{server}
__start({{ {exports} }}, APP);
}})();
</script>
{body}"""

Path(sys.argv[1]).write_text(page, encoding='utf-8')
print(f'built {sys.argv[1]} ({len(page):,} chars, server functions: {", ".join(public)})')
