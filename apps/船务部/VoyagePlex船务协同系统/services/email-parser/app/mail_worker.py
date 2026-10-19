"""Bounded, disposable single-email parser processes (no mailbox credentials)."""
import ctypes
import hashlib
from email import policy
from email.header import decode_header, make_header
from email.parser import BytesHeaderParser
import json
import os
from pathlib import Path
import resource
import select
import signal
import subprocess
import sys
import tempfile
import time

MAX_RAW_BYTES = 40 * 1024 * 1024
MAX_RESULT_BYTES = 1024 * 1024
WORKER_ADDRESS_SPACE = 256 * 1024 * 1024
WORKER_SECONDS = 18
WORKER_COMMAND = [sys.executable, "-m", "app.mail_worker"]
MESSAGES = {
    "parse_memory": "邮件解析内存超出单封预算，已隔离供人工处理",
    "parse_timeout": "邮件解析超过单封时间预算，已隔离供人工处理",
    "parse_result_size": "邮件解析结果超过单封大小预算，已隔离供人工处理",
    "parse_process": "邮件解析进程异常退出，已隔离供人工处理",
    "parse_cancelled": "邮件解析已取消",
}


def failed(filename, kind):
    return {"filename": filename, "status": "failed", "error": MESSAGES[kind],
            "failure_kind": kind}


def failure_headers(raw):
    """Bounded identifiers only; never decode a failed email's body in parent."""
    message = {"sender": "", "subject": "", "message_id": ""}
    try:
        head = raw[:65536]
        head = head.split(b"\r\n\r\n", 1)[0].split(b"\n\n", 1)[0]
        headers = BytesHeaderParser(policy=policy.compat32).parsebytes(head + b"\r\n\r\n")
        for source, target in (("From", "sender"), ("Subject", "subject"), ("Message-ID", "message_id")):
            message[target] = str(make_header(decode_header(str(headers.get(source, ""))[:2048])))[:512]
    except Exception:
        pass
    return {"message": message, "fingerprint": hashlib.sha256(raw).hexdigest()}


def _limits():
    # Linux cgroup testing covers this limit. macOS has a different virtual
    # address layout; its functional tests must not claim Linux memory coverage.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (WORKER_ADDRESS_SPACE, WORKER_ADDRESS_SPACE))
    resource.setrlimit(resource.RLIMIT_CPU, (12, 13))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def _parse(raw, filename, company):
    from .main import parse_email_entries
    result = parse_email_entries([{"filename": filename, "raw": raw}], company)["items"][0]
    if result.get("status") == "failed" and not result.get("error"):
        result["error"] = MESSAGES["parse_process"]
    return result


def _child(write_fd, raw, filename, company):
    # Third-party parsing diagnostics cannot contaminate the JSON protocol or
    # leak email contents into application logs.
    null = os.open(os.devnull, os.O_RDWR)
    os.dup2(null, 1)
    os.dup2(null, 2)
    os.close(null)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    try:
        _limits()
        result = _parse(raw, filename, company)
        encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode()
        if len(encoded) > MAX_RESULT_BYTES:
            encoded = json.dumps(failed(filename, "parse_result_size")).encode()
    except MemoryError:
        encoded = json.dumps(failed(filename, "parse_memory")).encode()
    except BaseException:
        encoded = json.dumps(failed(filename, "parse_process")).encode()
    try:
        view = memoryview(encoded)
        while view:
            view = view[os.write(write_fd, view):]
    finally:
        os.close(write_fd)
    os._exit(0)


def _group_members():
    """Owned group plus descendants, including tools that create a session."""
    if sys.platform != "linux":
        return []
    table = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            table[int(entry.name)] = (int(fields[1]), int(fields[2]))
        except (OSError, ValueError, IndexError):
            continue
    owned = {pid for pid, (_, group) in table.items() if group == os.getpgrp()}
    ancestors = {os.getpid()}
    while True:
        children = {pid for pid, (parent, _) in table.items() if parent in ancestors}
        if children <= ancestors:
            break
        ancestors |= children
    return list((owned | ancestors) - {os.getpid()})


def supervise(raw, filename, company):
    """Lightweight supervisor remains responsive while native parsing runs.

    Linux subreaping lets it kill AND reap attachment-tool descendants before
    returning. It never imports the parser's large dependency graph itself.
    """
    if os.getpgrp() != os.getpid():
        return failed(filename, "parse_process")  # Never inspect/signal a shared group.
    if sys.platform == "linux":
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            return failed(filename, "parse_process")
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    read_fd, write_fd = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read_fd)
        _child(write_fd, raw, filename, company)
    os.close(write_fd)
    os.set_blocking(read_fd, False)
    output = bytearray()
    deadline = time.monotonic() + WORKER_SECONDS
    reason = None
    child_status = None
    try:
        while True:
            if stopped or time.monotonic() >= deadline:
                reason = "parse_cancelled" if stopped else "parse_timeout"
                break
            ready, _, _ = select.select([read_fd], [], [], .05)
            if ready:
                data = os.read(read_fd, min(65536, MAX_RESULT_BYTES + 1 - len(output)))
                if not data:
                    break
                output.extend(data)
                if len(output) > MAX_RESULT_BYTES:
                    reason = "parse_result_size"
                    break
    finally:
        os.close(read_fd)
        # This supervisor has its own session/group. Native tools share that
        # group and are adopted here if their original parent exits first.
        cleanup_until = time.monotonic() + .7
        while True:
            for pid in set(_group_members() + [child]):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            any_children = False
            while True:
                try:
                    pid, status = os.waitpid(-1, os.WNOHANG)
                    if pid == 0:
                        any_children = True
                        break
                    if pid == child:
                        child_status = status
                except ChildProcessError:
                    break
            if not any_children and not _group_members():
                break
            if time.monotonic() >= cleanup_until:
                reason = reason or "parse_process"
                break
            time.sleep(.01)
    if reason:
        return failed(filename, reason)
    try:
        result = json.loads(output)
        if not isinstance(result, dict) or result.get("filename") != filename or result.get("status") not in {"parsed", "failed"}:
            raise ValueError()
        return result
    except (ValueError, UnicodeError):
        return failed(filename, "parse_timeout" if child_status is not None and os.WIFSIGNALED(child_status)
                      and os.WTERMSIG(child_status) == signal.SIGXCPU else "parse_process")


def parse_isolated(raw, filename, company, cancelled, deadline):
    """One bounded stdin/stdout transaction; parent never parses email itself."""
    if len(raw) > MAX_RAW_BYTES:
        return failed(filename, "parse_memory")
    until = min(deadline, time.monotonic() + WORKER_SECONDS + 2)
    if cancelled.is_set() or time.monotonic() >= until:
        return failed(filename, "parse_cancelled" if cancelled.is_set() else "parse_timeout")
    with tempfile.TemporaryDirectory(prefix="voyageplex-mail-worker-") as temp:
        environment = {key: value for key, value in os.environ.items()
                       if key in {"PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH"}}
        environment["TMPDIR"] = temp
        process = subprocess.Popen(WORKER_COMMAND + [company, filename],
                                   cwd=Path(__file__).resolve().parent.parent, env=environment,
                                   start_new_session=True, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for stream in (process.stdin, process.stdout, process.stderr):
            os.set_blocking(stream.fileno(), False)
        pending = memoryview(raw)
        if not pending:
            process.stdin.close()
        output = bytearray()
        streams = {process.stdout, process.stderr}
        reason = None
        try:
            while streams:
                if cancelled.is_set() or time.monotonic() >= until:
                    reason = "parse_cancelled" if cancelled.is_set() else "parse_timeout"
                    break
                readable, writable, _ = select.select(list(streams), [process.stdin] if pending else [], [], .05)
                for stream in writable:
                    try:
                        pending = pending[os.write(stream.fileno(), pending[:65536]):]
                        if not pending:
                            process.stdin.close()
                    except BrokenPipeError:
                        pending = pending[:0]
                        process.stdin.close()
                for stream in readable:
                    data = os.read(stream.fileno(), 65536)
                    if not data:
                        streams.remove(stream)
                    elif stream is process.stdout:
                        output.extend(data)
                        if len(output) > MAX_RESULT_BYTES:
                            reason = "parse_result_size"
                            break
                if reason:
                    break
        finally:
            if process.poll() is None:
                try:
                    os.kill(process.pid, signal.SIGTERM)  # responsive supervisor
                    process.wait(timeout=1)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    pass
            try:
                os.killpg(process.pid, signal.SIGKILL)  # owned disposable group only
            except ProcessLookupError:
                pass
            process.wait(timeout=1)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
        if reason:
            return failed(filename, reason)
        try:
            result = json.loads(output)
            if not isinstance(result, dict) or result.get("filename") != filename:
                raise ValueError()
            return result
        except (ValueError, UnicodeError):
            return failed(filename, "parse_process")


if __name__ == "__main__":
    try:
        company, filename = sys.argv[1:]
        if company not in {"Xingxin", "Huadeng"} or not filename.endswith(".eml") or len(filename) > 100:
            raise ValueError()
        raw = sys.stdin.buffer.read(MAX_RAW_BYTES + 1)
        result = failed(filename, "parse_memory") if len(raw) > MAX_RAW_BYTES else supervise(raw, filename, company)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")), flush=True)
    except BaseException:
        # No tracebacks or untrusted exception messages in container logs.
        print('{"status":"failed","error":"邮件解析进程异常退出","failure_kind":"parse_process"}', flush=True)
        sys.exit(1)
