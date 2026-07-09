"""QC验货 / 状态流转 / 通知 视图"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User
from .models import Shipment, QCInspection, QCPhoto, Notification

# ── 状态流转规则 ────────────────────────────────────────────────
NEXT_STATUS = {
    Shipment.Status.CREATED:         Shipment.Status.PENDING_QC,
    Shipment.Status.PENDING_QC:      Shipment.Status.PENDING_LOADING,
    Shipment.Status.PENDING_LOADING: Shipment.Status.SHIPPED,
}

# 状态变更后通知哪些角色
NOTIFY_ROLES = {
    Shipment.Status.PENDING_QC:      [User.Role.QC],
    Shipment.Status.PENDING_LOADING: [User.Role.SHIPPING, User.Role.WAREHOUSE_CLERK, User.Role.WAREHOUSE_MANAGER],
    Shipment.Status.SHIPPED:         [User.Role.SUPERVISOR, User.Role.CUSTOMS],
}

STATUS_LABELS = {v: l for v, l in Shipment.Status.choices}


def _create_notifications(shipment, new_status, actor):
    roles = NOTIFY_ROLES.get(new_status, [])
    if not roles:
        return
    recipients = User.objects.filter(role__in=roles, is_active=True).exclude(pk=actor.pk)
    label = STATUS_LABELS.get(new_status, new_status)
    msg = f'出货单【{shipment.so_number or shipment.id}】状态已变更为"{label}"'
    Notification.objects.bulk_create([
        Notification(
            recipient=u, shipment=shipment,
            type=Notification.Type.STATUS_CHANGE, message=msg
        )
        for u in recipients
    ])


# ── 状态推进 ────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def advance_status(request, pk):
    try:
        shipment = Shipment.objects.get(pk=pk)
    except Shipment.DoesNotExist:
        return Response({'error': '出货单不存在'}, status=status.HTTP_404_NOT_FOUND)

    current = shipment.status
    next_s = NEXT_STATUS.get(current)
    if not next_s:
        return Response({'error': '已是最终状态'}, status=status.HTTP_400_BAD_REQUEST)

    shipment.status = next_s
    shipment.save(update_fields=['status'])
    _create_notifications(shipment, next_s, request.user)
    return Response({'status': shipment.status, 'status_display': shipment.get_status_display()})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def rollback_status(request, pk):
    """撤回到上一个状态（仅主管）"""
    if not (request.user.is_superuser or getattr(request.user, 'role', '') == User.Role.SUPERVISOR):
        return Response({'error': '无权限'}, status=status.HTTP_403_FORBIDDEN)
    try:
        shipment = Shipment.objects.get(pk=pk)
    except Shipment.DoesNotExist:
        return Response({'error': '出货单不存在'}, status=status.HTTP_404_NOT_FOUND)

    prev_map = {v: k for k, v in NEXT_STATUS.items()}
    prev_s = prev_map.get(shipment.status)
    if not prev_s:
        return Response({'error': '已是初始状态'}, status=status.HTTP_400_BAD_REQUEST)

    shipment.status = prev_s
    shipment.save(update_fields=['status'])
    return Response({'status': shipment.status, 'status_display': shipment.get_status_display()})


# ── QC验货 ──────────────────────────────────────────────────────
def _inspection_data(ins):
    return {
        'id': ins.id,
        'shipment_id': ins.shipment_id,
        'inspector': {'id': ins.inspector_id, 'display_name': ins.inspector.display_name or ins.inspector.username},
        'result': ins.result,
        'result_display': ins.get_result_display(),
        'notes': ins.notes,
        'created_at': ins.created_at.strftime('%Y-%m-%d %H:%M'),
        'photos': [
            {'id': p.id, 'url': request_obj.build_absolute_uri(p.image.url)}
            for p in ins.photos.all()
        ] if hasattr(ins, '_request') else [],
    }


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def qc_list(request, shipment_pk):
    try:
        shipment = Shipment.objects.get(pk=shipment_pk)
    except Shipment.DoesNotExist:
        return Response({'error': '出货单不存在'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        inspections = shipment.qc_inspections.select_related('inspector').prefetch_related('photos')
        result = []
        for ins in inspections:
            result.append({
                'id': ins.id,
                'shipment_id': ins.shipment_id,
                'inspector': {'id': ins.inspector_id, 'display_name': ins.inspector.display_name or ins.inspector.username},
                'result': ins.result,
                'result_display': ins.get_result_display(),
                'notes': ins.notes,
                'created_at': ins.created_at.strftime('%Y-%m-%d %H:%M'),
                'photos': [{'id': p.id, 'url': request.build_absolute_uri(p.image.url)} for p in ins.photos.all()],
            })
        return Response(result)

    # POST — 新建验货记录
    r = request.data.get('result')
    if r not in ('pass', 'fail', 'partial'):
        return Response({'error': '验货结果无效'}, status=status.HTTP_400_BAD_REQUEST)

    ins = QCInspection.objects.create(
        shipment=shipment,
        inspector=request.user,
        result=r,
        notes=request.data.get('notes', ''),
    )

    # 验货完成后通知船务推进状态
    msg = f'出货单【{shipment.so_number or shipment.id}】QC验货完成：{ins.get_result_display()}'
    shipping_users = User.objects.filter(
        role__in=[User.Role.SHIPPING, User.Role.SUPERVISOR], is_active=True
    ).exclude(pk=request.user.pk)
    Notification.objects.bulk_create([
        Notification(recipient=u, shipment=shipment, type=Notification.Type.QC_RESULT, message=msg)
        for u in shipping_users
    ])

    return Response({'id': ins.id, 'result': ins.result, 'result_display': ins.get_result_display()},
                    status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_qc_photo(request, inspection_pk):
    try:
        ins = QCInspection.objects.get(pk=inspection_pk)
    except QCInspection.DoesNotExist:
        return Response({'error': '验货记录不存在'}, status=status.HTTP_404_NOT_FOUND)

    photos = []
    for f in request.FILES.getlist('photos'):
        p = QCPhoto.objects.create(inspection=ins, image=f)
        photos.append({'id': p.id, 'url': request.build_absolute_uri(p.image.url)})
    return Response({'photos': photos})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_qc_photo(request, photo_pk):
    try:
        p = QCPhoto.objects.get(pk=photo_pk)
    except QCPhoto.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    p.image.delete(save=False)
    p.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── 通知 ────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    notifs = Notification.objects.filter(recipient=request.user).select_related('shipment')[:50]
    data = [{
        'id': n.id,
        'message': n.message,
        'type': n.type,
        'is_read': n.is_read,
        'shipment_id': n.shipment_id,
        'so_number': n.shipment.so_number if n.shipment else '',
        'created_at': n.created_at.strftime('%Y-%m-%d %H:%M'),
    } for n in notifs]
    unread = Notification.objects.filter(recipient=request.user, is_read=False).count()
    return Response({'notifications': data, 'unread': unread})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_read(request):
    """批量标记已读；ids=[] 时标记全部"""
    ids = request.data.get('ids', [])
    qs = Notification.objects.filter(recipient=request.user, is_read=False)
    if ids:
        qs = qs.filter(pk__in=ids)
    qs.update(is_read=True)
    return Response({'ok': True})
