"""Join ไฟล์ HIS (รายงาน QR-10-020) เข้ากับ line-list แลป ด้วย HN
เพื่อเติม 'admit_datetime' ให้แต่ละ isolate สำหรับคำนวณ CAI/HAI.

อ้างอิงตรรกะ normalize HN จากสคริปต์เดิมของทีม (his_ward_sync.py):
    เอาเฉพาะตัวเลข -> ถ้ายาว >= 10 หลัก ตัด 2 หลักหน้า
"""

from __future__ import annotations

import re

import pandas as pd


def norm_hn(value) -> str:
    """normalize HN ให้ตรงกันทั้ง 2 ฝั่ง (ตามกติกาเดิมของทีม)."""
    digits = re.sub(r"\D", "", str(value))
    return digits[2:] if len(digits) >= 10 else digits


def build_admit_lookup(
    his_df: pd.DataFrame,
    hn_col: str,
    admit_col: str,
    admit_format: str | None = "%d/%m/%Y",
) -> pd.DataFrame:
    """แปลง HIS dataframe -> ตาราง (hn_norm, admit_datetime) หนึ่งแถวต่อ admission.

    คืนทุก admission (ยังไม่ยุบ) เพื่อให้เลือก admission ที่ตรงกับวันส่งตรวจภายหลัง.
    """
    out = pd.DataFrame()
    # astype(object) กันชนิดไม่ตรง (pandas 3.x อ่าน CSV เป็น StringDtype)
    out["hn_norm"] = his_df[hn_col].map(norm_hn).astype(object)
    out["admit_datetime"] = pd.to_datetime(
        his_df[admit_col], format=admit_format, errors="coerce"
    )
    out = out[(out["hn_norm"] != "") & out["admit_datetime"].notna()]
    return out.sort_values("admit_datetime").reset_index(drop=True)


def attach_admit(
    lab_df: pd.DataFrame,
    admit_lookup: pd.DataFrame,
    lab_hn_col: str = "hn",
    collect_col: str = "collect_datetime",
) -> pd.DataFrame:
    """เติมคอลัมน์ 'admit_datetime' ให้ lab_df โดยเลือก admission ล่าสุด
    ที่ admit <= วันส่งตรวจ (admission ที่ครอบคลุม/ก่อนการส่งตรวจนั้น).

    ใช้ merge_asof (backward) จับคู่ตามเวลาในแต่ละ HN.
    """
    left = lab_df.copy()
    left["hn_norm"] = left[lab_hn_col].map(norm_hn).astype(object)
    left["_row"] = range(len(left))

    # merge_asof ต้องเรียงตามคีย์เวลา
    left_sorted = left.sort_values(collect_col)
    right_sorted = admit_lookup.sort_values("admit_datetime")

    merged = pd.merge_asof(
        left_sorted,
        right_sorted,
        left_on=collect_col,
        right_on="admit_datetime",
        by="hn_norm",
        direction="backward",
    )
    # คืนลำดับเดิม + ตัดคอลัมน์ช่วยงาน
    merged = merged.sort_values("_row").drop(columns=["_row"]).reset_index(drop=True)
    return merged
