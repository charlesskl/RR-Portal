"""INERT exact-own-rule reopen of original PrintLink and bounded diagnosis.
PIN False prevents execution. No lifecycle, SQLite/tar read, business/auth/model
write, configuration edit or data restore is present. Old-service health never
blocks removal of the six temporary rules installed by this failed deployment.
"""
import copy,hashlib,ipaddress,json,os,pathlib,re,shlex,stat,subprocess,sys,traceback,urllib.error,urllib.request
ROOT=pathlib.Path('/opt/rr-portal')
D=ROOT/'deploy/backups/pr-1008-20261026-03-deploy'
BACKUP=ROOT/'deploy/backups/pr-1008-20261026-02-backup'
B_RECOVERY=ROOT/'deploy/backups/pr-1008-20261026-03-publication-recovery-b'
OUT=ROOT/'deploy/backups/pr-1008-20261026-03-reopen-original'
BASE='37b6146354f692dfabc8b009f6c5b80ced091bdb'
TARGET='bb1fab660bdf4e04e828e4c4250279f717603ac5'
TREE='72baeafdefab7f2abf01be09f941f31ec8b623fa'
BRANCH='refs/heads/ops/pr-1008-20261026-02'
D_MANIFEST='ad51e1bd5fae30749cc49cee61f238158dbf609d466165b04809cc297ff2a65e'
D_RESULT='a3480b593bd25a7fa6ae40c5e98355a12253c857681bf4543fe12b6a2db91a00'
B_MANIFEST='2a53e7953a986050fc8c786cc5f4baa758926eb2821233436ec9182c169aec15'
B_RESULT='8863f1ccf2101e03075d9029aafca1bebbff638542080708ea9b162bdec8454b'
B_RECOVERY_MANIFEST='9097db39ff386363ae609fbf49021a72a91480fb7f71eba356ec895af3b508e1'
B_RECOVERY_RESULT='b506095174d9d87f55b9f15360e42b4ade92fc087f48debf104b4c18eaeeeecc'
ORIGINAL_IMAGE='sha256:5d48e2e4e4557988e56fb3e27d28c38eab98410244783e31d169466b0fb476f4'
PIN=True
DEPS={}
TAG='rr-pr1008-p02-20261026'
OWN_CHAIN='RRP1008_P02'
EXPECTED_COUNT=6
STAGE='entrypoint';SERIAL=0
EXPECTED_TARGET_ID=None;EXPECTED_TARGET_CONFIGURATION=None
def need(v, label):
    global STAGE
    if not v:
        STAGE = label
        raise RuntimeError('PUBLICATION_CLEANUP_REJECTED')

def pin(v):
    return type(v) is str and re.fullmatch('[a-f0-9]{64}', v) is not None

def enc(v):
    return json.dumps(v, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def sha(v):
    return hashlib.sha256(v).hexdigest()

def nibbles(v):
    need(type(v) is str and re.fullmatch('[a-f0-9]{64}', v) is not None, 'typed-sha256')
    return [int(c, 16) for c in v]

def safe_name(v):
    return type(v) is str and bool(v) and (str(pathlib.PurePosixPath(v)) == v) and (not pathlib.PurePosixPath(v).is_absolute()) and all((x not in {'', '.', '..'} for x in pathlib.PurePosixPath(v).parts)) and (not any((ord(c) < 32 or c == '\\' for c in v)))

def filehash(p):
    need(p.is_file() and (not p.is_symlink()), 'regular-sealed-file')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    h = hashlib.sha256()
    with os.fdopen(fd, 'rb') as stream:
        a = os.fstat(stream.fileno())
        need(stat.S_ISREG(a.st_mode) and a.st_size <= 32 * 1024 ** 3, 'bounded-sealed-file')
        for block in iter(lambda : stream.read(1024 ** 2), b''):
            h.update(block)
        z = os.fstat(stream.fileno())
        key = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(key(a) == key(z) == key(p.lstat()), 'stable-sealed-file-hash')
    return h.hexdigest()

def regular(p, limit=32 * 1024 ** 2):
    need(p.is_file() and (not p.is_symlink()) and (p.stat().st_size <= limit), 'bounded-private-read')
    h = filehash(p)
    v = p.read_bytes()
    need(sha(v) == h == filehash(p), 'stable-complete-private-read')
    return v

def private(n, v):
    need(re.fullmatch('[a-z0-9_.-]+', n) is not None, 'fixed-output-name')
    fd = os.open(OUT / n, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 384)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(v if type(v) is bytes else enc(v))
        stream.flush()
        os.fsync(stream.fileno())

def sealed(root, mf, rh, whole):
    need(root.is_dir() and (not root.is_symlink()) and (stat.S_IMODE(root.stat().st_mode) == 448), 'private-original-archive')
    mb = regular(root / 'manifest.json')
    rb = regular(root / 'first-result.json')
    need(sha(mb) == mf and sha(rb) == rh, 'exact-original-manifest-and-result-seals')
    m = json.loads(mb)
    need(type(m) is dict and all((safe_name(n) and type(h) is str and (re.fullmatch('[a-f0-9]{64}', h) is not None) for (n, h) in m.items())), 'safe-original-manifest')
    if whole:
        entries = list(root.rglob('*'))
        need(len(entries) <= 100000 and all((not p.is_symlink() and (p.is_file() or p.is_dir()) and (p.stat().st_mode & 63 == 0) for p in entries)), 'all-private-original-failed-archive-entries')
        need(set(m) == {str(p.relative_to(root)) for p in entries if p.is_file() and p != root / 'manifest.json'} and all((filehash(root / n) == h for (n, h) in m.items())), 'every-original-failed-deploy-file-seal')
    r = json.loads(rb)
    need(enc(r) == rb, 'canonical-original-result')
    return (m, r)

def exact(left, right):
    return type(left) is type(right) and json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)

def token(row):
    need(type(row) in (list, tuple) and len(row) == 2 and (type(row[0]) is str) and (type(row[1]) is str), 'typed-saved-rule-row')
    return tuple(shlex.split(row[1])) if row[1].startswith('-A ') else None

def canonical_owned(tokens):
    """Only the already reviewed exact-host conntrack /32 spelling is folded."""
    result = list(tokens)
    if '--ctorigdst' in result:
        index = result.index('--ctorigdst') + 1
        need(index < len(result), 'complete-owned-ctorigdst')
        network = ipaddress.ip_network(result[index], strict=False)
        need(network.version == 4 and network.prefixlen == 32, 'exact-owned-original-destination-host')
        result[index] = str(network.network_address)
    return tuple(result)

def own_partition(rows, expected, family):
    (found, foreign) = ([], [])
    allowed = {(table, tuple(tokens)) for (f, table, tokens) in expected if f == family}
    for row in rows:
        tokens = token(row)
        if tokens and (TAG in tokens or OWN_CHAIN in tokens):
            need(row[0] == 'filter' and (row[0], canonical_owned(tokens)) in allowed, 'only-exact-reviewed-own-rule')
            found.append((row[0], tokens))
        else:
            need(not row[1].startswith(':' + OWN_CHAIN + ' '), 'no-owned-chain-created')
            foreign.append(copy.deepcopy(row))
    normalized = [(table, canonical_owned(tokens)) for (table, tokens) in found]
    need(len(normalized) == len(set(normalized)), 'no-duplicate-own-rules')
    return (foreign, found)

def plan_cleanup(installed_rules, original_rows, current_rows):
    """Return inert deletion argv; no process, file, DB, network or signal I/O.

    installed_rules is the authenticated D03 reservation's exact six rules.
    original_rows/current_rows are authenticated parse_save()['rows'] mappings
    keyed by integer family 4 and 6. A separate controller must prove the
    reservation matches frozen profile/source and the original B02 rules.
    """
    need(type(installed_rules) is list and len(installed_rules) == EXPECTED_COUNT, 'exact-six-authenticated-install-rules')
    need(set(original_rows) == {4, 6} and set(current_rows) == {4, 6}, 'both-firewall-families')
    normalized = []
    for entry in installed_rules:
        need(type(entry) in (list, tuple) and len(entry) == 3, 'typed-install-rule')
        (family, table, tokens) = entry
        need(type(family) is int and family in (4, 6) and (table == 'filter') and (type(tokens) in (list, tuple)) and all((type(t) is str for t in tokens)), 'typed-fixed-family-filter-rule')
        need(tokens[:2] in (['-A', 'INPUT'], ['-A', 'DOCKER-USER'], ('-A', 'INPUT'), ('-A', 'DOCKER-USER')) and tokens.count(TAG) == 1 and (OWN_CHAIN not in tokens), 'only-six-tagged-input-or-docker-user-rules')
        normalized.append((family, table, tuple(tokens)))
    need(len(set(normalized)) == EXPECTED_COUNT and sum((f == 6 for (f, _, _) in normalized)) == 1, 'unique-five-ipv4-one-ipv6-install-rules')
    (commands, expected_after) = ([], {})
    for family in (4, 6):
        (baseline_foreign, baseline_own) = own_partition(original_rows[family], normalized, family)
        need(not baseline_own, 'owned-tag-absent-before-this-install')
        (current_foreign, current_own) = own_partition(current_rows[family], normalized, family)
        expected_after[family] = current_foreign
        for (_, tokens) in reversed(current_own):
            commands.append(['iptables' if family == 4 else 'ip6tables', '-w', '30', '-t', 'filter', '-D', *tokens[1:]])
    need(len(commands) <= EXPECTED_COUNT, 'bounded-only-observed-own-subset-deletion')
    return {'commands': commands, 'expectedAfterRows': expected_after, 'expectedRemovedCount': len(commands), 'requiresCurrent46And43PeersPrivateSnapshots': True, 'requiresActualTargetIdentityImageConfigRunningProof': True, 'unrelatedLifecycleEqualityToOldBackupRequired': False, 'containerOrSourceOrDataOrEnvironmentOperations': False}

def verify_after(plan, observed_rows):
    need(set(observed_rows) == {4, 6}, 'both-after-firewall-families')
    need(exact(plan['expectedAfterRows'], observed_rows), 'all-current-foreign-rules-byte-identical-in-order-and-only-own-subset-removed')
    return True

def parse_save(blob):
    text = blob.decode()
    table = None
    rows = []
    times = []
    counters = {}
    for line in text.splitlines():
        if not line:
            continue
        if line.startswith('# Generated by ') or line.startswith('# Completed on '):
            times.append(line)
            continue
        if line.startswith('*'):
            need(table is None and line[1:] in {'filter', 'nat', 'raw', 'mangle', 'security'}, 'known-firewall-table')
            table = line[1:]
            rows.append((table, line))
            continue
        need(table is not None, 'complete-firewall-table')
        if line == 'COMMIT':
            rows.append((table, line))
            table = None
            continue
        if line.startswith(':'):
            m = re.fullmatch(':([A-Za-z0-9_-]+) (ACCEPT|DROP|REJECT|-) \\[([0-9]+):([0-9]+)\\]', line)
            need(m is not None, 'exact-chain-declaration')
            rows.append((table, ':' + m[1] + ' ' + m[2] + ' [COUNTERS]'))
            counters[table + '/' + m[1]] = [int(m[3]), int(m[4])]
            continue
        need(line.startswith('-A ') and len(shlex.split(line)) <= 100, 'bounded-append-rule')
        rows.append((table, line))
    need(table is None and rows, 'complete-saved-rules')
    return {'rows': rows, 'generatedTimeLines': times, 'chainCounters': counters}

def expected_rules():
    tag = ['-m', 'comment', '--comment', TAG]
    values = []
    for family in (4, 6):
        values.append((family, 'filter', tuple(['-A', 'INPUT', '!', '-i', 'lo', '-p', 'tcp', '-m', 'tcp', '--dport', '3100', '-m', 'addrtype', '--dst-type', 'LOCAL', *tag, '-j', 'REJECT', '--reject-with', 'tcp-reset'])))
    for address in ('172.17.0.1', '172.18.0.1', '172.19.0.1', '192.168.0.173'):
        values.append((4, 'filter', tuple(['-A', 'DOCKER-USER', '-p', 'tcp', '-m', 'tcp', '-m', 'conntrack', '--ctorigdst', address, '--ctorigdstport', '3100', '--ctdir', 'ORIGINAL', *tag, '-j', 'REJECT', '--reject-with', 'tcp-reset'])))
    return values

def selected(root, manifest, name):
    need(name in manifest, 'selected-evidence-present')
    value = regular(root / name)
    need(sha(value) == manifest[name], 'selected-evidence-byte-seal')
    return value

def read_command(args, label, limit=64 * 1024 ** 2):
    global SERIAL
    allowed = args == ['docker', 'ps', '-aq', '--no-trunc'] or args[:2] == ['docker', 'inspect'] or args == ['docker', 'network', 'ls', '--no-trunc', '--format', '{{json .}}'] or (args[:3] == ['docker', 'network', 'inspect']) or (args in (['iptables-save'], ['ip6tables-save']))
    need(allowed, 'only-explicit-runtime-read-command')
    SERIAL += 1
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, cwd=ROOT)
    private('%03d-%s.stdout.private' % (SERIAL, label), r.stdout)
    private('%03d-%s.stderr.private' % (SERIAL, label), r.stderr)
    need(r.returncode == 0 and len(r.stdout) <= limit, 'bounded-runtime-read-success')
    return r.stdout

def configuration(raw):
    return {r['Id']: {'image': r['Image'], 'Config': dict(r['Config'], Env=sorted(r['Config']['Env'])), 'HostConfig': r['HostConfig'], 'Mounts': sorted(r['Mounts'], key=enc)} for r in raw}

def lifecycle(raw):
    return {r['Id']: {'running': r['State']['Running'], 'started': r['State']['StartedAt'], 'oom': r['State']['OOMKilled'], 'restarts': r['RestartCount']} for r in raw}

def snapshot_rules(label):
    return {family: parse_save(read_command([tool], label + '-ipv' + str(family)))['rows'] for (family, tool) in ((4, 'iptables-save'), (6, 'ip6tables-save'))}

def check_delete(args, label):
    global SERIAL
    need(args[0] in {'iptables', 'ip6tables'} and args[1:6] == ['-w', '30', '-t', 'filter', '-D'], 'only-exact-owned-filter-deletion')
    family = 4 if args[0] == 'iptables' else 6
    tokens = ('-A', *args[6:])
    need(('filter', canonical_owned(tokens)) in {(table, t) for (f, table, t) in expected_rules() if f == family}, 'deletion-is-one-of-exact-six-owned-rules')
    for action in ('-C', '-D'):
        command = [*args[:5], action, *args[6:]]
        SERIAL += 1
        with (OUT / ('%03d-%s-%s.private.log' % (SERIAL, label, action[1:]))).open('xb') as log:
            r = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=45, cwd=ROOT)
        need(r.returncode == 0, 'one-exact-owned-rule-' + action[1:] + '-succeeded')

def seal_output(result):
    private('first-result.json', result)
    manifest = {str(p.relative_to(OUT)): filehash(p) for p in OUT.rglob('*') if p.is_file()}
    private('manifest.json', manifest)
    print(enc(dict(result, manifestSHA256Nibbles=nibbles(filehash(OUT / 'manifest.json')), resultSHA256Nibbles=nibbles(filehash(OUT / 'first-result.json')))).decode(), flush=True)

STATIC_LABELS = ('PR1008_BACKUP_REJECTED', 'PR1008_RELEASE_REJECTED', 'actual-gate-proven-before-recovery', 'actual-source-and-assets-equal-prepared', 'actual-source-equals-immutable-prepared', 'all-45-original-runtime-contracts-identical', 'all-46-container-identities', 'all-46-runtime-inspects', 'all-and-only-bound-own-docker-rules-for-current-endpoint', 'all-child-environment-values-exact-pid1-plus-existing-secret-and-station-file', 'all-closed-portable-typed-sqlite-audits-reproduce', 'all-cloud-add-column-migrations-already-applied', 'all-docker-network-topologies-captured', 'all-existing-docker-copy-source-paths-preserved', 'all-files-mode-owners-stable-through-backup', 'all-fixed-configuration-and-mode-owners-preserved', 'all-network-configuration-exact', 'all-nginx-flags-unmodified', 'all-original-database-mode-owners-identical', 'all-original-diagnostic-file-seals', 'all-original-network-identities-only', 'all-other-startup-production-sync-lock-health-source-and-mode-identical', 'all-own-rules-and-chain-absent', 'all-phase-byte-seals', 'all-printlink-docker-copy-bytes-mode-match-base', 'all-printlink-docker-copy-roots', 'all-private-regular-phase-entries', 'all-records-have-identities-and-timestamps-no-startup-migration', 'all-required-input-and-forward-hooks-present', 'all-reviewed-git-file-hashes', 'all-target-maintenance-initially-clear', 'all-three-transitive-dependency-pins-before-import', 'all-transitive-frozen-dependencies', 'all-unchanged-cloud-startup-tables-exist', 'all-unchanged-production-startup-tables-exist', 'all-unrelated-ipv4-rules-byte-identical-and-in-order', 'all-unrelated-ipv6-rules-byte-identical-and-in-order', 'all45-other-container-unchanged', 'all46-original-runtime-before-switch', 'all46-stable-before-own-gate', 'all46-stable-before-recovery-open', 'all46-stable-through-held-loopback-public-checks', 'all46-stable-through-readonly-verify', 'anonymous-business-and-attachment-access-rejected', 'automatic-config-hostname', 'automatic-pid1-hostname', 'base-target-has-exact-dnat-and-accept', 'blank-draft-or-wrong-phase-branch-attempt-target', 'bounded-append-rule', 'bounded-full-printlink-source', 'bounded-ingress-capability-read', 'bounded-printlink-candidate-source', 'bounded-private-env', 'bounded-private-environment-file', 'bounded-public-static-response', 'bounded-readonly-public-request', 'bounded-regular-docker-daemon-config', 'bounded-unique-docker-networks', 'candidate-default-env-byte-list-unchanged', 'candidate-default-environment-covered-by-original-literal', 'candidate-ip-exclusive-in-bound-subnet', 'canonical-known-main-revision', 'canonical-persistent-roots-without-symlink-aliases', 'closed-data-audit-reproduced', 'complete-current-inspects', 'complete-firewall-table', 'complete-hostconfig-mounts', 'complete-original-pid1-environment', 'complete-original-production-printlink-baseline', 'complete-owned-original-destination', 'complete-pid1-environment', 'complete-printlink-candidate-source', 'complete-printlink-source', 'complete-production-two-sqlite-backup', 'complete-runtime-config-and-literal-env', 'complete-saved-rules', 'current-final-runtime-and-original45', 'database-family-map', 'dependency-pin', 'dirty-no-symlink-ancestors', 'dirty-original-regular-file', 'dirty-outside-printlink-app-and-fixed-configuration', 'dirty-regular-file', 'disjoint-canonical-persistent-roots', 'docker-user-is-first-forward-hook-before-established-accept', 'enough-private-backup-space', 'entire-compose-render-unchanged', 'entire-environment-exact-expected-bytes-mode-owner', 'entire-exact-publication-lease-present', 'entire-existing-cloud-startup-schema-seeding-cleanup-prefix-byte-identical', 'every-attachment-json-sync-baseline-secrets-and-file-byte-identical', 'every-business-telemetry-sync-authority-typed-row-schema-and-sequence-identical', 'every-candidate-copy-byte-and-mode-equals-reviewed-git', 'every-nontarget-endpoint-id-ip-name-mac-exact', 'every-original-file-and-directory-mode-owner-identical', 'every-original-nginx-maintenance-flag-unmodified', 'every-retained-main-and-companion-mode-owner-identical', 'exact-46-container-inventory', 'exact-base-tree', 'exact-bounded-lock-file-inventory', 'exact-candidate-platform-revision', 'exact-canonical-main', 'exact-chain-declaration', 'exact-compose-service-config-hash', 'exact-final-reviewed-printlink-frontend-server-doc-test-paths', 'exact-four-local-ipv4-original-destinations', 'exact-four-preexisting-dirty-files', 'exact-lock-directory', 'exact-lock-owner-file', 'exact-one-production-target-45-others', 'exact-only-reviewed-copy-files', 'exact-operational-lock-archive-bytes', 'exact-operational-lock-permissions', 'exact-operational-timestamp', 'exact-operational-timestamp-type', 'exact-phase-seals', 'exact-platform-lock-shape-pid-purpose', 'exact-prepared-source-and-services', 'exact-reviewed-printlink-frontend-diff', 'exact-reviewed-printlink-only-source-inventory', 'exact-reviewed-target-tree', 'exact-service-mount-count', 'exact-service-persistent-mount', 'exact-tracked-only-docker-copy-files', 'exact-two-printlink-database-inventories', 'exact-two-printlink-databases', 'exact-two-running-app-children', 'existing-authority-state-valid-and-preserved', 'existing-persistent-secret-shape', 'existing-persistent-secrets-no-regeneration', 'existing-production-snapshot-no-seed', 'existing-production-snapshot-shape', 'existing-production-users-and-mode-no-seed', 'existing-record-day-shape', 'existing-source-inventory-startup-config-no-seed', 'explicit-publication-only-profile', 'failed-closed-candidate-all-typed-rows-schema-sequence-files-mode-owners-exact', 'false-draft-or-wrong-invocation', 'fixed-printlink-capture-service-label', 'fixed-source-global-config-preserved', 'four-existing-dirty-files-identical', 'frozen-dependency-pin', 'frozen-ingress-profile', 'full-environment-bytes-mode-owner-unchanged', 'full-file-mode-owner-map', 'graceful-stop-removed-only-own-platform-lock', 'healthy-immutable-running-image', 'healthy-target-runtime', 'immutable-prepared-image-identities', 'immutable-printlink-original-image', 'inert-exact-backup-library', 'inert-factory-library', 'ingress-lease-present', 'known-firewall-table', 'known-network-protocol-sysctl', 'lease-install-started-not-released', 'literal-environment-map', 'lock-created-within-exact-candidate-start-window', 'lock-owner-equals-existing-node-database-owner', 'never-restart-without-fresh-closed-business-evidence', 'new-companion-matches-main-mode-owner', 'no-background-unsynced-job-writer', 'no-extra-or-modified-owned-rule', 'no-legacy-quality-stage-migration-candidates', 'no-other-network-created-or-removed', 'no-unattached-upload-gc-candidates-next-two-hours', 'no-unclassified-original-target-ip-firewall-rule', 'nonsecret-wire-sha256', 'observed-special-printlink-writer-reference-requires-specific-review', 'old-runtime-serving-with-no-ingress-write', 'one-complete-operational-lock-member', 'one-current-printlink', 'one-current-target-endpoint', 'one-explicit-compensation-attempt', 'one-ingress-lease-per-phase', 'one-of-each-own-rule-and-chain', 'one-of-each-owned-docker-rule', 'one-owned-failed-candidate', 'one-writer-exclusive-canonical-persistent-root', 'only-automatic-config-hostname', 'only-exact-image-revision-and-compose-labels', 'only-held-owned-failed-service-recovery', 'only-original-runtime-environment', 'only-owned-old-writer-stopped-with-original-contract', 'only-printlink-data-contract', 'only-printlink-public-target', 'only-printlink-source-proof', 'only-readiness-no-false-nginx-isolation', 'only-running-target-one-ipv4-endpoint', 'only-two-databases-and-typed-companion-metadata', 'only-two-existing-printlink-databases', 'original-43-peers-exact-reviewed-profile', 'original-immutable-image', 'original-target-is-exact-ipv4-only-network', 'overlay-exact-production-printlink', 'own-chain-only-ipv4', 'own-operation-service', 'own-rules-at-chain-head-in-exact-order', 'owned-original-destination-is-exact-host', 'owned-rules-have-exact-owned-chain', 'prepared-and-deployed-full-env-binding', 'prepared-original-runtime-and-full-env', 'printlink-public-health', 'printlink-public-static-exact-reviewed-candidate', 'private-original-diagnostic', 'private-original-diagnostic-entries', 'private-phase-directory-and-pins', 'production-printlink-closed-evidence-present', 'production-printlink-runtime-path-and-no-demo-mode', 'production-printlink-scoped-deploy-success', 'publication-adapter-never-creates-owned-chain', 'readable-network-protocol-sysctl', 'recovered-original-full-source', 'regular-environment-file', 'regular-existing-station-config', 'regular-metadata-kind', 'regular-metadata-path', 'regular-sealed-lock-archive', 'regular-tracked-printlink-files', 'rendered-full-literal-environment', 'retry03-never-prepare-build-or-rebackup', 'reviewed-canonical-file-bytes-mode', 'reviewed-ingress-lease-present', 'reviewed-regular-source-mode', 'reviewed-source-manifest-pin', 'reviewed-source-no-symlink-ancestors', 'safe-owned-path', 'safe-regular-candidate-copy-source', 'safe-regular-printlink-container-source', 'same-firewall-backends-as-backup', 'same-four-local-ipv4-addresses-for-public-dnat-gate', 'sealed-capture-audit-binding', 'sealed-cutover-exact-current-candidate-binding', 'sealed-diagnostic-binds-exact43-peer-and-bridge-profile', 'sealed-mode-owner-inventories', 'sealed-original-diagnostic', 'single-install-attempt', 'six-rules-all-existing-original-direction-connections-covered', 'stable-bounded-dirty-file', 'stable-captured-files-and-mode-owners', 'stable-environment-read', 'stable-sealed-lock-archive', 'successful-bound-prior-phase', 'successful-original-routing-diagnostic', 'target-network-attachment-matches-running-state', 'target-only-original-published-binding', 'terminated', 'typed-environment', 'typed-full-file-inventory', 'unchanged-all46-runtime-source-dirty-flags', 'unchanged-global-docker-dependencies-and-migrations', 'unchanged-other-image-labels', 'unique-environment', 'unique-file-paths', 'unique-target-service', 'unrecreated-original-labels')

SAFE_FRAMES = {'batch-host-config-library.py', 'pr1008-02-backup-library.py', 'pr1008-03-publication-ingress-library.py', 'run.py', 'release-data-ops-library.py', 'factory-review-backup-library.py', 'pr1008-printlink-contract-library.py', 'pr1008-02-publication-ingress-library.py', 'pr1008-03-release.py', 'release-data-library.py'}

def failure_summary(text):
    lines = [line for line in text.splitlines() if line.strip()]
    match = re.fullmatch('([A-Za-z_][A-Za-z0-9_]*): ?(.*)', lines[-1]) if lines else None
    allowed = {'RuntimeError', 'ValueError', 'TypeError', 'KeyError', 'FileNotFoundError', 'PermissionError', 'OSError', 'JSONDecodeError', 'AssertionError'}
    kind = match[1] if match and match[1] in allowed else 'OtherException'
    message = match[2] if match else ''
    frames = []
    for (name, line, _) in re.findall('File "([^"\\n]+)", line ([0-9]+), in ([A-Za-z_][A-Za-z0-9_]*)', text):
        file = pathlib.PurePosixPath(name).name
        if file in SAFE_FRAMES and 0 < int(line) <= 10000:
            frames.append({'file': file, 'line': int(line)})
    return {'exceptionClass': kind, 'staticLabel': message if message in STATIC_LABELS else '<non-whitelisted-message-omitted>', 'staticLabelWhitelisted': message in STATIC_LABELS, 'reviewedSourceFrames': frames[-8:], 'tracebackBodyEnvironmentAndArgumentsPrinted': False}
SAFE_FRAMES.update({'pr1008-03-release-library.py','pr1008-03-publication-recovery-b.py'})

def snapshot_runtime(label):
    ids=read_command(['docker','ps','-aq','--no-trunc'],label+'-ids').decode().split();need(len(ids)==len(set(ids))==46 and all(re.fullmatch('[a-f0-9]{64}',v)for v in ids),'current46-container-identities')
    raw=json.loads(read_command(['docker','inspect',*ids],label+'-runtime'));need(type(raw)is list and len(raw)==46 and {r['Id']for r in raw}==set(ids),'complete-current46-runtime')
    targets=[r for r in raw if(r['Config'].get('Labels')or{}).get('com.docker.compose.project')=='rr-portal'and(r['Config'].get('Labels')or{}).get('com.docker.compose.service')=='printlink'];need(len(targets)==1,'one-current-original-printlink');target=targets[0]
    need(target['Id']==EXPECTED_TARGET_ID and target['Image']==ORIGINAL_IMAGE and exact(configuration([target]),EXPECTED_TARGET_CONFIGURATION),'same-original-target-identity-image-full-config-env-mounts')
    listed=[json.loads(line)for line in read_command(['docker','network','ls','--no-trunc','--format','{{json .}}'],label+'-network-ids').decode().splitlines()];need(len(listed)==5 and len({n['ID']for n in listed})==5 and all(re.fullmatch('[a-f0-9]{64}',n['ID'])for n in listed),'current-five-network-identities')
    networks=json.loads(read_command(['docker','network','inspect',*[n['ID']for n in listed]],label+'-networks'));need(type(networks)is list and len(networks)==5 and {n['Id']for n in networks}=={n['ID']for n in listed},'complete-current-five-networks');private(label+'-raw-runtime.private.json',raw);private(label+'-raw-networks.private.json',networks)
    return raw,sorted(networks,key=lambda row:row['Id']),target

def target_status(target):
    state=target['State'];health=state.get('Health',{}).get('Status');exit_code=state.get('ExitCode');need(type(state['Running'])is bool and type(state['OOMKilled'])is bool and health in {None,'healthy','unhealthy','starting'}and type(exit_code)is int and -2147483648<=exit_code<=2147483647,'typed-current-original-runtime-summary')
    return {'sameOriginalContainerID':True,'sameOriginalImage':True,'sameOriginalConfiguration':True,'running':state['Running'],'health':health,'exitCode':exit_code,'oomKilled':state['OOMKilled']}

def bounded_failure_diagnostic(manifest):
    text=selected(B_RECOVERY,manifest,'failure.private.txt').decode('utf-8','replace');safe=failure_summary(text)
    safe['reviewedStaticStageCandidates']=sorted({label for label in STATIC_LABELS if label and any('need('in line and (repr(label)in line or '"'+label+'"'in line)for line in text.splitlines())})[:24]
    operations=[]
    for name in sorted(manifest):
        match=re.fullmatch('[0-9]{3}-(emergency-start-only-original-printlink|wait_service_ready-printlink)\\.private\\.log',name)
        if not match:continue
        content=selected(B_RECOVERY,manifest,name).decode('utf-8','replace');markers=[]
        for marker,found in [('wait-service-ready-succeeded','[OK] printlink ready'in content),('wait-service-ready-timeout',re.search(r'\[ERROR\] printlink 未在 [0-9]{1,4}s 内就绪；仅该系统保留维护提示',content)is not None),('permission-denied','Permission denied'in content),('command-not-found','command not found'in content),('unbound-variable','unbound variable'in content),('docker-daemon-unavailable','Cannot connect to the Docker daemon'in content)]:
            if found:markers.append(marker)
        operations.append({'operation':match[1],'knownStaticMarkers':markers,'emptyOutput':not bool(content)})
    safe['operationNamesAndStaticMarkers']=operations;safe['completeLogsOrErrorMessagesPrinted']=False;return safe

def loopback_health():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3100/api/health',timeout=3)as response:
            data=response.read(8193);private('loopback-health-body.private',data)
            return {'httpStatus':response.status,'bodyWithinLimit':len(data)<=8192,'usedAsRuleRemovalPrecondition':False}
    except urllib.error.HTTPError as error:return {'httpStatus':error.code,'usedAsRuleRemovalPrecondition':False}
    except BaseException as error:return {'safeExceptionType':type(error).__name__ if type(error).__name__ in {'TimeoutError','URLError','ConnectionRefusedError','RemoteDisconnected','OSError'}else'OtherException','usedAsRuleRemovalPrecondition':False}

def main():
    global EXPECTED_TARGET_ID,EXPECTED_TARGET_CONFIGURATION
    need(PIN is True and sys.argv[1:]==['reopen-original']and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_ATTEMPT')=='1','inert-until-root-bound-single-reopen-attempt');os.umask(0o077);OUT.mkdir(mode=0o700)
    result={'mode':'original-reopen','base':BASE,'target':TARGET,'tree':TREE,'success':False,'removedRuleCount':0,'ownRulesAbsent':False,'noContainerLifecycleCommands':True,'businessWritesPerformed':False,'databaseRestorePerformed':False,'environmentConfigurationChanged':False,'sourceConfigurationChanged':False,'modelCallsPerformed':False,'authenticatedBusinessWritesPerformed':False,'secretOrRowsPrinted':False,'containerStartStopRecreatePerformed':False}
    try:
        # Only immutable metadata and explicitly selected small evidence files
        # are hashed. Business SQLite copies and files.tar are never opened.
        dm,dr=sealed(D,D_MANIFEST,D_RESULT,False);bm,br=sealed(BACKUP,B_MANIFEST,B_RESULT,False);rm,rr=sealed(B_RECOVERY,B_RECOVERY_MANIFEST,B_RECOVERY_RESULT,False)
        need(dr.get('success')is False and dr.get('mode')=='deploy'and dr.get('target')==TARGET and br.get('success')is True and br.get('mode')=='backup'and br.get('target')==BASE and rr.get('success')is False and rr.get('mode')=='publication-recovery-b'and rr.get('target')==TARGET and rr.get('originalContainerStartPerformed')is True and rr.get('candidateContainerStarted')is False and type(rr.get('removedRuleCount'))is int and rr['removedRuleCount']==0,'actual-bound-failed-deploy-and-original-only-start-attempt')
        old=json.loads(selected(BACKUP,bm,'target-inspect.private.json'))['printlink'];need(old['Image']==ORIGINAL_IMAGE,'immutable-original-image-pin');EXPECTED_TARGET_ID=old['Id'];EXPECTED_TARGET_CONFIGURATION=configuration([old])
        reservation=json.loads(selected(D,dm,'ingress-install-reservation.private.json'));need(reservation.get('profileSHA256')=='c0c279e91c9b55a119e3755801964d3f586752999d3df6a260ac4697dd018e0e'and exact(reservation.get('exactRules'),json.loads(enc(expected_rules()))),'exact-this-deployment-six-rule-reservation')
        original={family:parse_save(selected(BACKUP,bm,'ingress-'+name+'.stdout.private'))['rows']for family,name in ((4,'ipv4FilterAndNat'),(6,'ipv6FilterAndNat'))}
        before,net_before,target=snapshot_runtime('before');result['currentOriginalPrintlinkBefore']=target_status(target);observed=snapshot_rules('before');plan=plan_cleanup(reservation['exactRules'],original,observed);private('exact-reopen-rule-plan.private.json',plan);private('reopen-one-attempt-reservation.private.json',{'failedRecoveryManifestSHA256':B_RECOVERY_MANIFEST,'failedRecoveryResultSHA256':B_RECOVERY_RESULT,'exactOnlyOwnObservedRules':plan['commands'],'healthOrOldLifecycleOrUpgradeDataProofUsedAsPrecondition':False})
        for index,args in enumerate(plan['commands']):
            current=snapshot_rules('predelete-%02d'%index);actual=plan_cleanup(reservation['exactRules'],original,current);need(exact(actual['expectedAfterRows'],plan['expectedAfterRows'])and args in actual['commands'],'only-current-exact-own-subset-and-all-foreign-rules-stable');check_delete(args,'reopen-%02d'%index);result['removedRuleCount']+=1
        final=snapshot_rules('after');verify_after(plan,final);result.update(ownRulesAbsent=True,foreignFirewallRowsPreserved=True,onlyExactOwnedPublicationRulesRemoved=True)
        after,net_after,target=snapshot_runtime('after');need(exact(configuration(before),configuration(after)),'current46-full-configuration-env-mounts-preserved');result['current46ConfigurationPreserved']=True;need(exact(net_before,net_after),'current-five-networks-all-peer-endpoints-preserved');result.update(currentNetworkTopologyPreserved=True,originalTargetIdentityImageConfigurationPreserved=True,currentOriginalPrintlinkAfter=target_status(target),success=True)
        # Diagnostic errors never undo or block the proven own-rule reopening.
        try:result['failedRecoveryDiagnostic']=bounded_failure_diagnostic(rm)
        except BaseException as error:result['failedRecoveryDiagnostic']={'available':False,'safeExceptionType':type(error).__name__,'completeLogsOrErrorMessagesPrinted':False}
        result['loopbackHealthAfterReopen']=loopback_health()
    except BaseException as error:
        result.update(safeFailureStage=STAGE,safeExceptionType=type(error).__name__);private('failure.private.txt',traceback.format_exc().encode())
    finally:seal_output(result)
    return 0 if result['success']else 1

if __name__=='__main__':
    try:sys.exit(main())
    except SystemExit:raise
    except BaseException:print(enc({'mode':'original-reopen','success':False,'safeFailure':'ORIGINAL_REOPEN_PREFLIGHT_OR_OUTPUT_FAILURE','currentAccessAndOwnRuleStateRequireReadOnlyVerification':True}).decode(),flush=True);sys.exit(1)
