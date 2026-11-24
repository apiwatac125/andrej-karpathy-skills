import json, os
D=os.path.dirname(__file__)
tmpl=open(f"{D}/advisor.html",encoding="utf-8").read()
data=open(f"{D}/DATA.json",encoding="utf-8").read().strip()
assert "__DATA__" in tmpl
tmpl=tmpl.replace("__DATA__", data)
i=tmpl.index("</style>")+len("</style>")
head, body = tmpl[:i], tmpl[i:]
FONTS=('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
 '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
 '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@500;600;700&family=Sarabun:wght@400;600;700&display=swap">')
out=('<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
 '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
 '<meta name="description" content="ระบบสนับสนุนการตัดสินใจการใช้ยาต้านจุลชีพจาก Antibiogram โรงพยาบาลเลิดสิน (CLSI M39) ปี 2018-2025">\n'
 '<style>html,body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n'
 + head + "\n" + FONTS + "\n</head>\n<body>\n" + body + "\n</body>\n</html>\n")
open(os.path.normpath(f"{D}/../cf/public/index.html"),"w",encoding="utf-8").write(out)
print("wrote cf/public/index.html", len(out), "bytes")
# quick structural sanity
for tag in ["<!doctype html>","</head>","<body>","</body>","</html>","const DATA = {","id=\"hospLogo\"","generateAnnualPDF","renderTrend"]:
    print(("OK " if tag in out else "MISSING "), tag)
