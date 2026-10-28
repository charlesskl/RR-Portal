#!/usr/bin/env bash
# Consistent live SQLite backup, including committed WAL pages. No raw cp fallback.
# Run before recreating Paiji: a failed backup must stop the deployment.
set -euo pipefail
umask 077

INSTALL_DIR="${INSTALL_DIR:-/opt/rr-portal}"
cd "$INSTALL_DIR"
CT=$(docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production ps -q paiji)
[[ "$CT" =~ ^[a-f0-9]{12,64}$ ]] || { echo '[FAIL] 需要唯一运行中的 paiji 容器，未执行迁移' >&2; exit 1; }
[[ "$(docker inspect -f '{{.State.Running}}' "$CT")" == true ]] || { echo '[FAIL] paiji 未运行，未执行迁移' >&2; exit 1; }

BACKUP_ROOT="$INSTALL_DIR/deploy/backups/paiji"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
BACKUP_DIR=$(mktemp -d "$BACKUP_ROOT/online-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
REMOTE_TMP=$(docker exec "$CT" mktemp -d /tmp/paiji-online-backup.XXXXXX)
[[ "$REMOTE_TMP" =~ ^/tmp/paiji-online-backup\.[A-Za-z0-9_-]+$ ]] || { echo '[FAIL] 无效的备份临时路径' >&2; exit 1; }
cleanup() { docker exec "$CT" rm -rf -- "$REMOTE_TMP" >/dev/null || echo '[WARN] 容器备份临时目录未清理' >&2; }
trap cleanup EXIT

docker exec -i "$CT" node - "$REMOTE_TMP/paiji.db" > "$BACKUP_DIR/manifest.json" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
process.umask(0o077);
(async () => {
  const destination = process.argv[2];
  const source = new Database('/app/data/paiji.db', { readonly: true, fileMustExist: true });
  try { await source.backup(destination); } finally { source.close(); }
  fs.chmodSync(destination, 0o600);
  const snapshot = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const integrity = snapshot.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity_check failed');
    const counts = {};
    for (const { name } of snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      counts[name] = snapshot.prepare('SELECT COUNT(*) AS n FROM "' + name.replaceAll('"', '""') + '"').get().n;
    }
    console.log(JSON.stringify({ createdAt: new Date().toISOString(), method: 'sqlite-online-backup', integrity: 'ok',
      bytes: fs.statSync(destination).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'), counts }));
  } finally { snapshot.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
docker cp "$CT:$REMOTE_TMP/paiji.db" "$BACKUP_DIR/paiji.db" >/dev/null
chmod 600 "$BACKUP_DIR/paiji.db" "$BACKUP_DIR/manifest.json"
python3 - "$BACKUP_DIR" <<'PY'
import hashlib, json, pathlib, sqlite3, sys
folder = pathlib.Path(sys.argv[1])
path = folder / 'paiji.db'
manifest = json.loads((folder / 'manifest.json').read_text())
assert manifest['method'] == 'sqlite-online-backup' and manifest['integrity'] == 'ok'
assert path.stat().st_size == manifest['bytes']
assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest['sha256']
with sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
    assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
print('[OK] Paiji online backup: ' + str(folder) + ' SHA256=' + manifest['sha256'])
PY
