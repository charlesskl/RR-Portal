"""
柜单下载 API
"""
import os

from django.http import FileResponse, Http404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

from apps.shipments.models import Shipment

from .base_generator import generate_container_sheet


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def generate_download(request, shipment_id):
    """
    生成柜单 Excel 并返回下载。

    GET /api/generator/<shipment_id>/generate/
    """
    try:
        shipment = Shipment.objects.get(pk=shipment_id)
    except Shipment.DoesNotExist:
        raise Http404('出货单不存在')

    output_path = generate_container_sheet(shipment_id)

    if not os.path.exists(output_path):
        raise Http404('文件生成失败')

    filename = os.path.basename(output_path)

    response = FileResponse(
        open(output_path, 'rb'),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response
