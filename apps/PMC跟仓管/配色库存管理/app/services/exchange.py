"""RMB ↔ HKD 换算。

约定:
- **存储**: DB 里所有入库/流水的单价/金额都是 HKD
- **输入**: 入库/OCR/编辑表单里用户输入的是 RMB,后端保存时 rmb_to_hkd 换算
- **显示**: 所有流水/库存页面显示 HKD
- **例外**: 色粉档案 (pigment.unit_price)、Excel 导入 — 按原值对待为 HKD,不换算

汇率默认 1 HKD = 0.88 RMB,可在「设置」页修改。
"""
from __future__ import annotations

SETTING_KEY = "hkd_to_rmb_rate"
DEFAULT_RATE = 0.88


def get_rate() -> float:
    """读当前 HKD→RMB 汇率。从 Setting 表读,失败回退默认。"""
    try:
        from app.models import Setting
        s = Setting.query.filter_by(key=SETTING_KEY).first()
        if s and s.value:
            return float(s.value)
    except Exception:
        pass
    return DEFAULT_RATE


def set_rate(rate: float) -> None:
    from app.extensions import db
    from app.models import Setting
    s = Setting.query.filter_by(key=SETTING_KEY).first()
    if s is None:
        s = Setting(key=SETTING_KEY, value=str(rate))
        db.session.add(s)
    else:
        s.value = str(rate)
    db.session.commit()


def rmb_to_hkd(rmb: float | None) -> float | None:
    if rmb is None or rmb == 0:
        return rmb
    return round(rmb / get_rate(), 1)


def hkd_to_rmb(hkd: float | None) -> float | None:
    if hkd is None or hkd == 0:
        return hkd
    return round(hkd * get_rate(), 1)
