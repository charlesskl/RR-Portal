"""Recognize explicit multi-container plans across companies; no invented cargo."""
import re
from datetime import datetime
from .rules import normalize_deadline
from .product_brand import product_brand


def multi_container_plan(fields, tables, text, received_at=""):
    count = re.search(r"(\d+)\s*[*×Xx]\s*(20GP|40GP|40HQ|45HQ)", text, re.I)
    if not count or not 1 < int(count[1]) <= 100:
        return []
    year_match = re.search(r"20\d{2}", received_at or text)
    year = int(year_match[0]) if year_match else None
    def deadline(value):
        normalized = normalize_deadline(value)
        if year and re.match(r"^\d{1,2}/\d{1,2}", value.strip()):
            match = re.search(r"(\d{1,2})/(\d{1,2}).*?(\d{1,2}):(\d{2})", value)
            if match:
                hour = int(match[3])
                if "PM" in value.upper() and hour < 12: hour += 12
                if "AM" in value.upper() and hour == 12: hour = 0
                try: return datetime(year, int(match[1]), int(match[2]), hour, int(match[4])).isoformat(timespec="minutes")
                except ValueError: return ""
        return normalized
    for table in tables:
        for index, header in enumerate(table):
            keys = [re.sub(r"[^a-z]", "", cell.lower()) for cell in header]
            if not all(key in keys for key in ("so", "vesselname", "sicut", "cycut")):
                continue
            result = []
            for row in table[index+1:]:
                values = dict(zip(keys, row)); so = values.get("so", "")
                if not re.fullmatch(r"[A-Za-z0-9-]{6,}", so): continue
                if any(group["so_number"] == so for group in result): continue
                result.append({"group_key": f"container-{len(result)+1}", "so_number": so,
                               "container_type": count[2].upper(), "vessel_name": values.get("vesselname", ""),
                               "si_deadline": deadline(values.get("sicut", "")),
                               "cutoff_date": deadline(values.get("cycut", ""))})
            if len(result) == int(count[1]):
                fields["multi_container"] = "true"
                fields["container_count"] = str(len(result))
                fields["so_number"] = ",".join(group["so_number"] for group in result)
                return result
    return []


def order_cargo(tables):
    """Only an explicit order table supplies cargo; blank document templates do not."""
    for table in tables:
        for index, header in enumerate(table):
            keys = [re.sub(r"[^a-z]", "", cell.lower()) for cell in header]
            if not all(key in keys for key in ("item", "orderreference", "qtyctn")): continue
            cargo = []
            for row in table[index+1:]:
                values = dict(zip(keys, row)); code = values.get("item", "")
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.\-/]{2,}", code): continue
                def number(key):
                    try: return float(values.get(key, "").replace(",", ""))
                    except ValueError: return None
                cargo.append({"product_code": code, "product_name": values.get("description", ""),
                              "spec": number("qtyctn"), "quantity": number("qtypc"),
                              "pieces": number("noofctn"),
                              "customer_po": values.get("xpo", values.get("orderreference", "")),
                              "order_reference": values.get("orderreference", ""),
                              "supplier": values.get("factory", ""), "volume": number("ttlcbm"),
                              "volume_per_box": number("cbmctn")})
                cargo[-1]["brand"] = product_brand(cargo[-1])
                dimensions = [row[i] for i, key in enumerate(keys) if key.startswith("measurementctn") and i < len(row)]
                if len(dimensions) == 3 and all(re.fullmatch(r"\d+(?:\.\d+)?", v) for v in dimensions):
                    cargo[-1]["box_dimensions"] = "*".join(dimensions)
            if cargo:
                for item in cargo:
                    same_order = [other for other in cargo if other["customer_po"] == item["customer_po"] and other["order_reference"] == item["order_reference"]]
                    if all(other["pieces"] is not None for other in same_order):
                        item["order_total_pieces"] = sum(other["pieces"] for other in same_order)
                return cargo
    return []
