from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        SHIPPING = 'shipping', '船务'
        SUPERVISOR = 'supervisor', '主管'
        WAREHOUSE_CLERK = 'warehouse_clerk', '仓库跟单'
        CARGO_TRACKER = 'cargo_tracker', '货物跟踪'
        QC = 'qc', 'QC'
        WAREHOUSE_MANAGER = 'warehouse_manager', '仓管'
        CUSTOMS = 'customs', '报关'

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.SHIPPING,
        verbose_name='角色'
    )
    display_name = models.CharField(max_length=50, blank=True, verbose_name='显示名')

    class Meta:
        verbose_name = '用户'
        verbose_name_plural = '用户'


from cryptography.fernet import Fernet
import base64, hashlib
from django.conf import settings as _settings


class UserMailboxConfig(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='mailbox_config')
    imap_host = models.CharField(max_length=128, default='imaphz.qiye.163.com')
    imap_port = models.IntegerField(default=993)
    email = models.CharField(max_length=254)
    password_encrypted = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    def _fernet(self):
        key = hashlib.sha256(_settings.SECRET_KEY.encode()).digest()
        return Fernet(base64.urlsafe_b64encode(key))

    def set_password(self, plain):
        self.password_encrypted = self._fernet().encrypt(plain.encode()).decode()

    def get_password(self):
        return self._fernet().decrypt(self.password_encrypted.encode()).decode()

    class Meta:
        db_table = 'accounts_usermailboxconfig'
