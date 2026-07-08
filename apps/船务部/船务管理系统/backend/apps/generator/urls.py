from django.urls import path

from . import views

urlpatterns = [
    path('<int:shipment_id>/generate/', views.generate_download, name='generator-download'),
]
