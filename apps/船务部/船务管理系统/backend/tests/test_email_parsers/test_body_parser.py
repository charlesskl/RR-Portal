"""邮件正文字段提取测试。"""

from django.test import TestCase

from apps.emails.parsers.body_parser import parse_email_body


class BodyParserTest(TestCase):

    def test_extract_so_number(self):
        result = parse_email_body("请安排出货 SO# SHZ7952680 柜型 1*40'HQ")
        assert result['so_number'] == 'SHZ7952680'

    def test_extract_so_number_without_hash(self):
        """SO 后面没有 # 或 : 时不应匹配。"""
        result = parse_email_body("SO SHZ123456")
        assert result['so_number'] == ''

    def test_extract_so_number_with_colon(self):
        result = parse_email_body("SO:SHZ123456")
        assert result['so_number'] == 'SHZ123456'

    def test_extract_container_type(self):
        result = parse_email_body("柜型 1*40'HQ  出货日期 3月26日")
        assert result['container_type'] == '1*40HQ'

    def test_extract_container_type_gp(self):
        result = parse_email_body("2X40GP 兴信做柜")
        assert result['container_type'] == '2*40GP'

    def test_extract_si_deadline(self):
        result = parse_email_body("SI: 3月27日9:00\n截数期：3月21日 12:00")
        assert '3/27' in result['si_deadline']

    def test_extract_si_deadline_chinese_colon(self):
        result = parse_email_body("SI：3月28日 10:00")
        assert '3/28' in result['si_deadline']

    def test_extract_cutoff_date(self):
        result = parse_email_body("截数期：3月21日 12:00")
        assert '3/21' in result['cutoff_date']

    def test_extract_vgm_cutoff(self):
        # VGM CUT OFF 不再从正文提取截数期（由PDF的Port Cargo Cut-off处理）
        result = parse_email_body("VGM CUT OFF: 3月20日 12:00")
        assert result['cutoff_date'] == ''

    def test_extract_special_requirements(self):
        result = parse_email_body("**拉网**立放**拍照")
        assert '拉网' in result['special_requirements']

    def test_extract_special_requirements_multiple(self):
        result = parse_email_body("注意**防潮**和**加固**处理")
        assert '防潮' in result['special_requirements']
        assert '加固' in result['special_requirements']

    def test_extract_port_yantian(self):
        result = parse_email_body("盐田港出货")
        assert result['port'] == '盐田'

    def test_extract_port_shekou(self):
        result = parse_email_body("在蛇口码头装柜")
        assert result['port'] == '蛇口'

    def test_extract_port_nansha(self):
        result = parse_email_body("南沙港区")
        assert result['port'] == '南沙'

    def test_no_fields_found(self):
        result = parse_email_body("这是一封普通邮件")
        assert result['so_number'] == ''
        assert result['container_type'] == ''
        assert result['si_deadline'] == ''
        assert result['cutoff_date'] == ''
        assert result['special_requirements'] == ''
        assert result['port'] == ''

    def test_si_sunday_adjusted_to_saturday(self):
        """SI 截止日期落在周日时应前推到周六。"""
        # 2026-03-29 是周日
        result = parse_email_body("SI: 3月29日 9:00")
        assert '3/28' in result['si_deadline']
