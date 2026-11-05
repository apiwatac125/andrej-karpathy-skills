"""จับคู่คอลัมน์ในไฟล์ที่อัปโหลด -> ฟิลด์มาตรฐานที่โปรแกรมใช้.

ฟิลด์มาตรฐาน (logical fields):
    hn               - รหัสผู้ป่วย (ใช้ dedup)
    organism         - ชื่อเชื้อ
    specimen         - ชนิดสิ่งส่งตรวจ
    ward             - หอผู้ป่วย
    admit_datetime   - วันที่/เวลา admit
    collect_datetime - วันที่/เวลาส่งตรวจ (ครั้งแรก)

คอลัมน์ผลยา (antibiotic result columns) เลือกแยกต่างหากเป็นหลายคอลัมน์.

โมดูลนี้ทำ 2 อย่าง:
    1. เดา mapping อัตโนมัติจากชื่อหัวคอลัมน์ (ด้วยรายการ synonym)
    2. save/load profile การ map ไว้ใช้ซ้ำ
"""

from __future__ import annotations

import json
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
PROFILES_PATH = CONFIG_DIR / "column_profiles.json"

# ฟิลด์ระบุตัวตน (identity fields) ที่ต้อง map ทีละคอลัมน์
IDENTITY_FIELDS = [
    "hn",
    "organism",
    "organism_code",
    "specimen",
    "ward",
    "admit_datetime",
    "collect_datetime",
]

# คำที่พบบ่อยในหัวคอลัมน์ของแต่ละฟิลด์ (ใช้เดาอัตโนมัติ, ไม่สนตัวพิมพ์)
SYNONYMS: dict[str, list[str]] = {
    "hn": ["hn", "patient", "รหัสผู้ป่วย", "เลขที่ผู้ป่วย", "an"],
    "organism": ["organism", "เชื้อ", "bacteria", "microorganism", "org"],
    # คอลัมน์โค้ดเชื้อ (ใช้กรอง Gram stain — ค่าที่มี "." / ช่องว่าง)
    "organism_code": ["organism", "org code", "รหัสเชื้อ"],
    "specimen": ["csource", "specimen", "sample", "สิ่งส่งตรวจ", "sample_type", "source"],
    "ward": ["cward", "ward", "หอผู้ป่วย", "location", "unit", "หน่วยงาน"],
    "admit_datetime": ["admit", "admission", "วันที่รับ", "date_admit", "adm_date"],
    "collect_datetime": ["spcdate", "collect", "ส่งตรวจ", "received", "specimen date", "specimen_date", "sample date", "sample_date", "รับสิ่งส่งตรวจ", "order date"],
}


def guess_mapping(columns: list[str]) -> dict[str, str | None]:
    """เดา mapping ฟิลด์มาตรฐาน -> ชื่อคอลัมน์จริง (None ถ้าเดาไม่ได้)."""
    lowered = {c.lower(): c for c in columns}
    result: dict[str, str | None] = {}
    for field, keys in SYNONYMS.items():
        match = None
        # 1) exact match ก่อน (แม่นกว่า เช่น ORGANISM ไม่ใช่ SORGANISM)
        for key in keys:
            if key.lower() in lowered:
                match = lowered[key.lower()]
                break
        # 2) ค่อย substring match
        if not match:
            for key in keys:
                for low, original in lowered.items():
                    if key.lower() in low:
                        match = original
                        break
                if match:
                    break
        result[field] = match
    return result


def guess_antibiotic_columns(columns: list[str], mapping: dict[str, str | None]) -> list[str]:
    """เดาคอลัมน์ผลยา: เลือกเฉพาะคอลัมน์ที่รู้จักใน dictionary ยา (โค้ด/ชื่อยา).

    ถ้าไม่มีคอลัมน์ไหนตรง dictionary เลย จะ fallback เป็นคอลัมน์ที่เหลือทั้งหมด.
    """
    used = {v for v in mapping.values() if v}
    rest = [c for c in columns if c not in used]
    try:
        from .dictionary import load_antibiotic_dictionary, _normalize
        abx = load_antibiotic_dictionary()
        known = [c for c in rest if _normalize(c) in abx._mapping]
        if known:
            return known
    except Exception:
        pass
    return rest


def load_profiles(path: Path = PROFILES_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_profile(name: str, mapping: dict, antibiotic_columns: list[str],
                 path: Path = PROFILES_PATH) -> None:
    """บันทึก profile การ map คอลัมน์ไว้ใช้ซ้ำครั้งหน้า."""
    data = load_profiles(path)
    data.setdefault("profiles", {})[name] = {
        "mapping": mapping,
        "antibiotic_columns": antibiotic_columns,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
