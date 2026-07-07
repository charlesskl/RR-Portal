from pcba.summary import (
    compute_department_totals,
    compute_material_department_totals,
    compute_material_totals,
    compute_public_summary,
    compute_summary,
)

LOCATIONS = ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴", "新邵"]


def _rec(rec_type, location, qty):
    return {"rec_type": rec_type, "location": location, "qty": qty}


def _flow(rec_type, material, department, qty):
    return {
        "rec_type": rec_type,
        "material": material,
        "department": department,
        "qty": qty,
    }


def test_empty_returns_zeros():
    s = compute_summary([], LOCATIONS)
    assert s["subtotal"]["issue"] == 0
    assert s["subtotal"]["finished"] == 0
    assert s["subtotal"]["balance"] == 0
    assert s["raw"]["inbound"] == 0
    assert s["raw"]["outbound"] == 0
    assert s["raw"]["balance"] == 0
    assert len(s["locations"]) == 5


def test_per_location_balance():
    records = [
        _rec("issue", "东莞车间", 50955),
        _rec("finished", "东莞车间", 0),
        _rec("issue", "东莞加工厂利鸿", 110551),
        _rec("finished", "东莞加工厂利鸿", 53096),
    ]
    s = compute_summary(records, LOCATIONS)
    by_name = {row["location"]: row for row in s["locations"]}
    assert by_name["东莞车间"]["issue"] == 50955
    assert by_name["东莞车间"]["finished"] == 0
    assert by_name["东莞车间"]["balance"] == 50955
    assert by_name["东莞加工厂利鸿"]["balance"] == 57455


def test_semi_finished_counts_as_finished_output():
    records = [
        _rec("issue", "东莞加工厂利鸿", 100),
        _rec("finished", "东莞加工厂利鸿", 30),
        _rec("semi_finished", "东莞加工厂利鸿", 20),
    ]
    s = compute_summary(records, LOCATIONS)
    by_name = {row["location"]: row for row in s["locations"]}
    assert by_name["东莞加工厂利鸿"]["finished"] == 50
    assert by_name["东莞加工厂利鸿"]["balance"] == 50
    assert s["subtotal"]["finished"] == 50
    assert s["subtotal"]["balance"] == 50


def test_full_original_data():
    records = [
        # 来料入仓（登信），合计 1,883,908
        _rec("inbound_raw", None, 1671656),
        _rec("inbound_raw", None, 50560),
        _rec("inbound_raw", None, 5760),
        _rec("inbound_raw", None, 60800),
        _rec("inbound_raw", None, 4055),
        _rec("inbound_raw", None, 15360),
        _rec("inbound_raw", None, 25797),
        _rec("inbound_raw", None, 49920),
        # 领料
        _rec("issue", "东莞车间", 50955),
        _rec("issue", "东莞加工厂利鸿", 110551),
        _rec("issue", "邵阳华登", 1690242),
        _rec("issue", "河源华兴", 30240),
        # 成品入仓
        _rec("finished", "东莞车间", 0),
        _rec("finished", "东莞加工厂利鸿", 53096),
        _rec("finished", "邵阳华登", 928113),
        _rec("finished", "河源华兴", 0),
    ]
    s = compute_summary(records, LOCATIONS)
    assert s["subtotal"]["issue"] == 1881988
    assert s["subtotal"]["finished"] == 981209
    assert s["subtotal"]["balance"] == 900779
    assert s["raw"]["inbound"] == 1883908
    assert s["raw"]["outbound"] == 1881988
    assert s["raw"]["balance"] == 1920
    by_name = {row["location"]: row for row in s["locations"]}
    assert by_name["邵阳华登"]["balance"] == 762129
    assert by_name["河源华兴"]["balance"] == 30240


def test_material_totals_group_by_material_name():
    records = [
        _flow("inbound_raw", "NFC贴纸", "兴信B来料仓", 100),
        _flow("issue", "NFC贴纸", "兴信B来料仓", 30),
        _flow("finished", "PCBA板", "装配", 80),
        _flow("semi_outbound", "PCBA板", "半成品", 20),
    ]

    totals = {row["material"]: row for row in compute_material_totals(records)}

    assert totals["NFC贴纸"] == {
        "material": "NFC贴纸",
        "inbound": 100,
        "outbound": 30,
        "balance": 70,
    }
    assert totals["PCBA板"] == {
        "material": "PCBA板",
        "inbound": 80,
        "outbound": 20,
        "balance": 60,
    }


def test_department_totals_include_zero_departments_in_order():
    departments = ["兴信B来料仓", "装配", "外发"]
    records = [
        _flow("inbound_raw", "NFC贴纸", "兴信B来料仓", 100),
        _flow("issue", "NFC贴纸", "兴信B来料仓", 30),
        _flow("semi_finished", "PCBA板", "装配", 40),
    ]

    totals = compute_department_totals(records, departments)

    assert totals == [
        {"department": "兴信B来料仓", "inbound": 100, "outbound": 30, "balance": 70},
        {"department": "装配", "inbound": 40, "outbound": 0, "balance": 40},
        {"department": "外发", "inbound": 0, "outbound": 0, "balance": 0},
    ]


def test_material_department_totals_group_by_material_and_department():
    records = [
        _flow("inbound_raw", "NFC贴纸", "兴信B来料仓", 100),
        _flow("issue", "NFC贴纸", "兴信B来料仓", 30),
        _flow("finished", "NFC贴纸", "装配", 25),
    ]

    totals = compute_material_department_totals(records)

    assert totals == [
        {"material": "NFC贴纸", "department": "兴信B来料仓", "inbound": 100, "outbound": 30, "balance": 70},
        {"material": "NFC贴纸", "department": "装配", "inbound": 25, "outbound": 0, "balance": 25},
    ]


def test_public_summary_contains_safe_aggregates():
    departments = ["兴信B来料仓", "装配"]
    records = [
        _flow("inbound_raw", "NFC贴纸", "兴信B来料仓", 100),
        _flow("issue", "NFC贴纸", "兴信B来料仓", 30),
        _flow("finished", "PCBA板", "装配", 80),
    ]

    summary = compute_public_summary(
        records,
        departments,
        {"date_from": "2026-07-01", "date_to": "2026-07-07"},
    )

    assert summary["record_count"] == 3
    assert summary["totals"] == {"inbound": 180, "outbound": 30, "balance": 150}
    assert summary["filters"]["date_from"] == "2026-07-01"
    assert {row["material"] for row in summary["materials"]} == {"NFC贴纸", "PCBA板"}
