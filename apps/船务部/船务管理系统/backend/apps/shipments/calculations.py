from decimal import Decimal


def calculate_weights(pieces: int, gw_per_box, nw_per_box) -> tuple:
    """根据件数和每箱重量计算总毛重和总净重"""
    if gw_per_box is None or nw_per_box is None:
        return None, None
    gw = round(Decimal(str(pieces)) * Decimal(str(gw_per_box)), 3)
    nw = round(Decimal(str(pieces)) * Decimal(str(nw_per_box)), 3)
    return gw, nw


def is_pallet_product(product_code: str) -> bool:
    """判断是否为栈板类产品（以SLB或SK结尾）"""
    code = product_code.upper()
    return code.endswith('SLB') or code.endswith('SK')


def determine_main_factory(items: list[dict]) -> str:
    """根据体积占比确定主要工厂"""
    factory_volumes = {}
    for item in items:
        factory = item['factory']
        factory_volumes[factory] = factory_volumes.get(factory, 0) + item['volume']
    if not factory_volumes:
        return ''
    return max(factory_volumes, key=factory_volumes.get)


def determine_truck_type(total_cbm: float) -> str:
    """根据CBM总和判断吨车类型。

    1-10 CBM → 1*3T
    11-16 CBM → 1*5T
    17-20 CBM → 1*8T
    21-30 CBM → 1*10T
    31-39 CBM → 1*12T
    40+ CBM → 1*18T
    """
    if total_cbm <= 0:
        return ''
    if total_cbm <= 10:
        return '1*3T'
    if total_cbm <= 16:
        return '1*5T'
    if total_cbm <= 20:
        return '1*8T'
    if total_cbm <= 30:
        return '1*10T'
    if total_cbm <= 39:
        return '1*12T'
    return '1*18T'


def calculate_total_pieces_per_order(items) -> dict:
    """计算每个订单的总件数（按客PO分组合计）"""
    po_totals = {}
    for item in items:
        po = item.customer_po or ''
        po_totals[po] = po_totals.get(po, 0) + (item.pieces or 0)
    # 返回以完整key为键的字典，值为该PO的总件数
    totals = {}
    for item in items:
        key = (item.contract_number, item.customer_po, item.product_code, item.product_name, item.spec)
        po = item.customer_po or ''
        totals[key] = po_totals.get(po, item.pieces or 0)
    return totals
