from decimal import Decimal
from django.test import TestCase
from apps.shipments.calculations import calculate_weights, is_pallet_product, determine_main_factory


class CalculateWeightsTest(TestCase):
    def test_basic_calculation(self):
        gw, nw = calculate_weights(10, 1.5, 1.2)
        self.assertEqual(gw, Decimal('15.0'))
        self.assertEqual(nw, Decimal('12.0'))

    def test_decimal_precision(self):
        gw, nw = calculate_weights(3, 1.578, 1.022)
        self.assertEqual(gw, Decimal('4.734'))
        self.assertEqual(nw, Decimal('3.066'))

    def test_none_weights(self):
        gw, nw = calculate_weights(10, None, None)
        self.assertIsNone(gw)
        self.assertIsNone(nw)

    def test_partial_none(self):
        gw, nw = calculate_weights(10, 1.5, None)
        self.assertIsNone(gw)
        self.assertIsNone(nw)

    def test_zero_pieces(self):
        gw, nw = calculate_weights(0, 1.5, 1.2)
        self.assertEqual(gw, Decimal('0.0'))
        self.assertEqual(nw, Decimal('0.0'))


class IsPalletProductTest(TestCase):
    def test_slb_suffix(self):
        self.assertTrue(is_pallet_product('77711GQ4SLB'))

    def test_sk_suffix(self):
        self.assertTrue(is_pallet_product('12345SK'))

    def test_case_insensitive(self):
        self.assertTrue(is_pallet_product('77711gq4slb'))
        self.assertTrue(is_pallet_product('12345sk'))

    def test_normal_product(self):
        self.assertFalse(is_pallet_product('77711GQ4'))

    def test_contains_but_not_suffix(self):
        self.assertFalse(is_pallet_product('SLB12345'))
        self.assertFalse(is_pallet_product('SK12345'))


class DetermineMainFactoryTest(TestCase):
    def test_single_factory(self):
        items = [{'factory': '兴信', 'volume': 10.0}]
        self.assertEqual(determine_main_factory(items), '兴信')

    def test_multiple_factories(self):
        items = [
            {'factory': '兴信', 'volume': 30.0},
            {'factory': '大朗', 'volume': 20.0},
            {'factory': '兴信', 'volume': 10.0},
        ]
        self.assertEqual(determine_main_factory(items), '兴信')

    def test_empty_list(self):
        self.assertEqual(determine_main_factory([]), '')

    def test_equal_volumes(self):
        items = [
            {'factory': 'A', 'volume': 10.0},
            {'factory': 'B', 'volume': 10.0},
        ]
        # max returns first encountered max
        result = determine_main_factory(items)
        self.assertIn(result, ['A', 'B'])
