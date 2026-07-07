from django.urls import path
from . import views

urlpatterns = [
    path('import/', views.import_email, name='email-import'),
    path('ai-parse/', views.ai_parse_email, name='email-ai-parse'),
    path('ai-parse/confirm/', views.ai_parse_confirm, name='email-ai-parse-confirm'),
    path('mailbox/config/', views.mailbox_config, name='mailbox-config'),
    path('mailbox/search/', views.mailbox_search, name='mailbox-search'),
    path('mailbox/import/', views.mailbox_import, name='mailbox-import'),
    path('<int:pk>/', views.delete_email, name='email-delete'),
    path('', views.EmailRecordListView.as_view(), name='email-list'),
]
