"""Dictionary แปลงชื่อเชื้อ/ยา จากที่เจอในไฟล์ ให้เป็นชื่อมาตรฐาน.

ไฟล์ dictionary เป็น CSV 2 คอลัมน์: raw_name, standard_name
การจับคู่ทำแบบ normalize (ตัดช่องว่าง + ตัวพิมพ์ใหญ่) เพื่อกันความต่างเล็กน้อย.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
ORGANISMS_PATH = CONFIG_DIR / "organisms.csv"
ANTIBIOTICS_PATH = CONFIG_DIR / "antibiotics.csv"


def _normalize(name: str) -> str:
    return " ".join(str(name).strip().upper().split())


class Dictionary:
    """ตารางแปลงชื่อ raw -> standard พร้อมเก็บรายการที่ยังไม่รู้จัก."""

    def __init__(self, mapping: dict[str, str]):
        # key ถูก normalize ไว้แล้ว
        self._mapping = mapping

    @classmethod
    def from_csv(cls, path: Path) -> "Dictionary":
        df = pd.read_csv(path, dtype=str).fillna("")
        mapping = {
            _normalize(row["raw_name"]): row["standard_name"].strip()
            for _, row in df.iterrows()
            if row["raw_name"].strip()
        }
        return cls(mapping)

    def normalize(self, name: str) -> str:
        """คืนชื่อมาตรฐาน ถ้าไม่พบใน dictionary คืนชื่อเดิม (strip)."""
        return self._mapping.get(_normalize(name), str(name).strip())

    def unknown_values(self, names) -> list[str]:
        """คืนรายชื่อที่ยังไม่มีใน dictionary (ไว้เตือนผู้ใช้ให้เพิ่ม)."""
        seen: dict[str, str] = {}
        for n in names:
            if n is None or str(n).strip() == "":
                continue
            key = _normalize(n)
            if key not in self._mapping:
                seen.setdefault(key, str(n).strip())
        return sorted(seen.values())


def load_organism_dictionary(path: Path = ORGANISMS_PATH) -> Dictionary:
    return Dictionary.from_csv(path)


def load_antibiotic_dictionary(path: Path = ANTIBIOTICS_PATH) -> Dictionary:
    return Dictionary.from_csv(path)
