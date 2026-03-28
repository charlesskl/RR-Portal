#!/usr/bin/env bash
# ============================================================
# QC-18: Database Readiness Detection
# ============================================================
# Detects what database an app needs by scanning source code,
# validates connection string format, and flags issues that
# will cause runtime failures.
#
# This is a PRE-DEPLOY check. It does NOT test actual DB
# connectivity (that happens in PREPARE phase via SSH).
# It ensures the agent has enough info to provision correctly.
#
# Usage: check-db-ready.sh <app-directory>
# Exit 0: No database detected, or DB config looks correct
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-db-ready.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-18] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
FIXES_MADE=0

echo "[QC-18] Detecting database requirements for: $APP_DIR"

# --- Find the server directory ---
SERVER_DIR="$APP_DIR"
if [[ -d "$APP_DIR/server" ]]; then
  SERVER_DIR="$APP_DIR/server"
fi

# --- Detect database type from source code ---
DB_TYPE="none"
DB_DETECTED_FROM=""

# PostgreSQL indicators
if grep -rq "require.*pg\b\|from.*pg\b\|import.*pg\b\|postgresql://\|postgres://" "$SERVER_DIR" \
    --include="*.js" --include="*.ts" --include="*.py" --include="*.mjs" --include="*.cjs" 2>/dev/null; then
  DB_TYPE="postgresql"
  DB_DETECTED_FROM="pg module or postgresql:// URL in source"
elif grep -rq "sequelize\|typeorm\|knex\|prisma" "$SERVER_DIR" \
    --include="*.js" --include="*.ts" --include="*.json" 2>/dev/null; then
  # Check which backend the ORM uses
  if [[ -f "$SERVER_DIR/prisma/schema.prisma" ]]; then
    PRISMA_PROVIDER=$(grep 'provider.*=' "$SERVER_DIR/prisma/schema.prisma" 2>/dev/null | grep -oE '"[^"]*"' | tr -d '"' | tail -1)
    case "$PRISMA_PROVIDER" in
      postgresql|postgres) DB_TYPE="postgresql"; DB_DETECTED_FROM="prisma schema (provider=$PRISMA_PROVIDER)" ;;
      mysql) DB_TYPE="mysql"; DB_DETECTED_FROM="prisma schema (provider=mysql)" ;;
      sqlite) DB_TYPE="sqlite"; DB_DETECTED_FROM="prisma schema (provider=sqlite)" ;;
      mongodb) DB_TYPE="mongodb"; DB_DETECTED_FROM="prisma schema (provider=mongodb)" ;;
    esac
  elif grep -rq "dialect.*postgres\|client.*pg" "$SERVER_DIR" --include="*.js" --include="*.ts" --include="*.json" 2>/dev/null; then
    DB_TYPE="postgresql"
    DB_DETECTED_FROM="ORM config (dialect=postgres)"
  fi
fi

# MongoDB indicators
if [[ "$DB_TYPE" == "none" ]]; then
  if grep -rq "require.*mongoose\|from.*mongoose\|import.*mongoose\|mongodb://\|mongodb+srv://" "$SERVER_DIR" \
      --include="*.js" --include="*.ts" --include="*.py" --include="*.mjs" --include="*.cjs" 2>/dev/null; then
    DB_TYPE="mongodb"
    DB_DETECTED_FROM="mongoose module or mongodb:// URL in source"
  fi
fi

# SQLite indicators
if [[ "$DB_TYPE" == "none" ]]; then
  if grep -rq "better-sqlite3\|sqlite3\|import sqlite3\|\.sqlite\|\.db'" "$SERVER_DIR" \
      --include="*.js" --include="*.ts" --include="*.py" --include="*.mjs" --include="*.cjs" --include="*.json" 2>/dev/null; then
    DB_TYPE="sqlite"
    DB_DETECTED_FROM="sqlite module or .sqlite/.db file reference"
  fi
fi

# MySQL indicators
if [[ "$DB_TYPE" == "none" ]]; then
  if grep -rq "require.*mysql2\?\b\|from.*mysql\|mysql://" "$SERVER_DIR" \
      --include="*.js" --include="*.ts" --include="*.py" --include="*.mjs" --include="*.cjs" 2>/dev/null; then
    DB_TYPE="mysql"
    DB_DETECTED_FROM="mysql module or mysql:// URL in source"
  fi
fi

echo "[QC-18] Database type: $DB_TYPE (detected from: ${DB_DETECTED_FROM:-N/A})"

if [[ "$DB_TYPE" == "none" ]]; then
  echo "[QC-18] PASS: No database dependency detected"
  exit 0
fi

# --- Check for migrations ---
HAS_MIGRATIONS=false
for MDIR in "migrations" "prisma/migrations" "db/migrate" "alembic" "drizzle"; do
  if [[ -d "$SERVER_DIR/$MDIR" ]]; then
    HAS_MIGRATIONS=true
    echo "[QC-18] INFO: Found migrations in $MDIR"
    break
  fi
done

# --- Check for seed data ---
HAS_SEED=false
for SFILE in "seed.js" "seed.ts" "seeds" "fixtures" "init.sql" "seed.sql"; do
  if [[ -e "$SERVER_DIR/$SFILE" ]]; then
    HAS_SEED=true
    echo "[QC-18] INFO: Found seed data: $SFILE"
    break
  fi
done

# --- For SQLite: check that the DB file is in a volume-mountable directory ---
if [[ "$DB_TYPE" == "sqlite" ]]; then
  # Find sqlite file references
  SQLITE_PATHS=$(grep -roE "['\"][^'\"]*\.(sqlite3?|db)['\"]" "$SERVER_DIR" \
    --include="*.js" --include="*.ts" --include="*.py" 2>/dev/null | head -5 || true)

  if [[ -n "$SQLITE_PATHS" ]]; then
    echo "[QC-18] INFO: SQLite file references found:"
    echo "$SQLITE_PATHS" | head -3

    # Check if the sqlite file is inside a data/ directory (good for volume mount)
    if ! echo "$SQLITE_PATHS" | grep -q "data/\|DATA_PATH"; then
      echo "[QC-18] WARN: SQLite DB file may not be in a volume-mountable directory."
      echo "[QC-18] WARN: Ensure DATA_PATH env var is used and volume mount covers the DB file."
    fi
  fi
fi

# --- For server-hosted DBs: validate .env connection string ---
if [[ "$DB_TYPE" == "postgresql" || "$DB_TYPE" == "mongodb" || "$DB_TYPE" == "mysql" ]]; then
  ENV_FILE="${SERVER_DIR}/.env"
  if [[ -f "$ENV_FILE" ]]; then
    case "$DB_TYPE" in
      postgresql)
        CONN_VAR=$(grep -E '^(DATABASE_URL|POSTGRES_URL|PG_URL)=' "$ENV_FILE" | head -1)
        EXPECTED_HOST="db"
        EXPECTED_PROTO="postgresql://\|postgres://"
        ;;
      mongodb)
        CONN_VAR=$(grep -E '^(MONGODB_URL|MONGO_URL|MONGO_URI)=' "$ENV_FILE" | head -1)
        EXPECTED_HOST="mongo"
        EXPECTED_PROTO="mongodb://\|mongodb+srv://"
        ;;
      mysql)
        CONN_VAR=$(grep -E '^(DATABASE_URL|MYSQL_URL)=' "$ENV_FILE" | head -1)
        EXPECTED_HOST="mysql"
        EXPECTED_PROTO="mysql://"
        ;;
    esac

    if [[ -z "$CONN_VAR" ]]; then
      echo "[QC-18] WARN: No connection string found in .env for $DB_TYPE database."
      echo "[QC-18] WARN: Agent PREPARE phase must provision DB and write the connection string."
    else
      CONN_VALUE="${CONN_VAR#*=}"

      # Check for localhost (will fail inside Docker)
      if echo "$CONN_VALUE" | grep -qE 'localhost|127\.0\.0\.1'; then
        echo "[QC-18] WARN: Connection string uses localhost — will fail inside Docker container."
        echo "[QC-18] WARN: Should use Docker service name '$EXPECTED_HOST' instead."
        # Don't auto-fix here — check-env-vars.sh handles this
      fi

      # Check for placeholder values
      if echo "$CONN_VALUE" | grep -qiE 'CHANGE_ME|password@|your_'; then
        echo "[QC-18] WARN: Connection string has placeholder credentials."
        echo "[QC-18] WARN: Agent PREPARE phase must replace with real credentials."
      fi
    fi
  else
    echo "[QC-18] WARN: No .env file found. Agent PREPARE phase must create one with DB credentials."
  fi
fi

# --- Write detection results to a temp file for agent consumption ---
DB_INFO_FILE="/tmp/qc-db-info-${APP_NAME}.json"
python3 -c "
import json
info = {
    'db_type': '$DB_TYPE',
    'detected_from': '${DB_DETECTED_FROM}',
    'has_migrations': $( [[ "$HAS_MIGRATIONS" == "true" ]] && echo "True" || echo "False" ),
    'has_seed_data': $( [[ "$HAS_SEED" == "true" ]] && echo "True" || echo "False" ),
    'needs_provisioning': $( [[ "$DB_TYPE" == "postgresql" || "$DB_TYPE" == "mongodb" || "$DB_TYPE" == "mysql" ]] && echo "True" || echo "False" )
}
with open('$DB_INFO_FILE', 'w') as f:
    json.dump(info, f, indent=2)
print(f'[QC-18] INFO: DB detection results written to $DB_INFO_FILE')
" 2>/dev/null || echo "[QC-18] WARN: Could not write DB info file"

# --- Result ---
if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-18] RESULT: Fixed ${FIXES_MADE} database config issue(s)"
  exit 1
else
  echo "[QC-18] PASS: Database requirements detected and validated (type=$DB_TYPE)"
  exit 0
fi
