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


# family ที่รวมทั้ง family เป็นก้อนเดียว (เช่น Enterobacterales) แทนการแยกราย genus
POOL_AT_FAMILY = {"Enterobacterales"}


def build_report_mapping(
    counts: dict[str, int],
    min_isolates: int,
    primary: dict,
    taxonomy: dict,
    keep_groups: set | None = None,
    pool_at_family: set | None = None,
) -> dict[str, str]:
    """คืน dict species -> ชื่อกลุ่มที่จะใช้รายงาน.

    - species >= min          -> ชื่อของตัวเอง
    - species < min:
        * ชื่อที่อยู่ใน keep_groups (เช่น CoNS ที่ถูกรวมไว้แล้ว) -> คงเดิม
        * family อยู่ใน pool_at_family (เช่น Enterobacterales) -> "Other <Family>"
        * มี genus                                            -> "<Genus> species"
        * นอกนั้น                                             -> "Other organisms"
    """
    keep_groups = keep_groups or set()
    pool_at_family = pool_at_family if pool_at_family is not None else POOL_AT_FAMILY
    report: dict[str, str] = {}

    for sp, c in counts.items():
        if sp in keep_groups or c >= min_isolates:
            report[sp] = sp
            continue
        genus, family = _tax(sp, primary, taxonomy)
        if family in pool_at_family:
            report[sp] = f"Other {family}"
        elif genus:
            report[sp] = f"{genus.capitalize()} species"
        else:
            report[sp] = "Other organisms"

    return report


def apply_rollup(
    df: pd.DataFrame,
    min_isolates: int,
    organism_field: str = "organism",
    primary: dict | None = None,
    taxonomy: dict | None = None,
    keep_groups: set | None = None,
) -> pd.DataFrame:
    """เพิ่มคอลัมน์ 'report_organism' ให้ df ตามกติกา rollup."""
    primary = primary if primary is not None else load_primary()
    taxonomy = taxonomy if taxonomy is not None else load_taxonomy()
    counts = df[organism_field].value_counts().to_dict()
    mapping = build_report_mapping(counts, min_isolates, primary, taxonomy, keep_groups=keep_groups)
    out = df.copy()
    out["report_organism"] = out[organism_field].map(lambda s: mapping.get(s, s))
    return out
