from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from . import views_bl
from . import views_qc

router = DefaultRouter()
router.register('', views.ShipmentViewSet)

urlpatterns = [
    path('from-email/', views.create_from_email, name='create-from-email'),
    # 状态流转
    path('<int:pk>/advance/', views_qc.advance_status, name='advance-status'),
    path('<int:pk>/rollback/', views_qc.rollback_status, name='rollback-status'),
    # QC验货
    path('<int:shipment_pk>/qc/', views_qc.qc_list, name='qc-list'),
    path('qc/<int:inspection_pk>/photos/', views_qc.upload_qc_photo, name='upload-qc-photo'),
    path('qc/photos/<int:photo_pk>/', views_qc.delete_qc_photo, name='delete-qc-photo'),
    # 通知
    path('notifications/', views_qc.list_notifications, name='notifications'),
    path('notifications/read/', views_qc.mark_read, name='mark-read'),
    # 找提单 / 核对提单
    path('bl/search/', views_bl.search_bl, name='bl-search'),
    path('bl/save/', views_bl.save_bl, name='bl-save'),
    path('bl/', views_bl.list_bl, name='bl-list'),
    path('bl/<int:pk>/', views_bl.bl_detail, name='bl-detail'),
    path('bl/<int:pk>/verify/', views_bl.verify_bl, name='bl-verify'),
    path('bl/match-from-email/', views_bl.match_from_email, name='bl-match-from-email'),
    # 混合装子行（放在 router 前面避免冲突）
    path('items/<int:item_pk>/sub-items/', views.ShipmentSubItemViewSet.as_view({'get': 'list', 'post': 'create'})),
    path('items/<int:item_pk>/sub-items/<int:pk>/', views.ShipmentSubItemViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'})),
    path('<int:shipment_pk>/items/', views.ShipmentItemViewSet.as_view({'get': 'list', 'post': 'create'})),
    path('<int:shipment_pk>/items/bulk-update/', views.bulk_update_items, name='bulk-update-items'),
    path('<int:shipment_pk>/items/<int:pk>/', views.ShipmentItemViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'})),
    path('', include(router.urls)),
]
