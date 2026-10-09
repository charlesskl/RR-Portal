import unittest
from app.carrier_schedule import ScheduleTables, apply_carrier_schedule
from app.rules import normalize_deadline, parse_body


class CarrierScheduleTests(unittest.TestCase):
    def test_us_dates_and_voucher_priority(self):
        self.assertEqual(normalize_deadline("10/21/2026 17:00"), "2026-10-21T17:00")
        fields = parse_body("预计提货时间: 10/15/2026 SO:SBK0004739115\nCYCutoff:10/21/2026 12:00\nVoucher cut off:10/21/2026 17:00")
        self.assertEqual(fields["ship_date"], "2026-10-15")
        self.assertEqual(fields["cutoff_date"], "2026-10-21T17:00")

    def test_table_columns_and_order_isolation(self):
        parser = ScheduleTables()
        parser.feed("<table><tr><td>SO</td><td>Carrier SO</td><td>SI cutoff day</td><td>CYCutoff</td><td>Voucher cut off</td></tr>"
                    "<tr><td>SBK0001111111</td><td>999999999999</td><td>10/01/2026 15:00</td><td>10/01/2026 12:00</td><td>10/01/2026 17:00</td></tr>"
                    "<tr><td>SBK0004739115</td><td>149608933546</td><td>10/15/2026 15:00</td><td>10/21/2026 12:00</td><td>10/21/2026 17:00</td></tr></table>")
        fields = {"so_number": "SBK0004739115", "ship_date": "2026-10-15"}
        apply_carrier_schedule(fields, parser.tables)
        self.assertEqual(fields["so_number"], "SBK0004739115,149608933546")
        self.assertEqual(fields["si_deadline"], "2026-10-15T15:00")
        self.assertEqual(fields["cutoff_date"], "2026-10-21T17:00")
        self.assertEqual(fields["ship_date"], "2026-10-15")

    def test_forwarded_voucher_and_other_order_list(self):
        fields = parse_body("预计提货时间: 2026/9/26 SO:SBK0004609257\nSO List: SBK0004606704;SBK0004615130;SBK0004609257;\nFrom: sender\nCY closing date:2026/9/30 12:00\nCustom Voucher Cutoff:2026/9/30 17:00")
        self.assertEqual(fields["so_number"], "SBK0004609257")
        self.assertEqual(fields["_fallback_voucher_cutoff"], "2026-09-30T17:00")
