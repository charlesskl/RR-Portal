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

print(f'OK: {expected_phase} state valid (status={data[\"status\"]})')
" "$JSON_FILE" "$EXPECTED_PHASE" "$REQUIRE_SUCCESS"
