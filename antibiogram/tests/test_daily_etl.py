"""เทสต์ daily_etl.build_summary (รันด้วย `python tests/test_daily_etl.py`).

ตรวจว่า:
- ได้แถวสรุปทุกช่วง (ทุกปี + rolling12m) × ทุกกลุ่ม (All / specimen / CAI-HAI)
- คอลัมน์ output ไม่มี PHI (ไม่มี hn/name/an ฯลฯ)
- ตัวเลขตรงกับ ab.rolling (n_tested, pct_s) สำหรับคู่หนึ่ง
- dedup_reports ตัดรายงานซ้ำโดยเก็บ RPTDATE ล่าสุด
"""
import random
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import daily_etl  # noqa: E402
from ab import config as cfg, rolling  # noqa: E402

AB_COLS = ["CAZ", "CRO", "MEM"]


def _synthetic():
    rng = random.Random(3)
    rows = []
    for org in ["Escherichia coli", "Klebsiella pneumoniae"]:
        for year in (2024, 2025):
            for i in range(60):
                dt = pd.Timestamp(year=year, month=rng.randint(1, 12), day=rng.randint(1, 28))
                row = {"hn": f"{org[:2]}{year}{i:04d}", "organism": org, "specimen": "Blood",
                       "ward": "ICU", "infection_origin": "CAI" if i % 2 else "HAI",
                       "collect_datetime": dt}
                for ab in AB_COLS:
                    row[ab] = "S" if rng.random() < 0.7 else "R"
                rows.append(row)
    return pd.DataFrame(rows)


def main():
    conditions = cfg.load_conditions()
    std = _synthetic()
    summary = daily_etl.build_summary(std, AB_COLS, conditions, rolling_months=12)

    assert list(summary.columns) == daily_etl.OUT_COLS, summary.columns.tolist()
    # ไม่มี PHI หลุด
    assert not (daily_etl.PHI_COLS & {c.lower() for c in summary.columns})
    assert not any("hn" in str(v).lower() for v in summary["stratum"].unique())

    periods = set(summary["period"])
    assert {"2024", "2025", "rolling12m"} <= periods, periods
    strata = set(summary["stratum"])
    assert {"All", "Blood", "CAI", "HAI"} <= strata, strata

    # ตรงกับ ab.rolling โดยตรง: E. coli / MEM ปี 2025 กลุ่ม All
    ann = rolling.annual(std, AB_COLS, conditions, year=2025)
    r = ann.long_form[(ann.long_form.organism == "Escherichia coli")
                      & (ann.long_form.antibiotic == "MEM")].iloc[0]
    got = summary[(summary.period == "2025") & (summary.stratum == "All")
                  & (summary.organism == "Escherichia coli")
                  & (summary.drug == ann.drug_name.get("MEM", "MEM"))].iloc[0]
    assert int(got["n_tested"]) == int(r["n_tested"]), (got["n_tested"], r["n_tested"])
    assert int(got["pct_s"]) == int(r["pct_susceptible"])

    # dedup_reports: เก็บ RPTDATE ล่าสุดต่อ REF_NO+LAB_NO+ORGANISM
    raw = pd.DataFrame({
        "REF_NO": ["A", "A", "B"], "LAB_NO": ["1", "1", "2"],
        "ORGANISM": ["EC", "EC", "KP"], "RPTDATE": ["2025-01-01", "2025-01-03", "2025-01-02"],
        "MEM": ["R", "S", "S"],
    })
    dd = daily_etl.dedup_reports(raw)
    assert len(dd) == 2
    assert dd[(dd.REF_NO == "A")].iloc[0]["MEM"] == "S"  # ฉบับ 01-03 ชนะ

    # regression: specimen ที่โผล่เฉพาะบางปี -> (specimen × ปีที่ไม่มีข้อมูล) ต้องไม่ทำให้พัง
    extra = pd.DataFrame([{
        "hn": f"X{i:04d}", "organism": "Escherichia coli", "specimen": "CSF",
        "ward": "ICU", "infection_origin": "HAI",
        "collect_datetime": pd.Timestamp(year=2025, month=6, day=1),
        "CAZ": "S", "CRO": "S", "MEM": "S",
    } for i in range(3)])
    std2 = pd.concat([std, extra], ignore_index=True)
    summary2 = daily_etl.build_summary(std2, AB_COLS, conditions, rolling_months=12)
    assert "CSF" in set(summary2["stratum"])
    # CSF มีเฉพาะปี 2025 -> ต้องไม่มีแถว CSF ปี 2024
    assert summary2[(summary2.stratum == "CSF") & (summary2.period == "2024")].empty

    print(f"OK — {len(summary)} แถวสรุป · ช่วง={sorted(periods)} · กลุ่ม={sorted(strata)} · "
          f"E.coli MEM 2025 All: {got['pct_s']}%S (N={got['n_tested']}) · empty-stratum ok")


if __name__ == "__main__":
    main()
