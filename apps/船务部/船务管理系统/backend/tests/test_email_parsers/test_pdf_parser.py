"""PDF 解析器单元测试。"""

from django.test import TestCase

from apps.emails.parsers.pdf_parser import parse_booking_pdf_text


class PdfParserTextTest(TestCase):
    """测试 parse_booking_pdf_text 对不同文本格式的解析。"""

    def test_english_delivery_address(self):
        text = "Delivery Address: Yantian Port Warehouse B3\nOther info"
        result = parse_booking_pdf_text(text)
        assert result['delivery_address'] == 'Yantian Port Warehouse B3'

    def test_chinese_delivery_address(self):
        text = "送货地址：深圳市盐田港仓库B3号\n其他信息"
        result = parse_booking_pdf_text(text)
        assert result['delivery_address'] == '深圳市盐田港仓库B3号'

    def test_place_of_delivery(self):
        text = "Place of Delivery: Shanghai Waigaoqiao Terminal\nNext line"
        result = parse_booking_pdf_text(text)
        assert result['delivery_address'] == 'Shanghai Waigaoqiao Terminal'

    def test_delivery_place(self):
        text = "Delivery Place: Nansha Port Gate 5\nOther"
        result = parse_booking_pdf_text(text)
        assert result['delivery_address'] == 'Nansha Port Gate 5'

    def test_vgm_cutoff(self):
        text = "VGM CUT OFF: 2026-03-15 12:00\nSome other line"
        result = parse_booking_pdf_text(text)
        assert result['customs_cutoff'] == '3/15 12:00'

    def test_chinese_cutoff(self):
        text = "截关时间：2026/3/7 12:00\n其他"
        result = parse_booking_pdf_text(text)
        assert result['customs_cutoff'] == '3/7 12:00'

    def test_cy_cutoff(self):
        text = "CY CUT OFF: 2026-03-20 18:00\nNext"
        result = parse_booking_pdf_text(text)
        assert result['customs_cutoff'] == '3/20 18:00'

    def test_gate_cut_off(self):
        text = "Gate Cut Off: 2026-04-01 09:00\nEnd"
        result = parse_booking_pdf_text(text)
        assert result['customs_cutoff'] == '4/1 09:00'

    def test_no_match(self):
        text = "This is a random document with no relevant fields."
        result = parse_booking_pdf_text(text)
        assert result['delivery_address'] == ''
        assert result['customs_cutoff'] == ''

    def test_combined_fields(self):
        text = (
            "Booking Confirmation\n"
            "Delivery Address: Shekou Port Terminal 2\n"
            "VGM CUT OFF: 2026-03-10 15:00\n"
            "Vessel: EVER GIVEN"
        )
        result = parse_booking_pdf_text(text)
        assert result['delivery_address'] == 'Shekou Port Terminal 2'
        assert result['customs_cutoff'] == '3/10 15:00'
