#!/usr/bin/env bash
# ============================================================
# QC-10: App Directory Check
# ============================================================
# Ensures that the Dockerfile creates all directories the app
# writes to, with proper ownership for the non-root container
# user.
#
# Usage: check-app-dirs.sh <app-directory>
# Exit 0: No fix needed
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-app-dirs.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-10] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

DOCKERFILE="$APP_DIR/Dockerfile"

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "[QC-10] SKIP: No Dockerfile found in $APP_DIR (QC-04 handles creation)"
  exit 0
fi

# --- Stack Detection ---
STACK="unknown"
if [[ -f "$APP_DIR/package.json" ]]; then
  STACK="node"
elif [[ -f "$APP_DIR/requirements.txt" || -f "$APP_DIR/pyproject.toml" ]]; then
  STACK="python"
fi

# --- Exclusion Patterns ---
EXCLUDE_DIRS="node_modules|__pycache__|\.git|\.venv|venv|dist|build|coverage|client|frontend|public|static|\.next"
EXCLUDE_FILES="\.env$|\.env\.|\.md$|\.lock$|package-lock\.json$"
TEST_PATTERNS="\.test\.|\.spec\.|test_|_test\.|__tests__|\.stories\."

# --- Tracking ---
FIXES_MADE=0

# --- Known writable directory names ---
KNOWN_DIRS="data uploads logs temp tmp templates cache"

# --- Helper Functions ---

is_test_file() {
  local file="$1"
  echo "$file" | grep -qE "$TEST_PATTERNS"
}

# Build list of server-side source files
get_source_files() {
  find "$APP_DIR" -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.py" -o -name "*.mjs" -o -name "*.cjs" \) \
    | grep -vE "$EXCLUDE_DIRS" \
    | grep -vE "$EXCLUDE_FILES" || true
}

# Detect non-root user from Dockerfile
get_nonroot_user() {
  grep -E "^USER " "$DOCKERFILE" | tail -1 | awk '{print $2}' || true
}

# Get the group for the non-root user (convention: appuser:appgroup or user:user)
get_user_group() {
  local user="$1"
  # Check if a group is defined in the Dockerfile via addgroup/groupadd
  local group
  group="$(grep -E "(addgroup|groupadd).*" "$DOCKERFILE" | grep -oE "app[a-z]*" | head -1 || true)"
  if [[ -n "$group" ]]; then
    echo "$group"
  else
    echo "$user"
  fi
}

# Check if a directory path is already handled by mkdir in the Dockerfile
dir_has_mkdir() {
  local dir="$1"
  # Match: RUN mkdir ... /app/{dir} (with or without -p, combined or separate)
  grep -qE "mkdir.*[/ ]app/${dir}([/ ]|$)" "$DOCKERFILE" 2>/dev/null
}

# Check if a directory path is already handled by chown in the Dockerfile
dir_has_chown() {
  local dir="$1"
  grep -qE "chown.*[/ ]app/${dir}([/ ]|$)" "$DOCKERFILE" 2>/dev/null
}

# --- Scan source files for writable directories ---

discover_dirs() {
  local files
  files="$(get_source_files)"
  local found_dirs=""

  if [[ -z "$files" ]]; then
    echo ""
    return
  fi

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    is_test_file "$file" && continue

    local content
    content="$(cat "$file")"

    if [[ "$STACK" == "node" ]]; then
      # 1. fs.mkdirSync('...') / fs.mkdir('...')
      local mkdirs
      mkdirs="$(echo "$content" | grep -oE "(fs\.mkdirSync|fs\.mkdir|mkdirp)\s*\(\s*['\"][^'\"]*['\"]" | grep -oE "['\"][^'\"]*['\"]" | tr -d "\"'" || true)"
      if [[ -n "$mkdirs" ]]; then
        found_dirs="$found_dirs $mkdirs"
      fi

      # 2. fs.writeFileSync('path/to/file') - extract directory
      local write_paths
      write_paths="$(echo "$content" | grep -oE "(fs\.writeFileSync|fs\.writeFile)\s*\(\s*['\"][^'\"]*['\"]" | grep -oE "['\"][^'\"]*['\"]" | tr -d "\"'" || true)"
      for wp in $write_paths; do
        local dir_part
        dir_part="$(dirname "$wp" 2>/dev/null || true)"
        if [[ -n "$dir_part" && "$dir_part" != "." ]]; then
          found_dirs="$found_dirs $dir_part"
        fi
      done

      # 3. fs.createWriteStream('path/to/file') - extract directory
      local stream_paths
      stream_paths="$(echo "$content" | grep -oE "fs\.createWriteStream\s*\(\s*['\"][^'\"]*['\"]" | grep -oE "['\"][^'\"]*['\"]" | tr -d "\"'" || true)"
      for sp in $stream_paths; do
        local dir_part
        dir_part="$(dirname "$sp" 2>/dev/null || true)"
        if [[ -n "$dir_part" && "$dir_part" != "." ]]; then
          found_dirs="$found_dirs $dir_part"
        fi
      done

      # 4. multer({ dest: '...' }) or multer.diskStorage({ destination: '...' })
      local multer_dirs
      multer_dirs="$(echo "$content" | grep -oE "(dest|destination)\s*:\s*['\"][^'\"]*['\"]" | grep -oE "['\"][^'\"]*['\"]" | tr -d "\"'" || true)"
      if [[ -n "$multer_dirs" ]]; then
        found_dirs="$found_dirs $multer_dirs"
      fi

      # 5. path.join(__dirname, '...', 'data') or similar path constructions
      local path_joins
      path_joins="$(echo "$content" | grep -oE "path\.join\s*\([^)]*\)" || true)"
      for known in $KNOWN_DIRS; do
        if echo "$path_joins" | grep -qiE "['\"]${known}['\"]"; then
          found_dirs="$found_dirs ./$known"
        fi
      done

      # 6. Common directory names in string literals
      for known in $KNOWN_DIRS; do
        if echo "$content" | grep -qE "['\"]\./${known}['\"]|['\"]\.\./${known}['\"]|['\"]${known}/['\"]|['\"]/${known}['\"]"; then
          found_dirs="$found_dirs ./$known"
        fi
      done

    elif [[ "$STACK" == "python" ]]; then
      # 1. os.makedirs('...') / os.mkdir('...')
      local mkdirs
      mkdirs="$(echo "$content" | grep -oE "(os\.makedirs|os\.mkdir)\s*\(\s*['\"][^'\"]*['\"]" | grep -oE "['\"][^'\"]*['\"]" | tr -d "\"'" || true)"
      if [[ -n "$mkdirs" ]]; then
        found_dirs="$found_dirs $mkdirs"
      fi

      # 2. Path('...').mkdir()
      local path_mkdirs
      path_mkdirs="$(echo "$content" | grep -oE "Path\s*\(\s*['\"][^'\"]*['\"]\s*\)\.mkdir" | grep -oE "['\"][^'\"]*['\"]" | tr -d "\"'" || true)"
      if [[ -n "$path_mkdirs" ]]; then
        found_dirs="$found_dirs $path_mkdirs"
      fi

      # 3. open('path/to/file', 'w') - extract directory
      local open_writes
      open_writes="$(echo "$content" | grep -oE "open\s*\(\s*['\"][^'\"]*['\"].*['\"]w" | grep -oE "['\"][^'\"]*['\"]" | head -1 || true)"
      for ow in $open_writes; do
        local cleaned
        cleaned="$(echo "$ow" | tr -d "\"'")"
        local dir_part
        dir_part="$(dirname "$cleaned" 2>/dev/null || true)"
        if [[ -n "$dir_part" && "$dir_part" != "." ]]; then
          found_dirs="$found_dirs $dir_part"
        fi
      done

      # 4. Common directory names in string literals
      for known in $KNOWN_DIRS; do
        if echo "$content" | grep -qE "['\"]\./${known}['\"]|['\"]\.\./${known}['\"]|['\"]${known}/['\"]|['\"]/${known}['\"]"; then
          found_dirs="$found_dirs ./$known"
        fi
      done
    fi

  done <<< "$files"

  echo "$found_dirs"
}

# Normalize directory paths to simple names relative to app root
normalize_dirs() {
  local raw_dirs="$1"
  local normalized=""

  for dir in $raw_dirs; do
    # Strip leading ./, ../, /, /app/
    local clean
    clean="$(echo "$dir" | sed 's|^\./||; s|^\.\./||; s|^/app/||; s|^/||')"

    # Extract the top-level directory name only
    clean="$(echo "$clean" | cut -d'/' -f1)"

    # Skip empty, absolute system paths, or suspicious entries
    [[ -z "$clean" ]] && continue
    [[ "$clean" == "." ]] && continue
    [[ "$clean" == ".." ]] && continue

    # Only keep known-safe directory names (avoid injecting random paths)
    local is_known=false
    for known in $KNOWN_DIRS; do
      if [[ "$clean" == "$known" ]]; then
        is_known=true
        break
      fi
    done

    # Also allow dirs that were explicitly found in code (not just known names)
    # but filter out anything that looks like a file or nonsense
    if [[ "$is_known" == "true" ]]; then
      # Deduplicate
      if ! echo "$normalized" | grep -qw "$clean"; then
        normalized="$normalized $clean"
      fi
    fi
  done

  echo "$normalized" | sed 's/^ //'
}

# --- Auto-fix: add missing mkdir and chown to Dockerfile ---

fix_dockerfile() {
  local missing_mkdir=()
  local missing_chown=()
  local all_dirs="$1"
  local nonroot_user="$2"
  local user_group="$3"

  for dir in $all_dirs; do
    if ! dir_has_mkdir "$dir"; then
      missing_mkdir+=("$dir")
      echo "[QC-10] FOUND: directory /app/${dir} not created in Dockerfile"
    fi
    if [[ -n "$nonroot_user" ]] && ! dir_has_chown "$dir"; then
      missing_chown+=("$dir")
      echo "[QC-10] FOUND: directory /app/${dir} not owned by ${nonroot_user} in Dockerfile"
    fi
  done

  if [[ ${#missing_mkdir[@]} -eq 0 && ${#missing_chown[@]} -eq 0 ]]; then
    return 0
  fi

  # Build the path list for mkdir
  if [[ ${#missing_mkdir[@]} -gt 0 ]]; then
    local mkdir_paths=""
    for dir in "${missing_mkdir[@]}"; do
      mkdir_paths="$mkdir_paths /app/${dir}"
    done
    mkdir_paths="$(echo "$mkdir_paths" | sed 's/^ //')"

    if [[ -n "$nonroot_user" ]]; then
      # Insert before the USER line
      local user_line
      user_line="$(grep -n "^USER " "$DOCKERFILE" | tail -1 | cut -d: -f1)"

      if [[ -n "$user_line" ]]; then
        # Insert mkdir before USER line
        sed -i '' "${user_line}i\\
RUN mkdir -p ${mkdir_paths}
" "$DOCKERFILE"

        echo "[QC-10] FIXED: added 'RUN mkdir -p ${mkdir_paths}' before USER line"
        FIXES_MADE=$((FIXES_MADE + 1))

        # Re-find USER line (it shifted down by 1)
        user_line="$(grep -n "^USER " "$DOCKERFILE" | tail -1 | cut -d: -f1)"
      fi
    else
      # No non-root user; append mkdir before the last CMD/ENTRYPOINT
      local insert_line
      insert_line="$(grep -n "^\(CMD\|ENTRYPOINT\)" "$DOCKERFILE" | tail -1 | cut -d: -f1)"
      if [[ -n "$insert_line" ]]; then
        sed -i '' "${insert_line}i\\
RUN mkdir -p ${mkdir_paths}
" "$DOCKERFILE"
      else
        echo "RUN mkdir -p ${mkdir_paths}" >> "$DOCKERFILE"
      fi
      echo "[QC-10] FIXED: added 'RUN mkdir -p ${mkdir_paths}' to Dockerfile"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
  fi

  # Build the path list for chown
  if [[ -n "$nonroot_user" && ${#missing_chown[@]} -gt 0 ]]; then
    local chown_paths=""
    for dir in "${missing_chown[@]}"; do
      chown_paths="$chown_paths /app/${dir}"
    done
    chown_paths="$(echo "$chown_paths" | sed 's/^ //')"

    # Find USER line again (may have shifted)
    local user_line
    user_line="$(grep -n "^USER " "$DOCKERFILE" | tail -1 | cut -d: -f1)"

    if [[ -n "$user_line" ]]; then
      sed -i '' "${user_line}i\\
RUN chown -R ${nonroot_user}:${user_group} ${chown_paths}
" "$DOCKERFILE"

      echo "[QC-10] FIXED: added 'RUN chown -R ${nonroot_user}:${user_group} ${chown_paths}' before USER line"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
  fi
}

# --- Main ---

echo "[QC-10] Scanning for writable directories in: $APP_DIR (stack: $STACK)"

# Discover directories from source code
RAW_DIRS="$(discover_dirs)"
DIRS="$(normalize_dirs "$RAW_DIRS")"

if [[ -z "$DIRS" ]]; then
  echo "[QC-10] PASS: no writable directories detected in source code"
  exit 0
fi

echo "[QC-10] Detected writable directories: $DIRS"

# Detect non-root user
NONROOT_USER="$(get_nonroot_user)"
USER_GROUP=""
if [[ -n "$NONROOT_USER" ]]; then
  USER_GROUP="$(get_user_group "$NONROOT_USER")"
  echo "[QC-10] Non-root user detected: ${NONROOT_USER}:${USER_GROUP}"
fi

# Check and fix Dockerfile
fix_dockerfile "$DIRS" "$NONROOT_USER" "$USER_GROUP"

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-10] RESULT: Fixed ${FIXES_MADE} directory issue(s) in Dockerfile"
  exit 1
else
  echo "[QC-10] PASS: all writable directories properly configured in Dockerfile"
  exit 0
fi
