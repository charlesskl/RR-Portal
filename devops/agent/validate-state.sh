#!/usr/bin/env bash
# ============================================================
# State JSON Validator — Validates phase input/output files
# ============================================================
# Checks that a state JSON file has required fields and
# correct schema version before a phase proceeds.
#
# Usage: validate-state.sh <json-file> <expected-phase> [--require-success]
#
# Exit 0: Valid
# Exit 1: Invalid (reason printed to stderr)
# ============================================================

set -euo pipefail

JSON_FILE="${1:?Usage: validate-state.sh <json-file> <expected-phase> [--require-success]}"
EXPECTED_PHASE="${2:?Missing expected-phase argument}"
REQUIRE_SUCCESS="${3:-}"

if [[ ! -f "$JSON_FILE" ]]; then
  echo "ERROR: State file not found: $JSON_FILE" >&2
  exit 1
fi

# Quick sanity checks before parsing
FILE_SIZE=$(wc -c < "$JSON_FILE" | tr -d ' ')
if [[ "$FILE_SIZE" -eq 0 ]]; then
  echo "ERROR: State file is empty (0 bytes): $JSON_FILE" >&2
  exit 1
fi
if [[ "$FILE_SIZE" -lt 20 ]]; then
  echo "ERROR: State file is suspiciously small (${FILE_SIZE} bytes): $JSON_FILE" >&2
  echo "  Content: $(cat "$JSON_FILE")" >&2
  exit 1
fi

# Validate JSON is parseable and has required fields
python3 -c "
import json, sys

try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except (json.JSONDecodeError, FileNotFoundError) as e:
    print(f'ERROR: Invalid JSON: {e}', file=sys.stderr)
    sys.exit(1)

expected_phase = sys.argv[2]
require_success = len(sys.argv) > 3 and sys.argv[3] == '--require-success'

# Check schema version
if data.get('schema_version') != 1:
    print(f'ERROR: Expected schema_version 1, got {data.get(\"schema_version\")}', file=sys.stderr)
    sys.exit(1)

# Check phase matches
if data.get('phase') != expected_phase:
    print(f'ERROR: Expected phase \"{expected_phase}\", got \"{data.get(\"phase\")}\"', file=sys.stderr)
    sys.exit(1)

# Check required base fields
for field in ['app_name', 'timestamp', 'status']:
    if field not in data or not data[field]:
        print(f'ERROR: Missing required field: {field}', file=sys.stderr)
        sys.exit(1)

# Check status if required
if require_success and data.get('status') != 'success':
    print(f'ERROR: Previous phase status is \"{data.get(\"status\")}\", expected \"success\"', file=sys.stderr)
    if data.get('error'):
        print(f'  Previous error: {data[\"error\"]}', file=sys.stderr)
    sys.exit(1)

# Phase-specific field validation (warn on missing recommended fields)
recommended = {
    'understand': ['action', 'stack'],
    'prepare': ['qc_checks_passed'],
    'deploy': ['image_tag', 'host_port'],
    'verify': ['health_check'],
}

missing_recommended = []
for field in recommended.get(expected_phase, []):
    if field not in data:
        missing_recommended.append(field)

if missing_recommended:
    print(f'WARN: Phase \"{expected_phase}\" missing recommended fields: {missing_recommended}', file=sys.stderr)

print(f'OK: {expected_phase} state valid (status={data[\"status\"]})')
" "$JSON_FILE" "$EXPECTED_PHASE" "$REQUIRE_SUCCESS"
