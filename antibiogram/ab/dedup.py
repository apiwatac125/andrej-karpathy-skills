"""CLSI M39: เก็บเฉพาะ isolate ตัวแรกของผู้ป่วยแต่ละคนต่อสายพันธุ์."""

from __future__ import annotations

import pandas as pd


def first_isolate_per_patient(
    df: pd.DataFrame,
    scope: list[str] | None = None,
    order_by: str = "collect_datetime",
) -> pd.DataFrame:
    """คืน dataframe ที่เหลือเฉพาะแถวแรก (เรียงตามวันที่ส่งตรวจ) ของแต่ละกลุ่ม scope.

    scope ปริยาย = ['hn', 'organism'] (ผู้ป่วยคนเดิม + เชื้อชนิดเดิม).
    แถวที่ order_by เป็นค่าว่างจะถูกจัดไว้ท้าย (นับเป็นตัวหลัง).
    """
    scope = scope or ["hn", "organism"]
    sorted_df = df.sort_values(by=order_by, na_position="last", kind="stable")
    return sorted_df.drop_duplicates(subset=scope, keep="first").reset_index(drop=True)
