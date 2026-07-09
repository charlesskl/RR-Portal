from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate

from .models import User
from .serializers import (
    UserSerializer, LoginSerializer,
    UserCreateSerializer, UserUpdateSerializer, ChangePasswordSerializer
)


def _is_supervisor(user):
    return user.is_authenticated and (user.is_superuser or user.role == User.Role.SUPERVISOR)


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(
        username=serializer.validated_data['username'],
        password=serializer.validated_data['password']
    )
    if not user:
        return Response({'error': '用户名或密码错误'}, status=status.HTTP_401_UNAUTHORIZED)
    if not user.is_active:
        return Response({'error': '账号已被禁用'}, status=status.HTTP_403_FORBIDDEN)
    refresh = RefreshToken.for_user(user)
    return Response({
        'access': str(refresh.access_token),
        'refresh': str(refresh),
        'user': UserSerializer(user).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response(UserSerializer(request.user).data)


# ── 用户管理（仅主管） ──────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_users(request):
    if not _is_supervisor(request.user):
        return Response({'error': '无权限'}, status=status.HTTP_403_FORBIDDEN)
    users = User.objects.all().order_by('date_joined')
    return Response(UserSerializer(users, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_user(request):
    if not _is_supervisor(request.user):
        return Response({'error': '无权限'}, status=status.HTTP_403_FORBIDDEN)
    serializer = UserCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def manage_user(request, pk):
    if not _is_supervisor(request.user):
        return Response({'error': '无权限'}, status=status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)
    # 不允许修改/删除自己
    if user == request.user:
        return Response({'error': '不能操作自己的账号'}, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'DELETE':
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = UserUpdateSerializer(user, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(UserSerializer(user).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request, pk):
    """主管重置任意用户密码"""
    if not _is_supervisor(request.user):
        return Response({'error': '无权限'}, status=status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)
    serializer = ChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user.set_password(serializer.validated_data['new_password'])
    user.save()
    return Response({'message': '密码已重置'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_my_password(request):
    """用户修改自己的密码"""
    serializer = ChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    request.user.set_password(serializer.validated_data['new_password'])
    request.user.save()
    return Response({'message': '密码已修改'})


from .models import UserMailboxConfig
from apps.emails.imap_service import test_connection


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def mailbox_config(request):
    if request.method == 'GET':
        try:
            cfg = request.user.mailbox_config
            return Response({'configured': True, 'email': cfg.email, 'imap_host': cfg.imap_host, 'imap_port': cfg.imap_port})
        except UserMailboxConfig.DoesNotExist:
            return Response({'configured': False})

    # POST
    email_addr = request.data.get('email', '').strip()
    password = request.data.get('password', '').strip()
    imap_host = request.data.get('imap_host', 'mail.hanson2.com').strip()
    imap_port = int(request.data.get('imap_port', 993))

    if not email_addr:
        return Response({'error': '请输入邮箱地址'}, status=400)

    # 如果没提供密码，检查是否已有配置（允许只更新 host/port）
    try:
        cfg = request.user.mailbox_config
        if not password:
            password = cfg.get_password()
    except UserMailboxConfig.DoesNotExist:
        cfg = None
        if not password:
            return Response({'error': '请输入密码'}, status=400)

    # 测试连接
    try:
        test_connection(imap_host, imap_port, email_addr, password)
    except Exception as e:
        return Response({'error': f'连接失败: {str(e)}'}, status=400)

    # 保存
    if cfg is None:
        cfg = UserMailboxConfig(user=request.user)
    cfg.email = email_addr
    cfg.imap_host = imap_host
    cfg.imap_port = imap_port
    cfg.set_password(password)
    cfg.save()
    return Response({'ok': True})
