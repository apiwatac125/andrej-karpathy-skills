"""CLI รัน antibiogram จากไฟล์ (ใช้ pipeline เดียวกับหน้าจอ Streamlit).

ตัวอย่าง:
  python cli.py --micro ATB2025.xlsx --his HIS.csv --out out/ --split
  python cli.py --micro data.csv                       # ไม่มี HIS -> ไม่แยก CAI/HAI
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import pandas as pd

from ab import config as cfg
from ab import export, pipeline

HERE = Path(__file__).resolve().parent


def _read_table(path: str, encoding: str | None = None) -> pd.DataFrame:
    p = str(path).lower()
    if p.endswith(".csv"):
        return pd.read_csv(path, dtype=str, encoding=encoding)
    return pd.read_excel(path, sheet_name=0, dtype=object)


def main():
    ap = argparse.ArgumentParser(description="Antibiogram (CLSI M39) CLI")
    ap.add_argument("--micro", required=True, help="ไฟล์ line-list แลป (.xlsx/.csv)")
    ap.add_argument("--his", help="ไฟล์ HIS admission (.csv/.xlsx) สำหรับแยก CAI/HAI")
    ap.add_argument("--profile", default=str(HERE / "config" / "mlab_profile.json"))
    ap.add_argument("--out", default="out")
    ap.add_argument("--split", action="store_true", help="ออกไฟล์แยก ALL/CAI/HAI")
    args = ap.parse_args()

    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    conditions = cfg.load_conditions()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    micro = _read_table(args.micro)
    his = None
    his_kw = {}
    if args.his:
        his = _read_table(args.his, encoding=profile.get("his_encoding"))
        h = profile.get("his", {})
        his_kw = dict(his_hn_col=h.get("hn_col"), his_admit_col=h.get("admit_col"),
                      his_an_col=h.get("an_col"))
    his_msg = f", his={len(his):,} rows" if his is not None else ""
    print(f"read micro={len(micro):,} rows{his_msg}  ({time.time()-t0:.1f}s)")

    scopes = [("ALL", ["CAI", "HAI"])]
    if args.split and his is not None:
        scopes += [("CAI", ["CAI"]), ("HAI", ["HAI"])]

    for label, origins in scopes:
        t = time.time()
        res = pipeline.run(micro, profile["col_map"], profile["ab_cols"], conditions,
                           his_df=his, origins=origins, **his_kw)
        data = export.to_publish_excel(res.long_form, res.drug_name, res.totals,
                                       scope=f"All specimen & ward - {label}",
                                       date_range=res.date_range, mdr_df=res.mdr)
        fp = out_dir / f"antibiogram_{label}.xlsx"
        fp.write_bytes(data)
        reported = sum(1 for n in res.totals.values() if n >= 30)
        print(f"[{label}] steps={res.steps} reported>=30={reported} -> {fp}  ({time.time()-t:.1f}s)")


if __name__ == "__main__":
    main()
