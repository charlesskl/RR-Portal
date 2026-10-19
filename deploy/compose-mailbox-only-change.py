#!/usr/bin/env python3
"""Accept exact Compose environment additions and reviewed single-service fixes.

Exit 0 means update-server.sh may deploy the matching service incrementally. All other
changes and read failures exit 1, preserving the full Compose rollout fallback.
Read Git blobs only; never expand .env values or print Compose contents. With
--service, print only the whitelisted service name. Default invocation preserves
the legacy silent VoyagePlex-only validation contract.
"""

import re
import subprocess
import sys


COMPOSE_PATH = "docker-compose.cloud.yml"
MAILBOX_KEY = b"VOYAGEPLEX_HUADENG_MAILBOXES_JSON"
ADDED_LINE = b"      " + MAILBOX_KEY + b": ${" + MAILBOX_KEY + b":-}\n"
STATION_KEY = b"BUSINESS_SYNC_STATION"
STATION_LINE = b"      " + STATION_KEY + b": ${" + STATION_KEY + b":-}\n"
PEISE_MODEL_BEFORE = ("      # 注意: 阿里云已关闭 -latest 别名模型的访问权限(403 access_denied), 必须用稳定版模型名\n"
                      "      - BAILIAN_MODEL=${PEISE_BAILIAN_MODEL:-qwen-vl-max}\n").encode()
PEISE_MODEL_AFTER = ("      # 使用已验证可访问的视觉模型；API Key 所属地域与模型权限需匹配\n"
                     "      - BAILIAN_MODEL=${PEISE_BAILIAN_MODEL:-qwen3-vl-plus}\n").encode()
PRINTLINK_HEALTH_BEFORE = b'''      test: ["CMD-SHELL", "node -e \\"fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\\""]\n'''
PRINTLINK_HEALTH_AFTER = b'      test: ["CMD", "node", "ops/healthcheck.mjs"]\n'
PRINTLINK_HEALTH_BLOCK_BEFORE = (b'    healthcheck:\n' + PRINTLINK_HEALTH_BEFORE
    + b'      interval: 10s\n      timeout: 5s\n      retries: 3\n')
PRINTLINK_HEALTH_BLOCK_AFTER = (b'    healthcheck:\n' + PRINTLINK_HEALTH_AFTER
    + b'      interval: 10s\n      timeout: 5s\n      retries: 3\n')
PRINTLINK_MEMORY_BEFORE = b'    mem_limit: 512m\n    memswap_limit: 512m\n'
PRINTLINK_MEMORY_AFTER = b'    mem_limit: 768m\n    memswap_limit: 768m\n'


def is_mailbox_only_addition(before: bytes, after: bytes) -> bool:
    return _is_environment_only_addition(before, after, b"voyageplex-api", MAILBOX_KEY, ADDED_LINE)


def is_station_only_addition(before: bytes, after: bytes) -> bool:
    return _is_environment_only_addition(before, after, b"printlink", STATION_KEY, STATION_LINE)


def incremental_service(before: bytes, after: bytes):
    if is_mailbox_only_addition(before, after):
        return "voyageplex-api"
    if is_station_only_addition(before, after):
        return "printlink"
    if is_printlink_health_only_change(before, after):
        return "printlink"
    if is_peise_model_only_change(before, after):
        return "peise"
    return None


def _plain_service_block(blob: bytes, target: bytes):
    if not _quoted_scalars_complete_on_their_line(blob):
        return None
    services_seen = target_seen = 0
    in_services = False
    service = None
    start = end = None
    position = 0
    for line in blob.splitlines(keepends=True):
        significant = bool(line.strip()) and not line.lstrip().startswith(b"#")
        if significant and not line.startswith(b" "):
            if service == target:
                end = position
            in_services = line == b"services:\n"
            services_seen += int(in_services)
            service = None
        elif significant and in_services and line.startswith(b"  ") and not line.startswith(b"   "):
            if not re.fullmatch(rb"  [A-Za-z0-9_-]+:\n", line):
                return None
            if service == target:
                end = position
            service = line[2:-2]
            if service == target:
                target_seen += 1
                start = position
        elif significant and in_services and not line.startswith(b"    "):
            return None
        position += len(line)
    if service == target:
        end = len(blob)
    if services_seen != 1 or target_seen != 1 or start is None or end is None:
        return None
    return start, end, blob[start:end]


def is_printlink_health_only_change(before: bytes, after: bytes) -> bool:
    # Permit this exact resource/deadline fix only. All bytes outside the plain
    # PrintLink service, including all other services and credentials, must match.
    old = _plain_service_block(before, b"printlink")
    new = _plain_service_block(after, b"printlink")
    if old is None or new is None:
        return False
    block = old[2]
    if (block.count(PRINTLINK_HEALTH_BLOCK_BEFORE) != 1 or block.count(PRINTLINK_MEMORY_BEFORE) != 1
            or block.count(b"    healthcheck:\n") != 1
            or block.count(b"      test:") != 1
            or block.count(b"    mem_limit:") != 1 or block.count(b"    memswap_limit:") != 1):
        return False
    changed = block.replace(PRINTLINK_HEALTH_BLOCK_BEFORE, PRINTLINK_HEALTH_BLOCK_AFTER, 1)
    changed = changed.replace(PRINTLINK_MEMORY_BEFORE, PRINTLINK_MEMORY_AFTER, 1)
    return new[2] == changed and before[:old[0]] + changed + before[old[1]:] == after


def is_peise_model_only_change(before: bytes, after: bytes) -> bool:
    # Only the reviewed model/comment pair changes, with every other byte exact.
    # Do not accept arbitrary env replacements, credentials, or other services.
    if (before.count(PEISE_MODEL_BEFORE) != 1 or after.count(PEISE_MODEL_AFTER) != 1
            or after.replace(PEISE_MODEL_AFTER, PEISE_MODEL_BEFORE, 1) != before):
        return False
    if not _quoted_scalars_complete_on_their_line(after):
        return False
    in_services = False
    service = section = None
    services_seen = target_seen = environments_seen = 0
    eligible = False
    environment_keys = set()
    model_line = PEISE_MODEL_AFTER.splitlines(keepends=True)[1]
    for line in after.splitlines(keepends=True):
        if not line.strip() or line.lstrip().startswith(b"#"):
            continue
        if not line.startswith(b" "):
            in_services = line == b"services:\n"
            services_seen += int(in_services)
            service = section = None
            continue
        if not in_services:
            continue
        if line.startswith(b"  ") and not line.startswith(b"   "):
            if not re.fullmatch(rb"  [A-Za-z0-9_-]+:\n", line):
                return False
            service = line[2:-2]
            target_seen += int(service == b"peise")
            section = None
            continue
        if service != b"peise":
            continue
        if line.startswith(b"    ") and not line.startswith(b"     "):
            section = b"environment" if line == b"    environment:\n" else None
            environments_seen += int(section == b"environment")
            continue
        if section == b"environment":
            entry = re.fullmatch(rb"      - ([A-Za-z_][A-Za-z0-9_]*)=([^\r\n]+)\n", line)
            if (not entry or entry.group(1) in environment_keys
                    or not _is_single_line_environment_value(entry.group(2))):
                return False
            environment_keys.add(entry.group(1))
            if line == model_line:
                eligible = True
    return eligible and services_seen == target_seen == environments_seen == 1


def _quoted_scalars_complete_on_their_line(blob: bytes) -> bool:
    # A quoted value in any other service may legally span apparently mapped
    # lines at a lower indent. Never mistake its text for the target service.
    for line in blob.splitlines():
        if not line.strip() or line.lstrip().startswith(b"#"):
            continue
        # Quoted/complex/tagged mapping keys are outside this small parser's
        # grammar. Plain keys may be Unicode, including in another service.
        if line.lstrip()[:1] in (b"'", b'"', b"?", b"!", b"&", b"*"):
            return False
        mapping = re.fullmatch(rb"[ \t]*.+?:[ \t]+(.*)", line)
        sequence = re.fullmatch(rb"[ \t]*-[ \t]+(.*)", line)
        if not mapping and not sequence:
            continue
        value = (sequence or mapping).group(1).lstrip(b" \t")
        if sequence and value[:1] not in (b"'", b'"', b"[", b"{"):
            inline_mapping = re.fullmatch(rb".+?:[ \t]+(.*)", value)
            if inline_mapping:
                value = inline_mapping.group(1).lstrip(b" \t")
        # The actual Compose has single-line anchors for shared environment.
        anchor = re.match(rb"&[A-Za-z0-9_-]+(?:[ \t]+|$)", value)
        if anchor:
            value = value[anchor.end():].lstrip(b" \t")
        if value[:1] in (b"'", b'"'):
            if not _is_single_line_environment_value(value):
                return False
        elif value.startswith(b"!"):
            return False
        elif value[:1] in (b"[", b"{"):
            # Allow the existing single-line healthcheck/command arrays, but
            # reject a flow collection or quoted flow value continuing below.
            stack = []
            quote = None
            offset = 0
            while offset < len(value):
                char = value[offset:offset + 1]
                if quote:
                    if quote == b'"' and char == b"\\":
                        offset += 2
                        continue
                    if char == quote:
                        if quote == b"'" and value[offset + 1:offset + 2] == b"'":
                            offset += 2
                            continue
                        quote = None
                elif char in (b"'", b'"'):
                    quote = char
                elif char in (b"[", b"{"):
                    stack.append(char)
                elif char in (b"]", b"}"):
                    if not stack or (stack.pop(), char) not in [(b"[", b"]"), (b"{", b"}")]:
                        return False
                elif char == b"#":
                    break
                offset += 1
            if quote or stack:
                return False
    return True


def _is_single_line_environment_value(value: bytes) -> bool:
    value = value.lstrip(b" \t")
    # Block/flow collections, anchors, aliases and tags need a YAML parser to
    # determine their extent. They are outside this deliberately narrow exception.
    if not value or value[:1] in b">|&*![{":
        return False
    quote = value[:1]
    if quote not in (b"'", b'"'):
        return True

    offset = 1
    while offset < len(value):
        character = value[offset:offset + 1]
        if quote == b'"' and character == b"\\":
            offset += 2  # Double quotes escape the following character.
            continue
        if character == quote:
            if quote == b"'" and value[offset + 1:offset + 2] == b"'":
                offset += 2  # YAML single quotes escape a quote by doubling it.
                continue
            tail = value[offset + 1:]
            return (not tail.strip(b" \t") or
                    (tail.startswith((b" ", b"\t")) and tail.lstrip(b" \t").startswith(b"#")))
        offset += 1
    # An open quoted scalar may continue over the next apparently mapped line;
    # the whitelisted addition would be literal text rather than an env variable.
    return False


def _is_environment_only_addition(before: bytes, after: bytes, target: bytes,
                                  key: bytes, added_line: bytes) -> bool:
    # No removals, edits, duplicate definitions, line-ending changes, or changes
    # elsewhere qualify. In particular, this does not allow any literal secret.
    if key in before or after.count(added_line) != 1:
        return False
    if after.replace(added_line, b"", 1) != before:
        return False

    # Verify the literal is a mapping entry in the target service's environment,
    # not a similarly named variable under another service or a YAML block scalar.
    # Deliberately accept only the existing, plain indentation convention; unusual
    # YAML layouts fail closed rather than trying to infer their semantics.
    lines = after.splitlines(keepends=True)
    service = None
    section = None
    in_services = False
    services_seen = 0
    target_seen = 0
    environments_seen = 0
    eligible = False
    for line in lines:
        if not line.strip() or line.lstrip().startswith(b"#"):
            continue
        if not line.startswith(b" "):
            in_services = line == b"services:\n"
            services_seen += int(in_services)
            service = section = None
            continue
        if not in_services:
            continue
        if line.startswith(b"  ") and not line.startswith(b"   "):
            if not re.fullmatch(rb"  [A-Za-z0-9_-]+:\n", line):
                return False
            service = line[2:-2]
            target_seen += int(service == target)
            section = None
            continue
        if service != target:
            continue
        if line.startswith(b"    ") and not line.startswith(b"     "):
            section = b"environment" if line == b"    environment:\n" else None
            environments_seen += int(section == b"environment")
            continue
        if section == b"environment":
            # Only a simple mapping with complete single-line scalar values is
            # understood here. Validate quotes before considering an added line.
            entry = re.fullmatch(rb"      [A-Za-z_][A-Za-z0-9_]*: ([^\r\n]+)\n", line)
            if not entry or not _is_single_line_environment_value(entry.group(1)):
                return False
            if line == added_line:
                eligible = True
    return eligible and services_seen == target_seen == environments_seen == 1


def main() -> int:
    args = sys.argv[1:]
    show_service = args[:1] == ["--service"]
    if show_service:
        args = args[1:]
    if len(args) != 2:
        return 1
    blobs = []
    try:
        for revision in args:
            # update-server.sh supplies verified hashes; enforce that contract so
            # a revision cannot be interpreted as a git option or path expression.
            if not re.fullmatch(r"[0-9a-fA-F]{40,64}", revision):
                return 1
            result = subprocess.run(
                ["git", "show", f"{revision}:{COMPOSE_PATH}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            blobs.append(result.stdout)
    except (OSError, subprocess.CalledProcessError):
        return 1
    service = incremental_service(*blobs)
    if service is None or (not show_service and service != "voyageplex-api"):
        return 1
    if show_service:
        print(service)
    return 0


if __name__ == "__main__":
    sys.exit(main())
