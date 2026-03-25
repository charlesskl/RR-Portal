#!/usr/bin/env bash
# ============================================================
# QC-01: Hardcoded Config Scanner & Auto-Fixer
# ============================================================
# Scans app source files for hardcoded configuration values
# and replaces them with environment variable references.
#
# Usage: check-config.sh <app-directory>
# Exit 0: No hardcoded config found (or already fixed)
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-config.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-01] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

# --- Stack Detection ---
STACK="unknown"
if [[ -f "$APP_DIR/package.json" ]]; then
  STACK="node"
elif [[ -f "$APP_DIR/requirements.txt" || -f "$APP_DIR/pyproject.toml" ]]; then
  STACK="python"
fi

# --- Exclusion Patterns ---
# Files and directories to skip during scanning
EXCLUDE_DIRS="node_modules|__pycache__|\.git|\.venv|venv|dist|build|coverage"
EXCLUDE_FILES="\.env$|\.env\.|\.md$|\.lock$|package-lock\.json$"
TEST_PATTERNS="\.test\.|\.spec\.|test_|_test\.|__tests__|\.stories\."

# --- Tracking ---
FIXES_MADE=0
ENV_VARS_FILE="$APP_DIR/.env.example"
# Track vars (bash 3.x)
_SEEN_VARS_LIST=""

# Create .env.example if it doesn't exist
if [[ ! -f "$ENV_VARS_FILE" ]]; then
  touch "$ENV_VARS_FILE"
fi

# Load existing vars from .env.example to avoid duplicates
while IFS= read -r line; do
  if [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]]; then
    var_name="${line%%=*}"
    _SEEN_VARS_LIST="${_SEEN_VARS_LIST}|${var_name}|"
  fi
done < "$ENV_VARS_FILE"

_seen_var_exists() { [[ "$_SEEN_VARS_LIST" == *"|${1}|"* ]]; }
_seen_var_add() { _SEEN_VARS_LIST="${_SEEN_VARS_LIST}|${1}|"; }

# --- Helper Functions ---

is_test_file() {
  local file="$1"
  if echo "$file" | grep -qE "$TEST_PATTERNS"; then
    return 0
  fi
  return 1
}

is_comment_line() {
  local line="$1"
  # Strip leading whitespace
  local trimmed
  trimmed="$(echo "$line" | sed 's/^[[:space:]]*//')"
  # Check for common comment prefixes
  if [[ "$trimmed" == "//"* || "$trimmed" == "#"* || "$trimmed" == "/*"* || "$trimmed" == "*"* ]]; then
    return 0
  fi
  return 1
}

is_already_envified() {
  local line="$1"
  if echo "$line" | grep -qE 'process\.env\.|os\.environ|os\.getenv'; then
    return 0
  fi
  return 1
}

add_env_var() {
  local var_name="$1"
  local var_value="$2"
  local description="$3"

  if _seen_var_exists "$var_name"; then
    return
  fi

  echo "" >> "$ENV_VARS_FILE"
  echo "# $description" >> "$ENV_VARS_FILE"
  echo "${var_name}=${var_value}" >> "$ENV_VARS_FILE"
  _seen_var_add "$var_name"
}

derive_var_name() {
  local context="$1"
  local category="$2"

  case "$category" in
    connection_string)
      if echo "$context" | grep -qi "postgres"; then
        echo "DATABASE_URL"
      elif echo "$context" | grep -qi "mongo"; then
        echo "MONGODB_URL"
      elif echo "$context" | grep -qi "mysql"; then
        echo "MYSQL_URL"
      elif echo "$context" | grep -qi "redis"; then
        echo "REDIS_URL"
      else
        echo "DATABASE_URL"
      fi
      ;;
    port)
      echo "PORT"
      ;;
    ip_address)
      echo "HOST"
      ;;
    localhost)
      # Try to derive from context
      if echo "$context" | grep -qi "api"; then
        echo "API_URL"
      elif echo "$context" | grep -qi "database\|db\|mongo\|postgres\|mysql"; then
        echo "DATABASE_URL"
      else
        echo "SERVICE_URL"
      fi
      ;;
    api_key)
      # Try to derive from variable name in context
      local upper
      upper="$(echo "$context" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"
      if [[ -n "$upper" && "$upper" != "_" ]]; then
        echo "${upper}"
      else
        echo "API_KEY"
      fi
      ;;
    abs_path)
      echo "DATA_PATH"
      ;;
    *)
      echo "CONFIG_VALUE"
      ;;
  esac
}

replace_value_in_file() {
  local file="$1"
  local line_num="$2"
  local old_value="$3"
  local var_name="$4"

  # Escape special characters for sed
  local escaped_old
  escaped_old="$(printf '%s\n' "$old_value" | sed 's/[&/\]/\\&/g; s/\[/\\[/g; s/\]/\\]/g')"

  if [[ "$STACK" == "node" ]]; then
    local replacement="process.env.${var_name}"
    # Use sed to replace on the specific line
    sed -i '' "${line_num}s|['\"]${escaped_old}['\"]|${replacement}|" "$file" 2>/dev/null || \
    sed -i '' "${line_num}s|${escaped_old}|${replacement}|" "$file" 2>/dev/null || true
    echo "[QC-01] FIXED: replaced with process.env.${var_name} in ${file}:${line_num}"
  elif [[ "$STACK" == "python" ]]; then
    local replacement="os.environ.get('${var_name}', '${old_value}')"
    sed -i '' "${line_num}s|['\"]${escaped_old}['\"]|${replacement}|" "$file" 2>/dev/null || \
    sed -i '' "${line_num}s|${escaped_old}|${replacement}|" "$file" 2>/dev/null || true

    # Add import os at top of file if not present
    if ! grep -q "^import os" "$file" && ! grep -q "^from os " "$file"; then
      sed -i '' '1s/^/import os\n/' "$file"
      echo "[QC-01] FIXED: added 'import os' to ${file}"
    fi
    echo "[QC-01] FIXED: replaced with os.environ.get('${var_name}') in ${file}:${line_num}"
  fi
}

replace_port_in_listen() {
  local file="$1"
  local line_num="$2"
  local port_value="$3"
  local var_name="$4"

  if [[ "$STACK" == "node" ]]; then
    # Replace the port number in .listen() with process.env.PORT
    python3 -c "
import re
with open('\${file}') as f:
    lines = f.readlines()
idx = \${line_num} - 1
if idx < len(lines):
    lines[idx] = re.sub(r'\.listen\s*\(\s*\${port_value}', '.listen(process.env.\${var_name} || \${port_value}', lines[idx])
with open('\${file}', 'w') as f:
    f.writelines(lines)
" 2>/dev/null || true
    echo "[QC-01] FIXED: replaced port ${port_value} with process.env.${var_name} in ${file}:${line_num}"
  elif [[ "$STACK" == "python" ]]; then
    sed -i '' "${line_num}s|${port_value}|int(os.environ.get('${var_name}', '${port_value}'))|" "$file" 2>/dev/null || true
    if ! grep -q "^import os" "$file" && ! grep -q "^from os " "$file"; then
      sed -i '' '1s/^/import os\n/' "$file"
    fi
    echo "[QC-01] FIXED: replaced port ${port_value} with os.environ.get('${var_name}') in ${file}:${line_num}"
  fi
}

# --- Build file list (source files only) ---
get_source_files() {
  find "$APP_DIR" -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.py" -o -name "*.mjs" -o -name "*.cjs" \) \
    | grep -vE "$EXCLUDE_DIRS" \
    | grep -vE "$EXCLUDE_FILES" || true
}

# --- Scan and Fix ---

scan_and_fix() {
  local files
  files="$(get_source_files)"

  if [[ -z "$files" ]]; then
    echo "[QC-01] PASS: no source files to scan in $APP_DIR"
    return 0
  fi

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    # Skip test files
    if is_test_file "$file"; then
      continue
    fi

    local line_num=0
    while IFS= read -r line; do
      line_num=$((line_num + 1))

      # Skip empty lines
      [[ -z "$line" ]] && continue

      # Skip comment lines
      if is_comment_line "$line"; then
        continue
      fi

      # Skip already-envified lines
      if is_already_envified "$line"; then
        continue
      fi

      # --- 1. Connection strings ---
      for proto in "postgres://" "postgresql://" "mongodb://" "mongodb+srv://" "mysql://" "redis://"; do
        if echo "$line" | grep -q "$proto"; then
          local conn_str
          conn_str="$(echo "$line" | grep -oE "${proto}[^\"' ]*" | head -1)"
          if [[ -n "$conn_str" ]]; then
            local var_name
            var_name="$(derive_var_name "$conn_str" "connection_string")"
            echo "[QC-01] FOUND: hardcoded connection string in ${file}:${line_num}"
            replace_value_in_file "$file" "$line_num" "$conn_str" "$var_name"
            add_env_var "$var_name" "$conn_str" "Database/service connection string"
            FIXES_MADE=$((FIXES_MADE + 1))
          fi
        fi
      done

      # --- 2. Localhost URLs ---
      if echo "$line" | grep -qE "localhost:[0-9]+"; then
        local localhost_url
        localhost_url="$(echo "$line" | grep -oE "https?://localhost:[0-9]+[^\"' ]*" | head -1)"
        if [[ -z "$localhost_url" ]]; then
          localhost_url="$(echo "$line" | grep -oE "localhost:[0-9]+" | head -1)"
        fi
        if [[ -n "$localhost_url" ]]; then
          local var_name
          var_name="$(derive_var_name "$line" "localhost")"
          echo "[QC-01] FOUND: hardcoded localhost URL in ${file}:${line_num}"
          replace_value_in_file "$file" "$line_num" "$localhost_url" "$var_name"
          add_env_var "$var_name" "$localhost_url" "Service URL (was hardcoded localhost)"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi

      # --- 3. IP addresses (not in test files, skip 127.0.0.1 and 0.0.0.0) ---
      if echo "$line" | grep -qE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"; then
        local ip_addr
        ip_addr="$(echo "$line" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | head -1)"
        if [[ -n "$ip_addr" && "$ip_addr" != "127.0.0.1" && "$ip_addr" != "0.0.0.0" ]]; then
          local var_name
          var_name="$(derive_var_name "$line" "ip_address")"
          echo "[QC-01] FOUND: hardcoded IP address ${ip_addr} in ${file}:${line_num}"
          replace_value_in_file "$file" "$line_num" "$ip_addr" "$var_name"
          add_env_var "$var_name" "$ip_addr" "Host/IP address"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi

      # --- 4. Hardcoded ports in listen calls ---
      if echo "$line" | grep -qE "\.listen\s*\(\s*[0-9]+"; then
        local port_val
        port_val="$(echo "$line" | grep -oE "\.listen\s*\(\s*[0-9]+" | grep -oE "[0-9]+" | head -1)"
        if [[ -n "$port_val" ]]; then
          local var_name
          var_name="$(derive_var_name "$line" "port")"
          echo "[QC-01] FOUND: hardcoded port in listen() in ${file}:${line_num}"
          replace_port_in_listen "$file" "$line_num" "$port_val" "$var_name"
          add_env_var "$var_name" "$port_val" "Application listening port"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi

      # --- 5. API keys (conservative: variable assignments with long alphanumeric values) ---
      if echo "$line" | grep -qiE "(key|secret|token|api)[\"'_A-Za-z]*\s*[:=]\s*[\"'][A-Za-z0-9_-]{20,}[\"']"; then
        local key_val
        key_val="$(echo "$line" | grep -oE "[\"'][A-Za-z0-9_-]{20,}[\"']" | head -1 | tr -d "\"'")"
        if [[ -n "$key_val" ]]; then
          local var_context
          var_context="$(echo "$line" | grep -oiE "[A-Za-z_]*(key|secret|token|api)[A-Za-z_]*" | head -1)"
          local var_name
          var_name="$(derive_var_name "$var_context" "api_key")"
          echo "[QC-01] FOUND: potential API key/secret in ${file}:${line_num}"
          replace_value_in_file "$file" "$line_num" "$key_val" "$var_name"
          add_env_var "$var_name" "CHANGE_ME" "API key/secret (value removed for security)"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi

      # --- 6. Absolute file paths in string literals ---
      if echo "$line" | grep -qE "[\"'](/home/|/var/|/opt/)[^\"']*[\"']"; then
        local abs_path
        abs_path="$(echo "$line" | grep -oE "[\"'](/home/|/var/|/opt/)[^\"']*[\"']" | head -1 | tr -d "\"'")"
        if [[ -n "$abs_path" ]]; then
          echo "[QC-01] FOUND: hardcoded absolute path in ${file}:${line_num}"
          replace_value_in_file "$file" "$line_num" "$abs_path" "DATA_PATH"
          add_env_var "DATA_PATH" "$abs_path" "File system path (was hardcoded absolute path)"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi

    done < "$file"
  done <<< "$files"
}

# --- Main ---

echo "[QC-01] Scanning for hardcoded config in: $APP_DIR (stack: $STACK)"

scan_and_fix

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-01] RESULT: Fixed ${FIXES_MADE} hardcoded config issue(s)"
  exit 1
else
  echo "[QC-01] PASS: no hardcoded config detected"
  exit 0
fi
