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
        elif t == "finished":
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
