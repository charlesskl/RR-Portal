#!/usr/bin/env bash
# ============================================================
# QC-09: Auth Bypass Check
# ============================================================
# Detects per-app authentication middleware and neutralizes it.
# Apps behind the RR Portal run behind nginx basic auth, so
# individual apps should NOT enforce their own authentication.
#
# Usage: check-auth-bypass.sh <app-directory>
# Exit 0: No auth issues found (or already bypassed)
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-auth-bypass.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-09] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

# --- Stack Detection ---
STACK="unknown"
if [[ -f "$APP_DIR/package.json" ]]; then
  STACK="node"
elif [[ -f "$APP_DIR/server/package.json" ]]; then
  STACK="node"
elif [[ -f "$APP_DIR/requirements.txt" || -f "$APP_DIR/pyproject.toml" ]]; then
  STACK="python"
elif [[ -f "$APP_DIR/server/requirements.txt" || -f "$APP_DIR/server/pyproject.toml" ]]; then
  STACK="python"
fi

# --- Exclusion Patterns ---
EXCLUDE_DIRS="node_modules|__pycache__|\.git|\.venv|venv|dist|build|coverage"
TEST_PATTERNS="\.test\.|\.spec\.|test_|_test\.|__tests__|\.stories\."

# --- Tracking ---
FIXES_MADE=0

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
  local trimmed
  trimmed="$(echo "$line" | sed 's/^[[:space:]]*//')"
  if [[ "$trimmed" == "//"* || "$trimmed" == "#"* || "$trimmed" == "/*"* || "$trimmed" == "*"* ]]; then
    return 0
  fi
  return 1
}

# --- Build file lists ---

get_source_files() {
  find "$APP_DIR" -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.mjs" -o -name "*.cjs" -o -name "*.py" \) \
    | grep -vE "$EXCLUDE_DIRS" || true
}

get_entry_files() {
  # Main app entry points where middleware is typically applied
  local entries=""
  for name in app.js server.js index.js main.js app.ts server.ts index.ts main.ts; do
    for subdir in "" "src/" "server/"; do
      if [[ -f "$APP_DIR/${subdir}${name}" ]]; then
        entries="$entries $APP_DIR/${subdir}${name}"
      fi
    done
  done
  echo "$entries"
}

get_frontend_files() {
  find "$APP_DIR" -type f \( -name "*.jsx" -o -name "*.tsx" -o -name "*.vue" \) \
    | grep -vE "$EXCLUDE_DIRS" || true
}

# ============================================================
# Node.js Checks & Fixes
# ============================================================

fix_node_auth_middleware() {
  local entry_files
  entry_files="$(get_entry_files)"

  if [[ -z "$entry_files" ]]; then
    return
  fi

  for file in $entry_files; do
    [[ -f "$file" ]] || continue

    local line_num=0
    local tmpfile
    tmpfile="$(mktemp)"
    local file_changed=0

    while IFS= read -r line || [[ -n "$line" ]]; do
      line_num=$((line_num + 1))

      # Skip comment lines
      if is_comment_line "$line"; then
        echo "$line" >> "$tmpfile"
        continue
      fi

      # Skip lines that are already commented out by QC-09
      if echo "$line" | grep -q "modified by QC-09"; then
        echo "$line" >> "$tmpfile"
        continue
      fi

      # Pattern 1: app.use(authenticate) or app.use(auth) — standalone middleware
      # Match: app.use(authenticate), router.use(authenticate), app.use(auth)
      if echo "$line" | grep -qE '^\s*(app|router)\.(use)\s*\(\s*(authenticate|auth)\s*\)'; then
        echo "// $line // Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
        echo "[QC-09] FIXED: commented out standalone auth middleware in ${file}:${line_num}"
        FIXES_MADE=$((FIXES_MADE + 1))
        file_changed=1
        continue
      fi

      # Pattern 2: app.use('/path', authenticate, handler) — auth in route registration
      # Remove the authenticate/auth argument but keep the route and handler
      if echo "$line" | grep -qE '^\s*(app|router)\.(use|get|post|put|delete|patch)\s*\(' \
         && echo "$line" | grep -qE ',\s*(authenticate|auth)\s*,'; then
        local fixed_line
        # Remove ", authenticate" or ", auth" from the middle of the argument list
        fixed_line="$(echo "$line" | sed -E 's/, *(authenticate|auth) *,/,/')"
        echo "$fixed_line // Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
        echo "[QC-09] FIXED: removed auth middleware from route registration in ${file}:${line_num}"
        FIXES_MADE=$((FIXES_MADE + 1))
        file_changed=1
        continue
      fi

      # Pattern 3: app.use(passport.authenticate(...))
      if echo "$line" | grep -qE '^\s*(app|router)\.use\s*\(\s*passport\.authenticate'; then
        echo "// $line // Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
        echo "[QC-09] FIXED: commented out passport.authenticate middleware in ${file}:${line_num}"
        FIXES_MADE=$((FIXES_MADE + 1))
        file_changed=1
        continue
      fi

      # No match — keep line as-is
      echo "$line" >> "$tmpfile"
    done < "$file"

    if [[ "$file_changed" -eq 1 ]]; then
      cp "$tmpfile" "$file"
    fi
    rm -f "$tmpfile"
  done
}

fix_node_jwt_middleware() {
  local entry_files
  entry_files="$(get_entry_files)"

  if [[ -z "$entry_files" ]]; then
    return
  fi

  for file in $entry_files; do
    [[ -f "$file" ]] || continue

    # Check for jwt.verify or jsonwebtoken usage in middleware application
    # Only fix in entry files (middleware APPLICATION, not DEFINITION)
    local line_num=0
    local tmpfile
    tmpfile="$(mktemp)"
    local file_changed=0

    while IFS= read -r line || [[ -n "$line" ]]; do
      line_num=$((line_num + 1))

      if is_comment_line "$line"; then
        echo "$line" >> "$tmpfile"
        continue
      fi

      if echo "$line" | grep -q "modified by QC-09"; then
        echo "$line" >> "$tmpfile"
        continue
      fi

      # Pattern: app.use with jwt verification inline
      if echo "$line" | grep -qE '^\s*(app|router)\.use\s*\(' \
         && echo "$line" | grep -qE 'jwt\.verify|expressJwt|jwtMiddleware'; then
        echo "// $line // Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
        echo "[QC-09] FIXED: commented out JWT middleware in ${file}:${line_num}"
        FIXES_MADE=$((FIXES_MADE + 1))
        file_changed=1
        continue
      fi

      echo "$line" >> "$tmpfile"
    done < "$file"

    if [[ "$file_changed" -eq 1 ]]; then
      cp "$tmpfile" "$file"
    fi
    rm -f "$tmpfile"
  done
}

fix_node_frontend_auth() {
  local frontend_files
  frontend_files="$(get_frontend_files)"

  if [[ -z "$frontend_files" ]]; then
    return
  fi

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    is_test_file "$file" && continue

    # Pattern 1: useState(false) for auth state — set to always true
    if grep -qE 'useState\s*\(\s*false\s*\)' "$file" \
       && grep -qiE '(auth|logged|isAuth|isLoggedIn|signedIn)' "$file"; then
      # Find lines with auth-related useState(false) and flip to true
      local line_num=0
      local tmpfile
      tmpfile="$(mktemp)"
      local file_changed=0

      while IFS= read -r line || [[ -n "$line" ]]; do
        line_num=$((line_num + 1))

        if echo "$line" | grep -q "modified by QC-09"; then
          echo "$line" >> "$tmpfile"
          continue
        fi

        if echo "$line" | grep -qiE '(auth|logged|isAuth|isLoggedIn|signedIn)' \
           && echo "$line" | grep -qE 'useState\s*\(\s*false\s*\)'; then
          local fixed_line
          fixed_line="$(echo "$line" | sed -E 's/useState\s*\(\s*false\s*\)/useState(true)/')"
          echo "$fixed_line // Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
          echo "[QC-09] FIXED: set auth state to always-true in ${file}:${line_num}"
          FIXES_MADE=$((FIXES_MADE + 1))
          file_changed=1
          continue
        fi

        echo "$line" >> "$tmpfile"
      done < "$file"

      if [[ "$file_changed" -eq 1 ]]; then
        cp "$tmpfile" "$file"
      fi
      rm -f "$tmpfile"
    fi

    # Pattern 2: localStorage.getItem('token') checks — make them always truthy
    if grep -qE "localStorage\.getItem\s*\(\s*['\"]token['\"]\s*\)" "$file"; then
      local line_num=0
      local tmpfile
      tmpfile="$(mktemp)"
      local file_changed=0

      while IFS= read -r line || [[ -n "$line" ]]; do
        line_num=$((line_num + 1))

        if echo "$line" | grep -q "modified by QC-09"; then
          echo "$line" >> "$tmpfile"
          continue
        fi

        # Replace token check in conditionals: if (!localStorage.getItem('token')) → if (false)
        if echo "$line" | grep -qE "!\s*localStorage\.getItem\s*\(\s*['\"]token['\"]\s*\)"; then
          local fixed_line
          fixed_line="$(echo "$line" | sed -E "s/!\s*localStorage\.getItem\s*\(\s*['\"]token['\"]\s*\)/false/")"
          echo "$fixed_line // Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
          echo "[QC-09] FIXED: bypassed token check in ${file}:${line_num}"
          FIXES_MADE=$((FIXES_MADE + 1))
          file_changed=1
          continue
        fi

        echo "$line" >> "$tmpfile"
      done < "$file"

      if [[ "$file_changed" -eq 1 ]]; then
        cp "$tmpfile" "$file"
      fi
      rm -f "$tmpfile"
    fi
  done <<< "$frontend_files"
}

remove_node_login_pages() {
  # Find and delete login page components
  local login_files
  login_files="$(find "$APP_DIR" -type f \( -name "Login.jsx" -o -name "Login.tsx" -o -name "login.vue" -o -name "SignIn.jsx" -o -name "SignIn.tsx" -o -name "signin.vue" -o -name "LoginPage.jsx" -o -name "LoginPage.tsx" \) \
    | grep -vE "$EXCLUDE_DIRS" || true)"

  if [[ -n "$login_files" ]]; then
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      local filename
      filename="$(basename "$file")"
      rm -f "$file"
      echo "[QC-09] FIXED: removed login page: $file"
      FIXES_MADE=$((FIXES_MADE + 1))

      # Remove imports of this login component from other files
      local import_name="${filename%.*}"  # e.g., Login from Login.jsx
      local frontend_files
      frontend_files="$(get_frontend_files)"
      if [[ -n "$frontend_files" ]]; then
        while IFS= read -r src_file; do
          [[ -z "$src_file" ]] && continue
          [[ ! -f "$src_file" ]] && continue

          # Check if this file imports the deleted login component
          if grep -qE "import\s+.*${import_name}.*from" "$src_file" 2>/dev/null; then
            local tmpfile
            tmpfile="$(mktemp)"
            local file_changed=0

            while IFS= read -r line || [[ -n "$line" ]]; do
              # Remove the import line
              if echo "$line" | grep -qE "import\s+.*${import_name}.*from"; then
                echo "// $line // Login removed by QC-09" >> "$tmpfile"
                echo "[QC-09] FIXED: removed import of ${import_name} in ${src_file}"
                FIXES_MADE=$((FIXES_MADE + 1))
                file_changed=1
                continue
              fi

              # Remove JSX usage: if (!authed) return <Login ... />;
              if echo "$line" | grep -qE "<${import_name}" 2>/dev/null; then
                echo "// $line // Login removed by QC-09" >> "$tmpfile"
                echo "[QC-09] FIXED: removed <${import_name}> usage in ${src_file}"
                FIXES_MADE=$((FIXES_MADE + 1))
                file_changed=1
                continue
              fi

              echo "$line" >> "$tmpfile"
            done < "$src_file"

            if [[ "$file_changed" -eq 1 ]]; then
              cp "$tmpfile" "$src_file"
            fi
            rm -f "$tmpfile"
          fi
        done <<< "$frontend_files"
      fi
    done <<< "$login_files"
  fi
}

remove_node_auth_routes() {
  # Remove auth route file registrations from entry files (the /api/auth endpoint)
  local entry_files
  entry_files="$(get_entry_files)"
  [[ -z "$entry_files" ]] && return

  for file in $entry_files; do
    [[ -f "$file" ]] || continue

    # Check if this file registers auth routes
    if ! grep -qE "require\s*\(\s*['\"]\./(routes/auth|auth)" "$file" 2>/dev/null \
       && ! grep -qE "import.*from\s*['\"]\./(routes/auth|auth)" "$file" 2>/dev/null; then
      continue
    fi

    local tmpfile
    tmpfile="$(mktemp)"
    local file_changed=0

    while IFS= read -r line || [[ -n "$line" ]]; do
      if echo "$line" | grep -q "modified by QC-09"; then
        echo "$line" >> "$tmpfile"
        continue
      fi

      # Comment out auth route registration
      if echo "$line" | grep -qE "(require|import).*['\"]\./(routes/auth|auth)['\"]" \
         && echo "$line" | grep -qE "app\.use|router\.use"; then
        echo "// $line // Auth route removed by QC-09" >> "$tmpfile"
        echo "[QC-09] FIXED: removed auth route registration in ${file}"
        FIXES_MADE=$((FIXES_MADE + 1))
        file_changed=1
        continue
      fi

      echo "$line" >> "$tmpfile"
    done < "$file"

    if [[ "$file_changed" -eq 1 ]]; then
      cp "$tmpfile" "$file"
    fi
    rm -f "$tmpfile"
  done

  # Delete auth route files
  local auth_route_files
  auth_route_files="$(find "$APP_DIR" -type f \( -name "auth.js" -o -name "auth.ts" \) -path "*/routes/*" \
    | grep -vE "$EXCLUDE_DIRS" || true)"

  if [[ -n "$auth_route_files" ]]; then
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      rm -f "$file"
      echo "[QC-09] FIXED: removed auth route file: $file"
      FIXES_MADE=$((FIXES_MADE + 1))
    done <<< "$auth_route_files"
  fi

  # Delete auth middleware files
  local auth_middleware_files
  auth_middleware_files="$(find "$APP_DIR" -type f \( -name "auth.js" -o -name "auth.ts" -o -name "authenticate.js" \) -path "*/middleware/*" \
    | grep -vE "$EXCLUDE_DIRS" || true)"

  if [[ -n "$auth_middleware_files" ]]; then
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      rm -f "$file"
      echo "[QC-09] FIXED: removed auth middleware file: $file"
      FIXES_MADE=$((FIXES_MADE + 1))
    done <<< "$auth_middleware_files"
  fi

  # Remove dangling require/import of auth middleware from entry files
  for file in $entry_files; do
    [[ -f "$file" ]] || continue
    if grep -qE "(require|import).*['\"]\./(middleware/auth|auth)['\"]" "$file" 2>/dev/null; then
      sed -i '' -E "/^.*require.*['\"]\.\/middleware\/auth['\"].*$/s/^/\/\/ /" "$file" 2>/dev/null || true
      sed -i '' -E "/^.*import.*from.*['\"]\.\/middleware\/auth['\"].*$/s/^/\/\/ /" "$file" 2>/dev/null || true
      echo "[QC-09] FIXED: commented out auth middleware import in ${file}"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
  done
}

# ============================================================
# Python Checks & Fixes
# ============================================================

fix_python_auth_decorators() {
  local files
  files="$(get_source_files)"

  if [[ -z "$files" ]]; then
    return
  fi

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    is_test_file "$file" && continue

    # Check for auth decorators
    if ! grep -qE '@(login_required|jwt_required|auth_required)' "$file"; then
      continue
    fi

    local line_num=0
    local tmpfile
    tmpfile="$(mktemp)"
    local file_changed=0

    while IFS= read -r line || [[ -n "$line" ]]; do
      line_num=$((line_num + 1))

      if echo "$line" | grep -q "modified by QC-09"; then
        echo "$line" >> "$tmpfile"
        continue
      fi

      # Comment out auth decorators
      if echo "$line" | grep -qE '^\s*@(login_required|jwt_required|auth_required)'; then
        echo "# $line  # Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
        echo "[QC-09] FIXED: commented out auth decorator in ${file}:${line_num}"
        FIXES_MADE=$((FIXES_MADE + 1))
        file_changed=1
        continue
      fi

      echo "$line" >> "$tmpfile"
    done < "$file"

    if [[ "$file_changed" -eq 1 ]]; then
      cp "$tmpfile" "$file"
    fi
    rm -f "$tmpfile"
  done <<< "$files"
}

fix_python_flask_login() {
  local entry_files=""
  for name in app.py main.py wsgi.py __init__.py; do
    if [[ -f "$APP_DIR/$name" ]]; then
      entry_files="$entry_files $APP_DIR/$name"
    fi
    if [[ -f "$APP_DIR/src/$name" ]]; then
      entry_files="$entry_files $APP_DIR/src/$name"
    fi
  done

  if [[ -z "$entry_files" ]]; then
    return
  fi

  for file in $entry_files; do
    [[ -f "$file" ]] || continue

    # Comment out Flask-Login / Flask-JWT initialization lines
    # e.g., login_manager = LoginManager(app), jwt = JWTManager(app)
    if grep -qE '(LoginManager|JWTManager)\s*\(' "$file"; then
      local line_num=0
      local tmpfile
      tmpfile="$(mktemp)"
      local file_changed=0

      while IFS= read -r line || [[ -n "$line" ]]; do
        line_num=$((line_num + 1))

        if echo "$line" | grep -q "modified by QC-09"; then
          echo "$line" >> "$tmpfile"
          continue
        fi

        # Comment out login_manager.init_app(app) or LoginManager(app)
        if echo "$line" | grep -qE '(login_manager|jwt)\s*[.=]\s*(LoginManager|JWTManager|init_app)'; then
          echo "# $line  # Portal basic auth is sufficient (modified by QC-09)" >> "$tmpfile"
          echo "[QC-09] FIXED: commented out Flask auth init in ${file}:${line_num}"
          FIXES_MADE=$((FIXES_MADE + 1))
          file_changed=1
          continue
        fi

        echo "$line" >> "$tmpfile"
      done < "$file"

      if [[ "$file_changed" -eq 1 ]]; then
        cp "$tmpfile" "$file"
      fi
      rm -f "$tmpfile"
    fi
  done
}

# --- Main ---

echo "[QC-09] Scanning for per-app auth to bypass in: $APP_DIR (stack: $STACK)"

if [[ "$STACK" == "node" ]]; then
  fix_node_auth_middleware
  fix_node_jwt_middleware
  fix_node_frontend_auth
  remove_node_login_pages
  remove_node_auth_routes
elif [[ "$STACK" == "python" ]]; then
  fix_python_auth_decorators
  fix_python_flask_login
else
  echo "[QC-09] SKIP: unsupported stack ($STACK) in $APP_DIR"
  exit 0
fi

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-09] RESULT: Bypassed ${FIXES_MADE} auth issue(s)"
  exit 1
else
  echo "[QC-09] PASS: no per-app auth detected"
  exit 0
fi
