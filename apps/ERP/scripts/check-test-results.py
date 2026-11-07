#!/usr/bin/env python3
"""Read authoritative framework reports, failing on missing/failed/skipped tests."""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def backend(path: Path) -> bool:
    root = ET.parse(path).getroot()
    counters = root.find(".//{*}ResultSummary/{*}Counters")
    if counters is None:
        raise ValueError("TRX 没有测试计数")
    if not all(key in counters.attrib for key in ("total", "executed", "passed", "failed", "notExecuted")):
        raise ValueError("TRX 缺少必需测试计数")
    values = {key: int(value) for key, value in counters.attrib.items()}
    total, passed = values.get("total", 0), values.get("passed", 0)
    failed, skipped = values.get("failed", 0), values.get("notExecuted", 0)
    other = sum(values.get(key, 0) for key in ("error", "timeout", "aborted", "inconclusive", "passedButRunAborted"))
    print(f"后端真实摘要：总计 {total}，通过 {passed}，失败 {failed}，跳过 {skipped}，其他异常 {other}。")
    return total > 0 and passed == total and values.get("executed", 0) == total and not (failed or skipped or other)


def frontend(path: Path) -> bool:
    report = json.loads(path.read_text(encoding="utf-8"))
    fields = ("numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests")
    if not all(field in report for field in fields):
        raise ValueError("Vitest JSON 缺少必需测试计数")
    total, passed, failed, skipped, todo = (int(report[field]) for field in fields)
    errors = sum(int(report.get(field, 0)) for field in ("numRuntimeErrorTestSuites", "numFailedTestSuites", "numPendingTestSuites"))
    print(f"前端真实摘要：总计 {total}，通过 {passed}，失败 {failed}，跳过 {skipped}，待办 {todo}，测试文件异常 {errors}。")
    return report.get("success") is True and total > 0 and passed == total and not (failed or skipped or todo or errors)


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("backend", "frontend"):
        print("用法：check-test-results.py backend|frontend 报告路径", file=sys.stderr)
        return 2
    try:
        passed = (backend if sys.argv[1] == "backend" else frontend)(Path(sys.argv[2]))
    except (OSError, ValueError, TypeError, ET.ParseError) as error:
        print(f"无法确认测试结果：{error}", file=sys.stderr)
        return 2
    if not passed:
        print("检查失败：必须实际执行全部测试且没有失败、跳过或待办。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
