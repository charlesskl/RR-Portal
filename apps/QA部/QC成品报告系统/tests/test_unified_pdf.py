import io
import unittest
from unittest.mock import patch

from reportlab.pdfgen import canvas

from unified_pdf import (
    _Evidence,
    _draw_photo_page,
    _normalize_photos,
    _packaging_items,
    _percentage_value,
    _timestamp_value,
    _weight_value,
)


class UnifiedPDFNormalizationTests(unittest.TestCase):
    def test_semicolon_packaging_requirements_become_report_rows(self):
        rows = _packaging_items(
            {},
            {"individual_packaging": "Open Box=YES; Header=Y; Mailer=NO; Warning label=N"},
        )
        self.assertEqual(
            rows,
            [
                ("Open Box", "YES"),
                ("Header", "YES"),
                ("Mailer", "NO"),
                ("Warning label", "NO"),
            ],
        )

    def test_bilingual_photo_labels_are_english_and_one_warehouse_stays_one(self):
        evidence, warehouse = _normalize_photos(
            {
                "photo_slots": [
                    {
                        "label": "产品整体 / Product overview",
                        "category": "product",
                        "required": True,
                        "instruction": "拍摄完整产品",
                        "photos": [{"file_path": "product.jpg"}],
                    },
                    {
                        "label": "仓库存货 / Warehouse stock",
                        "category": "warehouse",
                        "required": True,
                        "photos": [{"file_path": "warehouse.jpg"}],
                    },
                ]
            }
        )
        self.assertEqual([(item.title, item.caption) for item in evidence], [("Product overview", "Product overview")])
        self.assertEqual([(item.title, item.caption) for item in warehouse], [("Warehouse stock", "Warehouse stock")])

    def test_display_values_do_not_add_invalid_or_duplicate_units(self):
        self.assertEqual(_percentage_value(None), "-")
        self.assertEqual(_percentage_value(100), "100%")
        self.assertEqual(_weight_value("1.21 kg"), "1.21 kg")
        self.assertEqual(_weight_value("1.39"), "1.39 kg")
        self.assertEqual(_timestamp_value("2026-07-15T02:44:45.641526"), "2026-07-15 02:44")

    def test_partial_photo_page_does_not_render_fake_empty_slots(self):
        output = io.BytesIO()
        document = canvas.Canvas(output)
        with patch("unified_pdf._draw_photo_card") as draw_card:
            _draw_photo_page(
                document,
                {"company_name": "QC", "report_no": "R-1", "revision": 0},
                page_no=3,
                total_pages=4,
                items=[_Evidence("Carton packing", "Carton packing", "photo.jpg")],
                start_index=9,
            )
        self.assertEqual(draw_card.call_count, 1)
        self.assertEqual(draw_card.call_args.args[-1], 9)


if __name__ == "__main__":
    unittest.main()
