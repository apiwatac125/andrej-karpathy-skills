"""แยก CAI / HAI ด้วยเกณฑ์ชั่วโมงหลัง admit (default 48 ชม.)."""

from __future__ import annotations

import pandas as pd


def classify_infection_origin(
    df: pd.DataFrame,
    hai_threshold_hours: float = 48,
    missing_admit_as: str = "CAI",
) -> pd.DataFrame:
    """เพิ่มคอลัมน์ 'infection_origin' (CAI / HAI / UNKNOWN) และ 'hours_since_admit'.

    เกณฑ์: ส่งตรวจครั้งแรก >= hai_threshold_hours หลัง admit -> HAI มิฉะนั้น CAI.
    ถ้าไม่มีวันที่ admit ใช้ค่า missing_admit_as.
    """
    out = df.copy()
    delta = out["collect_datetime"] - out["admit_datetime"]
    hours = delta.dt.total_seconds() / 3600.0
    out["hours_since_admit"] = hours

    def label(h: float) -> str:
        if pd.isna(h):
            return missing_admit_as
        return "HAI" if h >= hai_threshold_hours else "CAI"

    out["infection_origin"] = hours.map(label)
    return out
