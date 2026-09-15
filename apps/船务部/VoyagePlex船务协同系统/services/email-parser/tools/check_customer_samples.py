"""Regression checks for an authorized local customer-email sample folder."""

import sys
from pathlib import Path

from validate_folder import validate


def main(folder: Path) -> int:
    rows = validate(folder)
    errors = []
    if len(rows) != 10:
        errors.append(f"期望10封邮件，实际{len(rows)}封")

    incoming7 = next((row for row in rows if row["file"] == "收到邮件/7.eml"), None)
    expected = {"ELWOOD STORAGE": 3, "STATESBORO-STORAGE": 3, "SAVANNAH-FLOW": 3}
    actual = {group["warehouse"]: group["item_count"] for group in (incoming7 or {}).get("warehouse_groups", [])}
    if actual != expected:
        errors.append(f"7号多仓分组不符：{actual}")

    incoming4 = next((row for row in rows if row["file"] == "收到邮件/4.eml"), None)
    pl_counts = [item["item_count"] for item in (incoming4 or {}).get("attachments", []) if item["kind"] == "packing_list"]
    if pl_counts != [597]:
        errors.append(f"4号大型PL有效行数不符：{pl_counts}")

    incoming3 = next((row for row in rows if row["file"] == "收到邮件/3.eml"), None)
    legacy_kinds = [item["kind"] for item in (incoming3 or {}).get("attachments", []) if item["filename"].lower().endswith(".xls")]
    if legacy_kinds != ["container_loading_plan"]:
        errors.append(f"3号旧版XLS类型不符：{legacy_kinds}")

    if errors:
        print("回归验证失败：")
        for error in errors:
            print(f"- {error}")
        return 1
    print("回归验证通过：10封邮件、7号三仓分组、4号597行PL、3号旧版XLS均符合基线。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(Path(sys.argv[1])))
