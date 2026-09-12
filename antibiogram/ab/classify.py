"""แยก CAI / HAI โดยนับส่วนต่างเป็น "วัน" (วันปฏิทิน).

เกณฑ์: (วันส่งตรวจ - วัน admit) >= hai_threshold_days -> HAI มิฉะนั้น CAI.
ไม่คิดชั่วโมง (normalize เป็นวันที่ก่อนลบกัน).
"""

from __future__ import annotations

import pandas as pd


def classify_infection_origin(
    df: pd.DataFrame,
    hai_threshold_days: int = 2,
    missing_admit_as: str = "CAI",
) -> pd.DataFrame:
    """เพิ่มคอลัมน์ 'infection_origin' (CAI / HAI / UNKNOWN) และ 'days_since_admit'.

    ถ้าไม่มีวันที่ admit ใช้ค่า missing_admit_as.
    """
    out = df.copy()
    # ถ้าไม่มีคอลัมน์ (เช่นไม่ได้ join HIS) ให้ถือว่าไม่มีค่า (NaT)
    collect_raw = out["collect_datetime"] if "collect_datetime" in out.columns else pd.NaT
    admit_raw = out["admit_datetime"] if "admit_datetime" in out.columns else pd.NaT
    collect_day = pd.to_datetime(pd.Series(collect_raw, index=out.index), errors="coerce").dt.normalize()
    admit_day = pd.to_datetime(pd.Series(admit_raw, index=out.index), errors="coerce").dt.normalize()
    days = (collect_day - admit_day).dt.days
    out["days_since_admit"] = days

    def label(d) -> str:
        if pd.isna(d):
            return missing_admit_as
        return "HAI" if d >= hai_threshold_days else "CAI"

    out["infection_origin"] = days.map(label)
    return out
