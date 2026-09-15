"""Run the local parser against a folder of EML samples without external calls."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.attachments import parse_attachment
from app.eml import parse_eml
from app.rules import classify_email, filter_items_for_email, parse_body
from app.main import build_warehouse_groups


def validate(folder: Path) -> list[dict]:
    report = []
    with tempfile.TemporaryDirectory(prefix="voyageplex-validation-") as root:
        for index, path in enumerate(sorted(folder.rglob("*.eml"))):
            message = parse_eml(path.read_bytes(), Path(root) / str(index))
            fields = parse_body(f'{message["subject"]}\n{message["body_text"]}')
            shipment_type = classify_email(message["subject"], message["body_text"])
            attachment_results = []
            attachment_details = []
            for attachment in message["attachments"]:
                parsed = parse_attachment(Path(attachment["stored_path"]), attachment["filename"])
                parsed["items"] = filter_items_for_email(
                    parsed["items"], shipment_type, str(parsed["fields"].get("loading_factory", ""))
                )
                attachment_results.append({
                    "filename": attachment["filename"],
                    "kind": parsed["kind"],
                    "fields": parsed["fields"],
                    "item_count": len(parsed["items"]),
                    "warnings": parsed["warnings"],
                })
                attachment_details.append({
                    "filename": attachment["filename"], "kind": parsed["kind"],
                    "fields": parsed["fields"], "items": parsed["items"],
                })
            report.append({
                "file": str(path.relative_to(folder)),
                "subject": message["subject"],
                "body_length": len(message["body_text"]),
                "fields": fields,
                "shipment_type": shipment_type,
                "attachments": attachment_results,
                "warehouse_groups": [
                    {"warehouse": group["warehouse"], "references": group["references"], "item_count": len(group["items"])}
                    for group in build_warehouse_groups(attachment_details)
                ],
            })
    return report


if __name__ == "__main__":
    print(json.dumps(validate(Path(sys.argv[1])), ensure_ascii=False, indent=2))
