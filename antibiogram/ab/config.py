"""โหลด/บันทึกไฟล์ config เงื่อนไขการวิเคราะห์ (conditions.yaml)."""

from __future__ import annotations

from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
CONDITIONS_PATH = CONFIG_DIR / "conditions.yaml"


def load_conditions(path: Path = CONDITIONS_PATH) -> dict:
    """อ่านเงื่อนไขจาก YAML คืนเป็น dict."""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_conditions(conditions: dict, path: Path = CONDITIONS_PATH) -> None:
    """เขียนเงื่อนไขกลับลง YAML (ใช้เมื่อผู้ใช้กด save จาก UI)."""
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(conditions, f, allow_unicode=True, sort_keys=False)
