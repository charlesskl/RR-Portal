from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'customers', views.CustomerViewSet)
router.register(r'transport-companies', views.TransportCompanyViewSet)
router.register(r'factory-mappings', views.FactoryMappingViewSet)
router.register(r'product-mappings', views.ProductMappingViewSet, basename='productmapping')
router.register(r'destination-ports', views.DestinationPortMappingViewSet)

urlpatterns = [
    path('import-daily/', views.import_daily, name='import-daily'),
] + router.urls
