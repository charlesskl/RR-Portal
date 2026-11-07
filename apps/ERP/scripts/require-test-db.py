#!/usr/bin/env python3
"""Refuse destructive integration checks against anything except erp_test."""
from __future__ import annotations
import os
import sys


def connection_pairs(value: str) -> list[tuple[str, str]]:
    pairs = []
    index = 0
    while index < len(value):
        while index < len(value) and (value[index].isspace() or value[index] == ";"):
            index += 1
        if index == len(value):
            break
        start = index
        while index < len(value) and value[index] not in "=;":
            index += 1
        if index == len(value) or value[index] != "=":
            raise ValueError("连接串字段格式不正确")
        key = "".join(value[start:index].casefold().split())
        index += 1
        while index < len(value) and value[index].isspace():
            index += 1
        if index < len(value) and value[index] in "\"'":
            quote = value[index]
            index += 1
            chars = []
            while index < len(value):
                char = value[index]
                index += 1
                if char == quote:
                    if index < len(value) and value[index] == quote:
                        chars.append(quote)
                        index += 1
                    else:
                        break
                else:
                    chars.append(char)
            else:
                raise ValueError("连接串引号未闭合")
            item = "".join(chars)
            while index < len(value) and value[index].isspace():
                index += 1
            if index < len(value) and value[index] != ";":
                raise ValueError("连接串引号后有额外内容")
        else:
            start = index
            while index < len(value) and value[index] != ";":
                index += 1
            item = value[start:index].strip()
        pairs.append((key, item))
        if index < len(value):
            index += 1
    return pairs


def main() -> int:
    value = os.environ.get("ERP_TEST_DB", "")
    if not value.strip():
        print("拒绝运行：必须设置 ERP_TEST_DB，且数据库名必须为 erp_test。", file=sys.stderr)
        return 2
    try:
        catalogs = [item for key, item in connection_pairs(value) if key in ("database", "initialcatalog")]
    except ValueError as error:
        print(f"拒绝运行：ERP_TEST_DB {error}。", file=sys.stderr)
        return 2
    if len(catalogs) != 1 or catalogs[0].strip().casefold() != "erp_test":
        print("拒绝运行：ERP_TEST_DB 必须明确且仅指定一个 Database/Initial Catalog=erp_test。", file=sys.stderr)
        return 2
    print("数据库保护检查通过：ERP_TEST_DB → erp_test（连接凭据不输出）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
