#!/usr/bin/env python3
"""Manage local VoyagePlex services with the macOS user launchd manager."""

import os
import plistlib
import socket
import subprocess
import sys
import time
from pathlib import Path


SERVICES = (
    ("web", 3000, ["/usr/bin/env", "npm", "run", "start", "--", "--hostname", "127.0.0.1"]),
    ("api", 5088, ["/usr/bin/env", "dotnet", "run", "--no-launch-profile", "--project", "server/VoyagePlex.Api/VoyagePlex.Api.csproj", "--urls", "http://127.0.0.1:5088"]),
    ("parser", 8091, ["services/email-parser/.venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8091", "--app-dir", "services/email-parser"]),
)


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=False)


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "start":
        print("用法: local_services.py start <项目目录>", file=sys.stderr)
        return 2
    project = Path(sys.argv[2]).resolve()
    agent_dir = Path.home() / "Library" / "LaunchAgents"
    log_dir = Path.home() / "Library" / "Logs" / "VoyagePlex"
    agent_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)
    domain = f"gui/{os.getuid()}"
    path = ":".join(dict.fromkeys((
        *os.environ.get("PATH", "").split(":"),
        "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
    )))

    installed_services = {
        name: run("launchctl", "print", f"{domain}/com.voyageplex.local.{name}").returncode == 0
        for name, _, _ in SERVICES
    }
    for name, port, _ in SERVICES:
        if not installed_services[name] and port_open(port):
            print(f"端口 {port} 已由其他进程占用。请先关闭旧的 VoyagePlex 启动窗口，再重新运行。", file=sys.stderr)
            return 1

    for name, port, command in SERVICES:
        label = f"com.voyageplex.local.{name}"
        target = f"{domain}/{label}"
        plist_path = agent_dir / f"{label}.plist"
        if installed_services[name]:
            result = run("launchctl", "kickstart", "-k", target)
            if result.returncode:
                print(f"{name} 重启失败：{result.stderr.strip()}", file=sys.stderr)
                return 1
            print(f"✓ {name} 已重启")
            continue
        arguments = [str(project / command[0]) if name == "parser" else command[0], *command[1:]]
        config = {
            "Label": label,
            "ProgramArguments": arguments,
            "WorkingDirectory": str(project),
            "EnvironmentVariables": {"PATH": path},
            "RunAtLoad": True,
            "KeepAlive": True,
            "StandardOutPath": str(log_dir / f"{name}.log"),
            "StandardErrorPath": str(log_dir / f"{name}.error.log"),
        }
        with plist_path.open("wb") as output:
            plistlib.dump(config, output)
        result = run("launchctl", "bootstrap", domain, str(plist_path))
        if result.returncode:
            print(f"{name} 启动失败：{result.stderr.strip()}", file=sys.stderr)
            return 1
        print(f"✓ {name} 已交由系统管理，关闭终端不会停止")

    for _ in range(40):
        if all(port_open(port) for _, port, _ in SERVICES):
            print("✓ VoyagePlex 三个服务均已启动")
            return 0
        time.sleep(0.5)
    print(f"服务尚未全部就绪，请查看日志：{log_dir}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
