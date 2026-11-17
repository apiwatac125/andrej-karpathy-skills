"""เทสต์กฎรายงานใหม่ 2 ข้อ (รันด้วย `python tests/test_report_rules.py`):

1. ค่า "$" (suppressed-susceptible จาก cascade reporting) ต้องนับเป็น S
2. Gentamicin ของ Pseudomonas ต้อง "ไม่รายงาน" (ไม่มีแถว = ช่องว่าง)
"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ab import antibiogram, config as cfg, intrinsic, suppress  # noqa: E402


def main():
    conds = cfg.load_conditions()

    # 1) "$" -> S (ยาอื่น ๆ ต้องไม่เปลี่ยนพฤติกรรม)
    classify = antibiogram._build_result_classifier(conds["susceptibility"])
    assert classify("$") == "S", classify("$")
    assert classify("S") == "S"
    assert classify("R") == "R"
    assert classify("N") == "R"        # MLAB "N" = ไม่ไว
    assert classify("") is None        # ว่าง = ไม่ทดสอบ

    # 2) Pseudomonas x Gentamicin ถูกตัดออก, ยาอื่น/เชื้ออื่นยังอยู่, และ "$" ถูกนับ
    rows = ([{"report_organism": "Pseudomonas aeruginosa", "GM": "S", "AK": "$"}] * 40
            + [{"report_organism": "Pseudomonas species", "GM": "S", "AK": "$"}] * 40
            + [{"report_organism": "Escherichia coli", "GM": "S", "AK": "$"}] * 40)
    df = pd.DataFrame(rows)
    drug_name = {"GM": "Gentamicin", "AK": "Amikacin"}
    lf = antibiogram.compute_antibiogram(
        df, ["GM", "AK"], conds, organism_field="report_organism",
        intrinsic=intrinsic.load_intrinsic(), suppress=suppress.load_suppress(),
        drug_name=drug_name)

    def rows_for(org, ab):
        return lf[(lf.organism == org) & (lf.antibiotic == ab)]

    assert len(rows_for("Pseudomonas aeruginosa", "GM")) == 0
    assert len(rows_for("Pseudomonas species", "GM")) == 0
    assert len(rows_for("Escherichia coli", "GM")) == 1        # เชื้ออื่นยังรายงาน GM
    # Amikacin: "$" นับเป็น S -> N = 40 ทุกเชื้อ (รวม Pseudomonas ที่ยังรายงาน AK)
    assert rows_for("Pseudomonas aeruginosa", "AK").iloc[0]["n_tested"] == 40
    assert int(rows_for("Escherichia coli", "AK").iloc[0]["pct_susceptible"]) == 100

    print("OK — '$'->S และ Pseudomonas/Gentamicin ไม่รายงาน (เชื้อ/ยาอื่นไม่กระทบ)")


if __name__ == "__main__":
    main()
