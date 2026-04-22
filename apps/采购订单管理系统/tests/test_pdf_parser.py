import os
import pytest
from parser.pdf_parser import parse_purchase_pdf

TEST_PDF = r'C:\Users\1\OneDrive\Desktop\华登\江平\采购FDJA20260158-01.pdf'

@pytest.mark.skipif(not os.path.exists(TEST_PDF), reason='Test PDF not found')
class TestPdfParser:
    def test_parse_header(self):
        result = parse_purchase_pdf(TEST_PDF)
        assert result['po_no'] == 'FDJA20260158'
        assert '华茂' in result['supplier_name']
        assert result['po_date'] == '2026-03-18'
        assert result['delivery_date'] == '2026-03-31'
        assert result['receiver'] == '江平'

    def test_parse_items_count(self):
        result = parse_purchase_pdf(TEST_PDF)
        assert len(result['items']) == 11

    def test_parse_first_item(self):
        result = parse_purchase_pdf(TEST_PDF)
        item = result['items'][0]
        assert item['product_code'] == 'JWC2269'
        assert 'XS' in item['product_name']
        assert item['quantity'] == 5000
        assert item['unit'] == 'PCS'
        assert item['unit_price'] == 0.452
        assert item['amount'] == 2260.0
        assert item['material_code'] == '08010804'

    def test_parse_total_amount(self):
        result = parse_purchase_pdf(TEST_PDF)
        total = sum(item['amount'] for item in result['items'])
        assert total == 25247.0

    def test_parse_specification(self):
        result = parse_purchase_pdf(TEST_PDF)
        item = result['items'][0]
        assert '350G' in item['specification']
