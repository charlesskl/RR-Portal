import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.rules import filter_items_for_email


class FilterItemsForEmailTests(unittest.TestCase):
    def test_warehouse_delivery_keeps_external_factory_cargo(self):
        items = [
            {"product_code": "A1", "supplier": "兴信"},
            {"product_code": "B1", "supplier": "JAZ"},
            {"product_code": "C1", "supplier": "TOMY"},
        ]
        self.assertEqual(items, filter_items_for_email(items, "warehouse"))

    def test_standard_email_keeps_existing_filter(self):
        items = [
            {"product_code": "A1", "supplier": "兴信"},
            {"product_code": "B1", "supplier": "JAZ"},
        ]
        self.assertEqual([items[0]], filter_items_for_email(items, "standard"))


if __name__ == "__main__":
    unittest.main()
