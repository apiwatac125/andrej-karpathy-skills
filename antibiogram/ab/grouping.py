"""รวมเชื้อบางกลุ่มให้รายงานเป็นชื่อกลุ่มเดียว (เช่น CoNS).

config/organism_groups.csv: member_name, group_name
ใช้หลัง normalize ชื่อเชื้อ ก่อน dedup/analysis.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
GROUPS_PATH = CONFIG_DIR / "organism_groups.csv"


def load_groups(path: Path = GROUPS_PATH) -> dict[str, str]:
    """คืน dict member_name -> group_name."""
    if not path.exists():
        return {}
    df = pd.read_csv(path, dtype=str).fillna("")
    return {r["member_name"].strip(): r["group_name"].strip()
            for _, r in df.iterrows() if r["member_name"].strip()}


def apply_groups(df: pd.DataFrame, organism_field: str = "organism",
                 groups: dict | None = None) -> pd.DataFrame:
    groups = groups if groups is not None else load_groups()
    if not groups:
        return df
    out = df.copy()
    out[organism_field] = out[organism_field].map(
        lambda v: groups.get(v, v) if pd.notna(v) else v
    )
    return out
