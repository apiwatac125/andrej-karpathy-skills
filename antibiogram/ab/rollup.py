"""รวมกลุ่มเชื้อ (rollup) ตาม CLSI M39 เมื่อ isolate ไม่ถึงเกณฑ์ขั้นต่ำ.

กติกา:
- เชื้อที่ n >= min           -> รายงานเป็นแถวของตัวเอง
- เชื้อที่ n < min            -> รวมเป็น "<Genus> species"
- genus ที่รวมแล้วยัง < min   -> รวมเป็น "Other <Family>"
- family ที่ยัง < min         -> "Other organisms"

เชื้อหลักที่ >= min จะแยกเป็นแถวของตัวเองอยู่แล้ว (จึงไม่ปนกับ "อื่นๆ")
ส่วนเชื้อ < min ทุกตัว (รวมเชื้อหลัก) จะ rollup ตามลำดับ genus -> family -> Other
เช่น Citrobacter/Serratia ที่ < 30 จะรวมเป็น "Other Enterobacterales".
primary_organisms.csv ใช้เพื่อระบุ genus/family ที่ถูกต้องของชื่อเชื้อเท่านั้น.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
TAXONOMY_PATH = CONFIG_DIR / "taxonomy.csv"
PRIMARY_PATH = CONFIG_DIR / "primary_organisms.csv"


def load_taxonomy(path: Path = TAXONOMY_PATH) -> dict[str, str]:
    """คืน dict genus(lower) -> family."""
    df = pd.read_csv(path, dtype=str).fillna("")
    return {r["genus"].strip().lower(): r["family"].strip() for _, r in df.iterrows()
            if r["genus"].strip()}


def load_primary(path: Path = PRIMARY_PATH) -> dict[str, tuple[str, str]]:
    """คืน dict standard_name -> (genus, family) สำหรับเชื้อหลัก."""
    df = pd.read_csv(path, dtype=str).fillna("")
    return {
        r["standard_name"].strip(): (r["genus"].strip().lower(), r["family"].strip())
        for _, r in df.iterrows() if r["standard_name"].strip()
    }


def _tax(species: str, primary: dict, taxonomy: dict) -> tuple[str, str | None]:
    if species in primary:
        return primary[species]
    genus = species.strip().split()[0].lower() if species.strip() else ""
    return genus, taxonomy.get(genus)


def build_report_mapping(
    counts: dict[str, int],
    min_isolates: int,
    primary: dict,
    taxonomy: dict,
) -> dict[str, str]:
    """คืน dict species -> ชื่อกลุ่มที่จะใช้รายงาน."""
    report: dict[str, str] = {}
    genus_pool: dict[str, int] = {}
    genus_members: dict[str, set] = {}
    genus_family: dict[str, str | None] = {}

    for sp, c in counts.items():
        genus, family = _tax(sp, primary, taxonomy)
        if c >= min_isolates:
            report[sp] = sp
            continue
        genus_pool[genus] = genus_pool.get(genus, 0) + c
        genus_members.setdefault(genus, set()).add(sp)
        genus_family[genus] = family

    family_pool: dict[str, int] = {}
    family_members: dict[str, set] = {}
    for genus, total in genus_pool.items():
        if total >= min_isolates:
            label = f"{genus.capitalize()} species"
            for sp in genus_members[genus]:
                report[sp] = label
        else:
            fam = genus_family.get(genus) or "__none__"
            family_pool[fam] = family_pool.get(fam, 0) + total
            family_members.setdefault(fam, set()).update(genus_members[genus])

    for fam, total in family_pool.items():
        label = f"Other {fam}" if (fam != "__none__" and total >= min_isolates) else "Other organisms"
        for sp in family_members[fam]:
            report[sp] = label

    return report


def apply_rollup(
    df: pd.DataFrame,
    min_isolates: int,
    organism_field: str = "organism",
    primary: dict | None = None,
    taxonomy: dict | None = None,
) -> pd.DataFrame:
    """เพิ่มคอลัมน์ 'report_organism' ให้ df ตามกติกา rollup."""
    primary = primary if primary is not None else load_primary()
    taxonomy = taxonomy if taxonomy is not None else load_taxonomy()
    counts = df[organism_field].value_counts().to_dict()
    mapping = build_report_mapping(counts, min_isolates, primary, taxonomy)
    out = df.copy()
    out["report_organism"] = out[organism_field].map(lambda s: mapping.get(s, s))
    return out
