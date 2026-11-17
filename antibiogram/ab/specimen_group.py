"""จัดกลุ่มสิ่งส่งตรวจ — จับค่า CSOURCE_A ดิบ -> กลุ่ม specimen (dictionary).

แก้/เพิ่มได้ที่ config/specimens.csv (คอลัมน์: raw_name, group)
จับคู่แบบไม่สนตัวพิมพ์เล็ก-ใหญ่และช่องว่างซ้ำ (DBF บางค่ามี 2 เว้นวรรค เช่น "Bone  (SWAB)").
ค่าที่ไม่มีในตาราง -> คงชื่อดิบไว้ (ไม่ยุบเงียบ ๆ จะได้เห็นว่าต้องเพิ่มใน dict).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
SPECIMEN_PATH = CONFIG_DIR / "specimens.csv"


def _key(name) -> str:
    return " ".join(str(name).strip().upper().split())


class SpecimenGroups:
    def __init__(self, mapping: dict[str, str]):
        self._map = mapping  # key(raw) -> group

    @classmethod
    def from_csv(cls, path: Path = SPECIMEN_PATH) -> "SpecimenGroups":
        if not path.exists():
            return cls({})
        df = pd.read_csv(path, dtype=str).fillna("")
        m = {_key(r["raw_name"]): r["group"].strip()
             for _, r in df.iterrows()
             if str(r["raw_name"]).strip() and str(r["group"]).strip()}
        return cls(m)

    def group_of(self, specimen):
        """คืนชื่อกลุ่ม หรือ None ถ้าไม่มีในตาราง."""
        return self._map.get(_key(specimen))


def load_specimen_groups(path: Path = SPECIMEN_PATH) -> SpecimenGroups:
    return SpecimenGroups.from_csv(path)
