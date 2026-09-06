"""ส่งออกผล antibiogram เป็นไฟล์ Excel."""

from __future__ import annotations

import io

import pandas as pd


def to_excel_bytes(matrix: pd.DataFrame, long_form: pd.DataFrame) -> bytes:
    """คืนไฟล์ Excel (bytes) สำหรับให้ดาวน์โหลด: 2 sheet (สรุป + รายละเอียด)."""
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        matrix.to_excel(writer, sheet_name="Antibiogram")
        long_form.to_excel(writer, sheet_name="Details", index=False)
    return buffer.getvalue()
