"""LangGraph 各节点函数实现。"""

import json
import re
import pdfplumber
import openpyxl
from dataclasses import dataclass, field
from typing import Optional

import os
import requests as _requests

from .prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, JSON_SCHEMA


@dataclass
class TextBlock:
    source_file: str
    page: Optional[int]
    row: Optional[int]
    text: str


@dataclass
class ParserState:
    # 输入
    eml_data: dict = field(default_factory=dict)
    attachments: list = field(default_factory=list)
    # Node1 输出
    text_blocks: list = field(default_factory=list)
    # Node2 输出
    shipment_type: str = ''
    zuogui_factory: str = ''
    # Node3 输出
    ai_result: dict = field(default_factory=dict)
    ai_error: str = ''
    # Node4 输出
    normalized: dict = field(default_factory=dict)
    # 最终输出
    final: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Node 1: 内容提取
# ---------------------------------------------------------------------------

def node_extract(state: ParserState) -> ParserState:
    """从邮件正文和所有附件提取带位置信息的文本块。"""
    blocks = []

    # 正文按行提取
    body = state.eml_data.get('body_text', '')
    for i, line in enumerate(body.splitlines(), 1):
        if line.strip():
            blocks.append(TextBlock(source_file='正文', page=None, row=i, text=line.strip()))

    # 邮件主题
    subject = state.eml_data.get('subject', '')
    if subject:
        blocks.append(TextBlock(source_file='正文主题', page=None, row=1, text=subject))

    # 附件
    for att in state.attachments:
        path = att.get('saved_path', '')
        fname = att.get('filename', '')
        if not path:
            continue
        if fname.lower().endswith('.pdf'):
            blocks.extend(_extract_pdf(path, fname))
        elif fname.lower().endswith(('.xlsx', '.xls')):
            blocks.extend(_extract_excel(path, fname))

    state.text_blocks = blocks
    return state


def _extract_pdf(path: str, fname: str) -> list:
    blocks = []
    try:
        with pdfplumber.open(path) as pdf:
            for page_num, page in enumerate(pdf.pages[:5], 1):  # 只读前5页
                text = page.extract_text() or ''
                for row_num, line in enumerate(text.splitlines(), 1):
                    if line.strip():
                        blocks.append(TextBlock(
                            source_file=fname, page=page_num,
                            row=row_num, text=line.strip()
                        ))
    except Exception:
        pass
    return blocks


def _extract_excel(path: str, fname: str) -> list:
    blocks = []
    try:
        wb = openpyxl.load_workbook(path, data_only=True)
        for sheet in wb.worksheets:
            for row_num, row in enumerate(sheet.iter_rows(), 1):
                cells = [str(c.value).strip() for c in row if c.value is not None]
                if cells:
                    blocks.append(TextBlock(
                        source_file=f'{fname}[{sheet.title}]',
                        page=None, row=row_num,
                        text=' | '.join(cells)
                    ))
    except Exception:
        pass
    return blocks


# ---------------------------------------------------------------------------
# Node 2: 邮件类型判断
# ---------------------------------------------------------------------------

def node_classify(state: ParserState) -> ParserState:
    """根据附件和正文判断邮件类型和做柜工厂。"""
    subject = state.eml_data.get('subject', '')
    body = state.eml_data.get('body_text', '')
    fnames = [a.get('filename', '') for a in state.attachments]

    if any(f.upper().startswith('YAX') and f.lower().endswith(('.xlsx', '.xls')) for f in fnames):
        state.shipment_type = 'customer_load'
    elif any(kw in subject + body for kw in ['交仓', 'CFS', '散货收货站', 'warehouse']):
        state.shipment_type = 'warehouse'
    elif 'TJX' in (subject + body).upper() and re.search(r'柜[12]|container\s*[12]', subject + body, re.IGNORECASE):
        state.shipment_type = 'tjx_multi'
    else:
        state.shipment_type = 'fcl'

    zuogui_match = re.search(r'([\u4e00-\u9fff]{2,4})做柜', subject + body)
    if zuogui_match:
        factory = zuogui_match.group(1)
        # 去掉常见前置介词（"由兴信做柜" → "兴信"）
        factory = re.sub(r'^[由是被]', '', factory)
        state.zuogui_factory = factory or '兴信'
    else:
        state.zuogui_factory = '兴信'

    print(f'[classify] type={state.shipment_type} zuogui={state.zuogui_factory} fnames={fnames}', flush=True)
    return state


# ---------------------------------------------------------------------------
# Node 3: Claude AI 提取
# ---------------------------------------------------------------------------

def node_ai_extract(state: ParserState) -> ParserState:
    """调用 Claude API，强制 JSON 输出。"""
    # 只取头部字段需要的内容（正文+主题+PDF），跳过 Excel 数据（Excel 明细直接用解析器处理）
    excel_sources = set()
    for att in state.attachments:
        fname = att.get('filename', '')
        if fname.lower().endswith(('.xlsx', '.xls')):
            excel_sources.add(fname)
            excel_sources.add(f'{fname}[')

    pdf_blocks = [b for b in state.text_blocks if 'pdf' in b.source_file.lower()]
    body_blocks = [b for b in state.text_blocks
                   if not any(b.source_file.startswith(s) for s in excel_sources)
                   and 'pdf' not in b.source_file.lower()]
    # PDF 优先，正文次之，限制总 token
    ordered = pdf_blocks + body_blocks

    content_lines = []
    for b in ordered[:60]:  # 只取60行头部信息，AI只需提取字段，加快响应
        loc = f'[{b.source_file}'
        if b.page:
            loc += f' 第{b.page}页'
        if b.row:
            loc += f' 第{b.row}行'
        loc += ']'
        content_lines.append(f'{loc} {b.text}')

    content_text = '\n'.join(content_lines)
    filter_rule = '只保留 factory_short=DG Hanson 的货物' if '兴信' not in state.zuogui_factory else '保留全部货物'

    user_msg = USER_PROMPT_TEMPLATE.format(
        shipment_type=state.shipment_type,
        zuogui_factory=state.zuogui_factory,
        filter_rule=filter_rule,
        content_blocks=content_text,
        json_schema=JSON_SCHEMA,
    )

    try:
        api_key = os.environ.get('DEEPSEEK_API_KEY', '')
        if not api_key:
            state.ai_error = 'DEEPSEEK_API_KEY 未配置'
            return state
        resp = _requests.post(
            'https://api.deepseek.com/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': 'deepseek-chat',
                'max_tokens': 1024,
                'messages': [
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': user_msg},
                ],
            },
            timeout=(10, 30),  # 10秒连接超时，30秒读取超时
        )
        resp.raise_for_status()
        raw = resp.json()['choices'][0]['message']['content'].strip()
        json_match = re.search(r'\{[\s\S]*\}', raw)
        if json_match:
            state.ai_result = json.loads(json_match.group())
        else:
            state.ai_error = '无法提取 JSON'
    except Exception as e:
        state.ai_error = str(e)

    return state


# ---------------------------------------------------------------------------
# Node 4: 调用 normalizer
# ---------------------------------------------------------------------------

def node_normalize(state: ParserState) -> ParserState:
    from .normalizer import normalize_result
    state.normalized = normalize_result(state.ai_result, state.shipment_type, state.zuogui_factory)
    return state


# ---------------------------------------------------------------------------
# Node 5: 组装最终输出
# ---------------------------------------------------------------------------

def node_finalize(state: ParserState) -> ParserState:
    items = state.normalized.get('items', [])

    # 若 AI 未提取到明细，直接用现有 Excel 解析器解析 packing list 附件
    if not items:
        items = _parse_items_from_attachments(state.attachments, state.zuogui_factory)

    fields = state.normalized.get('fields', {})

    # customer_load 类型：从 YAX Excel 补全 AI 无法提取的字段（柜型、报关行）
    if state.shipment_type == 'customer_load':
        _fill_from_yax(fields, state.attachments)

    state.final = {
        'shipment_type': state.shipment_type,
        'zuogui_factory': state.zuogui_factory,
        'fields': fields,
        'items': items,
        'ai_error': state.ai_error,
    }
    return state


def _fill_from_yax(fields: dict, attachments: list) -> None:
    """对 customer_load 类型，用 YAX Excel 补全 AI 未能提取到的字段。"""
    from apps.emails.parsers.excel_parser import parse_yax_excel
    from .normalizer import _normalize_si, _calc_ship_date
    for att in attachments:
        fname = att.get('filename', '')
        path = att.get('saved_path', '')
        if not path or not fname.upper().startswith('YAX'):
            continue
        try:
            yax = parse_yax_excel(path)
            # 柜型：YAX 最可靠，直接覆盖（AI 无法从被排除的 Excel 中读到）
            ct = yax.get('container_type', '')
            if ct:
                fields['container_type'] = _make_yax_field(ct, fname)
            # 报关行：仅在 AI 未提取时补全
            if not fields.get('customs_broker', {}).get('value'):
                broker = yax.get('customs_broker', '')
                if broker:
                    fields['customs_broker'] = _make_yax_field(broker, fname)
            # SI截止：YAX Excel 最可靠，直接覆盖 AI 值（AI 从正文提取容易出错）
            si_raw = yax.get('si_deadline', '')
            if si_raw:
                si_normalized = _normalize_si(str(si_raw))
                if si_normalized:
                    fields['si_deadline'] = _make_yax_field(si_normalized, fname)
                    # 同步重算出货时间
                    ship_val = _calc_ship_date(si_normalized)
                    if ship_val:
                        f = _make_yax_field(ship_val, fname)
                        f['manual_override'] = True
                        fields['ship_date'] = f
        except Exception:
            pass
        break  # 只用第一个 YAX 文件


def _make_yax_field(value: str, fname: str) -> dict:
    return {
        'value': value,
        'source_file': fname,
        'page': None,
        'row': None,
        'evidence': value,
        'confidence': 1.0,
        'confidence_level': 'green',
        'manual_override': False,
    }


def _parse_items_from_attachments(attachments: list, zuogui_factory: str) -> list:
    """直接用现有 Excel 解析器从附件中提取货物明细。"""
    from apps.emails.parsers.excel_parser import parse_packing_list
    print(f'[AI-items] 附件列表: {[(a.get("filename",""), a.get("saved_path","")) for a in attachments]}', flush=True)
    items = []
    for att in attachments:
        fname = att.get('filename', '')
        path = att.get('saved_path', '')
        if not path or not fname.lower().endswith(('.xlsx', '.xls')):
            continue
        # 跳过 YAX 开头的 booking Excel（不是 packing list）
        if fname.upper().startswith('YAX'):
            continue
        try:
            pl_items = parse_packing_list(path)
            print(f'[AI-items] {fname} → {len(pl_items)} 条', flush=True)
            for item in pl_items:
                # 过滤非整柜数据（CBM 小于 1 的行通常是散货/余货）
                cbm_val = item.get('volume') or item.get('cbm') or 0
                try:
                    cbm_val = float(cbm_val)
                except (TypeError, ValueError):
                    cbm_val = 0
                # 本厂做柜（兴信）：保留全部条目（包括外厂货物），不过滤小CBM
                # 外厂做柜：过滤掉小CBM的散货/余货行
                if '兴信' not in (zuogui_factory or '') and cbm_val < 1.0:
                    continue
                # 外厂做柜：只保留兴信的货
                if zuogui_factory and '兴信' not in zuogui_factory:
                    factory_str = str(item.get('factory_english') or item.get('factory_short') or '').upper()
                    if 'HANSON' not in factory_str and 'DG' not in factory_str:
                        continue
                # 工厂简称：优先 supplier（通常含中文简称）；英文名通过数据库映射；兜底保留英文
                _fe = str(item.get('factory_english') or '').strip()
                _sup = str(item.get('supplier') or '').strip()
                _fs = str(item.get('factory_short') or '').strip()
                _rmk = str(item.get('remark') or '').strip()
                # 1. supplier 有中文内容→直接使用
                if _sup and _sup.upper() not in ('SUPPLIER NAME', ''):
                    factory_short = _sup
                elif _fe:
                    # 2. 英文工厂名→尝试数据库映射
                    try:
                        from apps.emails.views import _resolve_factory
                        _mapped = _resolve_factory(_fe)
                        factory_short = _mapped if _mapped and _mapped != _fe else (_fs or _fe)
                    except Exception:
                        factory_short = _fs or _fe
                else:
                    factory_short = _fs or _rmk or ''
                items.append({
                    'product_code': item.get('product_code', ''),
                    'contract_number': item.get('contract_number', ''),
                    'pieces': item.get('pieces'),
                    'quantity': item.get('quantity'),
                    'volume': round(cbm_val, 3),   # 用 'volume' 与 views.py 对齐
                    'customer_po': item.get('customer_po', ''),
                    'gross_weight_per_box': item.get('gross_weight_per_box'),
                    'net_weight_per_box': item.get('net_weight_per_box'),
                    'factory_short': factory_short,
                    'factory_remark': factory_short,  # 直接作为柜单备注列使用
                    'cargo_receipt': item.get('cargo_receipt', ''),
                    'source_file': fname,
                    'row': item.get('row'),
                    'confidence': 0.95,
                    'confidence_level': 'green',
                })
        except Exception as e:
            print(f'[AI-items] {fname} 解析失败: {e}', flush=True)
    return items
