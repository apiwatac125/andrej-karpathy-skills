"""Report suppression — คู่ (เชื้อ x ยา) ที่ "ไม่ต้องรายงาน" (ซ่อนช่อง เว้นว่าง).

ต่างจาก intrinsic (ที่แสดง "R"): คู่ใน suppress จะไม่ออกในตารางเลย (ไม่มีแถว/ช่องว่าง)
ใช้กับกรณีที่แลปเลิกรายงานยานั้นกับเชื้อนั้น เช่น CLSI ตัด breakpoint aminoglycoside
ของ Pseudomonas aeruginosa ออก -> ไม่รายงาน Gentamicin ของ Pseudomonas

แก้/เพิ่มได้ที่ config/report_suppress.csv (คอลัมน์: organism, drug, reason)
จับคู่ด้วยชื่อมาตรฐาน (เชื้อ = report_organism, ยา = standard drug name) ไม่สนตัวพิมพ์/ช่องว่าง.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
SUPPRESS_PATH = CONFIG_DIR / "report_suppress.csv"


def _key(name: str) -> str:
    return " ".join(str(name).strip().upper().split())


class SuppressTable:
    def __init__(self, pairs: set[tuple[str, str]]):
        self._pairs = pairs  # (org_key, drug_key)

    @classmethod
    def from_csv(cls, path: Path = SUPPRESS_PATH) -> "SuppressTable":
        if not path.exists():
            return cls(set())
        df = pd.read_csv(path, dtype=str).fillna("")
        pairs = {
            (_key(r["organism"]), _key(r["drug"]))
            for _, r in df.iterrows()
            if r["organism"].strip() and r["drug"].strip()
        }
        return cls(pairs)

    def is_suppressed(self, organism: str, drug: str) -> bool:
        return (_key(organism), _key(drug)) in self._pairs


def load_suppress(path: Path = SUPPRESS_PATH) -> SuppressTable:
    return SuppressTable.from_csv(path)
