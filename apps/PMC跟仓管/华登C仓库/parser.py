"""SR3703 生产资料 解析器 — 提"贴卷纸"行,固定款一条一行,随机款按组合并。

返回 dict {
    'fixed': [ {label, sr_no, per_set, spec, group_color}, ... ],
    'random_groups': [ {
        'label': '贴卷纸27-31 (粉紫钻神秘款)',
        'category': '随机C常稀款',
        'pool': 20, 'pick': 5,
        'sr_list': ['SR0252','SR0262',...],   # 20 个候选 SR 货号
        'spec': '1*300mm 普通款',
        'note': '...',
        'group_color': '...',
    }, ...]
}

每套用量 = 1(per_set 默认 1)
- 固定款每款需要量 = 总套数 × per_set
- 随机款每候选 SR 需要量 = 总套数 × pick ÷ pool
"""
import os
import re
import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_XLSX = os.path.join(_HERE, 'data', 'SR3703.xlsx')

# 给不同随机款组分配颜色(柔和色,跟 Excel 截图风格对齐)
_GROUP_COLORS = ['#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#e0e7ff', '#fce7eb']


def _clean(v):
    if v is None: return ''
    try:
        if pd.isna(v): return ''
    except (TypeError, ValueError): pass
    return str(v).strip()


def _is_tiejuanzhi_row(row):
    c0 = _clean(row.iloc[0])
    c1 = _clean(row.iloc[1])
    keys = ('贴卷纸', '贴纸卷', 'STICKER ROLL', 'STICKER\nROLL')
    return any(k in c0 or k in c1 for k in keys)


_CODE_RE = re.compile(r'^[A-Za-z]{0,4}\d{2,}[A-Za-z\-]*$')

def _parse_sr_list(s):
    """C2 列形如 'SR0252/0262/0265/0285' 或 '随机神秘款\\n0252/0262/...' → list
    1. 去空白/换行,按 / 分段
    2. 过滤掉不像编码的段(含中文标签的"随机神秘款"等)
    3. 若有 SR 前缀,后面纯数字的自动补 SR"""
    if not s: return []
    # 把中文字符替换成 / 当分隔符,让标签自然落到独立段被过滤掉
    raw = re.sub(r'[一-鿿]+', '/', str(s))
    raw = re.sub(r'[\s　]+', '', raw)
    parts = [p for p in raw.split('/') if p]
    parts = [p for p in parts if _CODE_RE.match(p)]
    if not parts: return []
    first_has_sr = parts[0].upper().startswith('SR')
    out = []
    for p in parts:
        if first_has_sr and not p.upper().startswith('SR') and re.fullmatch(r'\d+[A-Za-z\-]*', p):
            p = 'SR' + p
        out.append(p.upper())
    return out


def _short(s):
    """去掉换行 + 截断英文部分,只取中文。"""
    if not s: return ''
    return s.split('\n')[0].strip()


def parse_tiejuanzhi(xlsx_path=None):
    if xlsx_path is None: xlsx_path = DEFAULT_XLSX
    if not os.path.exists(xlsx_path):
        return {'fixed': [], 'random_groups': []}

    df = pd.read_excel(xlsx_path, sheet_name=0, header=None)
    fixed = []
    random_groups = []
    current_group = None
    group_color_idx = 0

    for idx in range(len(df)):
        row = df.iloc[idx]
        if not _is_tiejuanzhi_row(row): continue

        c0 = _clean(row.iloc[0])
        c1 = _clean(row.iloc[1])
        c2 = _clean(row.iloc[2]) if df.shape[1] > 2 else ''
        c3 = _clean(row.iloc[3]) if df.shape[1] > 3 else ''
        c4 = _clean(row.iloc[4]) if df.shape[1] > 4 else ''
        c5 = _clean(row.iloc[5]) if df.shape[1] > 5 else ''
        c7 = _clean(row.iloc[7]) if df.shape[1] > 7 else ''

        try: per_set = int(float(c3)) if c3 else 1
        except (ValueError, TypeError): per_set = 1

        is_random = '随机' in c7 or '随机' in c1
        cat_short = _short(c1)
        has_sr_list = '/' in c2

        if is_random and (c7 or has_sr_list):
            # 新组开始 —— 两种触发:
            #   1) C7 有"共N款 随机使用M"说明(SR3703 多行式)
            #   2) C2 有 / 分隔的候选列表(新单行式)
            m1 = re.search(r'共有?(\d+)款', c7)
            m2 = re.search(r'随机使用?(\d+)', c7)
            sr_list = _parse_sr_list(c2)
            pool = int(m1.group(1)) if m1 else (len(sr_list) if sr_list else None)
            # pick 优先用 C7 注释里的;没注释就用 C3(per_set)
            explicit_pick = int(m2.group(1)) if m2 else None
            pick = explicit_pick if explicit_pick else per_set
            color = _GROUP_COLORS[group_color_idx % len(_GROUP_COLORS)]
            group_color_idx += 1
            current_group = {
                'label_start': _short(c0),
                'category': cat_short,
                'pool': pool,
                'pick': pick,
                'sr_list': sr_list,
                'spec': _short(c4),
                'flavor': c5,
                'note': c7,
                'group_color': color,
                'rows_count': 1,
                '_explicit_pick': explicit_pick is not None,  # C7 显式给的不要被 rows_count 覆盖
            }
            random_groups.append(current_group)
        elif is_random and current_group is not None and not has_sr_list:
            # 同一随机组的后续行(SR3703 多行式),只递增 rows_count
            current_group['rows_count'] += 1
        else:
            # 固定款
            current_group = None  # 切回固定段
            fixed.append({
                'label': _short(c0),
                'category': cat_short,
                'sr_no': c2,
                'per_set': per_set,
                'spec': _short(c4),
                'flavor': c5,
                'is_rare': '稀有' in c4 or 'Rare' in c4,
            })

    # SR3703 多行式才用 rows_count 校正 pick;新单行式 rows_count 永远=1,不能拿来覆盖
    for g in random_groups:
        if g.get('_explicit_pick') and g['rows_count'] > 1 and g['pick'] != g['rows_count']:
            # C7 注释说一个数,但实际行数不同 —— 以行数为准(更可信)
            g['pick'] = g['rows_count']
        g.pop('_explicit_pick', None)

    return {'fixed': fixed, 'random_groups': random_groups}
