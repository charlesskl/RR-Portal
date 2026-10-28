"""Inert second read-only diagnosis of one fixed, sealed public Docker build log."""
import datetime, hashlib, json, os, pathlib, re, subprocess, sys

ROOT = pathlib.Path('/opt/rr-portal')
BASE = '4b3d8f3e319e41dcc8720d759e1af0726a2b2381'
BRANCH = 'refs/heads/ops/batch-1015-1019-1022-20261028'
EXECUTE = False
PHASE = 'diagnose-build-log-v2'
FAILED = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-existing/prepare'
OUT = ROOT / 'deploy/backups/batch-1015-1019-1022-20261028-build-log-v2'
MANIFEST_SHA256 = '853641272860863d96eb17d07260f8faced04417d8f6409df7f831e25c31c9d1'
LOG_SHA256 = 'e55cbcd0be5bd68a71f1088b656264c7dc233464a90f7732789fe61ca4b70810'
OLD_DIGEST = 'adf5b723ca5f8edae60a0a0f12a3828b8cd488a99eeee6405b61092805620294'
STAGE = 'entry'


def need(value, label):
    global STAGE
    if not value:
        STAGE = label
        raise RuntimeError('BUILD_LOG_DIAGNOSIS_REJECTED')


def enc(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_fixed(path, limit):
    for parent in (path, *path.parents):
        if parent == ROOT:
            break
        need(not parent.is_symlink(), 'no-fixed-evidence-symlinks')
    need(path.is_file() and path.stat().st_size <= limit, 'bounded-fixed-evidence')
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'stable-fixed-evidence')
    return raw



def features(raw):
    text = raw.decode('utf8', errors='replace')
    lower = text.lower()
    hints = {
        'PARSE_OR_REFERENCE': ('dockerfile parse error', 'invalid reference format', 'from requires', 'failed to read dockerfile'),
        'REGISTRY_RATE_LIMIT': ('toomanyrequests', 'rate limit', 'status code: 429', '429 too many'),
        'DNS_LOOKUP': ('no such host', 'server misbehaving', 'temporary failure in name resolution'),
        'TLS_CERTIFICATE': ('tls handshake', 'x509:', 'certificate signed', 'certificate has expired'),
        'TIMEOUT_OR_CANCEL': ('deadline exceeded', 'timeout', 'timed out', 'context canceled', 'context cancelled'),
        'REGISTRY_ACCESS_DENIED': ('pull access denied', 'insufficient_scope', 'unauthorized', 'authorization failed'),
        'IMAGE_PLATFORM': ('no match for platform', 'no matching manifest'),
        'DISK_SPACE': ('no space left on device',),
        'CONTEXT_PERMISSION': ('permission denied',),
        'NETWORK_CONNECT_FAILURE': ('connection refused', 'network is unreachable', 'no route to host', 'connection reset by peer', 'unexpected eof', ' eof'),
        'COPY_SOURCE': ('failed to calculate checksum', 'failed to compute cache key'),
    }
    codes = [code for code, tokens in hints.items() if any(token in lower for token in tokens)]
    for status in ('400', '401', '403', '404', '408', '413', '429', '500', '502', '503', '504'):
        if re.search(r'(?:status(?: code)?|http)\s*:?\s*' + status + r'\b', lower):
            codes.append('HTTP_STATUS_' + status)
    return {'oldImageIdMentioned': 'sha256:' + OLD_DIGEST in lower,
            'hubIdMentioned': ('docker.io/library/sha256:' + OLD_DIGEST in lower
                               or '/v2/library/sha256/manifests/' + OLD_DIGEST in lower),
            'metadataMentioned': 'load metadata' in lower or 'source metadata' in lower,
            'knownHintCodes': codes or ['UNCLASSIFIED'],
            'copySourcesMentioned': {name: bool(re.search(r'\b' + name + r'\b', lower)) for name in ('code0', 'code1', 'code2')}}


def diagnose():
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=15)
    need(result.returncode == 0 and result.stdout.decode().strip() == BASE, 'unchanged-host-source-base')
    manifest = read_fixed(FAILED / 'manifest.json', 1024 ** 2)
    need(sha(manifest) == MANIFEST_SHA256, 'exact-original-failed-manifest')
    raw = read_fixed(FAILED / 'internal-quote-build.private.log', 1329)
    need(len(raw) == 1329 and sha(raw) == LOG_SHA256
         and json.loads(manifest)['internal-quote-build.private.log'] == LOG_SHA256, 'exact-original-1329-byte-build-log')
    return dict(features(raw), buildLogBytes=len(raw), buildLogSHA256=sha(raw),
                dockerBuildTagSQLSignalsConfigWritesOrLiveHTTP=False)


def main():
    need(EXECUTE is True and sys.argv[1:] == [PHASE] and os.environ.get('RELEASE_BRANCH') == BRANCH
         and os.environ.get('RELEASE_MODE') == PHASE and os.environ.get('RELEASE_ATTEMPT') == '1', 'inert-fixed-new-diagnosis')
    os.umask(0o077)
    need(not OUT.exists() and not OUT.is_symlink(), 'new-one-shot-diagnostic-directory')
    OUT.mkdir(mode=0o700)
    value = {'phase': PHASE, 'base': BASE, 'success': False}
    try:
        value.update(diagnose())
        value['success'] = True
    except Exception as error:
        value.update(errorType=type(error).__name__, stage=STAGE)
    value['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fd = os.open(OUT / 'result.private.json', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(enc(value))
    value['resultSHA256'] = sha(enc(value))
    print(json.dumps(value, sort_keys=True), flush=True)
    return 0 if value['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
