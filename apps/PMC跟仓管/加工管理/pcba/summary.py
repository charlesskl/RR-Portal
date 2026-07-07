INBOUND_TYPES = {"inbound_raw", "finished", "semi_finished", "semi_inbound"}
OUTBOUND_TYPES = {"issue", "semi_outbound"}


def _qty(record):
    return int(record.get("qty") or 0)


def _name(record, key, fallback):
    value = record.get(key)
    return value if value else fallback


def _new_total(**extra):
    return {**extra, "inbound": 0, "outbound": 0, "balance": 0}


def _apply_flow(total, rec_type, qty):
    if rec_type in INBOUND_TYPES:
        total["inbound"] += qty
    elif rec_type in OUTBOUND_TYPES:
        total["outbound"] += qty
    total["balance"] = total["inbound"] - total["outbound"]


def compute_material_totals(records):
    totals = {}
    for record in records:
        material = _name(record, "material", "未分类")
        total = totals.setdefault(material, _new_total(material=material))
        _apply_flow(total, record.get("rec_type"), _qty(record))
    return [totals[name] for name in sorted(totals)]


def compute_sticker_type_totals(records):
    totals = {}
    for record in records:
        sticker_type = record.get("sticker_type")
        if not sticker_type:
            continue
        total = totals.setdefault(
            sticker_type,
            _new_total(sticker_type=sticker_type),
        )
        _apply_flow(total, record.get("rec_type"), _qty(record))
    return [totals[name] for name in sorted(totals)]


def compute_department_totals(records, departments):
    totals = {
        department: _new_total(department=department)
        for department in departments
    }
    for record in records:
        department = _name(record, "department", "未分部门")
        total = totals.setdefault(department, _new_total(department=department))
        _apply_flow(total, record.get("rec_type"), _qty(record))
    ordered = [totals[department] for department in departments if department in totals]
    ordered.extend(
        totals[department]
        for department in sorted(totals)
        if department not in departments
    )
    return ordered


def compute_material_department_totals(records):
    totals = {}
    for record in records:
        material = _name(record, "material", "未分类")
        department = _name(record, "department", "未分部门")
        key = (material, department)
        total = totals.setdefault(
            key,
            _new_total(material=material, department=department),
        )
        _apply_flow(total, record.get("rec_type"), _qty(record))
    return [totals[key] for key in sorted(totals)]


def compute_public_summary(records, departments, filters=None):
    materials = compute_material_totals(records)
    department_totals = compute_department_totals(records, departments)
    totals = _new_total()
    for row in materials:
        totals["inbound"] += row["inbound"]
        totals["outbound"] += row["outbound"]
    totals["balance"] = totals["inbound"] - totals["outbound"]
    return {
        "filters": filters or {},
        "record_count": len(records),
        "totals": totals,
        "materials": materials,
        "sticker_types": compute_sticker_type_totals(records),
        "department_totals": department_totals,
        "material_department": compute_material_department_totals(records),
    }


def compute_summary(records, location_names):
    """汇总计算（纯函数）。

    records: 列表，每项 dict 含 rec_type / location / qty。
      rec_type ∈ {inbound_raw, issue, finished}。
      issue/finished 带 location 名称；inbound_raw 的 location 为 None。
    location_names: 加工点名称列表（决定输出顺序，含 0 行）。
    返回 dict：locations[], subtotal{}, raw{}。
    """
    issue = {name: 0 for name in location_names}
    finished = {name: 0 for name in location_names}
    inbound = 0

    for r in records:
        t = r["rec_type"]
        qty = int(r["qty"] or 0)
        if t == "inbound_raw":
            inbound += qty
        elif t == "issue":
            if r["location"] in issue:
                issue[r["location"]] += qty
        elif t in ("finished", "semi_finished"):
            if r["location"] in finished:
                finished[r["location"]] += qty

    locations = []
    for name in location_names:
        locations.append({
            "location": name,
            "issue": issue[name],
            "finished": finished[name],
            "balance": issue[name] - finished[name],
        })

    sub_issue = sum(issue.values())
    sub_finished = sum(finished.values())
    subtotal = {
        "issue": sub_issue,
        "finished": sub_finished,
        "balance": sub_issue - sub_finished,
    }
    raw = {
        "inbound": inbound,
        "outbound": sub_issue,
        "balance": inbound - sub_issue,
    }
    return {"locations": locations, "subtotal": subtotal, "raw": raw}
