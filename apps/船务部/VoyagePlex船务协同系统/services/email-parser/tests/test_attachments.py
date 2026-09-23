import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import openpyxl

from app.attachments import parse_excel


class ParseExcelTests(unittest.TestCase):
    def test_packing_list_parsed_in_read_only_mode(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "packing.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Packing List"
            ws.append(["ITEM NO", "DESCRIPTION", "QTY", "CTNS", "CBM"])
            ws.append(["A1", "TOY CAR", 100, 10, 1.5])
            ws.append(["B2", "PLUSH DOLL", 50, 5, 0.8])
            wb.save(path)
            result = parse_excel(path)
        self.assertEqual(result["kind"], "packing_list")
        self.assertEqual([item["product_code"] for item in result["items"]], ["A1", "B2"])
        self.assertEqual(result["items"][0]["source_row"], 2)
        self.assertEqual(result["items"][0]["quantity"], 100)
        self.assertEqual(result["items"][0]["pieces"], 10)
        self.assertEqual(result["items"][1]["volume"], 0.8)

    def test_workbook_with_huge_declared_dimension_does_not_hang(self):
        import zipfile
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "inflated.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.append(["ITEM NO", "DESCRIPTION", "QTY"])
            ws.append(["A1", "TOY CAR", 100])
            wb.save(path)
            # 伪造一个夸大的工作表维度（某些工具生成的文件常见）
            inflated = Path(root) / "inflated-patched.xlsx"
            with zipfile.ZipFile(path) as source, zipfile.ZipFile(inflated, "w") as target:
                for entry in source.infolist():
                    data = source.read(entry.filename)
                    if entry.filename == "xl/worksheets/sheet1.xml":
                        data = data.replace(b'dimension ref="A1:C2"', b'dimension ref="A1:C1048576"')
                    target.writestr(entry, data)
            result = parse_excel(inflated)
        self.assertEqual([item["product_code"] for item in result["items"]], ["A1"])


if __name__ == "__main__":
    unittest.main()
