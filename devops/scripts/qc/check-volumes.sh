#!/usr/bin/env bash
# ============================================================
# QC-21: Volume Mount & Seed Data Detection
# ============================================================
# Scans app source code to discover ALL directories that need
# persistent volume mounts (not just data/ and uploads/).
#
# Patterns detected:
#   - JSON file storage (data/*.json)
#   - SQLite databases (data/*.db, data/*.sqlite)
#   - Upload directories (uploads/, public/uploads/)
#   - Template directories referenced in code
#   - Critical seed files that must exist at startup
#
# Outputs: Sets environment hints for deploy.sh to use when
# generating docker-compose volume mounts.
#
# Usage: check-volumes.sh <app-directory>
# Exit 0: No issues
# Exit 1: Issues found and documented
# ============================================================

set -eo pipefail

APP_DIR="${1:?Usage: check-volumes.sh <app-directory>}"

log_info()  { echo "[QC-21] INFO: $*"; }
log_fixed() { echo "[QC-21] FIXED: $*"; }
log_warn()  { echo "[QC-21] WARN: $*"; }

FIXES_MADE=0

# --- Detect server directory ---
SERVER_DIR="$APP_DIR"
[[ -d "$APP_DIR/server" ]] && SERVER_DIR="$APP_DIR/server"
[[ -d "$APP_DIR/backend" ]] && SERVER_DIR="$APP_DIR/backend"

# --- Detect stack ---
STACK="unknown"
[[ -f "$SERVER_DIR/package.json" || -f "$APP_DIR/package.json" ]] && STACK="node"
[[ -f "$SERVER_DIR/requirements.txt" || -f "$APP_DIR/requirements.txt" ]] && STACK="python"

# ============================================================
# Phase 1: Discover all persistent directories from source code
# ============================================================

VOLUMES_NEEDED=()
SEED_FILES_NEEDED=()

# --- Data directory patterns ---
check_data_pattern() {
  local search_dir="$1"
  local exts="*.js *.ts *.mjs *.py"

  # Check for JSON file read/write — exclude node_modules
  if grep -rq "readFileSync\|writeFileSync\|JSON\.parse.*readFile\|json\.load\|json\.dump" "$search_dir" \
    --include='*.js' --include='*.ts' --include='*.py' --exclude-dir='node_modules' --exclude-dir='__pycache__' --exclude-dir='dist' 2>/dev/null; then
    # Find the actual data paths referenced
    local data_paths
    data_paths=$(grep -rhoE "(process\.env\.DATA_PATH|os\.environ.*DATA_PATH|__dirname.*['\"]\.?\.?/?data['\"]|/app/data|\.\/data)" "$search_dir" \
      --include='*.js' --include='*.ts' --include='*.py' --exclude-dir='node_modules' --exclude-dir='__pycache__' 2>/dev/null | sort -u || true)
    if [[ -n "$data_paths" ]]; then
      VOLUMES_NEEDED+=("data:/app/data")
      log_info "Data directory detected (JSON/file-based storage)"
    fi
  fi

  # Check for SQLite — exclude node_modules to avoid false positives
  if grep -rqE "better-sqlite3|require\('sqlite3'\)|import sqlite3|\.db.*path|paiji\.db|data\.db" "$search_dir" \
    --include='*.js' --include='*.ts' --include='*.py' --exclude-dir='node_modules' --exclude-dir='__pycache__' 2>/dev/null; then
    VOLUMES_NEEDED+=("data:/app/data")
    log_info "SQLite database detected — data directory needed"
  fi
}

# --- Upload directory patterns ---
check_upload_pattern() {
  local search_dir="$1"

  # multer or file upload references — exclude node_modules
  if grep -rq "multer\|UPLOAD_FOLDER\|UPLOADS_PATH" "$search_dir" \
    --include='*.js' --include='*.ts' --include='*.py' --exclude-dir='node_modules' --exclude-dir='__pycache__' 2>/dev/null; then

    # Detect specific upload path from source code (not node_modules)
    local upload_path
    upload_path=$(grep -rhoE "(public/uploads|/app/public/uploads|UPLOADS_PATH|UPLOAD_FOLDER|/uploads)" "$search_dir" \
      --include='*.js' --include='*.ts' --include='*.py' --exclude-dir='node_modules' --exclude-dir='__pycache__' 2>/dev/null | sort -u | head -1 || true)

    case "$upload_path" in
      *public/uploads*)
        VOLUMES_NEEDED+=("public/uploads:/app/public/uploads")
        log_info "Upload directory: public/uploads (nested in public/)"
        ;;
      *)
        VOLUMES_NEEDED+=("uploads:/app/uploads")
        log_info "Upload directory: uploads/"
        ;;
    esac
  fi
}

# --- Critical seed files ---
check_seed_files() {
  local search_dir="$1"

  # Find files that are loaded at startup (require/import at top level)
  for pattern in "default-material-prices" "seed-data" "initial-data" "default-data"; do
    local files
    files=$(grep -rl "$pattern" "$search_dir" --include='*.js' --include='*.ts' --include='*.py' --exclude-dir='node_modules' --exclude-dir='__pycache__' 2>/dev/null || true)
    if [[ -n "$files" ]]; then
      # Find the actual file
      local seed_file
      seed_file=$(find "$search_dir" -name "*${pattern}*" -type f 2>/dev/null | head -1)
      if [[ -n "$seed_file" ]]; then
        local rel_path="${seed_file#$APP_DIR/}"
        SEED_FILES_NEEDED+=("$rel_path")
        log_info "Critical seed file: $rel_path"
      fi
    fi
  done

  # Check for data files that ship with the app
  if [[ -d "$search_dir/data" ]]; then
    local data_files
    data_files=$(find "$search_dir/data" -maxdepth 1 -type f \( -name "*.json" -o -name "*.db" -o -name "*.sqlite" -o -name "*.csv" \) 2>/dev/null)
    if [[ -n "$data_files" ]]; then
      while IFS= read -r f; do
        local rel_path="${f#$APP_DIR/}"
        SEED_FILES_NEEDED+=("$rel_path")
      done <<< "$data_files"
    fi
  fi
}

# --- Dockerfile directory creation ---
check_dockerfile_dirs() {
  local dockerfile="$APP_DIR/Dockerfile"
  [[ ! -f "$dockerfile" ]] && return

  # Ensure mkdir -p creates all needed directories
  local needs_dirs=()
  for vol in "${VOLUMES_NEEDED[@]}"; do
    local container_path="${vol#*:}"
    needs_dirs+=("$container_path")
  done

  if [[ ${#needs_dirs[@]} -gt 0 ]]; then
    local mkdir_line="RUN mkdir -p"
    for d in "${needs_dirs[@]}"; do
      mkdir_line="$mkdir_line $d"
    done

    # Check if Dockerfile already has all these directories
    local missing_dirs=false
    for d in "${needs_dirs[@]}"; do
      if ! grep -q "mkdir.*${d}" "$dockerfile" 2>/dev/null; then
        missing_dirs=true
        break
      fi
    done

    if [[ "$missing_dirs" == "true" ]]; then
      # Check if there's already a comprehensive mkdir line (covers enough dirs)
      local existing_mkdir
      existing_mkdir=$(grep 'mkdir -p' "$dockerfile" 2>/dev/null || true)
      local all_covered=true
      for d in "${needs_dirs[@]}"; do
        dir_base=$(basename "$d")
        if ! echo "$existing_mkdir" | grep -q "$dir_base" 2>/dev/null; then
          all_covered=false
          break
        fi
      done

      if [[ "$all_covered" == "false" ]]; then
        # Add mkdir before the USER line or before CMD using perl (macOS sed newline issues)
        if grep -q '^USER' "$dockerfile"; then
          perl -i -pe "s|^(USER .*)|\n${mkdir_line}\n\$1|" "$dockerfile"
        elif grep -q '^CMD' "$dockerfile"; then
          perl -i -pe "s|^(CMD .*)|\n${mkdir_line}\n\$1|" "$dockerfile"
        fi
        log_fixed "added mkdir for volume directories: ${needs_dirs[*]}"
        FIXES_MADE=$((FIXES_MADE + 1))
      fi
    fi
  fi
}

# ============================================================
# Phase 2: Run all checks
# ============================================================

check_data_pattern "$SERVER_DIR"
check_upload_pattern "$SERVER_DIR"
check_seed_files "$SERVER_DIR"
[[ "$SERVER_DIR" != "$APP_DIR" ]] && check_seed_files "$APP_DIR"

# Deduplicate VOLUMES_NEEDED
DEDUPED_VOLUMES=()
SEEN_VOLS=""
for vol in "${VOLUMES_NEEDED[@]}"; do
  if [[ "$SEEN_VOLS" != *"|${vol}|"* ]]; then
    SEEN_VOLS="${SEEN_VOLS}|${vol}|"
    DEDUPED_VOLUMES+=("$vol")
  fi
done
VOLUMES_NEEDED=("${DEDUPED_VOLUMES[@]}")

check_dockerfile_dirs

# ============================================================
# Phase 3: Write volume hints file for deploy.sh
# ============================================================
# This file is read by deploy.sh to generate accurate volume mounts
HINTS_FILE="$APP_DIR/.volume-hints"
if [[ ${#VOLUMES_NEEDED[@]} -gt 0 ]] || [[ ${#SEED_FILES_NEEDED[@]} -gt 0 ]]; then
  {
    echo "# Auto-generated by QC-21 — volume mount hints for deploy.sh"
    echo "# Format: host_subdir:container_path"
    # Deduplicate volumes
    printf '%s\n' "${VOLUMES_NEEDED[@]}" | sort -u | while IFS= read -r vol; do
      echo "VOLUME=$vol"
    done
    # Seed files
    for sf in "${SEED_FILES_NEEDED[@]}"; do
      echo "SEED=$sf"
    done
  } > "$HINTS_FILE"
  log_info "Wrote volume hints to $HINTS_FILE"
fi

# ============================================================
# Summary
# ============================================================
log_info "Volumes needed: ${#VOLUMES_NEEDED[@]}"
log_info "Seed files: ${#SEED_FILES_NEEDED[@]}"

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-21] RESULT: Fixed ${FIXES_MADE} volume issue(s)"
  exit 1
else
  log_info "PASS: Volume configuration looks correct"
  exit 0
fi
