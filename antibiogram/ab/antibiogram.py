"""คำนวณตาราง antibiogram: %Susceptible ต่อคู่ (เชื้อ x ยา) ตาม CLSI M39."""

from __future__ import annotations

import pandas as pd


def _build_result_classifier(susc: dict):
    """สร้างฟังก์ชันแปลงค่าผลดิบ -> 'S' / 'R' / None (None = ไม่ได้ทดสอบ/ไม่นับ)."""
    def norm(v) -> str:
        return str(v).strip().upper()

    s_vals = {norm(x) for x in susc.get("susceptible_values", [])}
    i_vals = {norm(x) for x in susc.get("intermediate_values", [])}
    r_vals = {norm(x) for x in susc.get("resistant_values", [])}
    nt_vals = {norm(x) for x in susc.get("not_tested_values", [])}
    count_i_as_s = susc.get("count_intermediate_as_susceptible", False)

    def classify(value) -> str | None:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        v = norm(value)
        if v == "" or v in nt_vals:
            return None
        if v in s_vals:
            return "S"
        if v in r_vals:
            return "R"
        if v in i_vals:
            return "S" if count_i_as_s else "R"
        # ค่าที่ไม่รู้จัก -> ไม่นับ (กันผลเพี้ยน)
        return None

    return classify


def compute_antibiogram(
    df: pd.DataFrame,
    antibiotic_columns: list[str],
    conditions: dict,
    organism_field: str = "organism",
    intrinsic=None,
    drug_name: dict | None = None,
) -> pd.DataFrame:
    """คืนตาราง antibiogram แบบ long-form:
        organism, antibiotic, n_tested, n_susceptible, pct_susceptible, reportable, intrinsic

    intrinsic  : IntrinsicTable (ถ้ามี) -> คู่ (เชื้อ x ยา) ที่ดื้อโดยธรรมชาติ = "R"
    drug_name  : dict คอลัมน์ยา -> ชื่อยามาตรฐาน (ใช้จับคู่กับตาราง intrinsic)

    reportable = False ถ้าจำนวน isolate < min_isolates (ตาม M39 ไม่ควรรายงาน %S).
    """
    susc = conditions.get("susceptibility", {})
    min_isolates = conditions.get("reporting", {}).get("min_isolates", 30)
    classify = _build_result_classifier(susc)
    # ยาที่คิด %I เป็น susceptible (เช่น Colistin) -> classifier แยก
    i_as_s_drugs = {str(x).strip().upper() for x in susc.get("intermediate_as_susceptible_drugs", [])}
    classify_i = _build_result_classifier({**susc, "count_intermediate_as_susceptible": True})

    drug_name = drug_name or {}
    rows = []
    for organism, group in df.groupby(organism_field):
        for ab in antibiotic_columns:
            std_drug = drug_name.get(ab, ab)
            if intrinsic is not None and intrinsic.is_intrinsic(organism, std_drug):
                rows.append({
                    "organism": organism, "antibiotic": ab,
                    "n_tested": 0, "n_susceptible": 0,
                    "pct_susceptible": None, "reportable": False, "intrinsic": True,
                })
                continue
            fn = classify_i if str(std_drug).strip().upper() in i_as_s_drugs else classify
            classified = group[ab].map(fn)
            n_tested = int(classified.notna().sum())
            n_susc = int((classified == "S").sum())
            pct = int(round(100.0 * n_susc / n_tested)) if n_tested else None
            rows.append(
                {
                    "organism": organism,
                    "antibiotic": ab,
                    "n_tested": n_tested,
                    "n_susceptible": n_susc,
                    "pct_susceptible": pct,
                    "reportable": n_tested >= min_isolates,
                    "intrinsic": False,
                }
            )

    return pd.DataFrame(rows)


def to_matrix(antibiogram_long: pd.DataFrame, show_unreportable: bool = False) -> pd.DataFrame:
    """แปลงเป็นตารางไขว้ (แถว=เชื้อ, คอลัมน์=ยา, ค่า=%S) แบบที่รายงานคุ้นเคย.

    ถ้า show_unreportable=False ช่องที่จำนวนน้อยกว่าเกณฑ์จะเว้นว่าง.
    """
    df = antibiogram_long.copy()
    if not show_unreportable:
        df.loc[~df["reportable"], "pct_susceptible"] = pd.NA
    # ช่อง intrinsic แสดงเป็น "R"
    if "intrinsic" in df.columns:
        df["cell"] = df["pct_susceptible"].astype(object)
        df.loc[df["intrinsic"] == True, "cell"] = "R"  # noqa: E712
        return df.pivot(index="organism", columns="antibiotic", values="cell")
    return df.pivot(index="organism", columns="antibiotic", values="pct_susceptible")
