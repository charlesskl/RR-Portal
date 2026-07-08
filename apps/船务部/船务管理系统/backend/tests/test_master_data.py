from django.test import TestCase
from apps.master_data.models import Customer, TransportCompany, FactoryMapping, ProductMapping
from apps.master_data.brand_rules import get_brand_for_product_code


class CustomerModelTest(TestCase):
    def test_create_zuru_customer(self):
        c = Customer.objects.create(name='ZURU', consignee='ZURU INC.', consignee_code='66934704', is_brand_auto=True)
        assert c.is_brand_auto is True

    def test_create_other_customer(self):
        c = Customer.objects.create(name='AZAD', is_brand_auto=False)
        assert c.is_brand_auto is False


class FactoryMappingTest(TestCase):
    def test_lookup(self):
        FactoryMapping.objects.create(english_name='Dong Guan Hanson Plastic Product Ltd', chinese_short_name='兴信', is_local=True)
        fm = FactoryMapping.objects.get(chinese_short_name='兴信')
        assert fm.is_local is True


class BrandRulesTest(TestCase):
    def test_7_prefix(self):
        assert get_brand_for_product_code('77711GQ4') == 'ZURU'

    def test_15756_prefix(self):
        assert get_brand_for_product_code('15756A') == 'SPONGEBOB SQUAREPANTS'

    def test_157_prefix(self):
        assert get_brand_for_product_code('15754') == 'ZURU/FUGGLER'

    def test_9548_prefix(self):
        assert get_brand_for_product_code('9548X') == 'ZURU'

    def test_95_prefix(self):
        assert get_brand_for_product_code('9500A') == 'ZURU/PetsAlive'

    def test_92_prefix(self):
        assert get_brand_for_product_code('9258A') == 'ZURU/RAinBocoRns'

    def test_25_prefix(self):
        assert get_brand_for_product_code('25001') == 'ZURU'

    def test_unknown_prefix(self):
        assert get_brand_for_product_code('99999') is None


class ProductMappingTest(TestCase):
    def test_create_and_lookup(self):
        ProductMapping.objects.create(product_code='77711GQ4', product_name='冰箱迷你球', gross_weight_per_box=1.578, net_weight_per_box=1.022)
        pm = ProductMapping.objects.get(product_code='77711GQ4')
        assert pm.product_name == '冰箱迷你球'
