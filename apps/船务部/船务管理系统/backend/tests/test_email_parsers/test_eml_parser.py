"""EML 文件解析器测试。"""

import os
import tempfile
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders
from email.utils import formatdate

from django.test import TestCase, override_settings

from apps.emails.parsers.eml_parser import parse_eml_file


# 使用临时目录作为 MEDIA_ROOT，避免污染项目目录
TEST_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class EmlParserTest(TestCase):

    def _make_eml(self, subject='Test', body='Hello', attachments=None,
                  sender='test@example.com', message_id='<test@example.com>'):
        """创建测试用的 .eml 文件。"""
        if attachments:
            msg = MIMEMultipart()
            msg.attach(MIMEText(body, 'plain', 'utf-8'))
            for filename, content in attachments:
                part = MIMEBase('application', 'octet-stream')
                part.set_payload(content)
                encoders.encode_base64(part)
                part.add_header(
                    'Content-Disposition', 'attachment', filename=filename
                )
                msg.attach(part)
        else:
            msg = MIMEText(body, 'plain', 'utf-8')

        msg['Subject'] = subject
        msg['From'] = sender
        msg['To'] = 'receiver@example.com'
        msg['Message-ID'] = message_id
        msg['Date'] = formatdate(localtime=True)

        tmp = tempfile.NamedTemporaryFile(
            suffix='.eml', delete=False, mode='wb'
        )
        tmp.write(msg.as_bytes())
        tmp.close()
        self.addCleanup(os.unlink, tmp.name)
        return tmp.name

    def test_parse_basic_eml(self):
        path = self._make_eml(subject='Shipping Notice', body='SO# SHZ123')
        result = parse_eml_file(path)
        assert result['subject'] == 'Shipping Notice'
        assert 'SO# SHZ123' in result['body_text']
        assert result['sender'] == 'test@example.com'
        assert result['message_id'] == '<test@example.com>'
        assert result['received_at'] is not None

    def test_parse_eml_with_attachments(self):
        path = self._make_eml(
            attachments=[('test.xlsx', b'fake-excel'), ('booking.pdf', b'fake-pdf')]
        )
        result = parse_eml_file(path)
        assert len(result['attachments']) == 2
        for att in result['attachments']:
            assert os.path.exists(att['saved_path'])
            assert att['size'] > 0
            assert att['filename'] in ('test.xlsx', 'booking.pdf')

    def test_parse_eml_no_attachments(self):
        path = self._make_eml(body='简单邮件正文')
        result = parse_eml_file(path)
        assert result['attachments'] == []
        assert '简单邮件正文' in result['body_text']

    def test_parse_eml_empty_body(self):
        path = self._make_eml(body='')
        result = parse_eml_file(path)
        assert result['body_text'] == ''

    def tearDown(self):
        # 清理测试中保存的附件
        attachments_dir = os.path.join(TEST_MEDIA_ROOT, 'attachments')
        if os.path.exists(attachments_dir):
            for f in os.listdir(attachments_dir):
                os.unlink(os.path.join(attachments_dir, f))
