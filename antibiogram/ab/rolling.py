"""Rolling (moving-window) antibiogram — ประสานกับแนวคิดจาก AMR Alert Dashboard.

antibiogram รายปี = หน้าต่างปีปฏิทิน (1 ม.ค. – 31 ธ.ค.)
rolling antibiogram = หน้าต่างเลื่อนย้อนหลัง N เดือน (ปริยาย 12) นับถึงวันล่าสุดของข้อมูล
    ใช้จับการดื้อยาที่เปลี่ยนเร็วกว่าตารางรายปี (ตาม CLSI M39 ที่แนะนำให้ทบทวนสม่ำเสมอ)

ทั้งคู่ใช้ pipeline.finalize() เดิม (dedup first-isolate, rollup, เกณฑ์ N≥30) โดยกรองช่วงวันที่
บน `collect_datetime` ก่อน แล้วจึงคิด %S — ผลจึงเทียบกันได้ตรง ๆ.
"""

from __future__ import annotations

import pandas as pd

from . import pipeline

DATE_COL = "collect_datetime"


def data_end(std: pd.DataFrame, col: str = DATE_COL) -> pd.Timestamp | None:
    """วันล่าสุดที่มีข้อมูลจริง (ใช้เป็นปลายหน้าต่าง rolling ปริยาย)."""
    if col not in std.columns:
        return None
    dt = pd.to_datetime(std[col], errors="coerce").dropna()
    return dt.max() if not dt.empty else None


def _window(std: pd.DataFrame, start, end, col: str = DATE_COL) -> pd.DataFrame:
    """กรองแถวที่ start < collect_datetime <= end (แถววันที่ว่างถูกตัดออก)."""
    dt = pd.to_datetime(std[col], errors="coerce")
    mask = dt.notna()
    if start is not None:
        mask &= dt > pd.Timestamp(start)
    if end is not None:
        mask &= dt <= pd.Timestamp(end)
    return std[mask].copy()


def annual(std, ab_cols, conditions, year: int | None = None, **finalize_kw):
    """antibiogram ของทั้งปีปฏิทิน (ปริยาย = ปีของวันล่าสุดในข้อมูล)."""
    if year is None:
        e = data_end(std)
        year = int(e.year) if e is not None else pd.Timestamp.now().year
    start = pd.Timestamp(year=year, month=1, day=1) - pd.Timedelta(seconds=1)
    end = pd.Timestamp(year=year, month=12, day=31, hour=23, minute=59, second=59)
    res = pipeline.finalize(_window(std, start, end), ab_cols, conditions, **finalize_kw)
    res.window = {"kind": "annual", "year": year, "start": start, "end": end,
                  "label": f"ปี {year}"}
    return res


def rolling(std, ab_cols, conditions, end=None, months: int = 12, **finalize_kw):
    """antibiogram หน้าต่างเลื่อนย้อนหลัง `months` เดือน นับถึง `end` (ปริยาย = วันล่าสุด)."""
    if end is None:
        end = data_end(std)
    end = pd.Timestamp(end)
    start = end - pd.DateOffset(months=months)
    res = pipeline.finalize(_window(std, start, end), ab_cols, conditions, **finalize_kw)
    res.window = {"kind": "rolling", "months": months, "start": start, "end": end,
                  "label": f"ย้อนหลัง {months} เดือน (ถึง {end:%d %b %Y})"}
    return res


def rolling_series(std, ab_cols, conditions, months: int = 12, step: int = 1,
                   points: int = 12, end=None, **finalize_kw):
    """ชุด rolling หลายจุดเวลา (ไว้ดูแนวโน้ม) — คืน list ของ (end_date, Result) เรียงเก่า→ใหม่."""
    if end is None:
        end = data_end(std)
    end = pd.Timestamp(end)
    out = []
    for k in range(points):
        e = end - pd.DateOffset(months=step * k)
        out.append((e, rolling(std, ab_cols, conditions, end=e, months=months, **finalize_kw)))
    return list(reversed(out))


def compare(annual_res, rolling_res) -> pd.DataFrame:
    """ตารางเทียบ %S รายปี vs rolling ต่อ (เชื้อ x ยา).

    คืนคอลัมน์: organism, antibiotic, pct_annual, n_annual, pct_rolling, n_rolling, delta
    (delta = rolling − annual; ติดลบ = ไวลดลง/ดื้อเพิ่ม) เฉพาะคู่ที่ reportable ทั้งสองฝั่ง.
    """
    def frame(res, tag):
        d = res.long_form[["organism", "antibiotic", "pct_susceptible", "n_tested", "reportable"]].copy()
        d = d[d["reportable"] & d["pct_susceptible"].notna()]
        return d.rename(columns={"pct_susceptible": f"pct_{tag}", "n_tested": f"n_{tag}"}) \
                .drop(columns=["reportable"])

    a, r = frame(annual_res, "annual"), frame(rolling_res, "rolling")
    m = a.merge(r, on=["organism", "antibiotic"], how="inner")
    if not m.empty:
        m["delta"] = (m["pct_rolling"] - m["pct_annual"]).astype(int)
        m = m.sort_values(["delta", "organism", "antibiotic"]).reset_index(drop=True)
    return m
