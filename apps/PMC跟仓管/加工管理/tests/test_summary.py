from pcba.summary import compute_summary

LOCATIONS = ["东莞车间", "东莞加工厂利鸿", "邵阳华登", "河源华兴"]


def _rec(rec_type, location, qty):
    return {"rec_type": rec_type, "location": location, "qty": qty}


def test_empty_returns_zeros():
    s = compute_summary([], LOCATIONS)
    assert s["subtotal"]["issue"] == 0
    assert s["subtotal"]["finished"] == 0
    assert s["subtotal"]["balance"] == 0
    assert s["raw"]["inbound"] == 0
    assert s["raw"]["outbound"] == 0
    assert s["raw"]["balance"] == 0
    assert len(s["locations"]) == 4


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
