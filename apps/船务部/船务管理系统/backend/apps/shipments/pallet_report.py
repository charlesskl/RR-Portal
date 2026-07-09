"""卡板数报表聚合 helper。

把来自 EmailRecord.parsed_data 的 PL items 分类到三类：
- self: 兴信做柜的兴信自有货
- local: 兴信送外厂拼柜的货（外厂做柜）
- external: 外厂送兴信柜的货（兴信做柜但货来自外厂）
"""
from collections import OrderedDict
from datetime import date as _date
from typing import Iterable

_XINGXIN_KEYS = ('兴信', 'hanson')


def _is_xingxin(name: str) -> bool:
    if not name:
        return False
    nl = name.lower()
    return '兴信' in name or 'hanson' in nl


def classify_pallet_items(items: list) -> dict:
    """把 PL items 分到 self / local / external。"""
    self_, local, external = [], [], []
    for it in items:
        pc = int(it.get('pallet_count') or 0)
        if pc <= 0:
            continue
        zg = (it.get('zuogui_factory') or '').strip()
        fr = (it.get('factory_remark') or '').strip()
        if _is_xingxin(zg) or not zg:
            if _is_xingxin(fr) or not fr:
                self_.append(it)
            else:
                external.append(it)
        else:
            local.append(it)
    return {'self': self_, 'local': local, 'external': external}


def group_by_factory_so(items: list, factory_field: str) -> dict:
    """按 (factory, so_number) 分组。

    Returns: OrderedDict {factory_name: OrderedDict {so_number: [items]}}
    """
    out = OrderedDict()
    for it in items:
        factory = (it.get(factory_field) or '未知').strip() or '未知'
        so = (it.get('so_number') or '-').strip() or '-'
        out.setdefault(factory, OrderedDict()).setdefault(so, []).append(it)
    return out


def apply_filters(
    items: list,
    start: _date | None = None,
    end: _date | None = None,
    factories: list | None = None,
) -> list:
    """按日期范围 + 工厂列表筛选 items。"""
    factories_set = set(factories) if factories else None
    result = []
    for it in items:
        if start or end:
            sd = _parse_ship_date(it.get('ship_date', ''))
            if sd is None:
                continue
            if start and sd < start:
                continue
            if end and sd > end:
                continue
        if factories_set:
            fr = (it.get('factory_remark') or '').strip()
            zg = (it.get('zuogui_factory') or '').strip()
            if fr not in factories_set and zg not in factories_set:
                continue
        result.append(it)
    return result


def _parse_ship_date(s: str) -> _date | None:
    """解析 'M/D' 或 'YYYY-MM-DD' 格式的发货日期。"""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    try:
        if '-' in s and len(s) >= 8:
            y, m, d = s.split('-')
            return _date(int(y), int(m), int(d))
        if '/' in s:
            parts = s.split('/')
            if len(parts) == 2:
                m, d = parts
                return _date(_date.today().year, int(m), int(d))
            if len(parts) == 3:
                y, m, d = parts
                if len(y) == 4:
                    return _date(int(y), int(m), int(d))
                return _date(_date.today().year, int(m), int(d))
    except (ValueError, TypeError):
        return None
    return None
