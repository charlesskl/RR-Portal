"""
公式计算引擎 - 纸箱/物料价格计算
所有公式以英寸为单位计算，输入cm自动转换
"""


def cm_to_inch(cm):
    """厘米转英寸"""
    return cm / 2.54


def calc_box(box_type, length_cm, width_cm, height_cm, paper_price):
    """
    计算纸箱价格（RMB）

    参数:
        box_type: 箱型 (normal/tiandi/banyi/weiboard/mailbox_lr/mailbox_tb)
        length_cm: 长(cm)
        width_cm: 宽(cm)
        height_cm: 高(cm)，围板时可为0
        paper_price: 纸价（RMB/千平方英寸，不含税）
    返回:
        纸箱价格 RMB
    """
    L = cm_to_inch(length_cm)
    W = cm_to_inch(width_cm)
    H = cm_to_inch(height_cm) if height_cm else 0

    if box_type == 'normal':
        # 普通箱: (长+宽+2)*(宽+高+1)*2*纸价/1000
        return (L + W + 2) * (W + H + 1) * 2 * paper_price / 1000

    elif box_type == 'tiandi':
        # 天地盖: (2*高+长+2)*(2*高+宽+1)*纸价/1000
        return (2 * H + L + 2) * (2 * H + W + 1) * paper_price / 1000

    elif box_type == 'banyi':
        # 半亦箱: (长+宽+2)*(0.5*宽+高+1)*2*纸价/1000
        return (L + W + 2) * (0.5 * W + H + 1) * 2 * paper_price / 1000

    elif box_type == 'weiboard':
        # 围板: (长+1)*(宽+1)*纸价/1000
        return (L + 1) * (W + 1) * paper_price / 1000

    elif box_type == 'mailbox_lr':
        # 邮包盒(左右扣): (长+宽+2)*(宽*2+高+1+2)*2*纸价/1000
        return (L + W + 2) * (W * 2 + H + 1 + 2) * 2 * paper_price / 1000

    elif box_type == 'mailbox_tb':
        # 邮包盒(上下扣): 暂用与左右扣相同公式，用户可自行调整
        return (L + W + 2) * (W * 2 + H + 1 + 2) * 2 * paper_price / 1000

    else:
        raise ValueError(f"未知箱型: {box_type}")


def calc_protection_card(length_cm, width_cm, paper_price, qty):
    """
    计算保护卡/平卡价格（RMB）
    公式: (长_in+1)*(宽_in+1)*纸价/1000 * 数量
    """
    L = cm_to_inch(length_cm)
    W = cm_to_inch(width_cm)
    return (L + 1) * (W + 1) * paper_price / 1000 * qty


def calc_corner_protector(length_cm, width_cm, paper_price):
    """
    计算护角价格（RMB）- 面积计算法
    公式: (长_in+1)*(宽_in+1)*纸价/1000
    """
    L = cm_to_inch(length_cm)
    W = cm_to_inch(width_cm)
    return (L + 1) * (W + 1) * paper_price / 1000


def calc_packing_tape(length_cm, width_cm, unit_price=0.045):
    """
    计算胶纸价格（RMB）
    公式: (长cm*2 + 宽cm*4) / 100 * 单价
    """
    return (length_cm * 2 + width_cm * 4) / 100 * unit_price


def calc_strapping(meters, unit_price=0.13):
    """
    计算打包带价格（RMB）
    公式: 米数 * 单价
    """
    return meters * unit_price


def calc_paper_pallet(length_cm, width_cm, margin_cm, unit_price=7.2):
    """
    计算纸滑板价格（RMB）
    公式: ((边距+长+边距)/100) * ((边距+宽+边距)/100) * 纸滑板单价
    """
    area = ((margin_cm + length_cm + margin_cm) / 100) * \
           ((margin_cm + width_cm + margin_cm) / 100)
    return area * unit_price


def calc_custom(unit_price, qty):
    """
    通用自定义物料（胶袋、胶钉、吊牌等固定单价物料）
    公式: 单价 × 数量
    """
    return unit_price * qty


def calc_cbm(length_cm, width_cm, height_cm):
    """计算CBM（立方米）"""
    return length_cm * width_cm * height_cm / 1_000_000


def calc_all(params):
    """
    一次性计算所有项目，返回结果字典

    参数 params 示例:
    {
        "box_type": "normal",
        "length": 46.5,
        "width": 29,
        "height": 63,
        "paper_price": 1.8,
        "paper_name": "单坑",
        "tape_unit_price": 0.045,
        "pcs_per_carton": 12,
        "exchange_rate": 7.08,
        "materials": [
            {"type": "card", "length": 31, "width": 19, "qty": 1, "paper_price": 1.3},
            {"type": "card", "length": 31, "width": 28, "qty": 12, "paper_price": 1.3},
            {"type": "strapping", "meters": 7},
            {"type": "pallet", "length": 120.5, "width": 47.5, "margin": 15},
            {"type": "corner", "length": 51, "width": 35, "paper_price": 1.61}
        ]
    }
    """
    L = params.get('length', 0)
    W = params.get('width', 0)
    H = params.get('height', 0)
    # 支持多箱型：box_types数组 或 box_type单值
    box_types = params.get('box_types') or [params.get('box_type', 'normal')]
    paper_price = params.get('paper_price', 0)
    tape_price = params.get('tape_unit_price', 0.045)
    pcs = params.get('pcs_per_carton', 1)
    rate = params.get('exchange_rate', 7.08)

    result = {
        'box_price_rmb': 0,
        'box_details': [],  # 各箱型明细
        'tape_price_rmb': 0,
        'materials': [],
        'materials_total_rmb': 0,
        'total_rmb': 0,
        'total_per_pcs_rmb': 0,
        'total_per_pcs_usd': 0,
        'cbm': 0,
    }

    # 纸箱价格（多箱型累加）
    if L and W and paper_price:
        total_box = 0
        for bt in box_types:
            price = calc_box(bt, L, W, H, paper_price)
            total_box += price
            result['box_details'].append({'type': bt, 'price_rmb': price})
        result['box_price_rmb'] = total_box

    # 胶纸价格
    if L and W:
        result['tape_price_rmb'] = calc_packing_tape(L, W, tape_price)

    # CBM
    if L and W and H:
        result['cbm'] = calc_cbm(L, W, H)

    # 附加物料
    mat_total = 0
    for mat in params.get('materials', []):
        mat_type = mat.get('type')
        item = {'type': mat_type, 'price_rmb': 0, 'desc': ''}

        if mat_type == 'card':
            price = calc_protection_card(
                mat['length'], mat['width'],
                mat['paper_price'], mat['qty']
            )
            item['price_rmb'] = price
            item['desc'] = f"保护卡 {mat['length']}×{mat['width']}cm ×{mat['qty']}pcs"

        elif mat_type == 'corner':
            price = calc_corner_protector(
                mat['length'], mat['width'], mat['paper_price']
            )
            item['price_rmb'] = price
            item['desc'] = f"护角 {mat['length']}×{mat['width']}cm"

        elif mat_type == 'strapping':
            price = calc_strapping(mat['meters'], mat.get('unit_price', 0.13))
            item['price_rmb'] = price
            item['desc'] = f"打包带 {mat['meters']}米"

        elif mat_type == 'pallet':
            price = calc_paper_pallet(
                mat['length'], mat['width'],
                mat['margin'], mat.get('unit_price', 7.2)
            )
            item['price_rmb'] = price
            item['desc'] = f"纸滑板 {mat['length']}×{mat['width']}cm 边距{mat['margin']}cm"

        elif mat_type == 'mailbox':
            # 邮包盒：用普通箱公式计算，cm先转英寸
            qty = mat.get('qty', 1)
            single_price = calc_box(
                'normal',
                mat['length'], mat['width'], mat.get('height', 0),
                mat['paper_price']
            )
            price = single_price * qty
            item['price_rmb'] = price
            item['desc'] = f"MAILBOX({qty}pcs)"

        elif mat_type == 'custom':
            # 通用自定义物料（胶袋、胶钉、吊牌等）
            price = calc_custom(mat.get('unit_price', 0), mat.get('qty', 1))
            item['price_rmb'] = price
            item['desc'] = mat.get('name', '自定义物料')

        result['materials'].append(item)
        mat_total += item['price_rmb']

    result['materials_total_rmb'] = mat_total
    result['total_rmb'] = result['box_price_rmb'] + result['tape_price_rmb'] + mat_total

    if pcs > 0:
        result['total_per_pcs_rmb'] = result['total_rmb'] / pcs
    if pcs > 0 and rate > 0:
        result['total_per_pcs_usd'] = result['total_rmb'] / pcs / rate

    return result
