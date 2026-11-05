"""ยืนยันกฎการคิด %S ให้ตรง plan rolling antibiogram:
  %S = S / (S + I + R + N)   โดย "N" (NS/SDD จาก MLAB DBF) นับเป็นตัวหาร แต่ไม่ใช่ S
  Colistin = %I = I / (I + R)   (ยาที่คิด %I เป็น susceptible)
รันด้วย: python tests/test_susceptibility.py
"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ab import antibiogram, config as cfg  # noqa: E402


def main():
    conditions = cfg.load_conditions()
    df = pd.DataFrame({
        "organism": ["Escherichia coli"] * 5,
        # S,S,R,I,N -> denominator = 5 (N นับด้วย), susceptible = 2 -> 40%
        "MEM": ["S", "S", "R", "I", "N"],
        # Colistin คิด %I: I,I,R,I -> S=3 (I->S), R=1 -> 75% ; "" = ไม่ทดสอบ (ไม่นับ)
        "CL": ["I", "I", "R", "I", ""],
    })
    long = antibiogram.compute_antibiogram(
        df, ["MEM", "CL"], conditions, organism_field="organism",
        drug_name={"MEM": "Meropenem", "CL": "Colistin"},
    )
    mem = long[long["antibiotic"] == "MEM"].iloc[0]
    assert int(mem["n_tested"]) == 5, f"'N' ต้องนับในตัวหาร: n_tested={mem['n_tested']}"
    assert int(mem["n_susceptible"]) == 2
    assert int(mem["pct_susceptible"]) == 40, f"pct={mem['pct_susceptible']} (ควร 40)"

    cl = long[long["antibiotic"] == "CL"].iloc[0]
    assert int(cl["n_tested"]) == 4, f"colistin ไม่นับช่องว่าง: n_tested={cl['n_tested']}"
    assert int(cl["pct_susceptible"]) == 75, f"colistin %I ควร 75 ได้ {cl['pct_susceptible']}"

    print(f"OK — MEM %S={mem['pct_susceptible']} (N นับในตัวหาร) · "
          f"Colistin %I={cl['pct_susceptible']}")


if __name__ == "__main__":
    main()
