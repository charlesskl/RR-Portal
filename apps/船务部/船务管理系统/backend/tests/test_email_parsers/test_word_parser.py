"""Word 解析器单元测试。"""

import os
import tempfile

from docx import Document
from django.test import TestCase

from apps.emails.parsers.word_parser import parse_word_attachment


class WordParserTest(TestCase):
    """测试 parse_word_attachment 对 .docx 文件的解析。"""

    def _create_test_docx(self, paragraphs: list[str]) -> str:
        doc = Document()
        for text in paragraphs:
            doc.add_paragraph(text)
        path = tempfile.NamedTemporaryFile(suffix='.docx', delete=False).name
        doc.save(path)
        return path

    def test_warehouse_address(self):
        path = self._create_test_docx([
            '入仓通知单',
            '仓库地址：深圳市宝安区福永街道XX仓库',
            '联系人：张三',
        ])
        try:
            result = parse_word_attachment(path)
            assert result['warehouse'] == '深圳市宝安区福永街道XX仓库'
        finally:
            os.unlink(path)

    def test_delivery_address(self):
        path = self._create_test_docx([
            '送货通知',
            '送货地址：东莞市虎门镇某某路88号',
        ])
        try:
            result = parse_word_attachment(path)
            assert result['warehouse'] == '东莞市虎门镇某某路88号'
        finally:
            os.unlink(path)

    def test_so_number(self):
        path = self._create_test_docx([
            '入仓通知',
            '收货地址：广州市南沙区仓库',
            'SO# YAX1234567',
        ])
        try:
            result = parse_word_attachment(path)
            assert result['so_number'] == 'YAX1234567'
            assert result['warehouse'] == '广州市南沙区仓库'
        finally:
            os.unlink(path)

    def test_no_match(self):
        path = self._create_test_docx([
            '这是一份普通文档',
            '没有任何地址信息',
        ])
        try:
            result = parse_word_attachment(path)
            assert result['warehouse'] == ''
            assert result['so_number'] == ''
        finally:
            os.unlink(path)
