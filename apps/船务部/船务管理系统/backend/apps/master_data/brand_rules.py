"""ZURU 品牌规则 - 根据产品代码前缀匹配品牌"""

BRAND_RULES = [
    # 5位前缀（最精确，优先匹配）
    ('15756', 'SPONGEBOB SQUAREPANTS'),
    ('9548', 'ZURU'),
    ('92107', 'ZURU/BABYCORNS'),
    ('92108', 'ZURU/BABYCORNS'),
    # 3位前缀
    ('157', 'ZURU/FUGGLER'),
    ('95', 'ZURU/PetsAlive'),
    ('92', 'ZURU/RAinBocoRns'),
    ('25', 'ZURU'),
    ('7', 'ZURU'),
]

# 国家为"中国"时，157系列的精确覆盖规则
BRAND_RULES_CHINA = [
    ('15789', 'ZURU/FUGGLER/Addo/PLUSH BAGCHARMS/Libertas'),
    ('15783', 'ZURU/FUGGLER/PLUSH BAGCHARMS'),
]


def get_brand_for_product_code(product_code: str, country: str = '') -> str | None:
    """根据产品代码前缀匹配品牌名称。

    规则按前缀长度从长到短排列，优先匹配更精确的前缀。
    仅适用于 ZURU 客户。
    当 country 包含"中国"时，15789/15783 使用更详细的品牌名。

    Args:
        product_code: 产品代码字符串
        country: 收货国家（可选）

    Returns:
        匹配的品牌名称，未匹配返回 None
    """
    if '中国' in (country or ''):
        for prefix, brand in BRAND_RULES_CHINA:
            if product_code.startswith(prefix):
                return brand
    for prefix, brand in BRAND_RULES:
        if product_code.startswith(prefix):
            return brand
    return None
