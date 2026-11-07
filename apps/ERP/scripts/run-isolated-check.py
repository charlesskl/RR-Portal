#!/usr/bin/env python3
"""Run one quality-check command with test DB and external integrations disabled.

Only the exec child's environment changes. Tests may explicitly configure their
own in-process HTTP fixtures after startup; inherited service credentials never
reach WebApplicationFactory or a build/test tool.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import re
import sys


def isolated_environment(inherited: dict[str, str]) -> dict[str, str]:
    # The process environment is a system boundary. Parse the SQL catalog rather
    # than trusting a filename, a caller-set marker, or a substring in a password.
    spec = importlib.util.spec_from_file_location("require_test_db", Path(__file__).with_name("require-test-db.py"))
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    test_db = inherited.get("ERP_TEST_DB", "")
    catalogs = [value for key, value in guard.connection_pairs(test_db) if key in ("database", "initialcatalog")]
    if len(catalogs) != 1 or catalogs[0].strip().casefold() != "erp_test":
        raise ValueError("ERP_TEST_DB 必须明确且仅指定 Database/Initial Catalog=erp_test")

    def is_external_setting(key: str) -> bool:
        normalized = key.replace("__", ":").casefold()
        for prefix in ("aspnetcore_", "dotnet_"):
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix):]
        return bool(re.match(r"^(paiji|sprayplan|engineeringdocs)(?:$|[:_])", normalized)) or normalized.startswith(
            ("erp_test_paiji_", "erp_test_sprayplan_", "erp_test_engineeringdocs_")
        ) or normalized == "erp:connectionstringenvvar"

    result = {key: value for key, value in inherited.items() if not is_external_setting(key)}
    # Blank canonical values also override appsettings/default production URLs.
    for section, names in {
        "Paiji": ("BaseUrl", "User", "Password", "WebhookToken", "ReturnToken", "SyncWorkshops"),
        "SprayPlan": ("BaseUrl", "User", "Password"),
        "EngineeringDocs": ("BaseUrl", "User", "Password"),
    }.items():
        for name in names:
            result[f"{section}__{name}"] = ""
    result["Paiji__SyncIntervalSeconds"] = "30"
    result["SprayPlan__SyncIntervalSeconds"] = "30"
    result["ERP_DB"] = test_db
    result["Erp__ConnectionStringEnvVar"] = "ERP_DB"
    return result


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：run-isolated-check.py <检查工具> [参数...]", file=sys.stderr)
        return 2
    try:
        environment = isolated_environment(dict(os.environ))
    except ValueError as error:
        print(f"拒绝运行隔离检查：{error}（连接凭据不输出）。", file=sys.stderr)
        return 2
    try:
        os.execvpe(sys.argv[1], sys.argv[1:], environment)
    except OSError as error:
        print(f"无法启动隔离检查工具：{type(error).__name__}。", file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main())
