"""จำแนก MDR phenotype ต่อ isolate และสรุปจำนวนต่อเชื้อ (เทียบกับ MLAB).

นิยาม (มาตรฐาน CLSI/ทั่วไป — ปรับได้):
- CRE     : Enterobacterales ดื้อ carbapenem อย่างน้อย 1 ตัว
- CRPA    : Pseudomonas aeruginosa ดื้อ carbapenem
- CRAB    : Acinetobacter baumannii ดื้อ carbapenem
- MRSA    : S. aureus ดื้อ Oxacillin/Cefoxitin
- MRCoNS  : Coagulase Negative Staphylococci ดื้อ Oxacillin/Cefoxitin
- VRE     : Enterococcus ดื้อ Vancomycin
- CoRO    : ดื้อ Colistin (colistin-resistant organism)

หมายเหตุ: isolate หนึ่งอาจติดได้หลาย flag (เช่น CRE + CoRO) เหมือน MLAB.
"""

from __future__ import annotations

import pandas as pd

from . import grouping, rollup
from .antibiogram import _build_result_classifier

CARBAPENEMS = ["Meropenem", "Imipenem", "Ertapenem", "Doripenem"]
MDR_TYPES = ["CRE", "CRPA", "CRAB", "MRSA", "MRCoNS", "VRE", "CoRO"]


def classify_mdr(
    df: pd.DataFrame,
    drug_name: dict,
    conditions: dict,
    organism_field: str = "organism",
) -> pd.DataFrame:
    """เพิ่มคอลัมน์ '_mdr' (list ของ flag) ให้ทุกแถว."""
    susc = conditions.get("susceptibility", {})
    classify = _build_result_classifier(susc)
    # ยาที่คิด %I เป็น susceptible (เช่น Colistin) — "I" ไม่นับเป็นดื้อ
    i_as_s_drugs = {str(x).strip().upper() for x in susc.get("intermediate_as_susceptible_drugs", [])}
    classify_i = _build_result_classifier({**susc, "count_intermediate_as_susceptible": True})

    # ชื่อยามาตรฐาน -> คอลัมน์จริง (อาจมีหลายคอลัมน์)
    std2cols: dict[str, list[str]] = {}
    for col, std in drug_name.items():
        std2cols.setdefault(std, []).append(col)

    taxonomy = rollup.load_taxonomy()
    primary = rollup.load_primary()
    cons_name = "Coagulase Negative Staphylococci"

    def any_R(row, stds) -> bool:
        for s in stds:
            fn = classify_i if str(s).strip().upper() in i_as_s_drugs else classify
            for c in std2cols.get(s, []):
                if c in row and fn(row[c]) == "R":
                    return True
        return False

    def row_flags(row) -> list[str]:
        org = row[organism_field]
        if not isinstance(org, str):
            return []
        genus, family = rollup._tax(org, primary, taxonomy)
        carb = any_R(row, CARBAPENEMS)
        flags = []
        if family == "Enterobacterales" and carb:
            flags.append("CRE")
        if org == "Pseudomonas aeruginosa" and carb:
            flags.append("CRPA")
        if org == "Acinetobacter baumannii" and carb:
            flags.append("CRAB")
        if org == "Staphylococcus aureus" and any_R(row, ["Oxacillin", "Cefoxitin"]):
            flags.append("MRSA")
        if org == cons_name and any_R(row, ["Oxacillin", "Cefoxitin"]):
            flags.append("MRCoNS")
        if genus == "enterococcus" and any_R(row, ["Vancomycin"]):
            flags.append("VRE")
        if any_R(row, ["Colistin"]):
            flags.append("CoRO")
        return flags

    out = df.copy()
    out["_mdr"] = out.apply(row_flags, axis=1)
    return out


def mdr_summary(df: pd.DataFrame, report_field: str = "report_organism") -> pd.DataFrame:
    """สรุปจำนวน isolate ต่อเชื้อ x MDR type (นับเฉพาะเชื้อที่มี flag อย่างน้อย 1)."""
    rows = []
    for org, g in df.groupby(report_field):
        counts = {t: int(g["_mdr"].map(lambda fl: t in fl).sum()) for t in MDR_TYPES}
        if sum(counts.values()) == 0:
            continue
        rec = {"organism": org, "N": len(g)}
        rec.update(counts)
        rows.append(rec)
    cols = ["organism", "N"] + MDR_TYPES
    return pd.DataFrame(rows, columns=cols).sort_values("N", ascending=False).reset_index(drop=True)
