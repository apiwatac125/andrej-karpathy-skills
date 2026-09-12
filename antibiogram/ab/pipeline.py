"""Pipeline หลักของโปรแกรม — ใช้ร่วมกันทั้งหน้าจอ Streamlit และ CLI.

ลำดับ: map -> กรอง gram-stain -> กรองไม่มี AST -> normalize ชื่อเชื้อ ->
รวมกลุ่ม (CoNS) -> join HIS (CAI/HAI) -> filter -> dedup -> rollup -> antibiogram.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from . import (antibiogram, classify, clean, dedup, dictionary, grouping,
               his_join, intrinsic, loader, mapping, rollup)


@dataclass
class Result:
    long_form: pd.DataFrame
    matrix: pd.DataFrame
    totals: dict
    drug_name: dict
    steps: dict = field(default_factory=dict)  # log จำนวนแถวแต่ละขั้น


def prepare(
    micro_df: pd.DataFrame,
    col_map: dict,
    ab_cols: list[str],
    conditions: dict,
    his_df: pd.DataFrame | None = None,
    his_hn_col: str | None = None,
    his_admit_col: str | None = None,
    his_an_col: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    """map -> clean -> normalize -> group -> join HIS -> classify CAI/HAI.

    คืน (std_df ที่จำแนก origin แล้ว, steps) ก่อน filter/dedup — ใช้เติม filter บนหน้าจอ.
    """
    hai_days = int(conditions.get("classification", {}).get("hai_threshold_days", 2))
    missing_admit_as = conditions.get("classification", {}).get("missing_admit_as", "CAI")
    nt = conditions.get("susceptibility", {}).get("not_tested_values", ["", "NT", "NA", "N/A", "-"])
    steps = {"input": len(micro_df)}

    std = loader.apply_mapping(micro_df, col_map, ab_cols)

    _clean = conditions.get("cleaning", {})
    # กรอง Gram stain จากคอลัมน์โค้ด (ถ้าเลือกไว้) ไม่งั้นใช้คอลัมน์ชื่อเชื้อ
    code_field = "organism_code" if col_map.get("organism_code") else "organism"
    std, _ = clean.filter_culture_rows(
        std,
        organism_field=code_field,
        exclude_substrings=tuple(_clean.get("drop_if_organism_contains", [".", " "])),
        drop_blank=_clean.get("drop_if_organism_blank", True),
    )
    steps["after_culture_filter"] = len(std)

    std, _ = clean.filter_has_ast(std, ab_cols, not_tested_values=nt)
    steps["after_ast_filter"] = len(std)

    org_dict = dictionary.load_organism_dictionary()
    std["organism"] = std["organism"].map(lambda v: org_dict.normalize(v) if pd.notna(v) else v)
    std = grouping.apply_groups(std, organism_field="organism")

    if his_df is not None and his_hn_col and his_admit_col:
        adm = his_df
        if his_an_col and his_an_col in his_df.columns:
            adm = his_df[his_df[his_an_col].notna() & (his_df[his_an_col].astype(str).str.strip() != "")]
        lookup = his_join.build_admit_lookup(adm, his_hn_col, his_admit_col)
        std = std.drop(columns=["admit_datetime"], errors="ignore")
        std = his_join.attach_admit(std, lookup)
        steps["admit_matched"] = int(std["admit_datetime"].notna().sum())

    std = classify.classify_infection_origin(std, hai_threshold_days=hai_days,
                                             missing_admit_as=missing_admit_as)
    return std, steps


def finalize(
    std: pd.DataFrame,
    ab_cols: list[str],
    conditions: dict,
    specimens: list | None = None,
    wards: list | None = None,
    origins: list | None = None,
    show_unreportable: bool = False,
    steps: dict | None = None,
) -> Result:
    """filter -> dedup -> rollup -> antibiogram."""
    min_iso = int(conditions.get("reporting", {}).get("min_isolates", 30))
    do_dedup = bool(conditions.get("deduplication", {}).get("enabled", True))
    scope = conditions.get("deduplication", {}).get("scope", ["hn", "organism"])
    steps = dict(steps or {})

    work = std
    if specimens is not None:
        work = work[work["specimen"].isin(specimens)]
    if wards is not None:
        work = work[work["ward"].isin(wards)]
    if origins is not None:
        work = work[work["infection_origin"].isin(origins)]
    work = work.copy()
    steps["after_filter"] = len(work)

    if do_dedup:
        work = dedup.first_isolate_per_patient(work, scope=scope)
    steps["after_dedup"] = len(work)

    work = rollup.apply_rollup(work, min_iso, organism_field="organism",
                               keep_groups=set(grouping.load_groups().values()))

    abx = dictionary.load_antibiotic_dictionary()
    drug_name = {ab: abx.normalize(ab) for ab in ab_cols}
    long_form = antibiogram.compute_antibiogram(
        work, ab_cols, conditions, organism_field="report_organism",
        intrinsic=intrinsic.load_intrinsic(), drug_name=drug_name,
    )
    matrix = antibiogram.to_matrix(long_form, show_unreportable=show_unreportable)
    totals = work["report_organism"].value_counts().to_dict()
    return Result(long_form, matrix, totals, drug_name, steps)


def run(micro_df, col_map, ab_cols, conditions, his_df=None, his_hn_col=None,
        his_admit_col=None, his_an_col=None, specimens=None, wards=None,
        origins=None, show_unreportable=False) -> Result:
    """prepare + finalize รวบเดียว (ใช้ใน CLI)."""
    std, steps = prepare(micro_df, col_map, ab_cols, conditions, his_df,
                         his_hn_col, his_admit_col, his_an_col)
    return finalize(std, ab_cols, conditions, specimens, wards, origins,
                    show_unreportable, steps)
