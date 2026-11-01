"""ETL สรุป antibiogram แบบรันอัตโนมัติรายวัน — ออกแบบให้รันบนเครื่อง lab (patho13).

ไหลงาน (เหมือนรอบรายวันของ AMR Alert แต่เปลี่ยนแหล่งข้อมูลเป็นไฟล์ DBF):
  อ่าน DBF ทุกไฟล์ในโฟลเดอร์ (หน้าต่างวิเคราะห์)  →  ตัดรายงานซ้ำข้ามไฟล์ (เก็บฉบับ RPTDATE ล่าสุด)
  →  prepare (map/clean/normalize/CAI-HAI)  →  คิด %S ตาม CLSI M39 (isolate แรก/ผู้ป่วย, N≥30, N=ไม่ไว)
  สำหรับหลายช่วง (ทุกปีปฏิทิน + 12 เดือนล่าสุด) × หลายกลุ่ม (All / สิ่งส่งตรวจ / CAI-HAI)
  →  เขียน "ตารางสรุป" ที่ **ไม่มีข้อมูลผู้ป่วย** เป็น CSV  (และถ้าตั้งค่า ก็ push ขึ้น Google Sheet)

PHI (HN/ชื่อ/วันเกิด) ใช้ภายในเครื่องเท่านั้น ไม่อยู่ใน output.

ตั้งเวลารันทุกวันด้วย Windows Task Scheduler — ดู README (หัวข้อ "รันรายวันอัตโนมัติ").

ตัวอย่าง:
  python daily_etl.py --dbf-dir D:\\mlab_dbf --out D:\\amr\\antibiogram_summary.csv
  python daily_etl.py --dbf-dir D:\\mlab_dbf --his-dir D:\\qr1020 --sheet-id <id> --creds creds.json
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
import time
from pathlib import Path

import pandas as pd

from ab import config as cfg, loader, pipeline, rolling

HERE = Path(__file__).resolve().parent
# คอลัมน์ที่ห้ามหลุดออกไปใน output (กันพลาด)
PHI_COLS = {"hn", "name", "prename", "birth", "corganism", "an"}
OUT_COLS = ["period", "period_start", "period_end", "stratum_type", "stratum",
            "organism", "drug", "n_tested", "n_s", "pct_s", "lt30", "intrinsic"]


def read_all_dbf(folder: str, encoding: str = "cp874") -> tuple[pd.DataFrame, list[str]]:
    """อ่าน .DBF ทุกไฟล์ในโฟลเดอร์แล้วต่อกันเป็น dataframe เดียว."""
    files = sorted({*glob.glob(str(Path(folder) / "*.dbf")), *glob.glob(str(Path(folder) / "*.DBF"))})
    frames = []
    for f in files:
        try:
            frames.append(loader.read_dbf(f, encoding=encoding))
        except Exception as e:  # ไฟล์เสีย/ล็อกอยู่ -> ข้าม แจ้ง error
            print(f"  skip {Path(f).name}: {e}", file=sys.stderr)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return df, files


def dedup_reports(raw: pd.DataFrame,
                  keys=("REF_NO", "LAB_NO", "ORGANISM"), rpt_col="RPTDATE") -> pd.DataFrame:
    """ตัดรายงานซ้ำข้ามไฟล์ (รายงานเบื้องต้น/ฉบับสุดท้าย) — เก็บฉบับ RPTDATE ล่าสุด."""
    if rpt_col in raw.columns and all(k in raw.columns for k in keys):
        raw = (raw.sort_values(rpt_col, na_position="first")
                  .drop_duplicates(list(keys), keep="last").reset_index(drop=True))
    return raw


def filter_real_isolates(raw: pd.DataFrame, method_col="METHOD", method_val="O",
                         drop_sources: list[str] | None = None, source_col="CSOURCE_A") -> pd.DataFrame:
    """เก็บเฉพาะ isolate จริง: METHOD=O (ถ้ามีคอลัมน์) และตัดสิ่งส่งตรวจ screening ตาม config."""
    out = raw
    if method_col in out.columns:
        out = out[out[method_col].astype(str).str.strip().str.upper() == method_val]
    if drop_sources and source_col in out.columns:
        drop = {s.strip().lower() for s in drop_sources}
        out = out[~out[source_col].astype(str).str.strip().str.lower().isin(drop)]
    return out.copy()


def _emit(res, period, stratum_type, stratum, rows: list[dict]):
    """แตก long_form เป็นแถวสรุป (ไม่มี PHI)."""
    w = res.window
    for _, r in res.long_form.iterrows():
        intrinsic = bool(r.get("intrinsic"))
        n_tested = int(r["n_tested"])
        if n_tested == 0 and not intrinsic:
            continue  # ไม่ได้ทดสอบ -> ไม่ต้องเก็บ
        rows.append({
            "period": period, "period_start": w["start"].date().isoformat(),
            "period_end": w["end"].date().isoformat(),
            "stratum_type": stratum_type, "stratum": stratum,
            "organism": r["organism"], "drug": res.drug_name.get(r["antibiotic"], r["antibiotic"]),
            "n_tested": n_tested, "n_s": int(r["n_susceptible"]),
            "pct_s": None if pd.isna(r["pct_susceptible"]) else int(r["pct_susceptible"]),
            "lt30": (not bool(r["reportable"])) and not intrinsic,
            "intrinsic": intrinsic,
        })


def build_summary(std: pd.DataFrame, ab_cols: list[str], conditions: dict,
                  rolling_months: int = 12, by_specimen: bool = True,
                  by_origin: bool = True) -> pd.DataFrame:
    """คืนตารางสรุป antibiogram ทุกช่วง × ทุกกลุ่ม (ไม่มี PHI).

    กรองข้อมูลต่อกลุ่มก่อน แล้ววนเฉพาะปีที่กลุ่มนั้น "มีข้อมูลจริง" และ rolling เฉพาะเมื่อ
    หน้าต่างย้อนหลังไม่ว่าง — เลี่ยงการเรียก finalize บน subset ว่าง (ซึ่งทำให้ engine พัง).
    """
    # (ชนิดกลุ่ม, ชื่อกลุ่ม, subset ที่กรองแล้ว)
    strata = [("all", "All", std)]
    if by_specimen and "specimen" in std.columns:
        for sp in sorted(x for x in std["specimen"].dropna().unique() if str(x).strip()):
            strata.append(("specimen", str(sp), std[std["specimen"] == sp]))
    if by_origin and "infection_origin" in std.columns:
        present = set(std["infection_origin"].dropna().unique())
        # แยก CAI/HAI เฉพาะเมื่อมี "ทั้งคู่" จริง (ต้องมี qr1020 เข้ามา join admission)
        # ถ้าไม่มี qr1020 ตัวจำแนกจะตีเป็นค่า default ค่าเดียวหมด -> ไม่ใช่การแยกจริง จึงไม่โชว์
        if {"CAI", "HAI"} <= present:
            for o in ("CAI", "HAI"):
                strata.append(("origin", o, std[std["infection_origin"] == o]))

    rows: list[dict] = []
    for st_type, st_name, sub in strata:
        if sub.empty:
            continue
        dt = pd.to_datetime(sub["collect_datetime"], errors="coerce")
        sub_years = sorted({int(y) for y in dt.dropna().dt.year.unique()})
        for y in sub_years:   # ปีที่กลุ่มนี้มีข้อมูล -> หน้าต่างรายปีไม่ว่างแน่นอน
            _emit(rolling.annual(sub, ab_cols, conditions, year=y),
                  str(y), st_type, st_name, rows)
        end = rolling.data_end(sub)
        if end is not None:   # rolling เฉพาะเมื่อมี isolate ในหน้าต่างย้อนหลัง
            start = end - pd.DateOffset(months=rolling_months)
            if not rolling._window(sub, start, end).empty:
                _emit(rolling.rolling(sub, ab_cols, conditions, months=rolling_months),
                      f"rolling{rolling_months}m", st_type, st_name, rows)

    df = pd.DataFrame(rows, columns=OUT_COLS)
    leaked = PHI_COLS & set(c.lower() for c in df.columns)
    assert not leaked, f"PHI หลุดเข้า output: {leaked}"  # safety net
    return df


def push_to_sheet(df: pd.DataFrame, sheet_id: str, creds_path: str, worksheet: str = "Antibiogram"):
    """เขียน df ทับ worksheet (ต้องมี gspread + service-account creds). ไม่บังคับ."""
    import gspread  # lazy import
    gc = gspread.service_account(filename=creds_path)
    sh = gc.open_by_key(sheet_id)
    try:
        ws = sh.worksheet(worksheet)
        ws.clear()
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=worksheet, rows=len(df) + 10, cols=len(df.columns))
    ws.update([df.columns.tolist()] + df.astype(object).where(df.notna(), "").values.tolist())


def push_to_gas(df: pd.DataFrame, gas_url: str, secret: str,
                action: str = "antibiogram", chunk: int = 2000, retries: int = 5) -> int:
    """เขียนตารางสรุปขึ้น Google Sheet ผ่าน GAS Web App เดิม (ใช้ secret เดียวกับ daily report).

    ส่งเป็นก้อน: ก้อนแรก mode=overwrite (GAS เคลียร์ tab ก่อนเขียน) ก้อนถัดไป mode=append.
    มี retry + backoff กัน script.google.com timeout ชั่วคราว.
    """
    import json
    import time
    import requests
    header = list(df.columns)
    rows = df.astype(object).where(df.notna(), "").values.tolist()
    for i in range(0, len(rows) or 1, chunk):
        payload = {"secret": secret, "action": action, "header": header,
                   "rows": rows[i:i + chunk],
                   "mode": "overwrite" if i == 0 else "append"}
        for attempt in range(retries):
            try:
                r = requests.post(gas_url, data=json.dumps(payload), timeout=(30, 120))
                r.raise_for_status()
                break
            except Exception:
                if attempt == retries - 1:
                    raise
                time.sleep(5 * (attempt + 1))  # 5,10,15,20s
    return len(rows)


def _read_one_his(f):
    """อ่าน qr1020 1 ไฟล์ — ลองหลาย engine (SoftCon .xls เป็น OLE บ้าง HTML-as-xls บ้าง)."""
    for eng in ("xlrd", "openpyxl"):
        try:
            xl = pd.ExcelFile(f, engine=eng)
            return [pd.read_excel(f, sheet_name=s, dtype=object, engine=eng) for s in xl.sheet_names]
        except Exception:
            continue
    # fallback: ไฟล์ที่จริง ๆ เป็น HTML table (รายงานบางระบบ export แบบนี้แต่ตั้งนามสกุล .xls)
    try:
        return pd.read_html(f)  # คืน list ของ DataFrame
    except Exception as e:
        raise e


def _read_his_files(his_dir):
    """อ่านไฟล์ qr1020 (.xls ของ SoftCon) ทุกไฟล์+ทุกชีต แล้วต่อกัน."""
    pats = sorted(glob.glob(str(Path(his_dir) / "qr1020_*.xls*")), key=str.lower) or \
        sorted(glob.glob(str(Path(his_dir) / "*.xls*")), key=str.lower)
    frames, ok = [], 0
    for f in pats:
        try:
            frames.extend(_read_one_his(f))
            ok += 1
        except Exception as e:
            print(f"  อ่าน his ไม่ได้ {Path(f).name}: {e}", file=sys.stderr)
    print(f"  his: อ่านสำเร็จ {ok}/{len(pats)} ไฟล์", file=sys.stderr)
    return (pd.concat(frames, ignore_index=True) if frames else None), pats


def _resolve_his_cols(his, want):
    """จับคอลัมน์ HN/AN/วันแอดมิต แบบ exact ก่อน แล้ว fuzzy (กันหัวคอลัมน์ไทยเพี้ยนจาก .xls)."""
    cols = [str(c) for c in his.columns]

    def find(target, keys):
        if target and target in his.columns:
            return target
        for c in cols:
            if any(k in c for k in keys):
                return c
        return None
    return {
        "his_hn_col": find(want.get("hn_col"), ["HN", "hn"]),
        "his_an_col": find(want.get("an_col"), ["AN", "an"]),
        "his_admit_col": find(want.get("admit_col"), ["ลงทะเบียน", "ลงทะ", "admit", "Admit", "regist"]),
    }


def run(dbf_dir, profile, conditions, out, his_dir=None, encoding="cp874",
        rolling_months=12, drop_sources=None, sheet_id=None, creds=None,
        gas_url=None, gas_secret=None):
    t0 = time.time()
    raw, files = read_all_dbf(dbf_dir, encoding=encoding)
    if raw.empty:
        print(f"ไม่พบข้อมูลใน {dbf_dir} (.DBF)", file=sys.stderr)
        return
    raw = dedup_reports(raw)
    raw = filter_real_isolates(raw, drop_sources=drop_sources)
    print(f"อ่าน {len(files)} ไฟล์ -> {len(raw):,} แถว (หลังตัดซ้ำ/กรอง)  ({time.time()-t0:.1f}s)")

    his = None
    his_kw = {}
    if his_dir:
        his, hfiles = _read_his_files(his_dir)
        if his is None:
            print(f"  ไม่พบไฟล์ qr1020 ใน {his_dir} -> ข้าม CAI/HAI", file=sys.stderr)
        else:
            his_kw = _resolve_his_cols(his, profile.get("his", {}))
            an, hn, adm = his_kw["his_an_col"], his_kw["his_hn_col"], his_kw["his_admit_col"]
            # เก็บเฉพาะ IPD (มี AN) + ตัดซ้ำตาม AN ลดปริมาณ
            if an and an in his.columns:
                his = his[his[an].notna() & (his[an].astype(str).str.strip() != "")]
                his = his.drop_duplicates(subset=[an], keep="last")
            # qr1020 HN 10 หลัก -> ตัด 2 หลักหน้าให้ตรง HN 8 หลักใน DBF
            if hn and hn in his.columns:
                import re
                his[hn] = his[hn].map(
                    lambda s: (lambda d: d[2:] if len(d) >= 10 else d)(re.sub(r"\D", "", str(s))))
            print(f"his: {len(hfiles)} ไฟล์ · {len(his):,} admission (IPD) · "
                  f"คอลัมน์ HN={hn} AN={an} admit={adm}")
            if not adm:
                print("  ⚠️ หาคอลัมน์วันแอดมิตไม่เจอ (หัวไทยอาจเพี้ยน) -> CAI/HAI จะไม่ทำงาน. "
                      f"คอลัมน์ที่มี: {list(his.columns)[:15]}", file=sys.stderr)

    std, steps = pipeline.prepare(raw, profile["col_map"], profile["ab_cols"], conditions,
                                  his_df=his, **his_kw)
    if his is not None and "infection_origin" in std.columns:
        oc = std["infection_origin"].value_counts().to_dict()
        print(f"admit matched: {steps.get('admit_matched', 0):,} · origin {oc}")
    # จำนวน isolate ต่อปี (หลัง clean/dedup report) — ดูว่าปีไหนข้อมูลครบ/ขาด
    _dt = pd.to_datetime(std.get("collect_datetime"), errors="coerce")
    _yc = _dt.dropna().dt.year.value_counts().sort_index()
    print("isolate ต่อปี: " + " · ".join(f"{int(y)}={int(n):,}" for y, n in _yc.items()))
    summary = build_summary(std, profile["ab_cols"], conditions, rolling_months=rolling_months)

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    summary.to_csv(out, index=False, encoding="utf-8-sig")
    periods = summary["period"].nunique()
    print(f"สรุป {len(summary):,} แถว · {periods} ช่วง · {summary['stratum'].nunique()} กลุ่ม -> {out}")

    if gas_url:
        try:
            n = push_to_gas(summary, gas_url, gas_secret or "")
            print(f"ส่งขึ้น Google Sheet ผ่าน GAS (tab 'Antibiogram') {n:,} แถว")
        except Exception as e:
            print(f"ส่ง GAS ไม่สำเร็จ: {e}", file=sys.stderr)
    elif sheet_id and creds:
        try:
            push_to_sheet(summary, sheet_id, creds)
            print(f"อัปโหลดขึ้น Google Sheet tab 'Antibiogram' แล้ว (gspread)")
        except Exception as e:
            print(f"อัปโหลด Sheet ไม่สำเร็จ: {e}", file=sys.stderr)
    print(f"เสร็จใน {time.time()-t0:.1f}s")


def main():
    ap = argparse.ArgumentParser(description="Antibiogram daily ETL (รันบนเครื่อง lab, PHI ไม่ออก)")
    ap.add_argument("--dbf-dir", required=True, help="โฟลเดอร์ไฟล์ .DBF รายวันจาก MLAB")
    ap.add_argument("--his-dir", help="โฟลเดอร์ qr1020 (.xls) สำหรับแยก CAI/HAI (ไม่บังคับ)")
    ap.add_argument("--profile", default=str(HERE / "config" / "mlab_profile.json"))
    ap.add_argument("--out", default="antibiogram_summary.csv")
    ap.add_argument("--encoding", default="cp874")
    ap.add_argument("--rolling-months", type=int, default=12)
    ap.add_argument("--drop-sources", default="", help="CSOURCE_A ที่เป็น screening (คั่นด้วย ,)")
    ap.add_argument("--gas-url", help="GAS Web App URL เดิม (ส่งขึ้น Sheet ด้วย action=antibiogram)")
    ap.add_argument("--gas-secret", help="API secret เดียวกับ daily report")
    ap.add_argument("--sheet-id", help="Google Sheet id ปลายทาง (ทางเลือก gspread)")
    ap.add_argument("--creds", help="service-account json สำหรับ gspread (ไม่บังคับ)")
    args = ap.parse_args()

    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    conditions = cfg.load_conditions()
    run(args.dbf_dir, profile, conditions, args.out, his_dir=args.his_dir,
        encoding=args.encoding, rolling_months=args.rolling_months,
        drop_sources=[s for s in args.drop_sources.split(",") if s.strip()],
        sheet_id=args.sheet_id, creds=args.creds,
        gas_url=args.gas_url, gas_secret=args.gas_secret)


if __name__ == "__main__":
    main()
