import asyncio
from email.message import EmailMessage
from io import BytesIO
import unittest

import openpyxl
from starlette.datastructures import UploadFile

from app.main import parse_email_batch
from app.rules import parse_body, requires_cargo_split


def packing_mail(subject, body):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["SKU NO.", "DESCRIPTION", "Actual factory", "Main assembly factory", "Retail Unit", "NO of CARTON", "MEASMT(CBM)"])
    for code, factory in (("77794", "兴信"), ("77673TQ1", "兴信"), ("15783UQ1", "兴信"),
                          ("15789UQ1", "兴信"), ("77772GQ2", "兴信"), ("15915", "丹尼"), ("15786UQ1", "华康")):
        sheet.append([code, "TOY", factory, "兴信", 100, 10, 8])
    data = BytesIO()
    workbook.save(data)
    mail = EmailMessage()
    mail["Subject"] = subject
    mail.set_content(body)
    mail.add_attachment(data.getvalue(), maintype="application", subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename="packing.xlsx")
    return UploadFile(filename="cargo.eml", file=BytesIO(mail.as_bytes()))


class OptimizationRulesTests(unittest.TestCase):
    def test_external_cargo_with_main_assembly_factory_is_kept(self):
        result = asyncio.run(parse_email_batch([packing_mail("出货通知", "请查收附件")]))["items"][0]
        self.assertEqual("parsed", result["status"])
        self.assertEqual(7, len(result["items"]))
        self.assertTrue(all(item["loading_factory"] == "兴信" for item in result["items"]))
        self.assertEqual(["丹尼", "华康"], [item["supplier"] for item in result["items"][-2:]])

    def test_loading_instruction_keeps_external_cargo_without_assembly_column(self):
        from app.rules import filter_items_for_email, loading_factory_from_text
        cargo = [{"supplier": "丹尼"}, {"supplier": "华康"}]
        marker = loading_factory_from_text("兴信做柜，丹尼送兴信拼柜")
        self.assertEqual(cargo, filter_items_for_email(cargo, "standard", marker))

    def test_explicit_ship_date_does_not_replace_cutoff(self):
        for label in ("出货", "出货日", "出货日期", "计划走货日期", "预计提货时间", "Pick up Date"):
            fields = parse_body(f"{label}: 2026/9/26 8:00\nCY closing date: 2026/9/30 12:00")
            self.assertEqual("2026-09-26", fields["ship_date"], label)
            self.assertEqual("2026-09-30T12:00", fields["cutoff_date"], label)

    def test_date_before_shipping_instruction(self):
        self.assertEqual("2026-09-26", parse_body("2026年9月26日出货")["ship_date"])
        self.assertTrue(parse_body("9月26日 出 1*40HQ")["ship_date"].endswith("-09-26"))

    def test_short_date_and_invalid_date(self):
        self.assertTrue(parse_body("出货日：9月26日")["ship_date"].endswith("-09-26"))
        self.assertEqual("", parse_body("出货日：2026/2/30")["ship_date"])
        self.assertEqual("", parse_body("预计提货时间待通知\n截关：2026/9/30")["ship_date"])

    def test_current_instruction_overrides_quoted_ship_date(self):
        fields = parse_body("出货日：2026/9/28\nFrom: old\nPick up Date: 2026/9/26")
        self.assertEqual("2026-09-28", fields["ship_date"])

    def test_waiting_notification_requires_per_row_allocation(self):
        result = asyncio.run(parse_email_batch([packing_mail("兴信做柜", "货物已装满一个柜，剩余货物走散柜，等客户另行通知")]))["items"][0]
        self.assertEqual("true", result["fields"]["cargo_split_required"])
        self.assertEqual(7, len(result["items"]))
        self.assertTrue(all(item["shipment_scope"] == "unassigned" for item in result["items"]))
        self.assertTrue(result["warnings"])

    def test_quoted_remainder_does_not_hold_current_shipment(self):
        self.assertFalse(requires_cargo_split("现在全部出货\nFrom: old\n剩余货物等客户另行通知"))


if __name__ == "__main__":
    unittest.main()
