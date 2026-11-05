"""Intrinsic resistance — คู่ (เชื้อ x ยา) ที่ดื้อโดยธรรมชาติ แสดงเป็น "R".

ตั้งต้นจากไฟล์ publish ปีล่าสุด (= ตารางที่ทีมใช้จริง ตรงกับ CLSI M100 Appendix B)
แก้/เพิ่มได้ที่ config/intrinsic_resistance.csv (คอลัมน์: organism, drug, source)

การจับคู่ใช้ชื่อมาตรฐาน (เชื้อ = report_organism, ยา = standard drug name)
แบบไม่สนตัวพิมพ์เล็ก-ใหญ่และช่องว่างส่วนเกิน.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
INTRINSIC_PATH = CONFIG_DIR / "intrinsic_resistance.csv"


def _key(name: str) -> str:
    return " ".join(str(name).strip().upper().split())


class IntrinsicTable:
    def __init__(self, pairs: set[tuple[str, str]]):
        self._pairs = pairs  # (org_key, drug_key)

    @classmethod
    def from_csv(cls, path: Path = INTRINSIC_PATH) -> "IntrinsicTable":
        df = pd.read_csv(path, dtype=str).fillna("")
        pairs = {
            (_key(r["organism"]), _key(r["drug"]))
            for _, r in df.iterrows()
            if r["organism"].strip() and r["drug"].strip()
        }
        return cls(pairs)

    def is_intrinsic(self, organism: str, drug: str) -> bool:
        return (_key(organism), _key(drug)) in self._pairs


def load_intrinsic(path: Path = INTRINSIC_PATH) -> IntrinsicTable:
    return IntrinsicTable.from_csv(path)
