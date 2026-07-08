"""提单功能视图 — 找提单 / 核对提单"""

import re
from datetime import date as _date
from decimal import Decimal

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Shipment, ShipmentItem, BillOfLadingRecord
from apps.emails.models import EmailRecord


# ── 搜索 ──────────────────────────────────────────────────────────────────────

@api_view(['POST'])
def search_bl(request):
    """在已创建的出货明细中搜索，按出货单分组返回结果。

    请求体（至少填一项）：
      product_code    货号（模糊）
      contract_number 合同号（模糊）
      email_subject   邮件主题关键词（模糊）
      pieces          件数（精确）
      cbm             CBM（精确，允许 ±0.001 误差）
    """
    product_code = (request.data.get('product_code') or '').strip()
    contract_number = (request.data.get('contract_number') or '').strip()
    email_subject_kw = (request.data.get('email_subject') or '').strip()
    pieces_str = request.data.get('pieces')
    cbm_str = request.data.get('cbm')

    if not any([product_code, contract_number, email_subject_kw, pieces_str, cbm_str]):
        return Response({'error': '请至少填写一个搜索条件'}, status=400)

    qs = ShipmentItem.objects.select_related('shipment').all()

    if product_code:
        qs = qs.filter(product_code__icontains=product_code)
    if contract_number:
        qs = qs.filter(contract_number__icontains=contract_number)
    if pieces_str:
        try:
            qs = qs.filter(pieces=int(pieces_str))
        except (ValueError, TypeError):
            pass
    if cbm_str:
        try:
            cbm_val = Decimal(str(cbm_str))
            qs = qs.filter(volume__range=(cbm_val - Decimal('0.001'), cbm_val + Decimal('0.001')))
        except Exception:
            pass

    # 按邮件主题关键词过滤：通过 source_email_id 反查 EmailRecord
    shipment_ids_by_subject = None
    if email_subject_kw:
        matched_emails = EmailRecord.objects.filter(subject__icontains=email_subject_kw)
        matched_email_ids = set(str(e.id) for e in matched_emails)
        # source_email_id 可能是逗号分隔的多个 ID
        candidate_sids = set()
        for s in Shipment.objects.filter(source_email_id__gt='').values('id', 'source_email_id'):
            for eid in s['source_email_id'].split(','):
                if eid.strip() in matched_email_ids:
                    candidate_sids.add(s['id'])
                    break
        shipment_ids_by_subject = candidate_sids
        qs = qs.filter(shipment_id__in=candidate_sids) if candidate_sids else qs.none()

    # 按出货单分组
    groups = {}
    for item in qs.order_by('shipment_id', 'seq_number'):
        sid = item.shipment_id
        if sid not in groups:
            s = item.shipment
            # 获取邮件主题
            email_subj = ''
            if s.source_email_id:
                for eid in s.source_email_id.split(','):
                    try:
                        er = EmailRecord.objects.get(id=int(eid.strip()))
                        email_subj = er.subject
                        break
                    except (EmailRecord.DoesNotExist, ValueError):
                        pass
            # 生成文件名：XX车 XX柜
            file_name = _make_file_name(s)
            groups[sid] = {
                'shipment_id': sid,
                'file_name': file_name,
                'cabinet_title': s.remarks or '',
                'container_type': s.container_type or '',
                'container_number': s.container_number or '',
                'so_number': s.so_number or '',
                'email_subject': email_subj,
                'ship_date': str(s.ship_date) if s.ship_date else '',
                'items': [],
                'total_cbm': 0.0,
                'total_pieces': 0,
                'already_saved': BillOfLadingRecord.objects.filter(shipment_id=sid).exists(),
            }
        groups[sid]['items'].append({
            'id': item.id,
            'product_code': item.product_code,
            'product_name': item.product_name,
            'contract_number': item.contract_number,
            'pieces': item.pieces,
            'volume': float(item.volume) if item.volume else 0,
            'quantity': item.quantity,
            'gross_weight': float(item.gross_weight) if item.gross_weight else 0,
            'net_weight': float(item.net_weight) if item.net_weight else 0,
        })
        if item.volume:
            groups[sid]['total_cbm'] = round(groups[sid]['total_cbm'] + float(item.volume), 3)
        if item.pieces:
            groups[sid]['total_pieces'] += item.pieces

    return Response({'groups': list(groups.values())})


def _make_file_name(shipment: Shipment) -> str:
    """根据出货单生成提单文件名：XX车/XX柜"""
    ct = shipment.container_type or ''
    cab = shipment.remarks or shipment.container_number or ''

    # 去掉 cabinet_title 中的前缀，只保留核心部分
    # remarks 格式: "盐田 ZURU 0001 柜" → 取 "0001 柜"
    cab_clean = cab
    m = re.search(r'(\d+\s*柜)', cab)
    if m:
        cab_clean = m.group(1).strip()

    if ct:
        return f'{ct} {cab_clean}'.strip()
    return cab_clean or f'出货单#{shipment.id}'


# ── 保存 ──────────────────────────────────────────────────────────────────────

@api_view(['POST'])
def save_bl(request):
    """保存提单记录。

    请求体：
      shipment_id   int
      file_name     str（可选，不传则自动生成）
      email_subject str（可选）
    """
    shipment_id = request.data.get('shipment_id')
    if not shipment_id:
        return Response({'error': '缺少 shipment_id'}, status=400)

    try:
        shipment = Shipment.objects.prefetch_related('items').get(id=shipment_id)
    except Shipment.DoesNotExist:
        return Response({'error': '出货单不存在'}, status=404)

    file_name = (request.data.get('file_name') or '').strip() or _make_file_name(shipment)
    email_subject = (request.data.get('email_subject') or '').strip()

    # 快照当前所有明细
    items_snapshot = []
    total_cbm = Decimal('0')
    total_pieces = 0
    for item in shipment.items.order_by('seq_number'):
        items_snapshot.append({
            'product_code': item.product_code,
            'product_name': item.product_name,
            'contract_number': item.contract_number,
            'pieces': item.pieces,
            'volume': float(item.volume) if item.volume else 0,
            'quantity': item.quantity,
            'gross_weight': float(item.gross_weight) if item.gross_weight else 0,
            'net_weight': float(item.net_weight) if item.net_weight else 0,
            'spec': item.spec,
        })
        if item.volume:
            total_cbm += item.volume
        if item.pieces:
            total_pieces += item.pieces

    bl = BillOfLadingRecord.objects.create(
        file_name=file_name,
        shipment=shipment,
        email_subject=email_subject or _get_email_subject(shipment),
        items_snapshot=items_snapshot,
        total_cbm=round(total_cbm, 3),
        total_pieces=total_pieces,
        created_by=request.user if request.user.is_authenticated else None,
    )
    return Response({
        'id': bl.id,
        'file_name': bl.file_name,
        'total_cbm': float(bl.total_cbm) if bl.total_cbm else 0,
        'total_pieces': bl.total_pieces,
        'item_count': len(items_snapshot),
        'created_at': bl.created_at.strftime('%Y-%m-%d %H:%M'),
    }, status=201)


def _get_email_subject(shipment: Shipment) -> str:
    if not shipment.source_email_id:
        return ''
    for eid in shipment.source_email_id.split(','):
        try:
            return EmailRecord.objects.get(id=int(eid.strip())).subject
        except (EmailRecord.DoesNotExist, ValueError):
            pass
    return ''


# ── 列表 / 详情 / 删除 ────────────────────────────────────────────────────────

@api_view(['GET'])
def list_bl(request):
    """返回所有保存的提单记录（最新100条）。"""
    qs = BillOfLadingRecord.objects.select_related('shipment')[:100]
    data = []
    for r in qs:
        data.append({
            'id': r.id,
            'file_name': r.file_name,
            'email_subject': r.email_subject,
            'total_cbm': float(r.total_cbm) if r.total_cbm else 0,
            'total_pieces': r.total_pieces or 0,
            'item_count': len(r.items_snapshot),
            'verified': r.verified,
            'shipment_id': r.shipment_id,
            'so_number': r.shipment.so_number if r.shipment else '',
            'container_type': r.shipment.container_type if r.shipment else '',
            'created_at': r.created_at.strftime('%Y-%m-%d %H:%M'),
        })
    return Response({'records': data})


@api_view(['GET', 'DELETE'])
def bl_detail(request, pk):
    """提单记录详情或删除。"""
    try:
        bl = BillOfLadingRecord.objects.select_related('shipment').get(pk=pk)
    except BillOfLadingRecord.DoesNotExist:
        return Response({'error': '记录不存在'}, status=404)

    if request.method == 'DELETE':
        bl.delete()
        return Response({'ok': True})

    return Response({
        'id': bl.id,
        'file_name': bl.file_name,
        'email_subject': bl.email_subject,
        'items_snapshot': bl.items_snapshot,
        'total_cbm': float(bl.total_cbm) if bl.total_cbm else 0,
        'total_pieces': bl.total_pieces or 0,
        'verified': bl.verified,
        'verify_discrepancies': bl.verify_discrepancies,
        'shipment_id': bl.shipment_id,
        'so_number': bl.shipment.so_number if bl.shipment else '',
        'container_type': bl.shipment.container_type if bl.shipment else '',
        'created_at': bl.created_at.strftime('%Y-%m-%d %H:%M'),
    })


# ── 核对 ──────────────────────────────────────────────────────────────────────

@api_view(['POST'])
def verify_bl(request, pk):
    """核对提单：将保存的明细快照与当前出货单实际明细对比。

    返回：
      matched        完全一致的行
      mismatched     有差异的行（含差异字段）
      only_in_saved  只在快照中有（出货单被删/改）
      only_in_live   只在当前出货单有（新增行）
    """
    try:
        bl = BillOfLadingRecord.objects.select_related('shipment').get(pk=pk)
    except BillOfLadingRecord.DoesNotExist:
        return Response({'error': '记录不存在'}, status=404)

    if not bl.shipment:
        return Response({'error': '该提单记录未关联出货单，无法核对'}, status=400)

    # 获取当前出货单的实时明细
    live_items = []
    for item in bl.shipment.items.order_by('seq_number'):
        live_items.append({
            'product_code': item.product_code,
            'product_name': item.product_name,
            'contract_number': item.contract_number,
            'pieces': item.pieces,
            'volume': float(item.volume) if item.volume else 0,
            'quantity': item.quantity,
            'gross_weight': float(item.gross_weight) if item.gross_weight else 0,
            'net_weight': float(item.net_weight) if item.net_weight else 0,
        })

    result = _compare_items(bl.items_snapshot, live_items)

    # 保存核对结果
    bl.verified = True
    bl.verify_discrepancies = result
    bl.save(update_fields=['verified', 'verify_discrepancies'])

    return Response(result)


def _compare_items(saved_items: list, live_items: list) -> dict:
    """对比两组明细（按货号+合同号匹配）。"""
    COMPARE_FIELDS = ['pieces', 'volume', 'quantity', 'gross_weight', 'net_weight']

    def _key(item):
        return (
            str(item.get('product_code', '') or '').strip().upper(),
            str(item.get('contract_number', '') or '').strip().upper(),
        )

    saved_map = {}
    for item in saved_items:
        k = _key(item)
        saved_map.setdefault(k, []).append(item)

    live_map = {}
    for item in live_items:
        k = _key(item)
        live_map.setdefault(k, []).append(item)

    matched = []
    mismatched = []
    only_in_saved = []
    only_in_live = []

    all_keys = set(saved_map) | set(live_map)
    for k in all_keys:
        s_list = saved_map.get(k, [])
        l_list = live_map.get(k, [])

        if not s_list:
            only_in_live.extend(l_list)
            continue
        if not l_list:
            only_in_saved.extend(s_list)
            continue

        # 简单按顺序逐行对比（同货号+合同号）
        for i in range(max(len(s_list), len(l_list))):
            if i >= len(s_list):
                only_in_live.append(l_list[i])
                continue
            if i >= len(l_list):
                only_in_saved.append(s_list[i])
                continue
            si = s_list[i]
            li = l_list[i]
            diffs = {}
            for field in COMPARE_FIELDS:
                sv = round(float(si.get(field) or 0), 3)
                lv = round(float(li.get(field) or 0), 3)
                if abs(sv - lv) > 0.001:
                    diffs[field] = {'saved': sv, 'live': lv}
            if diffs:
                mismatched.append({
                    'product_code': si.get('product_code', ''),
                    'product_name': si.get('product_name', ''),
                    'contract_number': si.get('contract_number', ''),
                    'saved': si,
                    'live': li,
                    'diffs': diffs,
                })
            else:
                matched.append(si)

    return {
        'match_count': len(matched),
        'mismatch_count': len(mismatched),
        'only_in_saved_count': len(only_in_saved),
        'only_in_live_count': len(only_in_live),
        'mismatched': mismatched,
        'only_in_saved': only_in_saved,
        'only_in_live': only_in_live,
    }


# ── 从邮件匹配提单 ────────────────────────────────────────────────────────────

@api_view(['POST'])
def match_from_email(request):
    """将已导入的邮件解析数据与出货单明细智能匹配。

    请求体：
      email_record_id  int    已保存的邮件记录 ID
      date_from        str    可选，YYYY-MM-DD，默认 2025-10-01
      date_to          str    可选，YYYY-MM-DD，默认 2026-03-31
    """
    email_record_id = request.data.get('email_record_id')
    if not email_record_id:
        return Response({'error': '缺少 email_record_id'}, status=400)

    try:
        email_record = EmailRecord.objects.get(id=int(email_record_id))
    except (EmailRecord.DoesNotExist, ValueError):
        return Response({'error': '邮件记录不存在'}, status=404)

    parsed = email_record.parsed_data or {}
    pl_items = parsed.get('packing_list_items', [])
    so_from_email = str(parsed.get('so_number', '') or '').strip()

    date_from_str = (request.data.get('date_from') or '2025-10-01').strip()
    date_to_str   = (request.data.get('date_to')   or '2026-03-31').strip()
    try:
        df = _date.fromisoformat(date_from_str)
        dt = _date.fromisoformat(date_to_str)
    except ValueError:
        df = _date(2025, 10, 1)
        dt = _date(2026, 3, 31)

    # ── 候选出货单（按日期范围） ──
    ship_qs = Shipment.objects.prefetch_related('items').filter(
        created_at__date__gte=df,
        created_at__date__lte=dt,
    )

    groups = {}   # shipment_id → result dict

    def _add_shipment(s, score_delta, match_reason, matched_items=None):
        sid = s.id
        if sid not in groups:
            groups[sid] = {
                'shipment_id': sid,
                'file_name': _make_file_name(s),
                'cabinet_title': s.remarks or '',
                'container_type': s.container_type or '',
                'container_number': s.container_number or '',
                'so_number': s.so_number or '',
                'ship_date': str(s.ship_date) if s.ship_date else '',
                'email_subject': email_record.subject,
                'items': [],
                'total_cbm': 0.0,
                'total_pieces': 0,
                'match_score': 0,
                'match_reasons': [],
                'already_saved': BillOfLadingRecord.objects.filter(shipment_id=sid).exists(),
            }
        groups[sid]['match_score'] += score_delta
        if match_reason not in groups[sid]['match_reasons']:
            groups[sid]['match_reasons'].append(match_reason)
        # 写入明细快照（仅写一次）
        if not groups[sid]['items']:
            for item in s.items.order_by('seq_number'):
                groups[sid]['items'].append({
                    'id': item.id,
                    'product_code': item.product_code,
                    'product_name': item.product_name,
                    'contract_number': item.contract_number,
                    'pieces': item.pieces,
                    'volume': float(item.volume) if item.volume else 0,
                    'quantity': item.quantity,
                    'gross_weight': float(item.gross_weight) if item.gross_weight else 0,
                    'net_weight': float(item.net_weight) if item.net_weight else 0,
                })
                if item.volume:
                    groups[sid]['total_cbm'] = round(groups[sid]['total_cbm'] + float(item.volume), 3)
                if item.pieces:
                    groups[sid]['total_pieces'] += item.pieces

    # ── 1. SO 号精确匹配（最高优先级） ──
    if so_from_email:
        for s in ship_qs.filter(so_number__icontains=so_from_email):
            _add_shipment(s, 10, f'SO号匹配: {so_from_email}')

    # ── 2. 邮件主题中的 SO/Booking 号 ──
    subj = email_record.subject or ''
    so_in_subj = re.findall(r'\b([A-Z]{2,4}\d{6,}[A-Z0-9]*)\b', subj)
    for so_cand in so_in_subj:
        for s in ship_qs.filter(so_number__icontains=so_cand):
            _add_shipment(s, 8, f'主题含SO: {so_cand}')

    # ── 3. 货号+合同号+件数+CBM 全匹配 ──
    for pl_item in pl_items:
        pc = str(pl_item.get('product_code', '') or '').strip()
        cn = str(pl_item.get('contract_number', '') or '').strip()
        pieces_val = pl_item.get('pieces')
        volume_val = pl_item.get('volume')

        if not pc and not cn:
            continue

        item_qs = ShipmentItem.objects.select_related('shipment').filter(
            shipment__in=ship_qs,
        )
        if pc:
            item_qs = item_qs.filter(product_code__iexact=pc)
        if cn:
            item_qs = item_qs.filter(contract_number__iexact=cn)

        for db_item in item_qs:
            s = db_item.shipment
            score = 4  # 货号+合同号 基础分
            reasons = [f'货号/合同号: {pc}/{cn}']

            # 件数精确匹配 +2
            if pieces_val is not None and db_item.pieces == int(pieces_val):
                score += 2
                reasons.append('件数一致')

            # CBM 匹配 +2
            if volume_val and db_item.volume:
                try:
                    diff = abs(float(db_item.volume) - float(volume_val))
                    if diff < 0.001:
                        score += 2
                        reasons.append('CBM一致')
                    elif diff < 0.1:
                        score += 1
                        reasons.append('CBM接近')
                except Exception:
                    pass

            for r in reasons:
                _add_shipment(s, 0, r)
            groups[s.id]['match_score'] += score

    # ── 4. 邮件主题与出货单 remarks 模糊匹配 ──
    if subj and not groups:
        # 从主题提取可能的柜号/PO等关键词
        keywords = re.findall(r'[A-Z0-9]{6,}', subj.upper())
        for kw in keywords[:5]:  # 最多试5个关键词
            for s in ship_qs.filter(remarks__icontains=kw):
                _add_shipment(s, 3, f'主题关键词: {kw}')
            for s in ship_qs.filter(so_number__icontains=kw):
                _add_shipment(s, 5, f'主题关键词匹配SO: {kw}')

    # 按匹配分数降序
    sorted_groups = sorted(groups.values(), key=lambda g: g['match_score'], reverse=True)

    return Response({
        'groups': sorted_groups[:20],  # 最多返回20组
        'email_subject': email_record.subject,
        'pl_item_count': len(pl_items),
        'so_from_email': so_from_email,
        'date_range': f'{date_from_str} ~ {date_to_str}',
    })
