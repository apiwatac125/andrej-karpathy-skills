"""ตัดแถวที่ไม่ใช่เชื้อเพาะจริงออก (Gram stain / smear / ผลตรวจตรง).

ตามวิธีทำเดิมของทีม: ดูจากคอลัมน์โค้ดเชื้อ (ORGANISM) แล้วตัดแถวที่
- โค้ดว่าง / เป็นช่องว่าง
- โค้ดมี "." (เช่น .PMN .EPI .G+CPR)  หรือมีช่องว่างในโค้ด
เก็บเฉพาะแถวที่โค้ดเป็นเชื้อจริง.
"""

from __future__ import annotations

import pandas as pd


def filter_culture_rows(
    df: pd.DataFrame,
    organism_field: str = "organism",
    exclude_substrings=(".", " "),
    drop_blank: bool = True,
) -> tuple[pd.DataFrame, int]:
    """คืน (dataframe ที่กรองแล้ว, จำนวนแถวที่ตัดออก)."""
    code = df[organism_field].astype("string")
    keep = pd.Series(True, index=df.index)
    if drop_blank:
        keep &= code.notna() & (code.str.strip() != "")
    for sub in exclude_substrings:
        keep &= ~code.fillna("").str.contains(sub, regex=False)
    dropped = int((~keep).sum())
    return df[keep].copy(), dropped


def filter_has_ast(
    df: pd.DataFrame,
    antibiotic_columns: list[str],
    not_tested_values=("", "NT", "NA", "N/A", "-"),
) -> tuple[pd.DataFrame, int]:
    """เก็บเฉพาะแถวที่มีผลทดสอบความไวต่อยา (S/I/R) อย่างน้อย 1 ตัว.

    เชื้อที่ไม่มีผล AST เลย (เช่น เชื้อรา/เชื้อที่ไม่ได้ทดสอบ) จะถูกตัดออก.
    """
    nt = {str(v).strip().upper() for v in not_tested_values}

    def has_result(row) -> bool:
        for c in antibiotic_columns:
            v = row.get(c)
            if v is None or (isinstance(v, float) and pd.isna(v)):
                continue
            if str(v).strip().upper() not in nt and str(v).strip() != "":
                return True
        return False

    keep = df.apply(has_result, axis=1)
    dropped = int((~keep).sum())
    return df[keep].copy(), dropped
