"""Brand names verified from supplied product/template references."""
import re

# SR3703QP-12 is the STICKI ROLLS product in the supplied Sky Castle tables.
VERIFIED_PRODUCT_BRANDS = {"SR3703QP-12": "STICKI ROLLS"}


def product_brand(item):
    explicit = str(item.get("brand") or "").strip()
    if explicit:
        return explicit
    code = str(item.get("product_code") or "").strip().upper()
    if code in VERIFIED_PRODUCT_BRANDS:
        return VERIFIED_PRODUCT_BRANDS[code]
    description = " ".join(str(item.get(key) or "") for key in ("product_name", "source_product_name"))
    return "STICKI ROLLS" if re.search(r"\bsticki\s+rolls\b", description, re.I) else ""
