"""Inert one-shot credential rotation. No SSH configuration changes or login attempts.

The only password-changing command is one chpasswd invocation with a RAM-only stdin.
An RSA-OAEP encrypted candidate is durably saved and emitted before that invocation.
"""
import hashlib
import json
import os
import pathlib
import pwd
import re
import secrets
import shutil
import stat
import subprocess
import sys

EXECUTE = False
BRANCH = 'refs/heads/codex/ops-ssh-root-reset-20261103'
MODE = 'reset-root'
ROTATION_ID = 'ssh-root-reset-20261103-5833a273c12c93b5'
HOST = '8.148.146.194'
USER = 'root'
PORT = 22
ROOT = pathlib.Path('/opt/rr-portal')
EXPECTED_GIT_HEAD = 'f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
EXPECTED_CONTAINER_COUNT = 46
PUBLIC_KEY_PEM = '-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA1yS1GQhRRTlRgD+3UQR2\nU0+Xqun8puFl1yaTqcdovW83qHkatNhfDWzpRfFdbFnvHk0urgeKdL9nJXj0VzL8\nBxQ1aL7lfma/ys6XllzIxMvbopicUUDkAzE/miKMfVdkvX3mNEwGO1RCWnlYtU7Z\nFSaeYs+rp6NGrFPw9t2WBMg4oG2pX+DuOG5J+Al3eN1nohNJjOVLAmk2yAW0owsy\npj5XLEN2A4d3N7vEg4B6nzkCgfrNVGEgtfY8sHTLa99XoTYoKzVxA4ucC+LC5y0H\n6Zl+S88rV2cSfLrfCU3gpz5sedOeBQ6akBZteWItP26Dq6vWohQACKV/Qhg94/Dd\nedyrNCdEeFhXatAlP/43ZVtnwkiFekvoVPOoQqrdu8FGZ3uNmJLQzivmEzng3xzy\nRFHW38/VHbmslZF0uEb6AgTGJi7NiKoMtlV6rdrOMDs2x6TvPgFJOeaXlWsPlghR\naiIjhCQrQZjK0Xg7IERZtGd5VEGWtMIbGKdnqs5Z3ZQxKt6Vu77pfLZCZVdx7UrI\nLhbUw5s4gVNq2cnpkgzwZKx60eTUk1KzEySQhLGNyrcXfhRZLo5uXGaSfM4Puc72\nK52tFbEMbasiDmSs/a1H5BQ+RODaoQX8+YI1nUGNe525TiDwWpXVCzDbn8mGQ2xW\n90YKGwG7/cfUSUuczAvhujsCAwEAAQ==\n-----END PUBLIC KEY-----\n'
PUBLIC_KEY_SHA256 = '006af6cbaf3c1166fc7e8d4e06fe86475db5ebf8a384c39fefc1982151ac2b8f'
HOST_PUBLIC_KEYS = tuple(pathlib.Path('/etc/ssh') / name for name in (
    'ssh_host_ed25519_key.pub', 'ssh_host_ecdsa_key.pub', 'ssh_host_rsa_key.pub'))
AUTHORIZED_PATHS = frozenset((
    '/root/.ssh/authorized_keys', '/root/.ssh/authorized_keys2',
    '/etc/ssh/authorized_keys', '/etc/ssh/authorized_keys2', '/etc/ssh/authorized_keys/root'))
DOCKER_FORMAT = '{"id":{{json .Id}},"pid":{{json .State.Pid}},"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}},"running":{{json .State.Running}}}'
STAGE = 'entry'
ATTEMPTED = False
AUDIT = None


def need(value, stage):
    global STAGE
    STAGE = stage
    if not value:
        raise RuntimeError('guard-failed')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def command(args, data=None, pass_fds=()):
    # Never include command arguments, stdin or stderr in exceptions or logs.
    result = subprocess.run(args, input=data, capture_output=True, timeout=10, pass_fds=pass_fds)
    need(result.returncode == 0 and len(result.stdout) <= 4 * 1024 ** 2 and len(result.stderr) <= 65536,
         'bounded-command-success')
    return result.stdout


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_file(name, body):
    need(AUDIT is not None and re.fullmatch(r'(?:candidate\.rsa-oaep|[0-9]{2}-[a-z-]+\.status\.json)', name),
         'fixed-private-audit-name')
    fd = os.open(AUDIT / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb', closefd=False) as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(fd)
    fsync_directory(AUDIT)


def new_audit_directory():
    global AUDIT
    need(re.fullmatch(r'ssh-root-reset-20261103-[a-f0-9]{16}', ROTATION_ID), 'fixed-rotation-identity')
    parent = ROOT / 'deploy/backups'
    for path in (parent, *parent.parents):
        row = path.lstat()
        need(stat.S_ISDIR(row.st_mode) and not stat.S_ISLNK(row.st_mode)
             and row.st_uid == 0 and not stat.S_IMODE(row.st_mode) & 0o022,
             'root-owned-real-audit-parent')
    path = parent / ROTATION_ID
    # O_EXCL-equivalent mkdir is the replay fence; an existing attempt is never reused.
    path.mkdir(mode=0o700)
    row = path.lstat()
    need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and stat.S_IMODE(row.st_mode) == 0o700,
         'exclusive-private-audit-directory')
    AUDIT = path
    fsync_directory(parent)


def guards():
    need(EXECUTE is True and sys.argv[1:] == [MODE], 'explicit-one-shot-execution')
    need(os.environ.get('RESET_BRANCH') == BRANCH and os.environ.get('RESET_MODE') == MODE
         and os.environ.get('RESET_ATTEMPT') == '1', 'fixed-branch-mode-first-attempt')
    source = os.environ.get('RESET_SOURCE_COMMIT', '')
    expected = os.environ.get('RESET_HELPER_SHA256', '')
    need(re.fullmatch(r'[a-f0-9]{40}', source) and re.fullmatch(r'[a-f0-9]{64}', expected)
         and digest(pathlib.Path(__file__).read_bytes()) == expected, 'workflow-bound-source-bytes')
    need(os.geteuid() == 0 and pwd.getpwnam(USER).pw_uid == 0
         and pwd.getpwnam(USER).pw_dir == '/root', 'actual-zero-uid-account')
    need(command(['git', '-C', str(ROOT), '-c', 'core.hooksPath=/dev/null', 'rev-parse', 'HEAD']).decode().strip()
         == EXPECTED_GIT_HEAD, 'expected-host-checkout')
    expected_fp = os.environ.get('RESET_HOST_FINGERPRINT', '')
    need(re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}=?', expected_fp), 'approved-host-fingerprint')
    fingerprints = []
    for path in HOST_PUBLIC_KEYS:
        if path.is_file() and not path.is_symlink():
            values = command(['ssh-keygen', '-lf', str(path)]).decode().split()
            need(len(values) >= 2, 'typed-public-host-fingerprint')
            fingerprints.append(values[1])
    need(expected_fp in fingerprints, 'actual-host-public-key-matches-approved-fingerprint')
    key = PUBLIC_KEY_PEM.encode()
    need(re.fullmatch(r'[a-f0-9]{64}', PUBLIC_KEY_SHA256) and digest(key) == PUBLIC_KEY_SHA256
         and key.startswith(b'-----BEGIN PUBLIC KEY-----\n') and b'PRIVATE KEY' not in key,
         'pinned-public-delivery-key-only')
    details = command(['openssl', 'pkey', '-pubin', '-text', '-noout'], key)
    need(b'Public-Key: (4096 bit)' in details, 'rsa-4096-delivery-key')


def read_regular_metadata(path):
    try:
        first = path.lstat()
    except FileNotFoundError:
        return {'absent': True}
    need(stat.S_ISREG(first.st_mode) and not stat.S_ISLNK(first.st_mode) and first.st_size <= 4 * 1024 ** 2,
         'regular-bounded-public-authorized-keys')
    for parent in path.parents:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and not stat.S_ISLNK(row.st_mode), 'real-authorized-key-parents')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(fd, 'rb', closefd=False) as handle:
            body = handle.read(4 * 1024 ** 2 + 1)
        after = os.fstat(fd)
        names = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        need(tuple(getattr(first, k) for k in names) == tuple(getattr(after, k) for k in names)
             == tuple(getattr(path.lstat(), k) for k in names) and len(body) == first.st_size,
             'stable-authorized-key-read')
        return {'sha256': digest(body), **{k: getattr(after, k) for k in names}}
    finally:
        os.close(fd)


def docker_signature():
    ids = command(['docker', 'ps', '-aq', '--no-trunc']).decode().split()
    need(len(ids) == len(set(ids)) == EXPECTED_CONTAINER_COUNT
         and all(re.fullmatch(r'[a-f0-9]{64}', value) for value in ids), 'exact-existing-container-set')
    rows = [json.loads(line) for line in command(['docker', 'inspect', '--format', DOCKER_FORMAT, *sorted(ids)]).splitlines()]
    need(len(rows) == len(ids) and {row['id'] for row in rows} == set(ids), 'complete-container-metadata')
    for row in rows:
        need(set(row) == {'id', 'pid', 'started', 'restarts', 'running'}
             and type(row['pid']) is int and row['pid'] >= 0
             and type(row['restarts']) is int and row['restarts'] >= 0
             and type(row['running']) is bool and type(row['started']) is str,
             'typed-minimal-container-metadata')
    return digest(encoded(sorted(rows, key=lambda row: row['id'])))


def password_state():
    values = command(['passwd', '-S', USER]).decode().split()
    need(len(values) >= 2 and values[0] == USER and values[1] in ('P', 'L', 'NP'), 'typed-password-state-only')
    return values[1]


def snapshot():
    daemon = shutil.which('sshd') or '/usr/sbin/sshd'
    raw = command([daemon, '-T'])
    config = {}
    for line in raw.decode().splitlines():
        values = line.split(None, 1)
        if len(values) == 2:
            config[values[0]] = values[1]
    tokens = config.get('authorizedkeysfile', '').split()
    need(tokens and tokens != ['none'], 'configured-public-authorized-key-files')
    paths = set(('/root/.ssh/authorized_keys', '/root/.ssh/authorized_keys2'))
    for token in tokens:
        token = token.replace('%h', '/root').replace('%u', USER).replace('%U', '0')
        need('%' not in token, 'known-authorized-key-path-expansions')
        path = pathlib.PurePosixPath(token)
        if not path.is_absolute():
            path = pathlib.PurePosixPath('/root') / path
        need(str(path) in AUTHORIZED_PATHS, 'fixed-public-authorized-key-path-allowlist')
        paths.add(str(path))
    keys = {name: read_regular_metadata(pathlib.Path(name)) for name in sorted(paths)}
    return {'sshd_sha256': digest(raw), 'authorized_keys_sha256': digest(encoded(keys)),
            'docker_sha256': docker_signature()}


def make_candidate():
    password = secrets.token_urlsafe(36)
    need(type(password) is str and re.fullmatch(r'[A-Za-z0-9_-]{48}', password), 'exact-random-password-format')
    payload = encoded({'rotation_id': ROTATION_ID, 'host': HOST, 'user': USER, 'port': PORT, 'password': password})
    # A public key goes through a separate inherited read-only pipe. No temporary
    # plaintext credential, public-key file or private-key file is created.
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, PUBLIC_KEY_PEM.encode())
    finally:
        os.close(write_fd)
    try:
        cipher = command(['openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', '/dev/fd/' + str(read_fd),
                          '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256',
                          '-pkeyopt', 'rsa_mgf1_md:sha256'], payload, (read_fd,))
    finally:
        os.close(read_fd)
    need(len(cipher) == 512, 'exact-rsa-ciphertext-size')
    return password, cipher


def emit_cipher(cipher):
    need(len(cipher) == 512, 'emit-encrypted-candidate-only')
    print(json.dumps({'kind': 'encrypted-candidate', 'cipher': list(cipher),
                      'sha256': [int(c, 16) for c in digest(cipher)]}, separators=(',', ':')), flush=True)


def change_password_once(password):
    global ATTEMPTED
    need(not ATTEMPTED and re.fullmatch(r'[A-Za-z0-9_-]{48}', password), 'single-password-change-call')
    # The persisted intent precedes the sole mutation, even if its acknowledgement
    # is lost. Neither this helper nor a replay may try this operation again.
    private_file('20-attempted.status.json', encoded({'attempted': True}))
    ATTEMPTED = True
    need(shutil.which('chpasswd') is not None, 'password-tool-present')
    command(['chpasswd'], (USER + ':' + password + '\n').encode())


def main():
    global STAGE
    password = None
    success = False
    error_type = None
    try:
        guards()
        before = snapshot()
        need(password_state() == 'P', 'preserve-existing-enabled-password-account')
        new_audit_directory()
        private_file('00-before.status.json', encoded({'attempted': False, 'before': before}))
        password, cipher = make_candidate()
        private_file('candidate.rsa-oaep', cipher)
        private_file('10-candidate.status.json', encoded({'attempted': False, 'cipher_sha256': digest(cipher),
                     'rotation_id': ROTATION_ID, 'delivery_public_key_sha256': PUBLIC_KEY_SHA256}))
        emit_cipher(cipher)
        STAGE = 'password-change'
        change_password_once(password)
        password = None
        need(password_state() == 'P', 'new-password-present')
        need(snapshot() == before, 'sshd-authorized-keys-and-all-container-metadata-unchanged')
        private_file('30-success.status.json', encoded({'success': True, 'attempted': True, 'unchanged': before}))
        success = True
        STAGE = 'complete'
    except Exception as error:
        error_type = type(error).__name__
        failed_stage = STAGE
        if AUDIT is not None:
            try:
                private_file('99-failure.status.json', encoded({'success': False, 'attempted': ATTEMPTED,
                             'stage': STAGE, 'errorType': error_type}))
            except Exception:
                pass
        STAGE = failed_stage
    finally:
        password = None
    # Only sanitized status is logged; candidate plaintext and password hashes
    # never enter an exception, argument vector, output or retained audit file.
    print(json.dumps({'kind': 'rotation-status', 'success': success, 'attempted': ATTEMPTED,
                      'stage': STAGE, 'errorType': error_type}, separators=(',', ':')), flush=True)
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
