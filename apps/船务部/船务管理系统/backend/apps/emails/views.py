"""邮件导入视图 — 解析 .eml 文件并提取出货相关数据。

解析管线（按顺序执行）：
  1. EML 解析 → 提取主题/正文/附件
  2. 邮件类型判断 → FCL整柜 / 交仓 / 客上柜(YAX) / TJX多柜
  3. 主题解析 → SO号、柜型、做柜工厂（多工厂模式）
  4. 附件解析 → PL Excel / Booking PDF / YAX Excel
  5. 正文补充解析 → SI截止、截数期、港口、国家
  6. 做柜工厂确认 → 从PL remark / 正文关键词 / CBM分布
  7. PL过滤 → 外厂做柜只保留兴信货
  8. CBM计算、吨车类型、柜号分配
"""

import os
import re
import logging
import tempfile
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.generics import ListAPIView

from .models import EmailRecord
from .serializers import EmailRecordSerializer
from .parsers.eml_parser import parse_eml_file
from .parsers.body_parser import (
    parse_email_body, _normalize_date, _adjust_sunday,
    COUNTRY_MAP, PORT_MAP,
)
from .parsers.excel_parser import parse_packing_list, parse_yax_excel, parse_cds_bkg_mapping
from .parsers.pdf_parser import parse_booking_pdf, _port_to_country, DESTINATION_PORT_MAP
from .parsers.word_parser import parse_word_attachment
from apps.master_data.models import FactoryMapping
from apps.shipments.calculations import determine_truck_type
# run_ai_parser 懒加载（避免 LangGraph 拖慢启动）

logger = logging.getLogger(__name__)

# ── 常量 ────────────────────────────────────────────────────────────────────

# 已知外厂中文简称（做柜工厂候选）
KNOWN_EXTERNAL_FACTORIES = [
    '华康', '丹尼', '高德斯', '嘉铭', '科美斯', '泰成', '汇有', '高美',
    '库有', '搏锐', '博锐', '泰亨', '超邦', '永贸', '雨禾', '高要',
]
# 兴信自身（本厂）
XINGXIN_NAMES = ['兴信', '新信']

# 贸易公司名（factory_remark 时不应使用 supplier 字段）
TRADING_COMPANIES = {'royal regent', 'royal regent products', 'topwin enterprise'}


# ── 工厂名解析 ───────────────────────────────────────────────────────────────

def _resolve_factory(name: str) -> str:
    """英文工厂名 → 中文简称（数据库映射，模糊兜底）。"""
    if not name:
        return ''
    name = name.strip()
    try:
        return FactoryMapping.objects.get(english_name=name).chinese_short_name
    except FactoryMapping.DoesNotExist:
        pass
    for fm in FactoryMapping.objects.all():
        en = fm.english_name.lower()
        if en in name.lower() or name.lower() in en:
            return fm.chinese_short_name
    return name


def _is_xingxin(name: str) -> bool:
    """判断工厂名是否是兴信本厂。"""
    if not name:
        return False
    nl = name.lower()
    return any(x in name for x in XINGXIN_NAMES) or 'hanson' in nl


# ── 第一步：邮件类型判断 ─────────────────────────────────────────────────────

def _detect_email_type(subject: str, body: str, has_yax: bool) -> str:
    """判断邮件类型。
    返回值：'fcl' | 'warehouse' | 'customer_load' | 'tjx'
    """
    combined = subject + ' ' + body

    # 客上柜（YAX附件）
    if has_yax:
        return 'customer_load'

    # 昱升拼柜/ZURU CY 客上柜：主题含 "CY carrier SO"（无 YAX 附件的 ZURU 船期邮件）
    if re.search(r'CY\s+carrier\s+SO', combined, re.IGNORECASE):
        return 'customer_load'

    # 整柜：主题含柜型关键词（HQ/GP/HC）
    if re.search(r'\d*\s*[xX*]?\s*\d+\s*(?:HQ|GP|HC)', subject):
        return 'fcl'

    # 整柜：主题含 CY SO（Container Yard，如 ZURU 的 <CY SO> 格式）
    if re.search(r'CY\s*SO[>#\s]', subject, re.IGNORECASE):
        return 'fcl'

    # 客上车：客户自行提货送外厂中转（库有清溪物流园等）
    # 只看主题和正文前300字，避免引用历史邮件误判
    # 注意：单凭"库有"工厂名出现不触发——很多 FCL 群发邮件正文 Dear/TO 行罗列了所有外厂含"库有"，
    # 必须配合明确的送货语义关键词（清溪/送库有 等）
    _head = subject + body[:300]
    if '客上车' in _head or '清溪' in _head:
        return 'customer_truck'
    if re.search(r'送(?:至|去|到)?库有', _head):
        return 'customer_truck'

    # 交仓：主题含交仓关键词（CFS 只检查主题，防止邮件正文模板误触发）
    if '交仓' in combined or '散货收货站' in combined or '入仓' in combined or 'CFS' in subject.upper():
        return 'warehouse'

    # 默认整柜
    return 'fcl'


# ── 第二步：主题解析（多工厂多SO模式）───────────────────────────────────────

def _parse_subject_fcl(subject: str) -> dict:
    """从主题提取 SO号、柜型、做柜工厂。

    支持两种模式：
    模式A（多工厂）：
      SO#SZPE82672700(FB14462 库有做柜),SZPE93895600,... 库有做柜 3X40HQ 兴信做柜 X40HQ
      → 按顺序将 SO 分配给各工厂段，提取兴信的 SO 和柜型。

    模式B（单工厂）：
      SO#SZPE81331200 1*40HQ / SO#SZPE81331200: some title 1X40HQ
      → 直接提取 SO 和柜型。
    """
    result = {
        'so_number': '',
        'container_type': '',
        'zuogui_factory': '',
    }

    # ── 模式A：检测是否有工厂做柜段 ──
    factory_ct_groups = re.findall(
        r'([\u4e00-\u9fff]+)[做装]柜\s*(?:(\d*)\s*[xX*]\s*)?(\d+)(HQ|GP|HC)',
        subject,
    )

    # 提取主题中所有 SO（第一个 SO# 开始的逗号分隔列表）
    # 字母前缀允许 3-6 字母（覆盖 SHZ/SZPE/ONEY 等），避免 4 字母硬性约束漏识别
    so_block = re.search(r'SO#((?:[A-Z]{3,6}\d+(?:\([^)]*\))?\s*,?\s*)+)', subject)
    all_sos = []
    if so_block:
        all_sos = re.findall(r'[A-Z]{3,6}\d+', so_block.group(1))

    if factory_ct_groups and all_sos:
        # 按顺序将 SO 分配给工厂段，收集兴信的 SO
        so_idx = 0
        xingxin_sos = []
        xingxin_ct_size = ''
        for factory, count_str, size, ctype in factory_ct_groups:
            cnt = int(count_str) if count_str else 1
            for _ in range(cnt):
                if so_idx < len(all_sos):
                    if any(x in factory for x in XINGXIN_NAMES):
                        xingxin_sos.append(all_sos[so_idx])
                        xingxin_ct_size = f'{size}{ctype.upper()}'
                    so_idx += 1

        if xingxin_sos:
            result['so_number'] = '/'.join(xingxin_sos)
            result['container_type'] = f'{len(xingxin_sos)}*{xingxin_ct_size}'
            result['zuogui_factory'] = '兴信'
            return result

        # 兴信在本批次中没有柜子（纯外厂邮件，只需提取第一个外厂的信息）
        # 把 SO 分配结果返回，但标记做柜工厂为第一个外厂
        if factory_ct_groups:
            first_factory = factory_ct_groups[0][0]
            # 兴信不在这批，找兴信的SO（可能在后续分批邮件里）
            # 此时 SO 全给外厂，兴信无柜 → 清空
            result['zuogui_factory'] = _resolve_factory(first_factory) or first_factory
        return result

    # ── 模式 A2：XINGXIN_NAMES 紧邻柜型（无"做柜"字样，如"兴信1*40HQ"）──
    if all_sos:
        _xx_pat = '|'.join(re.escape(x) for x in XINGXIN_NAMES)
        m_xx = re.search(rf'({_xx_pat})\s*(\d*)\s*[xX*]?\s*(\d+)\s*(HQ|GP|HC)', subject)
        if m_xx:
            size = m_xx.group(3)
            ctype = m_xx.group(4)
            count = int(m_xx.group(2)) if m_xx.group(2) else 1
            result['so_number'] = '/'.join(all_sos[:count])
            result['container_type'] = f'{count}*{size}{ctype.upper()}'
            result['zuogui_factory'] = '兴信'
            return result

    # ── 模式B：单一 SO ──
    if all_sos:
        result['so_number'] = all_sos[0]

    # 提取柜型（不含工厂做柜前缀）
    ct_match = re.search(r'(\d+)\s*[xX*]\s*(\d+)\s*(HQ|GP|HC)', subject)
    if ct_match:
        result['container_type'] = f'{ct_match.group(1)}*{ct_match.group(2)}{ct_match.group(3).upper()}'
    else:
        # 无数量前缀：1X40HQ → 1*40HQ
        ct_match2 = re.search(r'(\d+)\s*(HQ|GP|HC)', subject)
        if ct_match2:
            result['container_type'] = f'1*{ct_match2.group(1)}{ct_match2.group(2).upper()}'

    return result


# ── 第三步：做柜工厂确认 ─────────────────────────────────────────────────────

def _detect_zuogui_factory(subject: str, body: str, pl_items: list) -> str:
    """从多个来源按优先级确认做柜工厂。

    优先级：
    1. PL 的 carrier_so/container_type_loding 段标记（最准确）
    2. PL remark 列的"XX装柜"关键词
    3. 邮件正文/主题的"XX装柜/做柜"关键词
    4. PL 的 CBM 分布（兴信CBM < 最大工厂 → 外厂做柜）
    """
    combined = subject + ' ' + body

    # 1. PL container_type_loding 中的装柜段标记
    for item in pl_items:
        ctl = str(item.get('container_type_loding', '') or '').strip()
        sec_m = re.search(r'([\u4e00-\u9fff]+)[装做]柜', ctl)
        if sec_m:
            return sec_m.group(1)
        # 格式：40HQ/兴信
        if '/' in ctl:
            parts = ctl.split('/')
            if len(parts) > 1 and re.match(r'^[\u4e00-\u9fff]+$', parts[-1].strip()):
                return parts[-1].strip()

    # 2. PL remark 列
    for item in pl_items:
        rmk = str(item.get('remark', '') or '').strip()
        sec_m = re.search(r'([\u4e00-\u9fff]+)[装做]柜', rmk)
        if sec_m:
            return sec_m.group(1)

    # 3. 正文/主题关键词
    # 先找"兴信做柜"——直接返回兴信
    if re.search(r'兴信[做装]柜', combined):
        return '兴信'
    # 再找已知外厂（精确匹配，防止误识"安排装柜"等非工厂短语）
    for fac in KNOWN_EXTERNAL_FACTORIES:
        if re.search(fac + r'[做装]柜', combined):
            return fac
    # 注意：不做通用"任意XX做柜"模糊匹配，防止误识正文普通短语
    # 未知外厂情况交由第 4 步 CBM 分布推断处理

    # 4. CBM 分布推断
    factory_cbm = defaultdict(float)
    for item in pl_items:
        fr = item.get('factory_remark', '') or item.get('factory_short', '') or ''
        try:
            v = float(item.get('volume') or 0)
        except (ValueError, TypeError):
            v = 0
        if fr:
            factory_cbm[fr] += v

    if len(factory_cbm) > 1:
        xingxin_cbm = sum(v for f, v in factory_cbm.items() if _is_xingxin(f))
        max_factory = max(factory_cbm, key=factory_cbm.get)
        max_cbm = factory_cbm[max_factory]
        if xingxin_cbm < max_cbm and not _is_xingxin(max_factory):
            return _resolve_factory(max_factory) or max_factory

    return ''


# ── 第四步：PL factory_remark 赋值 ──────────────────────────────────────────

def _assign_factory_remark(pl_items: list):
    """给每个 PL item 赋值 factory_remark（中文简称）。"""
    all_suppliers = {
        str(it.get('supplier', '')).strip()
        for it in pl_items
        if it.get('supplier') and str(it.get('supplier', '')).strip().upper() != 'SUPPLIER NAME'
    }
    supplier_is_factory = len(all_suppliers) > 1

    for item in pl_items:
        sup = str(item.get('supplier', '')).strip()
        fe = str(item.get('factory_english', '')).strip()
        mf = str(item.get('main_factory', '')).strip()
        sup_lower = sup.lower()
        sup_is_trading = any(tc in sup_lower for tc in TRADING_COMPANIES)

        # factory_english（Actual factory）最准确，优先使用；但若数据库无映射（返回英文原名），则降级到 supplier
        if fe and fe.lower() not in ('actual factory', 'supplier name', ''):
            resolved_fe = _resolve_factory(fe)
            if resolved_fe and resolved_fe != fe:
                # 成功映射到中文简称
                item['factory_remark'] = resolved_fe
            elif supplier_is_factory and sup and not sup_is_trading and sup.upper() != 'SUPPLIER NAME':
                # 英文名无映射，用 supplier（通常含中文简称）
                item['factory_remark'] = _resolve_factory(sup) or sup
            else:
                item['factory_remark'] = resolved_fe  # 保留英文名兜底
        elif supplier_is_factory and sup and not sup_is_trading and sup.upper() != 'SUPPLIER NAME':
            item['factory_remark'] = _resolve_factory(sup)
        elif mf and mf.lower() not in ('actual factory', 'supplier name', 'main assembly factory', ''):
            item['factory_remark'] = _resolve_factory(mf)
        elif item.get('factory_short'):
            item['factory_remark'] = _resolve_factory(item['factory_short'])
        elif sup and sup.upper() != 'SUPPLIER NAME':
            item['factory_remark'] = _resolve_factory(sup)
        else:
            item['factory_remark'] = ''


# ── 第五步：PL 过滤 ───────────────────────────────────────────────────────────

def _filter_pl_items(pl_items: list, zuogui_factory: str, body: str) -> list:
    """根据做柜工厂过滤 PL 条目。

    - 兴信做柜：保留全部
    - 外厂做柜：只保留兴信的货物
    """
    if not zuogui_factory or _is_xingxin(zuogui_factory):
        return pl_items

    filtered = []
    for item in pl_items:
        fr = str(item.get('factory_remark') or '')
        fe = str(item.get('factory_english') or '').strip()
        fe_is_xingxin = fe and fe.lower() not in ('actual factory', 'supplier name') and 'hanson' in fe.lower()
        if _is_xingxin(fr) or fe_is_xingxin:
            item['factory_remark'] = '兴信'
            filtered.append(item)
    return filtered


# ── 第六步：整柜重复货号过滤 ─────────────────────────────────────────────────

def _dedup_pl_items(pl_items: list, subject: str) -> list:
    """整柜/散货时，同一货号+合同号+客PO 完全相同时才去重。

    不同合同号或不同客PO 的同货号行属于不同订单，保留全部。
    整柜：相同 key 保留 CBM 大的（主货）。
    散货/拼柜：相同 key 保留 CBM 小的（分配量）。
    """
    is_solo = '单独拼柜' in subject
    has_container = bool(re.search(r'\d+[xX*]\d+\s*(?:HQ|GP|HC)', subject))
    is_pinhui = '拼柜' in subject and not is_solo

    if is_solo or not pl_items:
        return pl_items

    # key = (product_code, contract_number, customer_po)，三者都相同才视为重复
    code_idxs = defaultdict(list)
    for idx, item in enumerate(pl_items):
        code = item.get('product_code', '')
        if not code:
            continue
        cn = str(item.get('contract_number', '') or '')
        po = str(item.get('customer_po', '') or '')
        key = (code, cn, po)
        code_idxs[key].append(idx)

    remove_idxs = set()
    for key, idxs in code_idxs.items():
        if len(idxs) <= 1:
            continue
        if has_container and not is_pinhui:
            # 整柜：保留 CBM 最大
            best = max(idxs, key=lambda i: _float(pl_items[i].get('volume')))
            remove_idxs.update(i for i in idxs if i != best)
        elif is_pinhui:
            # 拼柜：保留 CBM 最小
            best = min(idxs, key=lambda i: _float(pl_items[i].get('volume')))
            remove_idxs.update(i for i in idxs if i != best)

    return [it for i, it in enumerate(pl_items) if i not in remove_idxs]


def _parse_body_pl_table(body: str) -> list:
    """从邮件正文解析内嵌的 Packing List 表格（ZURU 标准格式）。

    表头固定 21 行，每条记录以 SKU 为起点，固定字段顺序：
      pos0=SKU  pos2=Retail Unit(qty)  pos4=NO of CARTON(pieces)
      pos15=CBM  pos16=Customer PO  pos18=ZURU PO  pos19=Actual factory
      pos20=Main assembly  pos23=Container No loading  pos24=Carrier SO  pos25=Container type loding(可为空)
    """
    HEADER_LINES = 21
    # 每条记录的最小字段数（不含可选的 container_type_loding）
    RECORD_CORE = 25

    # 规范化行：全角空格 → 空字符串
    lines = []
    for raw in body.splitlines():
        s = raw.strip()
        if s in ('\u3000', '　'):
            s = ''
        lines.append(s)

    # 找表头起始行 "SKU NO."
    header_start = None
    for i, line in enumerate(lines):
        if line.upper() in ('SKU NO.', 'SKU NO'):
            header_start = i
            break
    if header_start is None:
        return []

    # 从表头后收集数据行（遇到邮件引用段落停止）
    stop_markers = ('发件人:', 'from:', '—original', 'dear customer', 'caution!')
    data_lines = []
    for line in lines[header_start + HEADER_LINES:]:
        lower = line.lower()
        if any(lower.startswith(m) for m in stop_markers):
            break
        data_lines.append(line)

    if len(data_lines) < RECORD_CORE:
        return []

    def _looks_like_sku(s):
        if not s or ' ' in s or '(' in s: return False
        if re.search(r'[\u4e00-\u9fff/]', s): return False
        return bool(re.match(r'^[0-9A-Za-z]{3,12}$', s))

    def _looks_like_sku_start(vals, pos):
        if pos >= len(vals): return False
        if not _looks_like_sku(vals[pos]): return False
        # pos+1,+2 是数字
        for off in (1, 2):
            nxt = vals[pos + off] if pos + off < len(vals) else ''
            if not re.match(r'^\d+', nxt): return False
        return True

    # 第1条26值时（有 container_type_loding），第2条从26开始
    # 第1条25值时（无 container_type_loding），第2条从25开始
    if _looks_like_sku_start(data_lines, 26):
        first_step = 26
        step = 25   # 后续记录都是25（无ctl字段）
    elif _looks_like_sku_start(data_lines, 25):
        first_step = 25
        step = 25
    else:
        # 通用：扫描找第2条起始位置
        step = None
        for c in range(20, 30):
            if _looks_like_sku_start(data_lines, c):
                step = c
                break
        if step is None:
            return []
        first_step = step

    def _parse_record(record):
        def _g(i):
            return record[i].strip() if i < len(record) and isinstance(record[i], str) else ''
        sku = _g(0)
        if not sku:
            return None
        # 汇总行特征：pos0==pos1（件数合计行，如 "10819\n10819\n..."）
        if _g(1) == sku and re.match(r'^\d+$', sku):
            return None
        try: cbm = float(record[15]) if len(record) > 15 else 0
        except: cbm = 0
        try: pieces = int(float(_g(4))) if _g(4) else None
        except: pieces = None
        try: qty = int(float(_g(2))) if _g(2) else None
        except: qty = None
        return {
            'product_code': sku,
            'quantity': qty,
            'pieces': pieces,
            'volume': cbm,
            'customer_po': _g(16),
            'contract_number': _g(18),
            'factory_english': _g(19),
            'main_factory': _g(20),
            'remark': _g(21),
            'carrier_so': _g(24),
            'container_type_loding': _g(25),
            'supplier': '',
            'factory_short': '',
        }

    items = []
    pos = 0
    # 第1条记录
    rec = _parse_record(data_lines[pos:pos + first_step + 1])
    if rec:
        items.append(rec)
    pos += first_step

    # 后续记录（每条 step 个值）
    while pos + RECORD_CORE <= len(data_lines):
        rec = _parse_record(data_lines[pos:pos + step + 1])
        if rec is None:
            break
        items.append(rec)
        pos += step

    return items


def _parse_body_pl_table_tjx(body: str) -> list:
    """从邮件正文解析 TJX 简化版 PL 表格（每条 7 行 + 柜分组标记）。

    格式特征：
      数据段：BN<8-12位数字> / SKU / 合同号 / 客PO / 品牌 / 工厂(Remark) / CBM
      柜分组标记：在每柜起始位置出现一行 SO#XXXX（前一行可能是 1*40HQ 或 1*40HQ工厂）
      约定：marker 之后到下一个 marker 之间所有 records 属于该柜
      marker 之前的孤儿 records 归到第一柜

    返回：[{
      'so_number': 'SHZ8265013',
      'zuogui_factory': '丹尼',  # marker 上一行/或同行的"工厂"汉字
      'container_type': '1*40HQ',
      'items': [...],
    }, ...]
    或者空列表（不识别为该格式）
    """
    lines = [l.strip() for l in body.split('\n') if l.strip()]
    records = []   # 全部 PL records
    markers = []   # [(rec_idx, so, ct, factory)]

    i = 0
    while i < len(lines):
        # PL record: BN<数字> + 接下来 6 行 (SKU/合同/客PO/品牌/工厂/CBM)
        if re.match(r'^BN\d{8,12}$', lines[i]) and i + 6 < len(lines):
            try:
                cbm = float(lines[i + 6])
            except (ValueError, TypeError):
                i += 1
                continue
            records.append({
                'product_code': lines[i + 1],
                'contract_number': lines[i + 2],
                'customer_po': lines[i + 3],
                'brand': lines[i + 4],
                'factory_remark': lines[i + 5],
                'volume': cbm,
                'quantity': '',
                'pieces': '',
                'pallet_count': '',
                'spec': '',
                'box_dimensions': '',
            })
            i += 7
            continue
        # 柜分组标记：SO#XXX 行（前几行可能是 1*40HQ 或 1*40HQ工厂）
        m_so = re.match(r'^SO#([A-Z]{2,6}\d{4,})$', lines[i])
        if m_so:
            so = m_so.group(1)
            # 往前看 1-3 行找 柜型 / 工厂
            ct, factory = '', ''
            for back in (1, 2, 3):
                if i - back < 0:
                    break
                prev = lines[i - back]
                # 柜型 + 可选工厂（如 "1*40HQ" / "1*40HQ库有" / "1*400HQ华康"）
                m_ct = re.match(r'^(\d+\s*\*\s*\d+\s*(?:HQ|GP|HC|HIGH))([一-鿿]+)?$', prev, re.IGNORECASE)
                if m_ct:
                    ct = re.sub(r'\s+', '', m_ct.group(1)).upper().replace('HIGH', 'HQ').replace('400HQ', '40HQ')
                    if m_ct.group(2):
                        factory = m_ct.group(2)
                    break
                # 单独的工厂行（汉字 2-6 字符）
                if not factory and re.match(r'^[一-鿿（）()]{2,8}$', prev):
                    factory = re.sub(r'[（）()]', '', prev)
            markers.append((len(records), so, ct or '1*40HQ', factory))
            i += 1
            continue
        i += 1

    if not markers or not records:
        return []

    # 按 marker 分柜：marker[k].rec_idx 是该柜起始；下一 marker 是结束
    # marker 之前的孤儿 records 归入第一柜
    groups = []
    for k, (start_idx, so, ct, factory) in enumerate(markers):
        end_idx = markers[k + 1][0] if k + 1 < len(markers) else len(records)
        # 第一柜额外包含 marker[0] 之前的孤儿 records
        if k == 0 and start_idx > 0:
            recs = records[:end_idx]
        else:
            recs = records[start_idx:end_idx]
        groups.append({
            'so_number': so,
            'zuogui_factory': _resolve_factory(factory) or factory or '兴信',
            'container_type': ct,
            'items': recs,
        })
    return groups


def _float(val):
    try:
        return float(val or 0)
    except (ValueError, TypeError):
        return 0


# ── TJX 多柜分组处理 ──────────────────────────────────────────────────────────

def _process_tjx_groups(pl_items: list) -> list:
    """处理 TJX 类型的多柜分组 PL。

    PL 中每行都有 _container_assignment 或 _container_number 时触发。
    返回 container_groups 列表，每组含：
      so_number, zuogui_factory, container_type, total_cbm, packing_list_items
    """
    # 柜号模式仅当存在 2+ 个不同 _container_number 时才用
    # （单一 cno 时所有行会被合并成一组，无法按 _container_assignment 区分柜组）
    _distinct_cnos = set(
        (it.get('_container_number') or '').strip()
        for it in pl_items if (it.get('_container_number') or '').strip()
    )
    has_gui_number = len(_distinct_cnos) >= 2
    groups_map = {}

    if has_gui_number:
        # 柜号模式
        gui_info = {}
        for item in pl_items:
            gn = item.get('_container_number', '')
            ca = item.get('_container_assignment', '')
            if gn and ca and gn not in gui_info:
                gui_info[gn] = ca
        for item in pl_items:
            gn = item.get('_container_number', '')
            if not gn:
                continue
            key = f'{gn}:{gui_info.get(gn, gn)}'
            groups_map.setdefault(key, []).append(item)
    else:
        # 标记模式
        # 仅在 _container_assignment 实际变化时 seq++，避免每行都有相同 ca 时被错误拆成 N 个组
        # （如 ZURU PL 格式4 给每行都设了同一个 '40HQ\nHanson做柜'，应聚为同一组）
        seq = 0
        cur_key = ''
        prev_ca = None
        for item in pl_items:
            ca = item.get('_container_assignment')
            if ca and ca != prev_ca:
                seq += 1
                cur_key = f'{seq}:{ca}'
                prev_ca = ca
            item['_container_group_key'] = cur_key
        for item in pl_items:
            key = item.get('_container_group_key', '')
            groups_map.setdefault(key, []).append(item)

    # 计算跨柜总件数（同货号+合同号）
    total_pcs = defaultdict(int)
    for items in groups_map.values():
        for it in items:
            code = str(it.get('product_code', ''))
            cn = str(it.get('contract_number', ''))
            try:
                pcs = int(it.get('pieces') or 0)
            except (ValueError, TypeError):
                pcs = 0
            if code and cn:
                total_pcs[(code, cn)] += pcs

    container_groups = []
    factory_seq = defaultdict(int)

    # 预判整体装柜厂：收集所有有"做/装/拼柜"标记的工厂，判断是否全部是兴信
    # 若所有标记都是兴信 → 兴信本厂做全柜，外厂货也保留，不过滤
    # 若有多种工厂标记（兴信/库有/高德斯等）→ 各自独立装柜，保留分组过滤
    _assign_factories = []
    for _key in groups_map:
        _assign0 = _key.split(':', 1)[1] if ':' in _key else _key
        # 取最后一行再匹配，避免英文工厂名（含空格）被截断成 'Ltd'
        _assign0_last = _assign0.split('\n')[-1].strip()
        _zg0 = re.search(r'(.+?)\s*[做装拼]柜', _assign0_last) or re.search(r'([\u4e00-\u9fffA-Za-z]+)[做装拼]柜', _assign0)
        if _zg0:
            _f = _resolve_factory(_zg0.group(1).strip()) or _zg0.group(1).strip()
            _assign_factories.append(_f)
    # 所有标记工厂均为兴信（或无明确标记）→ 兴信统一做柜
    _overall_is_xingxin = bool(_assign_factories) and all(_is_xingxin(f) for f in _assign_factories)
    # CBM 复核：即使 assignment 全写"兴信做柜"，若外厂 CBM 总量 > 兴信 CBM → 实为外厂拼柜，需要过滤
    if _overall_is_xingxin:
        _all_cbm = defaultdict(float)
        for _gitems in groups_map.values():
            for _it in _gitems:
                _fr = _it.get('factory_remark', '')
                if _fr:
                    try:
                        _all_cbm[_fr] += float(_it.get('volume') or 0)
                    except (ValueError, TypeError):
                        pass
        if _all_cbm:
            _xi_total = sum(v for f, v in _all_cbm.items() if _is_xingxin(f))
            _max_ext = max((f for f in _all_cbm if not _is_xingxin(f)), key=lambda f: _all_cbm[f], default=None)
            if _max_ext and _all_cbm[_max_ext] > _xi_total:
                logger.info(f'[TJX_GROUP] CBM override _overall_is_xingxin→False: 外厂{_max_ext}={_all_cbm[_max_ext]:.3f} > 兴信={_xi_total:.3f}')
                _overall_is_xingxin = False

    def _item_is_xingxin(it):
        # factory_english（Actual factory）最准确，优先判断
        # 支持英文（Dong Guan Hanson...）和中文（兴信）两种格式
        # 短名（如 'Royal'）走 _resolve_factory 查 FactoryMapping 表
        fe = str(it.get('factory_english', '') or '').strip()
        if fe and fe.lower() not in ('actual factory', 'supplier name', ''):
            if _is_xingxin(fe):
                return True
            resolved = _resolve_factory(fe)
            if resolved and _is_xingxin(resolved):
                return True
        # 兜底用 factory_remark
        fr = it.get('factory_remark', '')
        return _is_xingxin(fr)

    for key, items in groups_map.items():
        assign = key.split(':', 1)[1] if ':' in key else key
        g_so = ''
        g_factory = ''
        g_ct = ''
        if assign:
            so_m = re.search(r'SO#(\S+)', assign)
            if so_m:
                g_so = so_m.group(1)
            # "拼" 也是兴信做柜标志（兴信拼柜 = 兴信负责装柜，含外厂数据）
            _assign_last = assign.split('\n')[-1].strip()
            zg_m = (re.search(r'([\u4e00-\u9fff]+)[做装拼]柜', _assign_last) or re.search(r'([\u4e00-\u9fff]+)[做装拼]柜', assign) or re.search(r'([A-Za-z][A-Za-z\s]*?)\s*[做装拼]柜', _assign_last))
            if zg_m:
                g_factory = _resolve_factory(zg_m.group(1).strip()) or zg_m.group(1).strip()
            ct_m = re.search(r'(\d*\*?\d+[A-Z]{2,})', assign)
            if ct_m:
                g_ct = ct_m.group(1)

        # CBM 分布校验：即使 assignment 写了"兴信做柜"，若外厂 CBM 更高 → 外厂拼柜，只保留兴信货
        logger.info(f'[TJX_GROUP] assign={assign!r} g_factory={g_factory!r} items={len(items)}')
        if items:
            _cbm_by_factory = defaultdict(float)
            for it in items:
                fr = it.get('factory_remark', '')
                if fr:
                    try:
                        _cbm_by_factory[fr] += float(it.get('volume') or 0)
                    except (ValueError, TypeError):
                        pass
            if _cbm_by_factory:
                _max_f = max(_cbm_by_factory, key=_cbm_by_factory.get)
                _xi_cbm = sum(v for f, v in _cbm_by_factory.items() if _is_xingxin(f))
                # 外厂 CBM 超过兴信 → 外厂拼柜，只保留兴信货
                if not _is_xingxin(_max_f) and _cbm_by_factory[_max_f] > _xi_cbm:
                    g_factory = _max_f
                    logger.info(f'[TJX_GROUP] CBM override: g_factory → {_max_f} (xi={_xi_cbm:.3f} max={_cbm_by_factory[_max_f]:.3f})')

        # 兜底：g_factory 仍为空时，默认保留全部（无法判断由谁装柜，不过滤）
        if not g_factory:
            g_factory = '兴信'

        if _overall_is_xingxin:
            # 兴信统一做柜（PL标记全是兴信）：保留全部数据，包括外厂的货，不过滤
            filtered = items
            g_factory = '兴信'
        elif _is_xingxin(g_factory):
            # 兴信自己做柜的组：保留全部数据，不过滤
            filtered = items
        else:
            # 外厂做柜（泰亨/雨禾/库有等）：只保留兴信的货（兴信拼入外厂柜的部分）
            filtered = [it for it in items if _item_is_xingxin(it) or not it.get('factory_remark')]
            for it in filtered:
                it['factory_remark'] = '兴信'

        if not filtered:
            continue

        # 补充 factory_remark（从 factory_short 或 supplier 推断）
        for it in filtered:
            if not it.get('factory_remark'):
                raw = it.get('factory_short', '') or it.get('supplier', '') or ''
                if raw:
                    resolved = _resolve_factory(raw)
                    if resolved:
                        it['factory_remark'] = resolved

        # 体积保留 3 位小数
        for it in filtered:
            if it.get('volume') is not None:
                try:
                    it['volume'] = round(float(it['volume']), 3)
                except (ValueError, TypeError):
                    pass

        # 写入跨柜总件数
        for it in filtered:
            code = str(it.get('product_code', ''))
            cn = str(it.get('contract_number', ''))
            it['total_pieces_per_order'] = total_pcs.get((code, cn), it.get('pieces', 0))

        g_cbm = round(sum(_float(it.get('volume')) for it in filtered), 3)
        factory_seq[g_factory] += 1
        container_groups.append({
            '_factory_name': g_factory,
            '_seq': factory_seq[g_factory],
            'so_number': g_so,
            'zuogui_factory': g_factory,
            'container_type': g_ct,
            'total_cbm': g_cbm,
            'packing_list_items': filtered,
        })

    # ── 同一工厂的多个 group 合并为一个（标记模式下同一工厂会被分成多组）──
    # 去掉 HQ/CY 等仓库前缀再合并，避免"HQ兴信"和"兴信"被当成两组
    # 合并 key = (工厂名, 柜型, booking行标识, so_number)；
    # - 有 _booking_line 的组按 booking 行分别保留
    # - 同工厂同柜型但 SO 不同 → 不同物理柜，不合并（如一封邮件 2 个兴信柜各对应 1 SO）
    merged_map = {}
    for g in container_groups:
        fn = re.sub(r'^(HQ|CY|QX|SZ|GZ)\s*', '', g['_factory_name']).strip()
        g['_factory_name'] = fn  # 统一名称
        ct_key = g.get('container_type', '')
        # 若组内条目含 _booking_line 字段，以 frozenset 区分不同物理柜（ZURU CDS BKG# 多柜场景）
        _g_bls = frozenset(
            it.get('_booking_line', '') for it in g.get('packing_list_items', [])
            if it.get('_booking_line')
        ) or None
        _g_so = g.get('so_number', '') or ''
        # _seq 是 _process_tjx_groups 内每工厂的递增序号
        # 含 _seq 可保留"同工厂不同物理柜"的区分（如一封邮件 2 个兴信柜从 PL 不同位置切出）
        _g_seq = g.get('_seq', 0)
        map_key = (fn, ct_key, _g_bls, _g_so, _g_seq)
        if map_key not in merged_map:
            # 深拷贝 items，避免浅拷贝导致数据被覆盖
            merged_map[map_key] = {**g, 'packing_list_items': list(g['packing_list_items'])}
        else:
            merged_map[map_key]['packing_list_items'].extend(g['packing_list_items'])
            merged_map[map_key]['total_cbm'] = round(
                merged_map[map_key]['total_cbm'] + g['total_cbm'], 3
            )

    container_groups = list(merged_map.values())

    # 若某个组内的 items 含有多个不同的 _container_number，按柜号拆分成独立组
    # 拆分后对每个子组做 CBM 校验：若外厂 CBM > 兴信 CBM，该子组视为外厂柜，需过滤非兴信货
    expanded_groups = []
    for g in container_groups:
        items = g.get('packing_list_items', [])
        cns = [it.get('_container_number', '') or '' for it in items]
        distinct_cns = [cn for cn in dict.fromkeys(cns) if cn]  # 去重保序
        if len(distinct_cns) > 1:
            for cn in distinct_cns:
                sub_items = [it for it in items if (it.get('_container_number') or '') == cn]
                if _overall_is_xingxin:
                    # 兴信统一做柜场景：该物理柜内有兴信货 → 保留全部数据（兴信装柜含外厂货是正常的）
                    #                   该物理柜内无兴信货 → 排除（该柜属于外厂）
                    has_xi = any(_item_is_xingxin(it) or not it.get('factory_remark') for it in sub_items)
                    if not has_xi:
                        logger.info(f'[TJX_GROUP] 排除外厂柜 {cn}（无兴信货）')
                        continue
                else:
                    # 非兴信统一做柜：对每个物理柜做 CBM 分布检查
                    _sub_cbm_by_f = defaultdict(float)
                    for _it in sub_items:
                        _fr = _it.get('factory_remark', '')
                        try:
                            _sub_cbm_by_f[_fr] += float(_it.get('volume') or 0)
                        except (ValueError, TypeError):
                            pass
                    _sub_xi_cbm = sum(v for f, v in _sub_cbm_by_f.items() if _is_xingxin(f))
                    _sub_ext_max_f = max(
                        (f for f in _sub_cbm_by_f if not _is_xingxin(f)),
                        key=lambda f: _sub_cbm_by_f[f], default=None
                    )
                    if _sub_ext_max_f and _sub_cbm_by_f[_sub_ext_max_f] > _sub_xi_cbm:
                        sub_items = [it for it in sub_items if _item_is_xingxin(it) or not it.get('factory_remark')]
                        for _it in sub_items:
                            _it['factory_remark'] = '兴信'
                if not sub_items:
                    continue
                sub_cbm = round(sum(_float(it.get('volume')) for it in sub_items), 3)
                expanded_groups.append({**g, 'packing_list_items': sub_items, 'total_cbm': sub_cbm, '_container_number': cn})
        else:
            expanded_groups.append(g)
    container_groups = expanded_groups

    # 若所有组的 zuogui_factory 都是兴信，且只有一种柜型（或无柜型），整体合并为一组
    # 有多种不同柜型时说明是多个独立物理柜（如 1*45HQ + 1*40HQ），保留各组不合并
    # 若各组的物理柜号（_container_number）不同，说明是多个独立物理柜，也不合并
    # 若各组的 _booking_line 不同，说明是 CDS BKG# 多柜场景，也不合并
    _all_cts = set(g.get('container_type', '') for g in container_groups if g.get('container_type'))
    _all_cn = set(
        it.get('_container_number', '') or ''
        for g in container_groups
        for it in g.get('packing_list_items', [])
        if it.get('_container_number')
    )
    _can_merge = len(_all_cn) <= 1  # 无柜号或全部相同柜号才允许合并
    # 不同 booking_line 的组代表不同物理柜（ZURU CDS BKG# 多柜），不合并
    _all_bl_sets = [
        frozenset(it.get('_booking_line', '') for it in g.get('packing_list_items', []) if it.get('_booking_line'))
        for g in container_groups
    ]
    _bl_differ = len(set(_all_bl_sets)) > 1 if all(_all_bl_sets) else False
    # SO 不同也代表独立物理柜（如一封邮件 2 个兴信柜各自有独立 SO）
    _all_sos = set(g.get('so_number', '') for g in container_groups if g.get('so_number'))
    _so_differ = len(_all_sos) > 1
    # 多个 _seq 也代表独立物理柜（PL 中多个独立 marker 行，如 2 个兴信柜各从不同位置切出）
    _seqs_differ = len({g.get('_seq', 0) for g in container_groups}) > 1
    if container_groups and all(_is_xingxin(g.get('zuogui_factory', '')) for g in container_groups) and len(_all_cts) <= 1 and _can_merge and not _bl_differ and not _so_differ and not _seqs_differ:
        all_items = []
        for g in container_groups:
            all_items.extend(g.get('packing_list_items', []))
        total = round(sum(_float(it.get('volume')) for it in all_items), 3)
        so = container_groups[0].get('so_number', '')
        ct = container_groups[0].get('container_type', '')
        container_groups = [{
            '_factory_name': '兴信',
            'so_number': so,
            'zuogui_factory': '兴信',
            'container_type': ct,
            'total_cbm': total,
            'packing_list_items': all_items,
        }]

    # 设置 group_label
    for g in container_groups:
        fn = g['_factory_name']
        ct = g.get('container_type', '')
        cn = g.get('_container_number', '')
        label = f'{fn}做柜 {ct}'.strip()
        if cn:
            label += f' ({cn})'
        g['group_label'] = label

    for g in container_groups:
        g.pop('_factory_name', None)
        g.pop('_seq', None)
        g.pop('_container_number', None)

    return container_groups


# ── 核心解析管线（供两个入口复用）────────────────────────────────────────────

def _run_import_pipeline(tmp_path: str) -> dict:
    """读取 EML 文件，执行完整解析管线，返回 {'email_record_id': ..., 'parsed': ...}。"""
    try:
        # ── 1. EML 解析 ────────────────────────────────────────────────────
        eml_data = parse_eml_file(tmp_path)
        subject = eml_data.get('subject', '') or ''
        body = eml_data.get('body_text', '') or ''
        combined = subject + ' ' + body

        logger.info(f'解析邮件: subject={subject[:80]}')

        # ── 2. 附件预扫描（判断是否有 YAX）──────────────────────────────────
        att_list = list(eml_data.get('attachments', []))

        # 2a. 解压 zip 附件：把内部 .xlsx/.pdf/.doc 当作新附件加入 att_list
        # 兼容中文文件名（CP437→GBK）
        import zipfile as _zipfile
        import tempfile as _tempfile
        _zip_atts = [a for a in att_list if a.get('filename', '').lower().endswith('.zip')]
        for _zatt in _zip_atts:
            try:
                _sp = _zatt['saved_path']
                _ext_dir = _tempfile.mkdtemp(prefix='zip_ext_', dir=os.path.dirname(_sp))
                with _zipfile.ZipFile(_sp) as _z:
                    for _n in _z.namelist():
                        if _n.endswith('/'):
                            continue
                        try:
                            _n_decoded = _n.encode('cp437').decode('gbk')
                        except (UnicodeDecodeError, UnicodeEncodeError):
                            _n_decoded = _n
                        _safe = ''.join(c for c in _n_decoded if c not in '<>:"|?*')
                        _safe = _safe.replace('\\', os.sep).replace('/', os.sep)
                        _target = os.path.join(_ext_dir, _safe)
                        os.makedirs(os.path.dirname(_target), exist_ok=True)
                        with _z.open(_n) as _src, open(_target, 'wb') as _dst:
                            _dst.write(_src.read())
                        att_list.append({
                            'filename': os.path.basename(_n_decoded),
                            'saved_path': _target,
                            'content_type': 'application/octet-stream',
                        })
                logger.info(f'解压 zip {_zatt["filename"]}: 含 {len([n for n in _zipfile.ZipFile(_sp).namelist() if not n.endswith("/")])} 个文件')
            except Exception as _ze:
                logger.error(f'zip 解压失败 {_zatt.get("filename")}: {_ze}', exc_info=True)

        yax_att = None
        pl_att_list = []
        pdf_att_list = []
        word_att_list = []
        warehouse_receipt_att = None  # 兴信入仓单（落货纸）

        for att in att_list:
            fn = att['filename']
            # NBSP (\xa0) 兼容：客户邮件附件名常含非断行空格，需归一化后再做关键词匹配
            fn_normalized = fn.replace('\xa0', ' ')
            fn_lower = fn_normalized.lower()
            if fn_lower.endswith(('.xlsx', '.xls')):
                if fn_normalized.upper().startswith('YAX'):
                    yax_att = att
                elif ('入仓单' in fn_normalized or '落货纸' in fn_normalized) and '兴信' in fn_normalized:
                    # 交仓邮件 zip 解压出的兴信入仓单（落货纸）
                    warehouse_receipt_att = att
                elif (
                    'packing list' in fn_lower
                    or 'packinglist' in fn_lower  # 无空格变体（如 ...Packinglist---1X40HQ顺铨提货.xlsx）
                    or fn_lower.startswith('bn')
                    or 'bn' in fn_lower          # 文件名含 BN（如 "4.30-5.04 UK BN260400193.xlsx"）
                    or re.search(r'^\d{1,2}[./]\d{1,2}', fn_lower)  # 日期开头（如 "4.30-5.04 UK..."）
                    or '箱单' in fn_normalized   # 送仓箱单
                    or '装车明细' in fn_normalized  # 送仓装车明细
                    or '出货清单' in fn_normalized  # 多工厂出货清单
                    or re.match(r'^\d+\.xlsx?$', fn_lower)  # 纯数字命名（如 1100033803.xlsx）
                    or re.match(r'^pl[\s\-_]', fn_lower)    # "PL - 总 ..." / "PL_..." / "PL-..."
                    or re.search(r'[\s_\-]pl\.xlsx?$', fn_lower)  # "<编号>[ _-]PL.xlsx"（如 1100034906-PL.xlsx / "...991 PL.xlsx"）
                    or re.search(r'[\s_\-]pkl\.xlsx?$', fn_lower)  # "<编号>[ _-]PKL.xlsx"（PKL = Packing List 缩写，如 "0999666985 PKL.xlsx"）
                    or re.search(r'[\s_\-]pl[\s_\-]', fn_lower)  # 含独立 PL 单词（如 "TWPOA2604001_CFS PL_PI#..."）
                    or re.match(r'^\d+(?:[+_-]\d+)+\.xlsx?$', fn_lower)  # 多 PO 组合（如 1100034658+1100034222.xlsx）
                ) and not (
                    # 排除：工厂报备表 / 自检报告 / 7Point 检查表 等非 PL 附件
                    '报备表' in fn_normalized
                    or '备表' in fn_normalized
                    or '报备' in fn_normalized
                    or '自检报告' in fn_normalized
                    or '7 point' in fn_lower
                    or '7point' in fn_lower
                ):
                    pl_att_list.append(att)
                # 其他 Excel 忽略（非 PL、非 YAX）
            elif fn_lower.endswith('.pdf'):
                pdf_att_list.append(att)
            elif fn_lower.endswith(('.docx', '.doc')):
                word_att_list.append(att)

        has_yax = yax_att is not None

        # ── 3. 邮件类型判断 ──────────────────────────────────────────────────
        email_type = _detect_email_type(subject, body, has_yax)
        logger.info(f'邮件类型: {email_type}')

        # ── 4. 解析各类附件 ──────────────────────────────────────────────────
        pl_items = []
        for att in pl_att_list:
            try:
                with ThreadPoolExecutor(max_workers=1) as _ex:
                    _fut = _ex.submit(parse_packing_list, att['saved_path'])
                    try:
                        items = _fut.result(timeout=30)
                    except FuturesTimeoutError:
                        logger.warning(f'PL 解析超时，跳过 {att["filename"]}')
                        continue
                # 标记每个 item 的源文件名（用于交仓多 PL 文件按文件分组场景）
                _src_fn = att.get('filename', '')
                for _it in items:
                    _it['_source_file'] = _src_fn
                pl_items.extend(items)
                logger.info(f'PL {att["filename"]}: {len(items)} 条')
            except Exception as e:
                logger.error(f'PL 解析失败 {att["filename"]}: {e}', exc_info=True)

        # 兴信入仓单（落货纸）— 交仓邮件 zip 解压出的中文表头 Excel
        if warehouse_receipt_att:
            try:
                from .parsers.excel_parser import parse_warehouse_receipt
                _wr_items = parse_warehouse_receipt(warehouse_receipt_att['saved_path'])
                if _wr_items:
                    _src_fn = warehouse_receipt_att.get('filename', '')
                    for _it in _wr_items:
                        _it['_source_file'] = _src_fn
                    # 入仓单是兴信货物的权威清单，优先使用（覆盖 TMS PL 等附件）
                    pl_items = _wr_items
                    logger.info(f'兴信入仓单 {_src_fn}: {len(_wr_items)} 条，覆盖 TMS PL')
            except Exception as e:
                logger.error(f'兴信入仓单解析失败 {warehouse_receipt_att.get("filename")}: {e}', exc_info=True)

        pdf_data = {}
        for att in pdf_att_list:
            try:
                with ThreadPoolExecutor(max_workers=1) as _ex:
                    _fut = _ex.submit(parse_booking_pdf, att['saved_path'])
                    try:
                        d = _fut.result(timeout=15)
                    except FuturesTimeoutError:
                        logger.warning(f'PDF 解析超时，跳过 {att["filename"]}')
                        continue
                for k, v in d.items():
                    if v and not pdf_data.get(k):
                        pdf_data[k] = v
            except Exception as e:
                logger.error(f'PDF 解析失败 {att["filename"]}: {e}', exc_info=True)

        word_data = {}
        for att in word_att_list:
            try:
                word_data = parse_word_attachment(att['saved_path'])
            except Exception as e:
                logger.error(f'Word 解析失败 {att["filename"]}: {e}', exc_info=True)

        yax_data = {}
        if yax_att:
            try:
                yax_data = parse_yax_excel(yax_att['saved_path'])
            except Exception as e:
                logger.error(f'YAX 解析失败 {yax_att["filename"]}: {e}', exc_info=True)

        # ── 4.5. 无附件时从正文解析内嵌 PL 表格 ────────────────────────────
        body_tjx_groups = None  # TJX 简化格式 body PL 多柜分组结果
        if not pl_items:
            body_pl = _parse_body_pl_table(body)
            if body_pl:
                pl_items = body_pl
                logger.info(f'正文表格解析: {len(pl_items)} 条')
            else:
                # TJX 简化格式 body PL 后置 fallback：每条 7 行 + SO# marker 分柜
                body_tjx_groups = _parse_body_pl_table_tjx(body)
                if body_tjx_groups:
                    # 把每柜 items 合并成 pl_items 供后续 factory_remark 等流程用
                    pl_items = []
                    for g in body_tjx_groups:
                        pl_items.extend(g['items'])
                    logger.info(f'正文表格解析(TJX): {len(body_tjx_groups)} 柜 / {len(pl_items)} 条')

        # ── 5. 赋值 factory_remark ──────────────────────────────────────────
        if pl_items:
            _assign_factory_remark(pl_items)

        # ── 6. 根据邮件类型分支处理 ──────────────────────────────────────────
        parsed = {}

        # ── 6A: TJX 多柜分组 ──────────────────────────────────────────────
        has_container_assignment = any(
            it.get('_container_assignment') or it.get('_container_number')
            for it in pl_items
        )

        # CDS BKG# 过滤：Excel Sheet2 有 BKG→Booking 映射，且 PL 分柜明细有 _cds_bkg_number/_booking_line 时精确过滤
        has_cds_bkg_col = any(it.get('_cds_bkg_number') or it.get('_booking_line') for it in pl_items)
        if has_cds_bkg_col and not has_container_assignment and pl_att_list:
            _bkg_records = []
            for _att in pl_att_list:
                try:
                    _bkg_records = parse_cds_bkg_mapping(_att['saved_path'])
                    if _bkg_records:
                        break
                except Exception:
                    pass
            # 从 PDF 附件文件名提取目标 BKG#（先提取，供两个分支共用）
            _target_bkg = None
            for _patt in (pdf_att_list or []):
                _m = re.search(r'(AMZ\w+)', _patt.get('filename', ''))
                if _m:
                    _target_bkg = _m.group(1)
                    break
            # 备选：从邮件主题/正文提取 BKG（AMZxxx 或 AMUxxx 等以 AM 开头的订舱号）
            if not _target_bkg:
                _m_subj = re.search(r'\b(AM[ZU]\w{10,})\b', subject)
                if _m_subj:
                    _target_bkg = _m_subj.group(1)

            if _bkg_records:
                # 若 PDF 无法确定，取兴信做柜的唯一 BKG#（只有一个时才用）
                if not _target_bkg:
                    _xi_bkgs = [r['bkg'] for r in _bkg_records if _is_xingxin(r['factory'])]
                    if len(set(_xi_bkgs)) == 1:
                        _target_bkg = _xi_bkgs[0]

                if _target_bkg:
                    # 2. 找该 BKG# 下所有兴信 Booking（可能多个柜）
                    _xi_bookings = [(r['booking'], r['contracts']) for r in _bkg_records
                                   if r['bkg'] == _target_bkg and _is_xingxin(r['factory'])]
                    # 3. 按 CDS BKG# + Booking 精确过滤；只在每组第一条打 _container_assignment 标记
                    if _xi_bookings:
                        logger.info(f'[CDS_BKG] BKG={_target_bkg} 兴信bookings={[b for b,_ in _xi_bookings]}，过滤前 {len(pl_items)} 条')
                        _new_items = []
                        for _booking_line, _contracts in _xi_bookings:
                            _ct_m = re.search(r'1\*(\d+HQ|\d+GP)', _booking_line)
                            _ct = _ct_m.group(1) if _ct_m else '40HQ'
                            # 用完整 booking_line（含 -4/-5 子柜号）+ 柜型，避免不同物理柜被 _process_tjx_groups 合并
                            _assign = f'{_booking_line} {_ct}\n兴信做柜'
                            _grp_first = True
                            for _it in pl_items:
                                if (_it.get('_cds_bkg_number', '').strip() == _target_bkg
                                        and _it.get('_booking_line', '') == _booking_line):
                                    _it2 = dict(_it)
                                    if _grp_first:
                                        _it2['_container_assignment'] = _assign
                                        _grp_first = False
                                    else:
                                        _it2.pop('_container_assignment', None)
                                    _new_items.append(_it2)
                        if _new_items:
                            pl_items = _new_items
                            logger.info(f'[CDS_BKG] 过滤后 {len(pl_items)} 条')
                            has_container_assignment = True

            elif _target_bkg:
                # Fallback：Sheet2 摘要不存在，直接按 _cds_bkg_number 过滤
                # 每个 booking_line 一组（=一个物理柜），做柜工厂用每行 _zuogui_factory 列值
                # 兴信做柜组保留全部货；外厂做柜组在后续 TJX 路径会过滤只剩兴信货
                _filtered_by_bkg = [it for it in pl_items
                                    if it.get('_cds_bkg_number', '').strip() == _target_bkg]
                if _filtered_by_bkg:
                    _bl_order = []
                    _bl_groups_fb = {}
                    for _it in _filtered_by_bkg:
                        _bl = _it.get('_booking_line', '') or ''
                        if _bl not in _bl_groups_fb:
                            _bl_groups_fb[_bl] = []
                            _bl_order.append(_bl)
                        _bl_groups_fb[_bl].append(_it)
                    _new_items = []
                    for _bl in _bl_order:
                        _bits = _bl_groups_fb[_bl]
                        _ct_m = re.search(r'\b(\d+HQ|\d+GP)\b', _bl, re.IGNORECASE)
                        _ct = _ct_m.group(1) if _ct_m else '40GP'
                        # 该组做柜工厂：取首行 _zuogui_factory 列值，缺省 '兴信'
                        _zg_fb = ''
                        for _it_fb in _bits:
                            _zg_fb = (_it_fb.get('_zuogui_factory') or '').strip()
                            if _zg_fb:
                                break
                        if not _zg_fb:
                            _zg_fb = '兴信'
                        # 该组 SO：取首行 _so_column（来自 SO# 列）或 _container_so
                        _so_fb = ''
                        for _it_fb in _bits:
                            _so_fb = str(_it_fb.get('_so_column') or _it_fb.get('_container_so') or '').strip()
                            if _so_fb:
                                break
                        # 用完整 booking_line（含 -4/-5 子柜号）+ 柜型，避免不同物理柜被 _process_tjx_groups 合并
                        _assign = f'{_bl} {_ct}\n{_zg_fb}做柜'
                        if _so_fb:
                            _assign = f'SO#{_so_fb}\n{_assign}'
                        for _idx, _it in enumerate(_bits):
                            _it2 = dict(_it)
                            if _idx == 0:
                                _it2['_container_assignment'] = _assign
                            else:
                                _it2.pop('_container_assignment', None)
                            _new_items.append(_it2)
                    pl_items = _new_items
                    logger.info(f'[CDS_BKG_FALLBACK] BKG={_target_bkg} 过滤后 {len(pl_items)} 条，{len(_bl_order)} 组')
                    has_container_assignment = True

        # warehouse / customer_truck 邮件已有专门分支，不进 TJX 多柜路径
        # 否则 PL 含 Container No. loading 列时会被误识为 fcl 多柜分组
        # 例外1: CDS BKG 过滤已成功 → 仍走 TJX 路径
        # 例外2: PL Remark 列含明确 "SO#... 做柜" 标记 → 用户显式指定的分柜，应走 TJX
        _bkg_filter_applied = has_cds_bkg_col and bool(locals().get('_target_bkg'))
        _has_explicit_so_assign = any(
            'SO#' in (str(it.get('_container_assignment') or ''))
            and '做柜' in str(it.get('_container_assignment') or '')
            for it in pl_items
        )
        if email_type in ('warehouse', 'customer_truck') and has_container_assignment and not _bkg_filter_applied and not _has_explicit_so_assign:
            logger.info(f'[路径] {email_type} 邮件跳过 TJX 路径（虽 has_container_assignment={has_container_assignment}）')
            has_container_assignment = False

        logger.info(f'[路径] has_container_assignment={has_container_assignment} email_type={email_type} pl_items={len(pl_items)}')
        if has_container_assignment:
            container_groups = _process_tjx_groups(pl_items)
            logger.info(f'[TJX] container_groups={len(container_groups)} groups, items_per_group={[len(g.get("packing_list_items",[])) for g in container_groups]}')
            # 从正文提取通用字段（SI/截数期/港口）
            body_fields = parse_email_body(body)
            subject_fields = parse_email_body(subject)
            for field in ['si_deadline', 'cutoff_date', 'port']:
                if not body_fields.get(field) and subject_fields.get(field):
                    body_fields[field] = subject_fields[field]
            # PDF 补充截数期、SI截止、港口（与 FCL 分支保持一致）
            if pdf_data.get('customs_cutoff'):
                body_fields['cutoff_date'] = pdf_data['customs_cutoff']
            if pdf_data.get('si_deadline'):
                body_fields['si_deadline'] = pdf_data['si_deadline']  # PDF 始终优先
            if pdf_data.get('port'):
                body_fields['port'] = pdf_data['port']
            # 国家：PDF 卸货港优先
            _tjx_country = pdf_data.get('country', '') or body_fields.get('country', '')
            if not _tjx_country:
                _zxg = re.search(r'卸货港[：:\s]*([A-Z][A-Z\s]+?)(?:;|,|\n|$)', combined, re.IGNORECASE)
                if _zxg:
                    _tjx_country = _port_to_country(_zxg.group(1).strip())
            if not _tjx_country:
                _to = re.search(r'\bTO\s+([A-Z]{2,3})\b', subject)
                if _to:
                    _tjx_country = COUNTRY_MAP.get(_to.group(1).upper(), '')
            # TJX 路线代码推断国家：PNW/NOR/SOR/AUSA/AUSM/AUSE/NZAU 等
            if not _tjx_country:
                _route_map = {
                    'PNW': '美国', 'NOR': '美国', 'SOR': '美国', 'MID': '美国',
                    'FCA-CY': '美国', 'AUSA': '澳大利亚', 'AUSM': '澳大利亚',
                    'AUSE': '澳大利亚', 'NZAU': '新西兰',
                    'CAVA': '加拿大', 'CABC': '加拿大', 'CAON': '加拿大',
                    'UK': '英国', 'GBR': '英国',
                }
                subj_upper = subject.upper()
                for code, ctry in _route_map.items():
                    if code in subj_upper:
                        _tjx_country = ctry
                        break
            # 从主题/正文中扫描目的港名推断国家
            if not _tjx_country:
                from .parsers.pdf_parser import DESTINATION_PORT_MAP
                subj_upper = subject.upper()
                body_upper = body[:1000].upper()
                for port, ctry in DESTINATION_PORT_MAP.items():
                    if port in subj_upper or port in body_upper:
                        _tjx_country = ctry
                        break
            # 从主题提取出货时间：预计提货时间:2026/4/17 → ship_date = 4/17
            _tjx_ship_date = body_fields.get('ship_date', '')
            if not _tjx_ship_date:
                _sd_m = re.search(r'预计提货时间[：:]*\s*(\d{4}/\d{1,2}/\d{1,2})', subject)
                if _sd_m:
                    _tjx_ship_date = _normalize_date(_sd_m.group(1))
            parsed = {
                **body_fields,
                'body_text': body,
                'container_groups': container_groups,
                'shipment_type': 'fcl',
                'country': _tjx_country,
                'delivery_address': _tjx_country,
            }
            if _tjx_ship_date:
                parsed['ship_date'] = _tjx_ship_date
            if container_groups:
                parsed['packing_list_items'] = container_groups[0]['packing_list_items']
                parsed['so_number'] = container_groups[0].get('so_number', '') or pdf_data.get('so_number', '') or body_fields.get('so_number', '') or subject_fields.get('so_number', '')
                parsed['container_type'] = container_groups[0]['container_type']
                _zf = container_groups[0]['zuogui_factory']
                parsed['zuogui_factory'] = _zf
                # 送外厂做柜（博锐/库有等）时，不显示特殊要求（拉网/拍照/立放是兴信做柜才有的）
                if _zf and '兴信' not in _zf:
                    parsed['special_requirements'] = ''
            else:
                # container_groups 为空时回退：至少把 PL items 展示出来（避免完全空白）
                parsed['packing_list_items'] = pl_items
                parsed['so_number'] = pdf_data.get('so_number', '') or body_fields.get('so_number', '') or subject_fields.get('so_number', '')
                _ct_sub = re.search(r'(\d+)\s*[×xX*]\s*(\d+\s*(?:HQ|HC|GP))', subject, re.IGNORECASE)
                if _ct_sub:
                    parsed['container_type'] = f'{_ct_sub.group(1)}*{_ct_sub.group(2).upper().replace(" ", "")}'

        # ── 6B: 客上柜（YAX 或昱升拼柜）──────────────────────────────────────
        elif email_type == 'customer_load':
            # 昱升拼柜邮件：无 YAX 附件，主题含 "CY carrier SO"
            is_yusheng = not has_yax and bool(re.search(r'CY\s+carrier\s+SO', combined, re.IGNORECASE))

            body_fields = parse_email_body(body)
            subject_fields = parse_email_body(subject)
            for field in ['si_deadline', 'cutoff_date', 'port']:
                if not body_fields.get(field) and subject_fields.get(field):
                    body_fields[field] = subject_fields[field]

            # PDF 补充截数期、SI截止、港口（与 FCL 分支保持一致）
            if pdf_data.get('customs_cutoff'):
                body_fields['cutoff_date'] = pdf_data['customs_cutoff']
            if pdf_data.get('si_deadline'):
                body_fields['si_deadline'] = pdf_data['si_deadline']  # PDF 始终优先
            if pdf_data.get('port'):
                body_fields['port'] = pdf_data['port']

            # YAX 数据覆盖
            raw_ct = yax_data.get('container_type', '')
            ct_m = re.search(r'(\d+)\s*(HQ|GP|HC|OT|FR|RF)', raw_ct, re.IGNORECASE)
            yax_ct = f'1*{ct_m.group(1)}{ct_m.group(2).upper()}' if ct_m else raw_ct

            # 昱升邮件：从主题提取柜型（取兴信的 1 个柜，默认 1*40HQ）
            if is_yusheng and not yax_ct:
                ct_m2 = re.search(r'昱升\d+[×xX]\s*(\d+)\s*(HQ|GP|HC)', combined, re.IGNORECASE)
                yax_ct = f'1*{ct_m2.group(1)}{ct_m2.group(2).upper()}' if ct_m2 else '1*40HQ'

            yax_cutoff = _normalize_date(str(yax_data.get('customs_cutoff', '') or ''))
            yax_si = _normalize_date(str(yax_data.get('si_deadline', '') or ''))

            # YAX SO 匹配（按 CBM 匹配兴信分配的 YAX 号）
            xingxin_cbm = round(sum(_float(it.get('volume')) for it in pl_items), 3)
            yax_so = ''
            min_diff = float('inf')
            for pm in yax_data.get('po_so_mapping', []):
                pm_so = str(pm.get('so', '')).strip()
                pm_cbm = pm.get('cbm') or 0
                if pm_so and pm_so.upper().startswith('YAX') and pm_cbm:
                    diff = abs(pm_cbm - xingxin_cbm)
                    if diff < min_diff:
                        min_diff = diff
                        yax_so = pm_so

            booking = yax_data.get('booking_number', '')
            so_number = f'{yax_so}（{booking}）' if yax_so and booking else (booking or yax_so)
            # YAX SO/booking 均为空时从 PDF/正文补充
            if not so_number:
                so_number = pdf_data.get('so_number', '') or body_fields.get('so_number', '') or subject_fields.get('so_number', '')

            # 国家：PDF 优先，其次正文各种模式
            country = pdf_data.get('country', '') or body_fields.get('country', '')
            if not country:
                pod_m = re.search(r'Place\s*of\s*delivery[：:\s]*(\S+)', combined, re.IGNORECASE)
                if pod_m:
                    country = _port_to_country(pod_m.group(1).strip().rstrip(','))
            if not country:
                zxg_m = re.search(r'卸货港[：:\s]*([A-Z][A-Z\s]+?)(?:;|,|\n|$)', combined, re.IGNORECASE)
                if zxg_m:
                    country = _port_to_country(zxg_m.group(1).strip())
            if not country:
                to_m = re.search(r'\bTO\s+([A-Z]{2,3})\b', subject)
                if to_m:
                    country = COUNTRY_MAP.get(to_m.group(1).upper(), '')

            # 报关行：YAX 优先，其次正文；昱升邮件默认志诚达
            customs_broker = yax_data.get('customs_broker', '') or body_fields.get('customs_broker', '')
            if is_yusheng and not customs_broker:
                customs_broker = '志诚达'

            # 昱升邮件：解析正文中的 ITEM-工厂映射，过滤 PL 只保留兴信数据
            if is_yusheng:
                xingxin_item_codes: set = set()
                for _m in re.finditer(r'ITEM[：:](\d+)[^\n（(]*[（(]([^）)]+)[）)]', body):
                    _item_code = _m.group(1)
                    _factories = [f.strip() for f in re.split(r'\+', _m.group(2))]
                    if any(_is_xingxin(f) for f in _factories):
                        xingxin_item_codes.add(_item_code)
                logger.info(f'昱升邮件 xingxin_items={xingxin_item_codes}')
                if xingxin_item_codes:
                    _filtered = []
                    for _it in pl_items:
                        _pc = str(_it.get('product_code', '')).strip()
                        # product_code 与 ITEM 代码精确匹配：相同或以 ITEM 代码开头后接字母后缀
                        # '11962' ✓  '11962UQ1' ✓  '119621' ✗（不能跟数字）
                        if any(re.match(r'^' + re.escape(code) + r'($|[A-Za-z])', _pc)
                               for code in xingxin_item_codes):
                            _it['factory_remark'] = '兴信'
                            _filtered.append(_it)
                    if _filtered:
                        pl_items = _filtered
                else:
                    # 无 ITEM 映射时按 factory_remark 过滤到兴信
                    _filtered2 = _filter_pl_items(pl_items, '外厂', body)
                    if _filtered2:
                        pl_items = _filtered2

            # 多柜分组：优先用 YAX containers，其次按 PL 文件数分组
            container_groups = []
            yax_containers = yax_data.get('containers', [])

            if len(yax_containers) > 1:
                # YAX 按 CBM 已分柜，用落货纸号码匹配 PL 明细
                # 先建立 cargo_receipt → pl_item 映射
                cr_map = {}
                for it in pl_items:
                    cr = str(it.get('cargo_receipt', '') or '').strip()
                    if cr:
                        cr_map.setdefault(cr, []).append(it)

                for i, cont in enumerate(yax_containers, start=1):
                    g_items = []
                    for entry in cont.get('entries', []):
                        cr = str(entry.get('cargo_receipt', '') or '').strip()
                        if cr and cr in cr_map:
                            g_items.extend(cr_map[cr])
                        elif not cr:
                            # 没有落货纸号码时按 PO 匹配
                            po = str(entry.get('po', '') or '').strip()
                            for it in pl_items:
                                if str(it.get('customer_po', '') or '').strip() == po:
                                    g_items.append(it)
                    # 兜底：若匹配不到明细，按 CBM 比例均分
                    if not g_items and pl_items:
                        chunk = len(pl_items) // len(yax_containers)
                        start = (i - 1) * chunk
                        end = start + chunk if i < len(yax_containers) else len(pl_items)
                        g_items = pl_items[start:end]
                    for it in g_items:
                        if it.get('volume') is not None:
                            try:
                                it['volume'] = round(float(it['volume']), 3)
                            except (ValueError, TypeError):
                                pass
                    g_cbm = round(sum(_float(it.get('volume')) for it in g_items), 3)
                    container_groups.append({
                        'group_label': f'第{i}柜 {yax_ct}',
                        'so_number': so_number,
                        'zuogui_factory': '兴信',
                        'container_type': yax_ct,
                        'total_cbm': g_cbm,
                        'packing_list_items': g_items,
                    })
            elif len(pl_att_list) > 1 and not is_yusheng:
                # 多PL文件 = 多柜，按文件分组（昱升的子件PL是按ITEM分的，不是按柜分的，跳过）
                for i, att in enumerate(pl_att_list, start=1):
                    try:
                        g_items = parse_packing_list(att['saved_path'])
                        _assign_factory_remark(g_items)
                    except Exception:
                        g_items = []
                    for it in g_items:
                        if it.get('volume') is not None:
                            try:
                                it['volume'] = round(float(it['volume']), 3)
                            except (ValueError, TypeError):
                                pass
                    g_cbm = round(sum(_float(it.get('volume')) for it in g_items), 3)
                    container_groups.append({
                        'group_label': f'第{i}柜 {yax_ct}',
                        'so_number': so_number,
                        'zuogui_factory': '兴信',
                        'container_type': yax_ct,
                        'total_cbm': g_cbm,
                        'packing_list_items': g_items,
                    })

            parsed = {
                **body_fields,
                'body_text': body,
                'shipment_type': 'customer_load',
                'so_number': so_number,
                'container_type': yax_ct,
                'cutoff_date': yax_cutoff or body_fields.get('cutoff_date', ''),
                'si_deadline': yax_si or body_fields.get('si_deadline', ''),
                'country': country,
                'delivery_address': country,
                'customs_broker': customs_broker,
                'special_requirements': '客上柜，送昱升拼柜，深圳报关' if is_yusheng else body_fields.get('special_requirements', ''),
                'packing_list_items': pl_items,
                'container_groups': container_groups,
                'zuogui_factory': '兴信',
            }

        # ── 6C: 交仓 ────────────────────────────────────────────────────
        elif email_type == 'warehouse':
            body_fields = parse_email_body(body)
            subject_fields = parse_email_body(subject)
            for field in ['si_deadline', 'cutoff_date', 'port']:
                if not body_fields.get(field) and subject_fields.get(field):
                    body_fields[field] = subject_fields[field]

            # SO/订舱号：正文优先，其次主题
            so_number = body_fields.get('so_number', '') or subject_fields.get('so_number', '')

            # 仓库名
            warehouse = ''
            for pattern in [
                r'海关登记为[：:\s]*([\u4e00-\u9fff]+[A-Za-z0-9]*仓)',
                r'入([\u4e00-\u9fff]+[A-Za-z0-9]*(?:仓|物流仓|物流园))',
                r'(勤辉[A-Za-z]?仓|盐田\d+号仓|中通[\u4e00-\u9fff]*仓)',
            ]:
                wh_m = re.search(pattern, combined)
                if wh_m:
                    warehouse = wh_m.group(1)
                    break
            if not warehouse and word_data.get('warehouse'):
                warehouse = word_data['warehouse']

            # 入仓时间：4/30-5/04 → ship_date=4/30, cutoff=5/04
            ship_date = ''
            rucang_m = re.search(r'入仓时间[：:\s]*(\d{1,2}/\d{1,2})\s*[-~–]\s*(\d{1,2}/\d{1,2})', combined)
            if rucang_m:
                ship_date = rucang_m.group(1)
                if not body_fields.get('cutoff_date'):
                    body_fields['cutoff_date'] = rucang_m.group(2)

            # CFS CLS 日期（优先级低于入仓时间）
            if not ship_date:
                cfs_m = re.search(r'CFS\s*CLS[：:\s]*(\d{1,2}/\d{1,2})\s*[-~–]\s*(\d{1,2}/\d{1,2})', combined, re.IGNORECASE)
                if cfs_m:
                    ship_date = cfs_m.group(1)
                    body_fields['cutoff_date'] = cfs_m.group(2)

            # 国家：AMZ/AMU + 国家代码（如 AMZ UK / AMU IT）或 Amazon UK 等
            country = body_fields.get('country', '') or subject_fields.get('country', '')
            if not country:
                amz_m = re.search(r'AM[ZU]\s+([A-Z]{2,3})\b', combined)
                if amz_m:
                    country = COUNTRY_MAP.get(amz_m.group(1).upper(), amz_m.group(1))
            if not country:
                amz_m2 = re.search(r'Amazon\s+([A-Z]{2,3})\b', combined, re.IGNORECASE)
                if amz_m2:
                    country = COUNTRY_MAP.get(amz_m2.group(1).upper(), amz_m2.group(1))

            # 过滤 PL：只保留兴信的货（若过滤后为空则保留原始，避免误删）
            if pl_items:
                logger.info(f'交仓PL过滤前: {len(pl_items)} 行, factory_remarks={list(set(it.get("factory_remark","") for it in pl_items))}')
                filtered = [it for it in pl_items if _is_xingxin(str(it.get('factory_remark') or '')) or 'hanson' in str(it.get('factory_english') or '').lower()]
                logger.info(f'交仓PL过滤后: {len(filtered)} 行')
                pl_items = filtered if filtered else pl_items

            # 多 PL 文件场景（一封邮件多份 packing list 各自对应一个 DC）：按源文件分组
            # 例：Family Dollar CFS 邮件含 6 份 PL 各对应一个 DC
            _src_files = [it.get('_source_file', '') for it in pl_items if it.get('_source_file')]
            _distinct_src = []
            for _f in _src_files:
                if _f not in _distinct_src:
                    _distinct_src.append(_f)
            _has_multi_pl_files = len(_distinct_src) >= 2

            # 交仓 PO Extract 格式：按 _delivery_date 分日期、再按 CBM≤46 切分车
            _has_delivery_date = (not _has_multi_pl_files) and any(it.get('_delivery_date') for it in pl_items)
            if _has_delivery_date:
                from collections import defaultdict as _twdd
                _by_date = _twdd(list)
                for it in pl_items:
                    _by_date[it.get('_delivery_date', '')].append(it)

                _truck_groups = []
                _truck_seq = 0
                _MAX_TRUCK_CBM = 46.0  # 单车 CBM 上限
                for _date in sorted(_by_date.keys(), key=lambda d: tuple(int(x) for x in d.split('/')) if d else (99, 99)):
                    _date_recs = _by_date[_date]
                    _cur = []
                    _cur_cbm = 0.0
                    for _rec in _date_recs:
                        _v = _float(_rec.get('volume'))
                        if _cur and _cur_cbm + _v > _MAX_TRUCK_CBM:
                            _truck_seq += 1
                            _bx_list = [str(it.get('remark') or '').strip() for it in _cur if it.get('remark')]
                            _truck_groups.append({
                                'group_label': f'车{_truck_seq}',
                                'so_number': so_number,
                                'zuogui_factory': '兴信',
                                'container_type': '',
                                'total_cbm': round(_cur_cbm, 3),
                                'delivery_date': _date,
                                'truck_remark': '；'.join(_bx_list),
                                'packing_list_items': _cur,
                            })
                            _cur = []
                            _cur_cbm = 0.0
                        _cur.append(_rec)
                        _cur_cbm += _v
                    if _cur:
                        _truck_seq += 1
                        _bx_list = [str(it.get('remark') or '').strip() for it in _cur if it.get('remark')]
                        _truck_groups.append({
                            'group_label': f'车{_truck_seq}',
                            'so_number': so_number,
                            'zuogui_factory': '兴信',
                            'container_type': '',
                            'total_cbm': round(_cur_cbm, 3),
                            'delivery_date': _date,
                            'truck_remark': '；'.join(_bx_list),
                            'packing_list_items': _cur,
                        })

                logger.info(f'交仓分车: {len(_truck_groups)} 车, '
                            f'明细={[(g["group_label"], len(g["packing_list_items"]), g["total_cbm"]) for g in _truck_groups]}')

                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'warehouse',
                    'so_number': so_number,
                    'container_type': '',
                    'country': country,
                    'delivery_address': country,
                    'warehouse': warehouse or body_fields.get('warehouse', ''),
                    'ship_date': ship_date,
                    'packing_list_items': pl_items,
                    'zuogui_factory': '兴信',
                    'container_groups': _truck_groups,
                }
                # 跳过下面的多柜分组逻辑
                _wh_cg_values = []
                _skip_cg_branch = True
            elif _has_multi_pl_files:
                # 多 PL 文件按源文件拆 N 组（如 Family Dollar CFS 6 份 PL 对应 6 个 DC）
                from collections import OrderedDict as _OD2

                def _extract_dc_label(fn: str) -> str:
                    """从文件名提取 DC 名作为分组标签。
                    例 'packing list PL260500409 (...) 散 35.3CBM - 9590 MAQUOKETA IA - FDS-2610060.xlsx'
                        → '9590 MAQUOKETA IA'
                    fallback：截掉扩展名后整个文件名。"""
                    _m = re.search(r'-\s*(\d{4}\s+[A-Z][A-Z\s]+?)\s*-', fn)
                    if _m:
                        return _m.group(1).strip()
                    _base = fn.rsplit('.', 1)[0]
                    return _base

                _file_groups_od = _OD2()
                for it in pl_items:
                    _f = it.get('_source_file', '')
                    _file_groups_od.setdefault(_f, []).append(it)

                _file_split_groups = []
                for _fn, _gits in _file_groups_od.items():
                    for it in _gits:
                        it.pop('_container_group', None)
                        if it.get('volume') is not None:
                            try: it['volume'] = round(float(it['volume']), 3)
                            except (ValueError, TypeError): pass
                    _g_cbm = round(sum(_float(it.get('volume')) for it in _gits), 3)
                    _file_split_groups.append({
                        'group_label': _extract_dc_label(_fn),
                        'so_number': so_number,
                        'zuogui_factory': '兴信',
                        'container_type': '',
                        'total_cbm': _g_cbm,
                        'packing_list_items': _gits,
                    })

                logger.info(f'交仓多PL文件分组: {len(_file_split_groups)} 组, '
                            f'明细={[(g["group_label"], len(g["packing_list_items"]), g["total_cbm"]) for g in _file_split_groups]}')

                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'warehouse',
                    'so_number': so_number,
                    'container_type': '',
                    'country': country,
                    'delivery_address': country,
                    'warehouse': warehouse or body_fields.get('warehouse', ''),
                    'ship_date': ship_date,
                    'packing_list_items': pl_items,
                    'zuogui_factory': '兴信',
                    'container_groups': _file_split_groups,
                }
                _wh_cg_values = []
                _skip_cg_branch = True
            else:
                # 吨车 fallback 分车：无 _delivery_date 但 warehouse 总 CBM > 46
                # 按每条 item 的 CBM 平均切到 N 个车（每车 ≤46 CBM）
                # 注：warehouse 分支本身意味着吨车类型，truck_type 字段在 step 9 才设
                _total_pl_cbm = sum(_float(it.get('volume')) for it in pl_items)
                if _total_pl_cbm > 46.0:
                    import math as _math
                    _MAX_TRUCK_CBM = 46.0
                    _truck_groups = []
                    _truck_seq = 0
                    for it in pl_items:
                        _cbm = _float(it.get('volume'))
                        _pcs = int(it.get('pieces') or 0)
                        _qty = int(it.get('quantity') or 0)
                        if _cbm <= _MAX_TRUCK_CBM:
                            _truck_seq += 1
                            _truck_groups.append({
                                'group_label': f'车{_truck_seq}',
                                'so_number': so_number,
                                'zuogui_factory': '兴信',
                                'container_type': '',
                                'total_cbm': round(_cbm, 3),
                                'packing_list_items': [dict(it)],
                            })
                            continue
                        # 拆分到 N 个车
                        _n = int(_math.ceil(_cbm / _MAX_TRUCK_CBM))
                        for _i in range(_n):
                            _sub = dict(it)
                            _sub['volume'] = round(_cbm / _n, 3)
                            _sub['pieces'] = int(round(_pcs / _n)) if _pcs else 0
                            _sub['quantity'] = int(round(_qty / _n)) if _qty else 0
                            _truck_seq += 1
                            _truck_groups.append({
                                'group_label': f'车{_truck_seq}',
                                'so_number': so_number,
                                'zuogui_factory': '兴信',
                                'container_type': '',
                                'total_cbm': _sub['volume'],
                                'packing_list_items': [_sub],
                            })
                    logger.info(f'吨车 CBM 分车: {len(_truck_groups)} 车, '
                                f'总CBM={round(_total_pl_cbm, 3)}, 单车上限={_MAX_TRUCK_CBM}')
                    parsed = {
                        **body_fields,
                        'body_text': body,
                        'shipment_type': 'warehouse',
                        'so_number': so_number,
                        'container_type': '',
                        'country': country,
                        'delivery_address': country,
                        'warehouse': warehouse or body_fields.get('warehouse', ''),
                        'ship_date': ship_date,
                        'packing_list_items': pl_items,
                        'zuogui_factory': '兴信',
                        'container_groups': _truck_groups,
                    }
                    _wh_cg_values = []
                    _skip_cg_branch = True
                else:
                    _skip_cg_branch = False

            # 多柜分组检测（送仓也适用）—— 已用分车路径处理时跳过
            if _skip_cg_branch:
                _wh_cg_values = []
            else:
                _wh_cg_values = [it.get('_container_group') for it in pl_items if it.get('_container_group') is not None]
            if _skip_cg_branch:
                pass  # parsed 已在分车路径中构建
            elif _wh_cg_values and len(set(_wh_cg_values)) > 1:
                from collections import defaultdict as _wdd
                _wh_cg_map = _wdd(list)
                for it in pl_items:
                    _wh_cg_map[it.get('_container_group', 0)].append(it)
                _wh_cg_groups = []
                for _gi, (_gk, _gits) in enumerate(sorted(_wh_cg_map.items()), 1):
                    for it in _gits:
                        it.pop('_container_group', None)
                        if it.get('volume') is not None:
                            try: it['volume'] = round(float(it['volume']), 3)
                            except: pass
                    _g_cbm = round(sum(_float(it.get('volume')) for it in _gits), 3)
                    _wh_cg_groups.append({
                        'group_label': f'柜{_gi}',
                        'so_number': so_number,
                        'zuogui_factory': '兴信',
                        'container_type': '',
                        'total_cbm': _g_cbm,
                        'packing_list_items': _gits,
                    })
                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'warehouse',
                    'so_number': so_number,
                    'container_type': '',
                    'country': country,
                    'delivery_address': country,
                    'warehouse': warehouse or body_fields.get('warehouse', ''),
                    'ship_date': ship_date,
                    'packing_list_items': pl_items,
                    'zuogui_factory': '兴信',
                    'container_groups': _wh_cg_groups,
                }
            else:
                for it in pl_items:
                    it.pop('_container_group', None)
                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'warehouse',
                    'so_number': so_number,
                    'container_type': '',
                    'country': country,
                    'delivery_address': country,
                    'warehouse': warehouse or body_fields.get('warehouse', ''),
                    'ship_date': ship_date,
                    'packing_list_items': pl_items,
                    'zuogui_factory': '',
                }

        # ── 6D: 客上车 ───────────────────────────────────────────────────
        elif email_type == 'customer_truck':
            body_fields = parse_email_body(body)
            subject_fields = parse_email_body(subject)
            for field in ['si_deadline', 'cutoff_date', 'port']:
                if not body_fields.get(field) and subject_fields.get(field):
                    body_fields[field] = subject_fields[field]
            so_number = body_fields.get('so_number', '') or subject_fields.get('so_number', '')

            # 过滤：只保留兴信的货
            # 例外：附件名含"兴信提货"时为兴信整柜提货（含外厂送来兴信拼柜的货），保留全部
            _is_xingxin_pickup = any(
                '兴信提货' in (a.get('filename') or '') or '兴信提柜' in (a.get('filename') or '')
                for a in (pl_att_list or [])
            )
            if pl_items and not _is_xingxin_pickup:
                filtered = [it for it in pl_items if _is_xingxin(str(it.get('factory_remark') or ''))
                            or 'hanson' in str(it.get('factory_english') or '').lower()]
                pl_items = filtered if filtered else pl_items
            elif _is_xingxin_pickup:
                logger.info(f'客上车-兴信提货: 跳过外厂过滤，保留全部 {len(pl_items)} 条')
                # 把超长 factory_remark（误读的 PL 标题/地址文字）归一化为'兴信'
                for it in pl_items:
                    fr = str(it.get('factory_remark') or '')
                    if '兴信提货' in fr or '兴信提柜' in fr or len(fr) > 8:
                        it['factory_remark'] = '兴信'

            for it in pl_items:
                it.pop('_container_group', None)
                if it.get('volume') is not None:
                    try: it['volume'] = round(float(it['volume']), 3)
                    except (ValueError, TypeError): pass

            # 客上车分车：若 PL 行有 _truck_label（来自 F 列合并单元格），按 label 分组
            _has_truck_label = any(it.get('_truck_label') for it in pl_items)
            if _has_truck_label:
                from collections import OrderedDict as _OD
                _ct_groups = _OD()
                for it in pl_items:
                    _label = (it.get('_truck_label') or '').strip()
                    if not _label:
                        continue
                    _ct_groups.setdefault(_label, []).append(it)

                _truck_groups = []
                for _label, _gits in _ct_groups.items():
                    _g_cbm = round(sum((it.get('volume') or 0) for it in _gits), 3)
                    # 从 label 解析柜型 / 收货日期，例 "1*45'自备柜/5.13收" → "1*45'自备柜" 和 "5/13"
                    _ct_part, _date_part = '', ''
                    _m = re.match(r'\s*(\d+\s*\*\s*\S+?)\s*[/／]\s*(\d+(?:[.\d]+)?)\s*收', _label)
                    if _m:
                        _ct_part = _m.group(1).strip()
                        _date_part = _m.group(2).replace('.', '/')
                    _truck_groups.append({
                        'group_label': _label,
                        'so_number': so_number,
                        'zuogui_factory': '兴信',
                        'container_type': _ct_part,
                        'total_cbm': _g_cbm,
                        'delivery_date': _date_part,
                        'packing_list_items': _gits,
                    })

                logger.info(f'客上车分车: {len(_truck_groups)} 车, '
                            f'明细={[(g["group_label"], len(g["packing_list_items"]), g["total_cbm"]) for g in _truck_groups]}')

                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'customer_truck',
                    'so_number': so_number,
                    'container_type': body_fields.get('container_type', ''),
                    'port': body_fields.get('port', '') or subject_fields.get('port', ''),
                    'special_requirements': '客上车，送库有，深圳报关',
                    'packing_list_items': pl_items,
                    'zuogui_factory': '兴信',
                    'container_groups': _truck_groups,
                }
            else:
                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'customer_truck',
                    'so_number': so_number,
                    'container_type': body_fields.get('container_type', ''),
                    'port': body_fields.get('port', '') or subject_fields.get('port', ''),
                    'special_requirements': '客上车，送库有，深圳报关',
                    'packing_list_items': pl_items,
                    'zuogui_factory': '兴信',
                }

        # ── 6E: 整柜（FCL）──────────────────────────────────────────────
        else:  # fcl
            # 从主题解析 SO/柜型/做柜工厂
            subject_parsed = _parse_subject_fcl(subject)

            # 从正文/主题提取 SI/截数期/港口
            body_fields = parse_email_body(body)
            subject_fields = parse_email_body(subject)
            for field in ['si_deadline', 'cutoff_date', 'port']:
                if not body_fields.get(field) and subject_fields.get(field):
                    body_fields[field] = subject_fields[field]

            # SO 号：主题优先，其次 PDF，其次正文
            so_number = subject_parsed.get('so_number', '')
            if not so_number:
                so_number = pdf_data.get('so_number', '')
            if not so_number:
                so_number = body_fields.get('so_number', '')

            # 柜型：主题优先，其次 PDF，其次正文
            container_type = subject_parsed.get('container_type', '')
            if not container_type:
                container_type = body_fields.get('container_type', '')

            # PDF 补充截数期、SI截止、港口、国家
            if pdf_data.get('customs_cutoff'):
                body_fields['cutoff_date'] = pdf_data['customs_cutoff']
            if pdf_data.get('si_deadline'):
                body_fields['si_deadline'] = pdf_data['si_deadline']  # PDF 始终优先
            if pdf_data.get('port'):
                body_fields['port'] = pdf_data['port']  # PDF 订舱确认的装港优先于正文推断

            # 国家
            country = pdf_data.get('country', '') or body_fields.get('country', '')
            if not country:
                pod_m = re.search(r'Place\s*of\s*delivery[：:\s]*(\S+)', combined, re.IGNORECASE)
                if pod_m:
                    country = _port_to_country(pod_m.group(1).strip().rstrip(','))
            if not country:
                dp_m = re.search(r'Discharge\s*port[：:\s]*(\S+)', combined, re.IGNORECASE)
                if dp_m:
                    country = _port_to_country(dp_m.group(1).strip().rstrip(','))
            # 卸货港: FELIXSTOWE;UNITED KINGDOM 格式（邮件正文或PDF文本中）
            if not country:
                zxg_m = re.search(r'卸货港[：:\s]*([A-Z][A-Z\s]+?)(?:;|,|\n|$)', combined, re.IGNORECASE)
                if zxg_m:
                    country = _port_to_country(zxg_m.group(1).strip())
            if not country:
                # 卸货港后跟分号+国家名，如 FELIXSTOWE;UNITED KINGDOM
                zxg2_m = re.search(r'卸货港[：:\s]*[^;\n]+;\s*([A-Z][A-Z\s]+?)(?:\n|$)', combined, re.IGNORECASE)
                if zxg2_m:
                    country = _port_to_country(zxg2_m.group(1).strip())
            if not country:
                # 从主题 "TO UK/US/..." 提取
                to_m = re.search(r'\bTO\s+([A-Z]{2,3})\b', subject)
                if to_m:
                    country = COUNTRY_MAP.get(to_m.group(1).upper(), '')
            if not country:
                # AMZ/AMU + 国家代码（如 AMU IT / AMZ FR）
                amu_m = re.search(r'AM[ZU]\s+([A-Z]{2,3})\b', combined)
                if amu_m:
                    country = COUNTRY_MAP.get(amu_m.group(1).upper(), amu_m.group(1))

            # 整柜重复货号去重
            pl_items = _dedup_pl_items(pl_items, subject)

            # 做柜工厂：主题中已解析 → 否则从 PL/正文/CBM 推断
            zuogui_factory = subject_parsed.get('zuogui_factory', '')
            if not zuogui_factory:
                zuogui_factory = _detect_zuogui_factory(subject, body, pl_items)
            if zuogui_factory:
                zuogui_factory = _resolve_factory(zuogui_factory) or zuogui_factory

            # 多柜分组检测：PL 解析后有 _container_group 字段，按柜分组
            _cg_values = [it.get('_container_group') for it in pl_items if it.get('_container_group') is not None]
            if _cg_values and len(set(_cg_values)) > 1:
                from collections import defaultdict as _dd
                _cg_map = _dd(list)
                for it in pl_items:
                    _cg_map[it.get('_container_group', 0)].append(it)
                _cg_groups = []
                for _gi, (_gk, _gits) in enumerate(sorted(_cg_map.items()), 1):
                    for it in _gits:
                        it.pop('_container_group', None)
                        if it.get('volume') is not None:
                            try: it['volume'] = round(float(it['volume']), 3)
                            except: pass
                    _g_cbm = round(sum(_float(it.get('volume')) for it in _gits), 3)
                    _cg_groups.append({
                        'group_label': f'柜{_gi}',
                        'so_number': so_number,
                        'zuogui_factory': zuogui_factory,
                        'container_type': container_type,
                        'total_cbm': _g_cbm,
                        'packing_list_items': _gits,
                    })
                parsed = {
                    **body_fields,
                    'body_text': body,
                    'shipment_type': 'fcl',
                    'so_number': so_number,
                    'container_type': container_type,
                    'country': country,
                    'delivery_address': country,
                    'special_requirements': body_fields.get('special_requirements', ''),
                    'zuogui_factory': zuogui_factory,
                    'packing_list_items': pl_items,
                    'container_groups': _cg_groups,
                }
            else:
                for it in pl_items:
                    it.pop('_container_group', None)

                # 多工厂分组检测：仅在未触发多柜分组时执行，避免覆盖 container_groups
                # 做柜工厂 = CBM 最大的工厂；其他工厂只是货物来源，不是做柜方
                _distinct_factories = sorted(set(
                    it.get('factory_remark', '') for it in pl_items
                    if it.get('factory_remark')
                ))
                if len(_distinct_factories) > 1:
                    # 计算各工厂总 CBM，取最大者为做柜工厂
                    _factory_cbm_map = defaultdict(float)
                    for it in pl_items:
                        fr = it.get('factory_remark') or ''
                        if fr:
                            _factory_cbm_map[fr] += _float(it.get('volume'))
                    _zuogui = max(_factory_cbm_map, key=_factory_cbm_map.get) if _factory_cbm_map else zuogui_factory
                    if _zuogui:
                        zuogui_factory = _zuogui

                    if not _is_xingxin(zuogui_factory):
                        # 外厂做柜：只保留兴信的货物
                        xingxin_items = [it for it in pl_items
                                         if _is_xingxin(str(it.get('factory_remark') or ''))
                                         or 'hanson' in str(it.get('factory_english') or '').lower()]
                        for it in xingxin_items:
                            it['factory_remark'] = '兴信'
                            if it.get('volume') is not None:
                                try:
                                    it['volume'] = round(float(it['volume']), 3)
                                except (ValueError, TypeError):
                                    pass
                        xi_cbm = round(sum(_float(it.get('volume')) for it in xingxin_items), 3)
                        pl_items = xingxin_items
                        container_groups = [{
                            'group_label': f'{zuogui_factory}做柜',
                            'so_number': so_number,
                            'zuogui_factory': zuogui_factory,
                            'container_type': container_type,
                            'total_cbm': xi_cbm,
                            'packing_list_items': xingxin_items,
                        }]
                    else:
                        # 兴信做柜：不分组，直接展示所有货物
                        for it in pl_items:
                            if it.get('volume') is not None:
                                try:
                                    it['volume'] = round(float(it['volume']), 3)
                                except (ValueError, TypeError):
                                    pass
                        xi_cbm = round(sum(_float(it.get('volume')) for it in pl_items), 3)
                        container_groups = [{
                            'group_label': f'{zuogui_factory}做柜',
                            'so_number': so_number,
                            'zuogui_factory': zuogui_factory,
                            'container_type': container_type,
                            'total_cbm': xi_cbm,
                            'packing_list_items': pl_items,
                        }]
                    parsed = {
                        **body_fields,
                        'body_text': body,
                        'shipment_type': 'fcl',
                        'so_number': so_number,
                        'container_type': container_type,
                        'country': country,
                        'delivery_address': country,
                        'special_requirements': body_fields.get('special_requirements', ''),
                        'zuogui_factory': zuogui_factory,
                        'packing_list_items': pl_items,
                        'container_groups': container_groups,
                    }
                else:
                    # 单工厂路径（兴信做柜 或 外厂做柜）
                    pl_items = _filter_pl_items(pl_items, zuogui_factory, body)

                    # 外厂做柜时清空特殊要求（拉网/拍照/立放只在兴信自身做柜时需要）
                    special_requirements = body_fields.get('special_requirements', '')
                    if zuogui_factory and not _is_xingxin(zuogui_factory):
                        special_requirements = ''

                    parsed = {
                        **body_fields,
                        'body_text': body,
                        'shipment_type': 'fcl',
                        'so_number': so_number,
                        'container_type': container_type,
                        'country': country,
                        'delivery_address': country,
                        'special_requirements': special_requirements,
                        'zuogui_factory': zuogui_factory,
                        'packing_list_items': pl_items,
                    }

        # ── 7. 通用补充字段 ──────────────────────────────────────────────────

        # SI → 出货时间（前一天）
        si = parsed.get('si_deadline', '')
        if si:
            si_m = re.match(r'(\d{1,2})/(\d{1,2})', si)
            if si_m and not parsed.get('ship_date'):
                from datetime import datetime, timedelta
                try:
                    si_dt = datetime(datetime.now().year, int(si_m.group(1)), int(si_m.group(2)))
                    ship_dt = si_dt - timedelta(days=1)
                    parsed['ship_date'] = f'{ship_dt.month}/{ship_dt.day}'
                except ValueError:
                    pass

        # PDF SO 补充（仅当尚无 SO）
        if not parsed.get('so_number') and pdf_data.get('so_number'):
            parsed['so_number'] = pdf_data['so_number']

        # Word 仓库补充
        if word_data.get('so_number') and not parsed.get('so_number'):
            parsed['so_number'] = word_data['so_number']

        # ── 8. CBM 计算 ──────────────────────────────────────────────────────
        factory_cbm = defaultdict(float)
        total_cbm = 0.0
        for item in parsed.get('packing_list_items', []):
            vol = item.get('volume')
            if vol is None or vol == '':
                continue
            try:
                v = float(vol)
            except (ValueError, TypeError):
                continue
            total_cbm += v
            # factory_remark 已经过 _assign_factory_remark 解析为短名（如"兴信"），优先使用
            fk_raw = (
                item.get('factory_remark') or item.get('factory_short')
                or item.get('main_factory') or item.get('factory_english') or '未知'
            )
            fk = _resolve_factory(str(fk_raw).strip()) or str(fk_raw).strip()
            factory_cbm[fk] = round(factory_cbm[fk] + v, 3)

        parsed['total_cbm'] = round(total_cbm, 3)
        parsed['factory_cbm'] = dict(factory_cbm)

        # 体积统一三位小数
        for item in parsed.get('packing_list_items', []):
            vol = item.get('volume')
            if vol is not None and vol != '':
                try:
                    item['volume'] = round(float(vol), 3)
                except (ValueError, TypeError):
                    pass

        # ── 9. 吨车类型 ──────────────────────────────────────────────────────
        ct = parsed.get('container_type', '')
        if not ct or parsed.get('shipment_type') == 'warehouse':
            truck = determine_truck_type(total_cbm)
            parsed['truck_type'] = truck
            if parsed.get('shipment_type') == 'warehouse' and truck:
                parsed['container_type'] = truck
        else:
            parsed['truck_type'] = ''

        # ── 10. 柜号分配 ─────────────────────────────────────────────────────
        ct = parsed.get('container_type', '')
        is_cabinet = bool(ct) and not ct.upper().endswith('T')
        if is_cabinet:
            from apps.master_data.models import Customer as _Customer
            customer_name = 'ZURU'
            try:
                cust = _Customer.objects.get(name=customer_name)
                cab_num = cust.next_cabinet_number()
                parsed['cabinet_number'] = cab_num
                parsed['cabinet_title'] = f'{parsed.get("port", "")} {customer_name} {cab_num} 柜'
            except _Customer.DoesNotExist:
                pass

        # ── 10.5. TJX body PL 多柜分组注入 ────────────────────────────────────
        # 若 body 解析出 TJX 简化格式多柜分组，覆盖 container_groups
        # 兴信做柜柜整柜保留；外厂做柜柜只保留 factory_remark=兴信 的货
        if body_tjx_groups:
            tjx_cgs = []
            grand_total = 0.0
            for g in body_tjx_groups:
                zg = g['zuogui_factory']
                if _is_xingxin(zg):
                    items = g['items']
                else:
                    items = [it for it in g['items'] if '兴信' in (it.get('factory_remark') or '')]
                if not items:
                    continue
                # 标准化 factory_remark（外厂做柜柜中保留的货统一标兴信）
                if not _is_xingxin(zg):
                    for it in items:
                        it['factory_remark'] = '兴信'
                cbm = round(sum(float(it.get('volume') or 0) for it in items), 3)
                tjx_cgs.append({
                    'group_label': f'{zg}做柜 {g["container_type"]} SO#{g["so_number"]}',
                    'so_number': g['so_number'],
                    'zuogui_factory': zg,
                    'container_type': g['container_type'],
                    'total_cbm': cbm,
                    'packing_list_items': items,
                })
                grand_total += cbm
            if tjx_cgs:
                parsed['container_groups'] = tjx_cgs
                parsed['packing_list_items'] = tjx_cgs[0]['packing_list_items']
                parsed['so_number'] = tjx_cgs[0]['so_number']
                parsed['container_type'] = tjx_cgs[0]['container_type']
                parsed['zuogui_factory'] = tjx_cgs[0]['zuogui_factory']
                parsed['total_cbm'] = round(grand_total, 3)
                parsed['shipment_type'] = 'fcl'

        # ── 11. 保存记录 ─────────────────────────────────────────────────────
        record = EmailRecord.objects.create(
            message_id=eml_data.get('message_id', ''),
            subject=eml_data['subject'],
            sender=eml_data['sender'],
            received_at=eml_data.get('received_at'),
            body_text=eml_data['body_text'],
            parsed_data=parsed,
            attachments=[{'filename': a['filename'], 'path': a['saved_path']} for a in att_list],
            status=EmailRecord.Status.PARSED,
        )

        return {
            'email_record_id': record.id,
            'parsed': parsed,
        }

    except Exception as e:
        logger.error(f'邮件解析失败: {e}', exc_info=True)
        raise


# ── HTTP 入口 ─────────────────────────────────────────────────────────────────

@api_view(['POST'])
@parser_classes([MultiPartParser])
def import_email(request):
    """上传 .eml 文件 → 解析。"""
    eml_file = request.FILES.get('eml_file')
    if not eml_file:
        return Response({'error': '请上传.eml文件'}, status=status.HTTP_400_BAD_REQUEST)

    tmp_dir = os.path.join(settings.MEDIA_ROOT, 'tmp_eml')
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f'{uuid.uuid4().hex}.eml')
    with open(tmp_path, 'wb') as f:
        for chunk in eml_file.chunks():
            f.write(chunk)
    try:
        result = _run_import_pipeline(tmp_path)
        return Response(result)
    except Exception as e:
        return Response({'error': f'解析失败: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


class EmailRecordListView(ListAPIView):
    queryset = EmailRecord.objects.all().order_by('-created_at')
    serializer_class = EmailRecordSerializer


@api_view(['DELETE'])
def delete_email(request, pk):
    """删除邮件记录。"""
    try:
        record = EmailRecord.objects.get(pk=pk)
        record.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    except EmailRecord.DoesNotExist:
        return Response({'error': '记录不存在'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_parse_email(request):
    """触发 AI 解析：接收 eml 文件，返回带置信度的 JSON 供前端审核。"""
    eml_file = request.FILES.get('eml_file')
    if not eml_file:
        return Response({'error': '请上传 eml 文件'}, status=400)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.eml') as tmp:
        for chunk in eml_file.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        eml_data = parse_eml_file(tmp_path)
        attachments = eml_data.get('attachments', [])
        from .ai_parser.graph import run_ai_parser; result = run_ai_parser(eml_data, attachments)
        return Response(result)
    except Exception as e:
        return Response({'error': str(e)}, status=500)
    finally:
        os.unlink(tmp_path)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_parse_confirm(request):
    """用户在前端审核面板确认后，创建出货单。"""
    data = request.data
    fields = data.get('fields', {})
    items = data.get('items', [])

    parsed = {
        'so_number': fields.get('so_number', {}).get('value', ''),
        'container_type': fields.get('container_type', {}).get('value', ''),
        'si_deadline': fields.get('si_deadline', {}).get('value', ''),
        'cutoff_date': fields.get('cutoff_date', {}).get('value', ''),
        'ship_date': fields.get('ship_date', {}).get('value', ''),
        'port': fields.get('port', {}).get('value', ''),
        'country': fields.get('country', {}).get('value', ''),
        'customs_broker': fields.get('customs_broker', {}).get('value', ''),
        'special_requirements': fields.get('special_requirements', {}).get('value', ''),
        'zuogui_factory': data.get('zuogui_factory', '兴信'),
        'shipment_type': data.get('shipment_type', 'fcl'),
        'packing_list_items': items,
    }

    try:
        from apps.shipments.views import _create_shipment_from_parsed
        shipment = _create_shipment_from_parsed(parsed, request.user)
        return Response({'shipment_id': shipment.id}, status=201)
    except Exception as e:
        return Response({'error': str(e)}, status=500)



@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def mailbox_config(request):
    """GET: 返回当前用户是否已配置邮箱。
    POST: 验证连接后保存加密凭据。
    """
    from apps.accounts.models import UserMailboxConfig
    from .imap_service import test_connection
    from .serializers import MailboxConfigSerializer

    if request.method == 'GET':
        try:
            cfg = request.user.mailbox_config
            return Response({
                'configured': True,
                'email': cfg.email,
                'imap_host': cfg.imap_host,
            })
        except UserMailboxConfig.DoesNotExist:
            return Response({'configured': False})

    # POST
    serializer = MailboxConfigSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    host = serializer.validated_data.get('imap_host', 'mail.hanson2.com')
    port = serializer.validated_data.get('imap_port', 993)
    mail_user = serializer.validated_data['email']
    password = serializer.validated_data['password']

    try:
        test_connection(host, port, mail_user, password)
    except Exception as e:
        return Response({'error': f'连接失败: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

    cfg, _ = UserMailboxConfig.objects.get_or_create(user=request.user)
    cfg.imap_host = host
    cfg.imap_port = port
    cfg.email = mail_user
    cfg.set_password(password)
    cfg.save()

    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mailbox_search(request):
    """用 IMAP SEARCH 搜索当前用户邮箱。"""
    from apps.emails.imap_service import search_emails
    try:
        cfg = request.user.mailbox_config
    except Exception:
        return Response({'error': '请先配置邮箱'}, status=403)

    folder = request.data.get('folder', 'INBOX')
    subject = request.data.get('subject', '')
    sender = request.data.get('sender', '')
    date_from = request.data.get('date_from', '')
    date_to = request.data.get('date_to', '')

    try:
        emails_list, folder_used = search_emails(
            cfg.imap_host, cfg.imap_port, cfg.email, cfg.get_password(),
            folder=folder, subject=subject, sender=sender,
            date_from=date_from, date_to=date_to,
        )
        return Response({'emails': emails_list, 'total': len(emails_list), 'folder_used': folder_used})
    except Exception as e:
        return Response({'error': str(e)}, status=500)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mailbox_import(request):
    """批量下载指定 UID 的邮件并解析。"""
    from apps.emails.imap_service import fetch_email_bytes as fetch_email_raw
    try:
        cfg = request.user.mailbox_config
    except Exception:
        return Response({'error': '请先配置邮箱'}, status=403)

    uids = request.data.get('uids', [])
    folder = request.data.get('folder', 'INBOX')
    mode = request.data.get('mode', 'rule')  # 'rule' or 'ai'

    if not uids:
        return Response({'error': '请选择邮件'}, status=400)

    results = []
    for uid in uids:
        try:
            eml_bytes = fetch_email_raw(cfg.imap_host, cfg.imap_port, cfg.email, cfg.get_password(), folder, uid)
            with tempfile.NamedTemporaryFile(delete=False, suffix='.eml') as tmp:
                tmp.write(eml_bytes)
                tmp_path = tmp.name
            try:
                if mode == 'ai':
                    eml_data = parse_eml_file(tmp_path)
                    attachments = eml_data.get('attachments', [])
                    from .ai_parser.graph import run_ai_parser; parsed = run_ai_parser(eml_data, attachments)
                    results.append({'uid': uid, 'ok': True, 'parsed': parsed})
                else:
                    result = _run_import_pipeline(tmp_path)
                    results.append({'uid': uid, 'ok': True, **result})
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        except Exception as e:
            results.append({'uid': uid, 'ok': False, 'error': str(e)})

    return Response({'results': results})
