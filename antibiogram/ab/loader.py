"""อ่านไฟล์ Excel และ normalize เข้าสู่ dataframe มาตรฐาน.

หมายเหตุ: รูปแบบวันที่/เวลา และค่าผล S/I/R จริง ขึ้นกับไฟล์ของผู้ใช้
เมื่อได้ไฟล์ตัวอย่างแล้วจะยืนยัน/ปรับ parsing ให้ตรงอีกครั้ง.
"""

from __future__ import annotations

import pandas as pd


def read_excel(file, sheet_name: int | str = 0) -> pd.DataFrame:
    """อ่าน Excel เป็น dataframe (file = path หรือ uploaded file object)."""
    return pd.read_excel(file, sheet_name=sheet_name, dtype=object)


def apply_mapping(
    df: pd.DataFrame,
    mapping: dict[str, str | None],
    antibiotic_columns: list[str],
) -> pd.DataFrame:
    """สร้าง dataframe มาตรฐาน: คอลัมน์ identity เปลี่ยนชื่อเป็นฟิลด์มาตรฐาน
    ตามด้วยคอลัมน์ผลยา (คงชื่อเดิม)."""
    out = pd.DataFrame(index=df.index)
    for field, source_col in mapping.items():
        if source_col and source_col in df.columns:
            out[field] = df[source_col]
        else:
            out[field] = pd.NA

    for col in antibiotic_columns:
        if col in df.columns:
            out[col] = df[col]

    # แปลงคอลัมน์วันที่เป็น datetime (พยายามเดารูปแบบอัตโนมัติ)
    for dt_field in ("admit_datetime", "collect_datetime"):
        if dt_field in out.columns:
            out[dt_field] = pd.to_datetime(out[dt_field], errors="coerce")

    return out


def antibiotic_columns_from_std(df: pd.DataFrame) -> list[str]:
    """คืนรายชื่อคอลัมน์ผลยาใน dataframe มาตรฐาน (ที่ไม่ใช่ identity fields)."""
    from .mapping import IDENTITY_FIELDS

    return [c for c in df.columns if c not in IDENTITY_FIELDS]
