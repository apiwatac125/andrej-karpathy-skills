"""เทสต์การจัดกลุ่มสิ่งส่งตรวจ (config/specimens.csv -> pipeline.prepare).

ตรวจว่า:
- จับคู่ได้แม้มีช่องว่างซ้ำ / ตัวพิมพ์ต่าง / ชื่อไทย
- Tissue เป็นกลุ่มแยก, Pus+Wound รวมกลุ่ม, Stool+Eye -> Others
- specimen ที่ไม่มีใน dict คงชื่อเดิม (ไม่ยุบเงียบ)
"""
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ab import config as cfg, pipeline, specimen_group  # noqa: E402

HERE = Path(__file__).resolve().parent.parent


def main():
    spg = specimen_group.load_specimen_groups()
    # จับคู่ไม่สนช่องว่างซ้ำ/ตัวพิมพ์/ชื่อไทย
    assert spg.group_of("Bone  (SWAB)") == "Bone/Joint"       # 2 ช่องว่าง
    assert spg.group_of("bone (swab)") == "Bone/Joint"        # พิมพ์เล็ก + 1 ช่องว่าง
    assert spg.group_of("Kidney (ซ้าย)Fluid") == "Body fluid (sterile)"
    assert spg.group_of("Tissue") == "Tissue"                 # แยกกลุ่ม
    assert spg.group_of("Pus (site ??)") == "Pus/Wound/Soft tissue"
    assert spg.group_of("Stool") == "Others"
    assert spg.group_of("ไม่เคยเจอ specimen นี้") is None       # ไม่มีใน dict

    # ผ่าน pipeline.prepare -> คอลัมน์ specimen ถูกยุบเป็นกลุ่ม
    conds = cfg.load_conditions()
    prof = json.loads((HERE / "config" / "mlab_profile.json").read_text(encoding="utf-8"))
    raws = ["Hemoculture-Blood", "Tissue", "Pus (site ??)", "Wound Swab (แผล)",
            "Stool", "EYE (SWAB)", "Bone  (SWAB)", "ODD NEW SPECIMEN"]
    rows = []
    for raw in raws:
        for i in range(3):
            rows.append({"HN": f"{abs(hash(raw)) % 999999:06d}{i}", "CORGANISM": "Escherichia coli",
                         "ORGANISM": "ECO", "CSOURCE_A": raw, "CWARD": "OPD",
                         "SPCDATE": pd.Timestamp("2026-05-01"), "MEM": "S", "CFX": "S"})
    std, _ = pipeline.prepare(pd.DataFrame(rows), prof["col_map"], prof["ab_cols"], conds)
    groups = set(std["specimen"].unique())
    assert "Tissue" in groups
    assert "Pus/Wound/Soft tissue" in groups          # Pus + Wound รวมกัน
    assert "Others" in groups                          # Stool + Eye
    assert "Blood" in groups
    assert "Bone/Joint" in groups
    assert "ODD NEW SPECIMEN" in groups                # ไม่รู้จัก -> คงชื่อเดิม
    # Pus กับ Wound ต้องถูกยุบเป็นกลุ่มเดียว ไม่เหลือชื่อดิบ
    assert "Pus (site ??)" not in groups and "Wound Swab (แผล)" not in groups

    print(f"OK — จัดกลุ่ม specimen: {sorted(groups)}")


if __name__ == "__main__":
    main()
