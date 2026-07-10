INBOUND_TYPES = {"inbound_raw", "finished", "semi_finished", "semi_inbound"}
OUTBOUND_TYPES = {"issue", "semi_outbound"}
DEFAULT_DEPARTMENT_ORDER = (
    "兴信B来料仓",
    "东莞车间",
    "半成品",
    "东莞加工厂利鸿",
    "河源华兴",
    "邵阳",
    "新邵",
)


def _qty(record):
    return int(record.get("qty") or 0)


def _name(record, key, fallback):
    value = record.get(key)
    return value if value else fallback


def _new_total(**extra):
    return {
        **extra,
        "inbound": 0,
        "outbound": 0,
        "balance": 0,
        "_normal_balance": 0,
        "_reverse_inbound": 0,
        "_reverse_outbound": 0,
    }


def _apply_flow(total, rec_type, qty, reverse_balance=False):
    if rec_type in INBOUND_TYPES:
        total["inbound"] += qty
        if reverse_balance:
            total["_reverse_inbound"] += qty
        else:
            total["_normal_balance"] += qty
    elif rec_type in OUTBOUND_TYPES:
        total["outbound"] += qty
        if reverse_balance:
            total["_reverse_outbound"] += qty
        else:
            total["_normal_balance"] -= qty


def _finalize_total(total):
    normal_balance = total.pop("_normal_balance", 0)
    reverse_inbound = total.pop("_reverse_inbound", 0)
    reverse_outbound = total.pop("_reverse_outbound", 0)
    reverse_balance = (
        reverse_outbound - reverse_inbound
        if reverse_outbound
        else reverse_inbound
    )
    total["balance"] = normal_balance + reverse_balance
    return total


def _finalize_totals(totals):
    return [_finalize_total(total) for total in totals]


def _reverse_balance(record, reverse_departments):
    return _name(record, "department", "未分部门") in reverse_departments


def compute_material_totals(records, reverse_departments=()):
    reverse_departments = set(reverse_departments or ())
    totals = {}
    for record in records:
        material = _name(record, "material", "未分类")
        total = totals.setdefault(material, _new_total(material=material))
        _apply_flow(
            total,
            record.get("rec_type"),
            _qty(record),
            _reverse_balance(record, reverse_departments),
        )
    return _finalize_totals(totals[name] for name in sorted(totals))


def compute_sticker_type_totals(records, reverse_departments=()):
    reverse_departments = set(reverse_departments or ())
    totals = {}
    for record in records:
        sticker_type = record.get("sticker_type")
        if not sticker_type:
            continue
        total = totals.setdefault(
            sticker_type,
            _new_total(sticker_type=sticker_type),
        )
        _apply_flow(
            total,
            record.get("rec_type"),
            _qty(record),
            _reverse_balance(record, reverse_departments),
        )
    return _finalize_totals(totals[name] for name in sorted(totals))


def compute_department_totals(records, departments, reverse_departments=()):
    reverse_departments = set(reverse_departments or ())
    totals = {
        department: _new_total(department=department)
        for department in departments
    }
    for record in records:
        department = _name(record, "department", "未分部门")
        total = totals.setdefault(department, _new_total(department=department))
        _apply_flow(
            total,
            record.get("rec_type"),
            _qty(record),
            department in reverse_departments,
        )
    ordered = [totals[department] for department in departments if department in totals]
    ordered.extend(
        totals[department]
        for department in sorted(totals)
        if department not in departments
    )
    return _finalize_totals(ordered)


def compute_material_department_totals(records, reverse_departments=()):
    reverse_departments = set(reverse_departments or ())
    totals = {}
    for record in records:
        material = _name(record, "material", "未分类")
        department = _name(record, "department", "未分部门")
        key = (material, department)
        total = totals.setdefault(
            key,
            _new_total(material=material, department=department),
        )
        _apply_flow(
            total,
            record.get("rec_type"),
            _qty(record),
            department in reverse_departments,
        )
    department_order = {
        department: index for index, department in enumerate(DEFAULT_DEPARTMENT_ORDER)
    }
    ordered_keys = sorted(
        totals,
        key=lambda key: (
            key[0],
            department_order.get(key[1], len(department_order)),
            key[1],
        ),
    )
    return _finalize_totals(totals[key] for key in ordered_keys)


def compute_public_summary(records, departments, filters=None, reverse_departments=()):
    materials = compute_material_totals(records, reverse_departments)
    department_totals = compute_department_totals(
        records, departments, reverse_departments
    )
    totals = {"inbound": 0, "outbound": 0, "balance": 0}
    for row in materials:
        totals["inbound"] += row["inbound"]
        totals["outbound"] += row["outbound"]
        totals["balance"] += row["balance"]
    return {
        "filters": filters or {},
        "record_count": len(records),
        "totals": totals,
        "materials": materials,
        "sticker_types": compute_sticker_type_totals(records, reverse_departments),
        "department_totals": department_totals,
        "material_department": compute_material_department_totals(
            records, reverse_departments
        ),
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
