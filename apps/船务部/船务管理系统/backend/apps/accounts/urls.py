from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from . import views

urlpatterns = [
    path('login/', views.login_view, name='login'),
    path('me/', views.me_view, name='me'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    # 用户管理（主管专用）
    path('users/', views.list_users, name='list-users'),
    path('users/create/', views.create_user, name='create-user'),
    path('users/<int:pk>/', views.manage_user, name='manage-user'),
    path('users/<int:pk>/password/', views.change_password, name='change-password'),
    path('users/me/password/', views.change_my_password, name='change-my-password'),
    path('mailbox/config/', views.mailbox_config, name='mailbox-config'),
]
