"""Callable-only, service-scoped image preparation; no import-time work.

Caller pins the Git archive/target and supplies run(argv, data=None, timeout=...).
Only live docker cp/inspect reads are allowed here. Builds and never-started own
scratch containers do not operate a live service. No rollout, data, env or tag-to-
Compose operation is provided. Overlay keys are container paths without leading /.
"""
import hashlib, json, os, pathlib, re, shutil, stat, uuid

APPS = {'qc': 'apps/生产部/品质管理系统', 'rr-production': 'apps/工程部/工程啤办单',
        'gongcheng-ziliao': 'apps/工程部/工程资料管理系统',
        'factory-review': 'apps/PMC跟仓管/加工厂月度评审管理制度',
        'factory-review-test': 'apps/PMC跟仓管/加工厂月度评审管理制度'}
FILES = {'qc': ('qc-backend.js', 'server/server.js'),
         'rr-production': ('public/engineering.html', 'public/slush.html'),
         'gongcheng-ziliao': ('vite-plugin-docs-api.ts', 'src/sections/DocEditor.tsx')}
TOP_SKIP = {'data', '资料库存储', 'pb_data', 'pb_data_test', 'node_modules', 'dist', '.git', 'logs', 'coverage'}

def need(value, label):
    if not value: raise RuntimeError('IMAGE_PREPARE_' + label)

def safe(name):
    p = pathlib.PurePosixPath(name)
    return type(name) is str and bool(name) and str(p) == name and not p.is_absolute() and '..' not in p.parts and '\\' not in name and all(ord(c) >= 32 for c in name)

def root(path):
    p = pathlib.Path(path).absolute()
    need(p.is_dir() and all(not x.is_symlink() for x in (p, *p.parents)), 'regular-root')
    return p

def manifest(folder):
    folder = root(folder); result = {}; total = 0
    for p in sorted(folder.rglob('*')):
        need(not p.is_symlink() and (p.is_dir() or p.is_file()), 'regular-tree')
        rel = p.relative_to(folder).as_posix(); need(safe(rel), 'safe-file-name')
        need(not any(x.startswith('.env') for x in pathlib.PurePosixPath(rel).parts), 'no-environment-files')
        if p.is_file():
            s = p.stat(); total += s.st_size
            need(s.st_size <= 128 * 1024**2 and total <= 512 * 1024**2 and len(result) < 15000, 'bounded-tree')
            data = p.read_bytes(); after = p.stat()
            need((s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode, s.st_uid, s.st_gid) == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_mode, after.st_uid, after.st_gid) and len(data) == s.st_size, 'stable-file')
            result[rel] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}
    return result

def directory_manifest(folder, logical):
    """Only directories actually copied, including each logical directory root."""
    folder = root(folder); result = {}
    for item in logical:
        need(type(item['directory']) is bool and safe(item['path']), 'typed-logical-root')
        if not item['directory']: continue
        directory = root(folder / item['path'])
        for p in [directory, *sorted(directory.rglob('*'))]:
            need(not p.is_symlink() and (p.is_dir() or p.is_file()), 'regular-logical-directory-tree')
            if p.is_dir():
                s = p.stat(); result[p.relative_to(folder).as_posix()] = {'uid': s.st_uid, 'gid': s.st_gid, 'mode': stat.S_IMODE(s.st_mode)}
    return result

def copy_file(source, destination):
    need(source.is_file() and not source.is_symlink() and all(not p.is_symlink() for p in source.parents), 'regular-source-file')
    destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    need(not destination.exists() and not destination.is_symlink(), 'new-copy-destination')
    shutil.copy2(source, destination)

def source_context(app, destination):
    destination.mkdir(mode=0o700)
    for p in sorted(app.rglob('*')):
        rel = p.relative_to(app); parts = rel.parts
        if parts[0] in TOP_SKIP or any(x.startswith('.env') or x in ('node_modules', '.git') for x in parts): continue
        need(safe(rel.as_posix()) and not p.is_symlink(), 'regular-public-source-context')
        if p.is_dir(): (destination / rel).mkdir(mode=0o755, parents=True, exist_ok=True)
        else: copy_file(p, destination / rel)
    need((destination / 'Dockerfile').is_file(), 'source-dockerfile')
    return manifest(destination)

def inspect_image(image, run):
    rows = json.loads(run(['docker', 'image', 'inspect', image]))
    need(len(rows) == 1 and re.fullmatch('sha256:[a-f0-9]{64}', rows[0]['Id']), 'immutable-image')
    return rows[0]

def scratch(image, service, target, run):
    token = uuid.uuid4().hex
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none',
               '--label', 'io.rr-portal.batch1003-scratch=' + token, '--label', 'io.rr-portal.build-service=' + service,
               '--label', 'io.rr-portal.build-target=' + target, '--entrypoint', '/bin/true', image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}', cid), 'own-scratch-id')
    return cid, token

def remove_scratch(cid, token, image, service, target, run):
    rows = json.loads(run(['docker', 'inspect', cid])); need(len(rows) == 1, 'one-scratch')
    r = rows[0]; labels = r['Config'].get('Labels') or {}; h = r['HostConfig']; s = r['State']
    need(r['Id'] == cid and r['Image'] == image and not s['Running'] and s['Pid'] == 0 and s['StartedAt'].startswith('0001-')
         and not r['Mounts'] and not h.get('Binds') and h['NetworkMode'] == 'none' and h['RestartPolicy']['Name'] == 'no'
         and h['LogConfig']['Type'] == 'none' and labels.get('io.rr-portal.batch1003-scratch') == token
         and labels.get('io.rr-portal.build-service') == service and labels.get('io.rr-portal.build-target') == target,
         'only-own-never-started-scratch-removal')
    run(['docker', 'rm', cid])

def capture(cid, remote, local, directory, run, scratch_token=None):
    need(safe(remote) and (remote.startswith(('app/', 'pb/')) or remote == 'build/dist' and scratch_token), 'fixed-container-code-path')
    if remote == 'build/dist':
        r = json.loads(run(['docker', 'inspect', cid])); need(len(r) == 1, 'one-build-scratch'); r = r[0]
        need(r['Id'] == cid and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-')
             and not r['Mounts'] and r['HostConfig']['NetworkMode'] == 'none'
             and (r['Config'].get('Labels') or {}).get('io.rr-portal.batch1003-scratch') == scratch_token, 'own-frontend-scratch-dist-only')
    local.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    if directory:
        need(not local.exists() and not local.is_symlink(), 'new-capture-destination')
        run(['docker', 'cp', '-a', cid + ':/' + remote, str(local)])
        manifest(local)
    else:
        run(['docker', 'cp', '-a', cid + ':/' + remote, str(local)])
        need(local.is_file() and not local.is_symlink(), 'captured-regular-file')

def inherit_metadata(old, new, static):
    """These five immutable bases have root-owned code. Unexpected owners abort."""
    before = manifest(old)
    need(all(v['uid'] == v['gid'] == 0 for v in before.values()), 'expected-root-owned-code-and-assets')
    for p in sorted(new.rglob('*')):
        rel = p.relative_to(new); prior = old / rel
        if not prior.exists() and p.is_file():
            need(static and rel.as_posix().startswith(static + '/assets/'), 'new-files-only-hashed-static-assets')
            candidates = [q for q in (old / static / 'assets').rglob('*') if q.is_file() and q.suffix == p.suffix]
            prior = sorted(candidates)[0] if candidates else old / static / 'index.html'
        if prior.exists():
            s = prior.stat(); need(s.st_uid == s.st_gid == 0, 'expected-root-code-metadata')
            os.chmod(p, stat.S_IMODE(s.st_mode))
        need(p.stat().st_uid == p.stat().st_gid == 0, 'root-overlay-owner-before-build')

def qc_ai_guard(old_cid, old_image, service, target, work, run):
    """Private transient hash comparison; neither config copy enters an overlay."""
    folder = work / 'private-ai-check'; folder.mkdir(mode=0o700)
    cid, token = scratch(old_image, service, target, run)
    try:
        capture(old_cid, 'app/server/ai-config.json', folder / 'live.json', False, run)
        capture(cid, 'app/server/ai-config.json', folder / 'image.json', False, run)
        values = [hashlib.sha256((folder / n).read_bytes()).hexdigest() for n in ('live.json', 'image.json')]
        need(values[0] == values[1], 'live-ai-config-differs-from-immutable-image')
        return {'sameAsOldImage': True, 'sha256': values[0], 'bytesReturnedOrInImageContext': False}
    finally:
        for n in ('live.json', 'image.json'):
            p = folder / n
            if p.is_file() and not p.is_symlink(): p.unlink()
        remove_scratch(cid, token, old_image, service, target, run)

def union_static(old, fresh, destination):
    before, new = manifest(old), manifest(fresh)
    need('index.html' in before and 'index.html' in new, 'static-entry-present')
    need(all(not n.startswith('assets/') or n not in before or v['sha256'] == before[n]['sha256'] for n, v in new.items()), 'no-existing-asset-collision')
    shutil.copytree(old, destination); shutil.copytree(fresh, destination, dirs_exist_ok=True)
    merged = manifest(destination)
    need(all(n in merged for n in before) and all(merged[n]['sha256'] == v['sha256'] for n, v in new.items()), 'complete-static-union')
    return {'old': before, 'fresh': new, 'union': merged}

def logical_roots(service):
    need(service in APPS, 'known-logical-service')
    values = [{'path': 'app/' + n, 'directory': False} for n in FILES.get(service, ())]
    if service == 'gongcheng-ziliao': values.append({'path': 'app/dist', 'directory': True})
    if service.startswith('factory-review'): values += [{'path': 'pb/pb_public', 'directory': True}, {'path': 'pb/pb_hooks', 'directory': True}]
    return values

def derivative_dockerfile(alias, service, target, old_image):
    need(alias == 'rrportal-batch1003-' + service + '-base:' + old_image.split(':')[1], 'fixed-base-alias-name')
    revision = {'org.opencontainers.image.revision': target, 'io.rr-portal.backend-image': old_image, 'io.rr-portal.release-service': service}
    text = 'FROM ' + alias + '\n'
    for item in logical_roots(service):
        suffix = '/' if item['directory'] else ''
        text += 'COPY ' + json.dumps(['overlay/' + item['path'] + suffix, '/' + item['path'] + suffix]) + '\n'
    return text + 'LABEL ' + ' '.join(k + '=' + json.dumps(v) for k, v in revision.items()) + '\n', revision

def prepare_service(service, old_image, old_cid, source_root, workspace, target, run):
    """Return isolated old/new overlay roots, manifests and a verified durable image.

    source_root is the complete immutable Git archive, not the live checkout.
    workspace must be a private existing parent; workspace/service is one-shot.
    The caller owns source pinning, live lifecycle/data guards and all rollout.
    """
    need(service in APPS and re.fullmatch('sha256:[a-f0-9]{64}', old_image) and re.fullmatch('[a-f0-9]{64}', old_cid)
         and re.fullmatch('[a-f0-9]{40}', target), 'fixed-service-image-container-target')
    source = root(source_root); app = root(source / APPS[service]); parent = root(workspace)
    need(not (source / '.git').exists() and os.geteuid() == 0, 'immutable-archive-and-root-metadata-preparation')
    work = parent / service; need(not work.exists() and not work.is_symlink(), 'one-shot-service-workspace'); work.mkdir(mode=0o700)
    old = work / 'old-overlay'; new = work / 'new-overlay'; old.mkdir(mode=0o700); new.mkdir(mode=0o700)
    live = json.loads(run(['docker', 'inspect', old_cid])); need(len(live) == 1, 'one-live-container')
    labels = live[0]['Config'].get('Labels') or {}
    need(live[0]['Id'] == old_cid and live[0]['Image'] == old_image and labels.get('com.docker.compose.project') == 'rr-portal'
         and labels.get('com.docker.compose.service') == service, 'exact-existing-live-service')
    direct = FILES.get(service, ())
    for name in direct: capture(old_cid, 'app/' + name, old / 'app' / name, False, run)
    static = 'app/dist' if service == 'gongcheng-ziliao' else 'pb/pb_public' if service.startswith('factory-review') else None
    if static: capture(old_cid, static, old / static, True, run)
    hooks = service.startswith('factory-review')
    if hooks: capture(old_cid, 'pb/pb_hooks', old / 'pb/pb_hooks', True, run)
    old_directories = directory_manifest(old, logical_roots(service))
    ai_proof = qc_ai_guard(old_cid, old_image, service, target, work, run) if service == 'qc' else None
    source_manifest = {}; static_manifest = None
    if static:
        context = work / 'source-context'; source_manifest = source_context(app, context)
        build_tag = 'rrportal-batch1003-' + service + '-frontend:' + target
        args = ['docker', 'build', '--pull=false', '-t', build_tag]
        if hooks: args += ['--target', 'frontend-build', '--build-arg', 'VITE_BASE_PATH=/' + service + '/']
        run(args + [str(context)], timeout=1500)
        built = inspect_image(build_tag, run)['Id']; cid, token = scratch(built, service, target, run)
        fresh = work / 'fresh-static'
        try: capture(cid, 'app/dist' if not hooks else 'build/dist', fresh, True, run, scratch_token=token if hooks else None)
        finally: remove_scratch(cid, token, built, service, target, run)
        (new / static).parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        static_manifest = union_static(old / static, fresh, new / static)
    for name in direct: copy_file(app / name, new / 'app' / name)
    if hooks:
        hook_source = root(app / 'pb_hooks'); manifest(hook_source)
        need(set(manifest(hook_source)) == set(manifest(old / 'pb/pb_hooks')), 'same-hook-file-set-for-offline-replacement')
        shutil.copytree(hook_source, new / 'pb/pb_hooks')
    inherit_metadata(old, new, static)
    if static_manifest: static_manifest['union'] = manifest(new / static)
    old_manifest, new_manifest = manifest(old), manifest(new)
    new_directories = directory_manifest(new, logical_roots(service)); need(new_directories == old_directories, 'logical-directory-metadata-preserved')
    need(old_manifest and new_manifest and old_manifest != new_manifest, 'nonempty-reviewed-overlay-change')
    # The Docker daemon receives only the public code/static overlay and Dockerfile.
    context = work / 'image-context'; context.mkdir(mode=0o700)
    shutil.copytree(new, context / 'overlay')
    alias = 'rrportal-batch1003-' + service + '-base:' + old_image.split(':')[1]
    tags = run(['docker', 'image', 'ls', '--no-trunc', '--format', '{{.Repository}}:{{.Tag}} {{.ID}}']).decode().splitlines()
    matches = [row.split(' ', 1)[1] for row in tags if row.split(' ', 1)[0] == alias]
    need(matches in ([], [old_image]), 'local-base-alias-not-reassigned')
    if not matches: run(['docker', 'tag', old_image, alias])
    base = inspect_image(alias, run); need(base['Id'] == old_image, 'frozen-local-base-image')
    dockerfile, revision = derivative_dockerfile(alias, service, target, old_image)
    (context / 'Dockerfile').write_text(dockerfile)
    need({n for n in context.iterdir()} == {context / 'Dockerfile', context / 'overlay'} and manifest(context / 'overlay') == new_manifest, 'public-only-derivative-context')
    need(directory_manifest(context / 'overlay', logical_roots(service)) == new_directories, 'context-logical-directory-metadata-exact')
    tag = 'rrportal-batch1003-' + service + ':' + target
    run(['docker', 'build', '--pull=false', '-t', tag, str(context)], timeout=300)
    derived = inspect_image(tag, run); image = derived['Id']
    need(inspect_image(alias, run)['Id'] == old_image and derived['Architecture'] == base['Architecture'] and derived['Os'] == base['Os']
         and derived['RootFS']['Layers'][:len(base['RootFS']['Layers'])] == base['RootFS']['Layers'], 'actual-base-layers-and-platform-retained')
    a, b = dict(base['Config']), dict(derived['Config']); a_labels, b_labels = a.pop('Labels', None) or {}, b.pop('Labels', None) or {}
    a.pop('Image', None); b.pop('Image', None)  # Legacy builder-parent metadata, not a runtime instruction.
    need(a == b and b_labels == dict(a_labels, **revision), 'runtime-config-inherited-only-revision-labels-change')
    cid, token = scratch(image, service, target, run); verified = work / 'verified-overlay'; verified.mkdir(mode=0o700)
    try:
        for name in direct: capture(cid, 'app/' + name, verified / 'app' / name, False, run)
        if static: capture(cid, static, verified / static, True, run)
        if hooks: capture(cid, 'pb/pb_hooks', verified / 'pb/pb_hooks', True, run)
    finally: remove_scratch(cid, token, image, service, target, run)
    need(manifest(verified) == new_manifest, 'durable-image-overlay-files-and-modes-exact')
    need(directory_manifest(verified, logical_roots(service)) == new_directories, 'durable-image-logical-directory-metadata-exact')
    return {'service': service, 'target': target, 'oldImage': old_image, 'image': image, 'imageTag': tag,
            'oldOverlay': str(old), 'newOverlay': str(new), 'oldManifest': old_manifest, 'newManifest': new_manifest, 'logicalRoots': logical_roots(service),
            'oldDirectoryManifest': old_directories, 'newDirectoryManifest': new_directories,
            'staticManifest': static_manifest, 'sourceContextManifest': source_manifest,
            'hooksReplacedCompletely': hooks, 'sameHookFileSet': hooks, 'aiConfigurationProof': ai_proof, 'runtimeConfigurationPreserved': True,
            'liveContainerReadOnly': True, 'dataOrEnvironmentIncluded': False, 'builderMetadataIgnored': ['Config.Image']}
