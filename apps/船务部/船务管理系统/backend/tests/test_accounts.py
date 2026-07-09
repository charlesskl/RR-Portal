from django.test import TestCase
from apps.accounts.models import User


class UserModelTest(TestCase):
    def test_create_user_with_role(self):
        user = User.objects.create_user(
            username='shipping1',
            password='testpass123',
            role='shipping',
            display_name='船务员A'
        )
        assert user.role == 'shipping'
        assert user.display_name == '船务员A'
        assert user.check_password('testpass123')

    def test_role_choices(self):
        valid_roles = ['shipping', 'supervisor', 'warehouse_clerk',
                       'cargo_tracker', 'qc', 'warehouse_manager', 'customs']
        for role in valid_roles:
            user = User(username=f'user_{role}', role=role, password='testpass123')
            user.full_clean()  # Should not raise
