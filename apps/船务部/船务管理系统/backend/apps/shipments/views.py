from django.db import models as db_models
from rest_framework import viewsets, status as http_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.emails.models import EmailRecord
from apps.master_data.models import Customer, ProductMapping
from apps.master_data.brand_rules import get_brand_for_product_code
from .calculations import calculate_total_pieces_per_order
from .models import Shipment, ShipmentItem, ShipmentSubItem
from .serializers import (
    ShipmentListSerializer,
    ShipmentSerializer,
    ShipmentCreateSerializer,
    ShipmentItemSerializer,
    ShipmentSubItemSerializer,
)


class ShipmentPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


class ShipmentViewSet(viewsets.ModelViewSet):
    queryset = Shipment.objects.all()
    pagination_class = ShipmentPagination

    def get_queryset(self):
        if self.action == 'list':
            queryset = (
                Shipment.objects
                .select_related('customer', 'created_by')
                .annotate(
                    items_count=db_models.Count('items', distinct=True),
                    total_cbm=db_models.Sum('items__volume'),
                )
                .order_by('-created_at')
            )
            params = self.request.query_params
            so = (params.get('so') or '').strip()
            port = (params.get('port') or '').strip()
            country = (params.get('country') or '').strip()
            container_type = (
                params.get('container_type')
                or params.get('containerType')
                or ''
            ).strip()
            status_value = (params.get('status') or '').strip()
            date_from = (params.get('date_from') or '').strip()
            date_to = (params.get('date_to') or '').strip()

            if so:
                queryset = queryset.filter(so_number__icontains=so)
            if port:
                queryset = queryset.filter(port__icontains=port)
            if country:
                queryset = queryset.filter(delivery_address__icontains=country)
            if container_type:
                queryset = queryset.filter(container_type__icontains=container_type)
            if status_value:
                queryset = queryset.filter(status=status_value)
            if date_from:
                queryset = queryset.filter(created_at__date__gte=date_from)
            if date_to:
                queryset = queryset.filter(created_at__date__lte=date_to)
            return queryset

        return Shipment.objects.prefetch_related('items', 'items__sub_items').all()

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ShipmentCreateSerializer
        if self.action == 'list':
            return ShipmentListSerializer
        return ShipmentSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ShipmentItemViewSet(viewsets.ModelViewSet):
    serializer_class = ShipmentItemSerializer

    def get_queryset(self):
        return ShipmentItem.objects.filter(shipment_id=self.kwargs['shipment_pk'])

    def perform_create(self, serializer):
        serializer.save(shipment_id=self.kwargs['shipment_pk'])


@api_view(['POST'])
def create_from_email(request):
    """Create shipment and items from parsed email data."""
    import traceback as _tb
    try:
        return _create_from_email_inner(request)
    except Exception as e:
        _tb.print_exc()
        return Response({'error': str(e), 'trace': _tb.format_exc()}, status=http_status.HTTP_500_INTERNAL_SERVER_ERROR)


def _create_from_email_inner(request):
    # 支持单个或多个 email_record_id
    email_record_id = request.data.get('email_record_id')
    email_record_ids = email_record_id if isinstance(email_record_id, list) else [email_record_id] if email_record_id else []
    parsed = request.data.get('parsed_data', {})

    # Find or create customer (default ZURU)
    customer_name = parsed.get('customer_name', 'ZURU')
    customer, _ = Customer.objects.get_or_create(name=customer_name)

    # 解析日期时间字段（M/D HH:MM 格式）
    import re as _re
    from datetime import date as _date, datetime as _datetime

    def _parse_md(val):
        """解析 M/D 或 M/D HH:MM 格式"""
        if not val:
            return None, None
        s = str(val).strip()
        # 先匹配带时间的：M/D HH:MM
        m = _re.match(r'(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})', s)
        if m:
            month, day = int(m.group(1)), int(m.group(2))
            hour, minute = int(m.group(3)), int(m.group(4))
            year = _date.today().year
            try:
                return _date(year, month, day), _datetime(year, month, day, hour, minute)
            except ValueError:
                return None, None
        # 再匹配只有日期的：M/D
        m = _re.match(r'(\d{1,2})/(\d{1,2})$', s)
        if not m:
            m = _re.match(r'(\d{1,2})/(\d{1,2})\s', s)
        if not m:
            return None, None
        month, day = int(m.group(1)), int(m.group(2))
        year = _date.today().year
        try:
            d = _date(year, month, day)
            return d, None
        except ValueError:
            return None, None

    ship_date, _ = _parse_md(parsed.get('ship_date', ''))
    _, si_deadline = _parse_md(parsed.get('si_deadline', ''))
    _, cutoff_date = _parse_md(parsed.get('cutoff_date', ''))

    # 自动分配柜号（仅柜类型）
    ct = parsed.get('container_type', '')
    is_cabinet = ct and not ct.upper().endswith('T')
    cabinet_number = ''
    if is_cabinet:
        cab_num = customer.next_cabinet_number()
        cabinet_number = f'{parsed.get("port", "")} {customer.name} {cab_num} 柜'

    # Create shipment
    shipment = Shipment.objects.create(
        shipment_type=parsed.get('shipment_type', 'normal'),
        customer=customer,
        so_number=parsed.get('so_number', ''),
        container_type=parsed.get('container_type', ''),
        port=parsed.get('port', ''),
        ship_date=ship_date,
        si_deadline=si_deadline,
        cutoff_date=cutoff_date,
        delivery_address=parsed.get('delivery_address', ''),
        customs_broker=parsed.get('customs_broker', ''),
        warehouse=parsed.get('warehouse', ''),
        special_requirements=parsed.get('special_requirements', ''),
        remarks=cabinet_number,  # 柜号标题存入备注
        main_factory=parsed.get('zuogui_factory', ''),
        source_email_id=','.join(str(eid) for eid in email_record_ids if eid),
        created_by=request.user,
    )

    # Create items from packing list
    pl_items = parsed.get('packing_list_items', [])

    # 批量预查 ProductMapping，避免每条都查数据库
    _all_codes = set()
    for pl in pl_items:
        pc = str(pl.get('product_code', '') or '').strip()
        if pc.endswith('.0'):
            pc = pc[:-2]
        if pc:
            _all_codes.add(pc)
    _pm_map = {}  # product_code -> list[ProductMapping]
    if _all_codes:
        for pm_obj in ProductMapping.objects.filter(product_code__in=_all_codes):
            _pm_map.setdefault(pm_obj.product_code, []).append(pm_obj)

    def _lookup_pm(product_code, spec, customer_name):
        candidates = _pm_map.get(product_code, [])
        if not candidates:
            return None
        # spec匹配优先
        if spec and spec.isdigit():
            for c in candidates:
                pn = c.product_name or ''
                if f'{spec}个/箱' in pn or f'{spec}PCS/箱' in pn:
                    return c
        # 客户名匹配
        for c in candidates:
            if c.customer_name == customer_name and c.product_name:
                return c
        # 任意有货名的
        for c in candidates:
            if c.product_name:
                return c
        return candidates[0] if candidates else None

    for idx, pl in enumerate(pl_items, start=1):
        product_code = str(pl.get('product_code', '')).strip()
        if product_code.endswith('.0'):
            product_code = product_code[:-2]

        _pl_spec = str(pl.get('spec', '') or '').strip()
        pm = _lookup_pm(product_code, _pl_spec, customer.name)
        product_name = pm.product_name if pm else ''
        toy_category = pm.toy_category if pm else ''
        gw_per_box = pm.gross_weight_per_box if pm else None
        nw_per_box = pm.net_weight_per_box if pm else None

        # 如果找到的货名中个数与spec不匹配，用spec替换
        if product_name and _pl_spec and _pl_spec.isdigit():
            import re as _re_spec
            _name_match = _re_spec.search(r'(\d+)(?=个/箱|PCS/箱|pcs/箱)', product_name)
            if _name_match and _name_match.group(1) != _pl_spec:
                product_name = _re_spec.sub(r'\d+(?=个/箱|PCS/箱|pcs/箱)', _pl_spec, product_name)

        # Brand auto-detection (ZURU only)
        brand = ''
        if customer.is_brand_auto:
            _country = parsed.get('country', '') or parsed.get('delivery_address', '') or ''
            brand = get_brand_for_product_code(product_code, country=_country) or ''

        def _safe_int(v):
            try: return int(v) if v not in (None, '') else 0
            except (ValueError, TypeError): return 0

        def _safe_dec(v):
            if v in (None, ''): return None
            try: return float(v)
            except (ValueError, TypeError): return None

        ShipmentItem.objects.create(
            shipment=shipment,
            seq_number=idx,
            factory_remark=pl.get('factory_remark') or pl.get('factory_short') or '',
            trading_company=customer.name,
            contract_number=pl.get('contract_number', '') or '',
            product_code=product_code,
            product_name=product_name,
            spec=str(pl.get('spec', '') or ''),
            quantity=_safe_int(pl.get('quantity')),
            pieces=_safe_int(pl.get('pieces')),
            gross_weight_per_box=gw_per_box,
            net_weight_per_box=nw_per_box,
            volume=_safe_dec(pl.get('volume') or pl.get('cbm')),
            customer_po=pl.get('customer_po', '') or '',
            customer_po_item_no=pl.get('customer_po_item_no', '') or '',
            brand=brand,
            pallet_count=_safe_int(pl.get('pallet_count')),
            box_dimensions=pl.get('box_dimensions', '') or '',
            toy_category=toy_category,
            country=pl.get('country') or parsed.get('country', '') or parsed.get('delivery_address', '') or '',
        )

    # Calculate total_pieces_per_order
    items = list(shipment.items.all())
    # 检查是否有 TJX 跨柜预算的总件数
    _has_precalc = any(pl.get('total_pieces_per_order') for pl in pl_items)
    if _has_precalc:
        # 使用解析时跨柜计算好的总件数
        for item, pl in zip(items, pl_items):
            item.total_pieces_per_order = _safe_int(pl.get('total_pieces_per_order')) or item.pieces
            item.save(update_fields=['total_pieces_per_order'])
    else:
        totals = calculate_total_pieces_per_order(items)
        for item in items:
            key = (item.contract_number, item.customer_po, item.product_code, item.product_name, item.spec)
            item.total_pieces_per_order = totals.get(key, item.pieces)
            item.save(update_fields=['total_pieces_per_order'])

    # Update email record status
    if email_record_ids:
        EmailRecord.objects.filter(id__in=email_record_ids).update(status=EmailRecord.Status.SHIPMENT_CREATED)

    return Response(ShipmentSerializer(shipment).data, status=http_status.HTTP_201_CREATED)


class ShipmentSubItemViewSet(viewsets.ModelViewSet):
    """混合装子行 CRUD"""
    serializer_class = ShipmentSubItemSerializer

    def get_queryset(self):
        return ShipmentSubItem.objects.filter(parent_item_id=self.kwargs['item_pk'])

    def perform_create(self, serializer):
        parent_item = ShipmentItem.objects.get(pk=self.kwargs['item_pk'])
        # 自动设置 order_index
        max_idx = parent_item.sub_items.aggregate(db_models.Max('order_index'))['order_index__max'] or 0
        serializer.save(parent_item=parent_item, order_index=max_idx + 1)


def _create_shipment_from_parsed(parsed: dict, user):
    """从已解析的字典创建出货单，供 AI 解析确认端点调用。

    参数：
        parsed: 包含出货单字段和 packing_list_items 的字典
        user: 当前登录用户（Django User 实例）
    返回：
        创建好的 Shipment 实例
    """
    import re as _re
    from datetime import date as _date, datetime as _datetime

    def _parse_md(val):
        if not val:
            return None, None
        s = str(val).strip()
        m = _re.match(r'(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})', s)
        if m:
            month, day = int(m.group(1)), int(m.group(2))
            hour, minute = int(m.group(3)), int(m.group(4))
            year = _date.today().year
            try:
                return _date(year, month, day), _datetime(year, month, day, hour, minute)
            except ValueError:
                return None, None
        m = _re.match(r'(\d{1,2})/(\d{1,2})$', s) or _re.match(r'(\d{1,2})/(\d{1,2})\s', s)
        if not m:
            return None, None
        month, day = int(m.group(1)), int(m.group(2))
        year = _date.today().year
        try:
            return _date(year, month, day), None
        except ValueError:
            return None, None

    ship_date, _ = _parse_md(parsed.get('ship_date', ''))
    _, si_deadline = _parse_md(parsed.get('si_deadline', ''))
    _, cutoff_date = _parse_md(parsed.get('cutoff_date', ''))

    customer_name = parsed.get('customer_name', 'ZURU')
    customer, _ = Customer.objects.get_or_create(name=customer_name)

    ct = parsed.get('container_type', '')
    is_cabinet = ct and not ct.upper().endswith('T')
    cabinet_number = ''
    if is_cabinet:
        cab_num = customer.next_cabinet_number()
        cabinet_number = f'{parsed.get("port", "")} {customer.name} {cab_num} 柜'

    shipment = Shipment.objects.create(
        shipment_type=parsed.get('shipment_type', 'normal'),
        customer=customer,
        so_number=parsed.get('so_number', ''),
        container_type=parsed.get('container_type', ''),
        port=parsed.get('port', ''),
        ship_date=ship_date,
        si_deadline=si_deadline,
        cutoff_date=cutoff_date,
        delivery_address=parsed.get('delivery_address', ''),
        customs_broker=parsed.get('customs_broker', ''),
        warehouse=parsed.get('warehouse', ''),
        special_requirements=parsed.get('special_requirements', ''),
        remarks=cabinet_number,
        main_factory=parsed.get('zuogui_factory', ''),
        source_email_id='',
        created_by=user,
    )

    def _safe_int(v):
        try:
            return int(v) if v not in (None, '') else 0
        except (ValueError, TypeError):
            return 0

    def _safe_dec(v):
        if v in (None, ''):
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    pl_items = parsed.get('packing_list_items', [])

    # 批量预查 ProductMapping
    _all_codes2 = set()
    for pl in pl_items:
        pc = str(pl.get('product_code', '') or '').strip()
        if pc.endswith('.0'):
            pc = pc[:-2]
        if pc:
            _all_codes2.add(pc)
    _pm_map2 = {}
    if _all_codes2:
        for pm_obj in ProductMapping.objects.filter(product_code__in=_all_codes2):
            _pm_map2.setdefault(pm_obj.product_code, []).append(pm_obj)

    def _lookup_pm2(product_code, spec, customer_name):
        candidates = _pm_map2.get(product_code, [])
        if not candidates:
            return None
        if spec and spec.isdigit():
            for c in candidates:
                pn = c.product_name or ''
                if f'{spec}个/箱' in pn or f'{spec}PCS/箱' in pn:
                    return c
        for c in candidates:
            if c.customer_name == customer_name and c.product_name:
                return c
        for c in candidates:
            if c.product_name:
                return c
        return candidates[0] if candidates else None

    for idx, pl in enumerate(pl_items, start=1):
        product_code = str(pl.get('product_code', '')).strip()
        if product_code.endswith('.0'):
            product_code = product_code[:-2]

        _pl_spec = str(pl.get('spec', '') or '').strip()
        pm = _lookup_pm2(product_code, _pl_spec, customer.name)
        product_name = pm.product_name if pm else ''
        toy_category = pm.toy_category if pm else ''
        gw_per_box = pm.gross_weight_per_box if pm else None
        nw_per_box = pm.net_weight_per_box if pm else None

        if product_name and _pl_spec and _pl_spec.isdigit():
            _name_match = _re.search(r'(\d+)(?=个/箱|PCS/箱|pcs/箱)', product_name)
            if _name_match and _name_match.group(1) != _pl_spec:
                product_name = _re.sub(r'\d+(?=个/箱|PCS/箱|pcs/箱)', _pl_spec, product_name)

        brand = ''
        if customer.is_brand_auto:
            _country = parsed.get('country', '') or parsed.get('delivery_address', '') or ''
            brand = get_brand_for_product_code(product_code, country=_country) or ''

        # factory_remark 优先级：ProductMapping.factory_short > PL数据
        _pm_factory2 = (pm.factory_short or '').strip() if pm else ''
        _pl_factory2 = pl.get('factory_remark') or pl.get('factory_short') or ''
        _factory_remark2 = _pm_factory2 or _pl_factory2

        ShipmentItem.objects.create(
            shipment=shipment,
            seq_number=idx,
            factory_remark=_factory_remark2,
            trading_company=customer.name,
            contract_number=pl.get('contract_number', '') or '',
            product_code=product_code,
            product_name=product_name,
            spec=str(pl.get('spec', '') or ''),
            quantity=_safe_int(pl.get('quantity')),
            pieces=_safe_int(pl.get('pieces')),
            gross_weight_per_box=gw_per_box,
            net_weight_per_box=nw_per_box,
            volume=_safe_dec(pl.get('volume') or pl.get('cbm')),
            customer_po=pl.get('customer_po', '') or '',
            customer_po_item_no=pl.get('customer_po_item_no', '') or '',
            brand=brand,
            pallet_count=_safe_int(pl.get('pallet_count')),
            box_dimensions=pl.get('box_dimensions', '') or '',
            toy_category=toy_category,
            country=pl.get('country') or parsed.get('country', '') or parsed.get('delivery_address', '') or '',
        )

    items = list(shipment.items.all())
    _has_precalc = any(pl.get('total_pieces_per_order') for pl in pl_items)
    if _has_precalc:
        for item, pl in zip(items, pl_items):
            item.total_pieces_per_order = _safe_int(pl.get('total_pieces_per_order')) or item.pieces
            item.save(update_fields=['total_pieces_per_order'])
    else:
        totals = calculate_total_pieces_per_order(items)
        for item in items:
            key = (item.contract_number, item.customer_po, item.product_code, item.product_name, item.spec)
            item.total_pieces_per_order = totals.get(key, item.pieces)
            item.save(update_fields=['total_pieces_per_order'])

    return shipment


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def pallet_export(request):
    """导出卡板数报表为 xlsx。

    Body 字段：
      start, end: YYYY-MM-DD
      factories: list[str]  空 = 全部
      categories: list[str]  空 = 全部
      self_items, local_items, external_items: list[dict]  来自前端筛选好的数据
      manual_borui, manual_kuyou: list[dict]  手填数据
    """
    from django.http import HttpResponse
    from urllib.parse import quote
    from .pallet_export import generate_xlsx

    data = request.data or {}
    start = (data.get('start') or '').strip()
    end = (data.get('end') or '').strip()
    factories = data.get('factories') or []
    categories = data.get('categories') or []

    # 简单校验日期格式（YYYY-MM-DD），缺失或格式错误返回 400
    import re as _re
    _date_re = _re.compile(r'^\d{4}-\d{2}-\d{2}$')
    if not _date_re.match(start) or not _date_re.match(end):
        return Response({'error': 'start / end 必须是 YYYY-MM-DD 格式'}, status=http_status.HTTP_400_BAD_REQUEST)

    payload = {
        'period_start': start,
        'period_end': end,
        'factories_filter': '、'.join(factories) if factories else '全部',
        'categories_filter': '、'.join(categories) if categories else '全部',
        'self_items': data.get('self_items') or [],
        'local_items': data.get('local_items') or [],
        'external_items': data.get('external_items') or [],
        'manual_borui': data.get('manual_borui') or [],
        'manual_kuyou': data.get('manual_kuyou') or [],
    }

    try:
        blob = generate_xlsx(payload)
    except Exception as e:
        return Response({'error': f'生成 Excel 失败: {e}'}, status=http_status.HTTP_500_INTERNAL_SERVER_ERROR)

    resp = HttpResponse(
        blob,
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    fn = f'卡板数报表_{start}_至_{end}.xlsx'
    resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(fn)}"
    return resp
