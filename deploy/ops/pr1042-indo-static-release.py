"""INERT PR1042 Indo-only static publication. No app start, SQL, env read or host checkout.
Root must replace every blank reviewed/fresh-profile pin, review and activate one phase.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT=ROOT/'deploy/backups/pr1042-indo-static-r4-20261030'
OUT=None
PREPARE_OUT=ARCHIVE_ROOT/'prepare'
BASE='49c0f09167f4eedcc766d828ced36d29f94544be'
BACKEND_REVISION='70590f6d0dc1c691cfcc7c6b85c67e4a3574e571'
PREVIOUS_FRONTEND='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
SOURCE_APP_TREE='6a52ba4b36d30895b8cbfd43c51ac5a8fad349cf'
HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
HEAD='1e024e50754b7b417207b6e0dcd8ed02d360b45f'
APP_TREE='fc63cee79ae886eb53ae44cc8986ea29ccd56aa1'
TARGET='1e4366f2803bd5ea19b07b787a12a7d7b66c5ff4'
TREE='c156f971326fde53daae0543bb64d8447100aef5'
REVIEWED_PATHS=('web/src/components/ShipmentNumberCell.tsx', 'web/src/components/ShipmentSheetDraft.tsx', 'web/src/components/ShipmentSheetTable.tsx', 'web/src/components/ShipmentTextCell.tsx', 'web/src/pages/ShipmentsPage.css', 'web/src/pages/ShipmentsPage.tsx', 'web/src/utils/shipmentConsolidationSave.test.ts', 'web/src/utils/shipmentDeclaration.test.ts', 'web/src/utils/shipmentEditorLoading.test.ts', 'web/src/utils/shipmentImportedHs.test.ts', 'web/src/utils/shipmentNumberDraft.test.ts', 'web/src/utils/shipmentSheet.ts', 'web/src/utils/shipmentSheetBatch.test.ts', 'web/src/utils/shipmentSheetFlow.test.ts', 'web/src/utils/shipmentSheetNavigation.test.ts', 'web/src/utils/shipmentSheetSafety.test.ts', 'web/src/utils/shipmentSheetSelection.test.ts', 'web/src/utils/shipmentSheetViewport.test.ts', 'web/src/utils/shipmentTextCell.test.ts', 'web/tests/fixtures/shipments/README.md', 'web/tests/fixtures/shipments/performance.html', 'web/tests/fixtures/shipments/performance.tsx', 'web/tests/fixtures/shipments/vite.config.ts')
EXPECTED_NEW_MANIFEST={'assets/CustomersPage-BN7pBTrr.js': 'dea88e97b98388befc5aaf342d2304c21e3dff22319823035e82305020bce4d3', 'assets/DbAdminPage-CREdE5ol.js': 'ce4144bed6e8772639faccc4a4ab2e5838209891c6a3077b86d8370760c2123e', 'assets/DictionariesPage-OLDoZN_x.js': '68488f6582b6a1fad0cd24d6b5f517d74c352fb70b0657bd8b1d08ae80db6e2e', 'assets/EditOutlined-2eeznxXp.js': '3368b0ce5ea04d43448e7478d4aff9ca632bbaae2f7ce940677611a7f427a7a9', 'assets/LoginPage-BdTw01jq.js': 'a31e131b8460865aa657820fe542ba23be1a54ccffa5ea0a688f27cdd30d944f', 'assets/MaterialAlertsPage-CInTs3dj.js': '55c4736a9972b3fa4a78b72dd6732016880ac8a50385177cad1eee5e19ecafff', 'assets/MoldingPosPage-D2TNM_Px.js': 'b0c1d690c2736d2571a4adbec66a047c573e84a1b9ad7911bfdb2af4c9ded47a', 'assets/OutboundPage-BQsxaIWx.css': 'b4f7372b122d76eebee9521327f40ab96530c2315df0b63ab49a74310fce55a5', 'assets/OutboundPage-BnzMnLNk.js': 'e0f19abfed2dfd6e5371e0cc4389268ad5b6dfe1e7cecada0cdea56ca945ae2b', 'assets/PlusOutlined-CDxW2rzJ.js': '591db41d5e0bc0a1f2a9bf3e1fcea1b7d34a74517101409274ce74e2e95c979d', 'assets/ProductsPage-CBgQaSW8.js': 'af03c64c3a6f6c36b585e96f5657c8e1cde86fefc0ceb37bd661e427e8460909', 'assets/PurchasePage-B8YonOf3.css': 'd2ea560788ecb0057235649740060f8e6fbb0495b65017913d39193397cd3da3', 'assets/PurchasePage-Gjwy_thd.js': '73f1c5a5d0200fec5b48a5c9b8d0d97209682e8462520887ecbc3b1cac3fbb31', 'assets/QuotesPage-DDVRdRl_.css': 'd9351cb3c2d4e8e5a76d947bf0e9731bac2260fb7b9abe8733daf9b3df4bbcbd', 'assets/QuotesPage-Hq-c9fT7.js': 'f7a5f5fce2668a8ac7d8ed17b059ae4031c23e5fb3a56a39aa7d8124cb2e966e', 'assets/ReloadOutlined-yudkG6wu.js': '7a1921795b99742592e02f0a9c9a9b01e8fb1d13cec0a44ae9d954f2ac588480', 'assets/SchedulesPage-CzlLBU4O.js': '4ba511dd07c7106f00dcdeab3519edf21c64bc6dd8e915545d4ec50a235375e8', 'assets/ShipmentsPage-COssvjuP.css': 'f0913b15ddcbe7cba9c5265c636c4ad69d64ad59f22c002c8076dc29059a127b', 'assets/ShipmentsPage-CezIJ1TU.js': 'a10ed5093f329917ba246500b5a54d8b9e1c536c2ce448bb92aab51d05d1f41c', 'assets/SupplierProfileEditor-BjrYrQ3w.js': 'bba4ad89344401f7df3f3c58a164915861a584bf2966e58e8575c7245836c921', 'assets/SupplierSummaryPage-D0NSi996.js': 'be53832d7b7105dc3ce50dc657d2c80ada402111189a9c3b1fc2ac527c9f2918', 'assets/ToolMaterialsPage-BntV5hf0.js': 'f09ed2988cbca15f5c4a1190401e00f97b9ba32f53040e66074394899b8c87aa', 'assets/UsersPage-CFc2JO89.js': '3546b535c4c57fba5f5f9cc7ce2a6c9532706bd5794584ff99a3f26be3d72f0e', 'assets/auto-complete-OBX4jwDS.js': '7d27d675eaf3c63d4cb8a0f9a76075b921db35508c6a269f2f5abcc1d77939d3', 'assets/chunk-BVpWp9h4.js': 'd68000f91e617e39707775fbbf502ae057f963da84e1d06dd6129df60614fb8a', 'assets/client-S6mPGKVM.js': '0619bdac1ca199b0cd07d9d54bd7a4c7e2320ac4fd6e6db5fe8a413b8c02838a', 'assets/customsExport-DJjBq2M6.js': '849c8d61708d87b70d20e403b9fc3071928a784ba145b992eef49b6a71aebb6f', 'assets/date-picker-Bq1mna8E.js': 'a8f2086d292d78cba5daaba4571770caab210a8ae0c78253743cb2d59930f4df', 'assets/engineeringImport-Dj8BJ1cN.js': 'f30eb473aaf933cab43edb879d6c42294af44510745f14d382034d1ef2cd2213', 'assets/form-C6YLCBd5.js': '8af44033bf68a01927bf7a01670f6432cec5b13d8e89fe2d1654b80df23d0ff4', 'assets/grid-DbqjXEjg.js': 'f1eb606c5c3972503e62881b36430cc7cb3d9201646945d28df9c9a78037227a', 'assets/imageUpload-DgJ9GzqX.js': '2ae7e23008960198e74d812c83429f8845cc5a7fe0e509b9cf5248c9244f35fb', 'assets/index-BCX1IYMT.js': 'd07ff41d428de9a6fc0db4248dad0da1232eb3aaa416f97900bcb93033459030', 'assets/index-Tu04tXLf.css': '52155b5185a7b6e40e4220a5ca913de309663c04263c268cdb46d630b2114f06', 'assets/input-CXl0CrxM.js': '25e158d41520991da9483332d71a6d82274b492b067cb61ae6e8b1db4ddc4e49', 'assets/input-number-CC_vC4xv.js': 'dd27ed0a354695df30ee6c95c3424f57cb580eccfb0e4a58c054478e93a57756', 'assets/jsx-runtime-CPIq3nuo.js': 'd2ea580ed7e6f97b65ce1f80560677bfcbab839e64ddeed93044accd603de09a', 'assets/modal-CAjY54Rv.js': '28f8e0b69d5754ccde2dd18b5dedd560c377301ad4033c5e36bbadaa6018d1c4', 'assets/moldingPoExport-DskrH8Av.js': '94274fed5b9e9e6d8fe02791d57b282eb4f5939b44221055c93261901164bdc5', 'assets/pagination-LhGL_5kc.js': '2282ab0540887d8564f54ab3dc0ebbb2a071fa58a9fa22037b8e0ef4dd6a68e9', 'assets/popconfirm-O0qH1ulH.js': '1fe49f5bc7d0a71b7961a9dc3a5245fe5fa682e94c245be01efa3a5d7b1d3e8d', 'assets/progress-CJwc4b9M.js': '8d31d7000dc848498c19bfaff18d76702f007d327b1b8f789f61dc687dd66bd1', 'assets/row-qsQo5oQn.js': '41aa614b605c7b845e497c67af3efe9fbc67418bcd4d7c6de07e695910f71608', 'assets/scheduleImport-D1nq1GIV.js': 'b387f3b8ed16102b34ebb907197ecb0ebbe267974eb0cbca201b8a50bad55932', 'assets/scheduleLineStatus-DhsZTTpa.js': '9d27284a276d471be9a420d812a7f689bbaad3765a206c6c27dceeb594da42ad', 'assets/shipmentDates-BAx2CWJF.js': '559dfd5a49cdcc52f408c94a01fbe2de5ef9707d7daa89a75d72ba9e28ec8a8f', 'assets/spin-N1N-gDTY.js': '59c0d5f6333af35f664aa80a2c951afad3984b62bc70dd6a5d035782ad49a310', 'assets/supplierProfiles-DdACjIXN.js': '52db3c57474848d19f0cbc130afb9628d268ce6903a35050d192041268f78870', 'assets/switch-cHCC8vmb.js': '5cce03714ee315742df2528ff937536851f8738e464718d27f6ff50de5cb1e2a', 'assets/table-CNC9cMNQ.js': '767a79facebc965741e45cb1681fdf6f90a1f2ecdf8efbe96d83a0a2df406cb0', 'assets/toolImportDefaults-Bzh2z1__.js': 'c833c002a332aa28f3417a21c64ae3981b5f432c59a2bcf346e5211aa247de2e', 'assets/useForm-Bk0qN2Jh.js': '2f3fb45e485cbad0abb2b386f35134e59744d63fc7f7153abf809283ac2dfc56', 'assets/xlsx-CGtpuIau.js': '768312094736c47185e84a085235cff804c378eba126a425fa5153e221e78e5d', 'assets/xlsx.min-DqAMbf-a.js': 'e2c2a477cfde2c9a1301515a0e1b73b28f2f70ddeaf262042e24ef4292d1f275', 'favicon.svg': '61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', 'icons.svg': 'b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a', 'index.html': '75dd8ce97c69dd87a9db42b39a021519dc82e3ea06197242373cccfa3f913e59', 'template-customs-rri.xlsx': 'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647', 'template-customs-rrm.xlsx': '21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984', 'template-customs.xlsx': '24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'}
EXPECTED_PROFILE_SHA256='1261bbfceb5788baed9a2f0ed070da966dbdedd7e9f061899abf72699c214999'
EXPECTED_PROFILE_INNER_SHA256='835bc783665c8e92528f7216050e5613ee657f61a98ff13ffeae11b0af956074'
EXPECTED_STATIC_INVENTORY_SHA256='422b75a907b52135f956bd617597a5605264efbc7ae6aee37d12237903c3df80'
EXPECTED_DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
EXECUTE=True
PHASE='prepare'
PREPARED_SHA256=''
DEPLOY_SHA256=''
BRANCH='refs/heads/codex/ops-pr-1042-20261030-indo'
APP='apps/印尼小组/印尼走货明细'
SERVICE='indo-shipping'
LIVE_IMAGE='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
STATIC_BASE_IMAGE='sha256:f09427d7b4ac75245a4bf823b964e04b8c524edf98eb9287d2ad57f2a76f4bd1'
EXPECTED_LIVE_CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
COMPOSE_TAG='rr-portal-indo-shipping:latest'
OLD=PREVIOUS_FRONTEND
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')
TEMPLATE_PROOFS={'template-customs.xlsx':(144045,'24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'),'template-customs-rri.xlsx':(43375953,'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647'),'template-customs-rrm.xlsx':(835559,'21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984')}
PUBLIC='http://127.0.0.1/indo-shipping/'
COMMON_NAME='pr1042-indo-preflight.py'
COMMON_SHA256='98700f59026d2e071fb7cc5d2487a41ded06ab95d311bccec3690cf7b44f25a4'
PDB_NAME='portable-pdb-library.py'
PDB_SHA256='cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'
P=None
PDB=None
SERIAL=0
STAGE='entry'
RECOVERY={}

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(v):return hashlib.sha256(v).hexdigest()

def private(p,v):
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(v if type(v)is bytes else enc(v));f.flush();os.fsync(f.fileno())

def run(args,data=None,timeout=180):
 global SERIAL,STAGE
 SERIAL+=1;STAGE='command-'+pathlib.Path(args[0]).name
 need(OUT is not None,'private-command-archive-required-before-execution')
 base=OUT/('%03d'%SERIAL)
 private(base.with_suffix('.command.private.json'),{'program':pathlib.Path(args[0]).name,'timeout':timeout})
 # Direct child output is retained even when subprocess.run times out or fails.
 # No argv or environment is written to command metadata or public receipts.
 with contextlib.ExitStack()as stack:
  stdout=stack.enter_context(os.fdopen(os.open(base.with_suffix('.stdout.private'),os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW,0o600),'w+b'))
  stderr=stack.enter_context(os.fdopen(os.open(base.with_suffix('.stderr.private'),os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW,0o600),'w+b'))
  try:p=subprocess.run(args,input=data,stdout=stdout,stderr=stderr,cwd=ROOT,timeout=timeout)
  finally:
   for stream in(stdout,stderr):stream.flush();os.fsync(stream.fileno())
  need(p.returncode==0,'command-'+pathlib.Path(args[0]).name)
  stdout.seek(0);return stdout.read()

def metadata(path):
    need(not path.is_symlink() and (path.is_file() or path.is_dir()), 'regular-metadata')
    st = path.stat()
    return {'uid': st.st_uid, 'gid': st.st_gid, 'mode': stat.S_IMODE(st.st_mode)}

def safe_relative(name):
    p = pathlib.PurePosixPath(name)
    return type(name) is str and bool(name) and str(p) == name and not p.is_absolute() and '..' not in p.parts and '\\' not in name and all(ord(c) >= 32 for c in name)

def image_id(name, optional=False):
    p = subprocess.run(['docker', 'image', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, cwd=ROOT)
    if optional and p.returncode != 0:
        need(b'No such image:' in p.stderr or b'No such object:' in p.stderr, 'only-known-absent-local-image')
        return None
    need(p.returncode == 0, 'local-image-inspect'); rows = json.loads(p.stdout)
    need(len(rows) == 1 and re.fullmatch('sha256:[a-f0-9]{64}', rows[0]['Id']), 'one-immutable-local-image')
    return rows[0]['Id']

def scratch_create(image):
    config = json.loads(run(['docker', 'image', 'inspect', image]))[0]; need(config['Id'] == image and not config['Config'].get('Volumes'), 'scratch-image-without-volumes')
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--label', 'io.rr-portal.pr1042-scratch='+PHASE, '--entrypoint', '/bin/true', image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}', cid), 'own-full-scratch-id')
    return cid

def scratch_remove(cid, image):
    r = json.loads(run(['docker', 'inspect', cid]))[0]
    need(r['Id'] == cid and r['Image'] == image and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and (r['Config'].get('Labels') or {}).get('io.rr-portal.pr1042-scratch')==PHASE and r['HostConfig']['NetworkMode'] == 'none', 'remove-only-own-never-started-scratch')
    run(['docker', 'rm', cid])

def index_metadata(cid):
    value = run(['docker', 'exec', '--user', '0', cid, 'stat', '-c', '%f|%u|%g|%a|%Y|%s', '/app/wwwroot/index.html']).decode().strip()
    need(re.fullmatch('[a-f0-9]+[|][0-9]+[|][0-9]+[|][0-7]+[|][0-9]+[|][0-9]+', value), 'typed-index-metadata')
    kind, uid, gid, mode, mtime, size = value.split('|')
    need(stat.S_ISREG(int(kind, 16)) and int(mode, 8) == 0o644, 'regular-readable-index')
    return {'uid': int(uid), 'gid': int(gid), 'mode': int(mode, 8), 'mtime': int(mtime), 'size': int(size)}

def static_plan(old, new):
    need(new.get('index.html') != old.get('index.html'), 'new-frontend-entry')
    need(all(name in old and name in new and old[name] == new[name] for name in TEMPLATES), 'all-three-original-templates-unchanged')
    need(all(n == 'index.html' or (n in old and h == old[n]) or (n not in old and n.startswith('assets/')) for n, h in new.items()), 'only-new-assets-and-index-no-existing-resource-overwrite')
    additions = sorted(n for n in new if n != 'index.html' and n not in old)
    need(all(str(pathlib.PurePosixPath(n).parent) == 'assets' for n in additions), 'flat-vite-asset-layout-before-any-live-write')
    return additions

def remote_index(cid):
    blob = run(['docker', 'exec', '--user', '0', cid, 'cat', '/app/wwwroot/index.html'])
    need(len(blob) <= 1024**2, 'bounded-observed-index'); return sha(blob)

def files(folder):
    result = {}; total = 0
    for p in sorted(folder.rglob('*')):
        need(not p.is_symlink() and (p.is_dir() or p.is_file()), 'regular-static-files-only')
        if p.is_file():
            name = p.relative_to(folder).as_posix(); size = p.stat().st_size; total += size
            need(safe_relative(name) and size <= 64 * 1024**2 and total <= 256 * 1024**2, 'bounded-safe-static-files')
            result[name] = sha(p.read_bytes())
    need('index.html' in result and len(result) < 1000, 'bounded-static-manifest')
    return result

def copy_web(cid, name):
    dest = OUT / name; dest.mkdir(mode=0o700)
    run(['docker', 'cp', cid + ':/app/wwwroot/.', str(dest)])
    files(dest)
    return dest

def preserve_templates(old, prepared, old_manifest):
    # Dockerignore excludes the two factory templates. Restore only absent files
    # after all three OLD/BASE/TARGET immutable Git blobs and live backups agree.
    proofs = {}; missing = []
    for name in TEMPLATES:
        expected_size, expected_sha = TEMPLATE_PROOFS[name]; source = APP + '/web/public/' + name
        blobs, sizes = [], []
        for ref in (OLD, BASE, TARGET):
            entry = git('ls-tree', '-z', ref, '--', source)
            match = re.fullmatch(b'100644 blob ([a-f0-9]{40})\t' + re.escape(source.encode()) + b'\0', entry)
            need(match is not None, 'regular-reviewed-template-git-blob'); blobs.append(match[1].decode())
            size = git('cat-file', '-s', ref + ':' + source).decode().strip()
            need(size.isdigit(), 'typed-template-blob-size'); sizes.append(int(size))
        need(len(set(blobs)) == 1 and sizes == [expected_size] * 3, 'old-base-target-template-blob-and-size-identical')
        body = git('show', OLD + ':' + source)
        need(len(body) == expected_size and sha(body) == expected_sha
             and hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == blobs[0], 'template-git-size-sha256-and-blob-id-exact')
        backup = old / name
        need(backup.is_file() and not backup.is_symlink() and backup.stat().st_size == expected_size
             and sha(backup.read_bytes()) == old_manifest.get(name) == expected_sha, 'live-old-template-equals-three-pinned-git-sources')
        dest = prepared / name
        need(not dest.is_symlink(), 'prepared-template-not-symlink')
        if dest.exists():
            need(dest.is_file() and dest.stat().st_size == expected_size and sha(dest.read_bytes()) == expected_sha, 'fresh-dist-template-cannot-conflict')
        else: missing.append(name)
        proofs[name] = {'blob': blobs[0], 'size': expected_size, 'sha256': expected_sha, 'restoredMissingDistFile': not dest.exists()}
    # All proofs precede any copy; never replace a Vite output or an existing asset.
    for name in missing:
        dest = prepared / name; os.link(old / name,dest,follow_symlinks=False)
        need(sha(dest.read_bytes()) == TEMPLATE_PROOFS[name][1], 'restored-template-copy-exact')
    return proofs

def http(path='', headers=None):
    need(not path.startswith('/') and '..' not in pathlib.PurePosixPath(path).parts and '?' not in path and '#' not in path, 'fixed-relative-public-route')
    req = urllib.request.Request(PUBLIC + urllib.parse.quote(path, safe='/'), headers={'Cache-Control': 'no-cache', **(headers or {})})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=20) as r:
            body = r.read(64 * 1024**2 + 1); need(len(body) <= 64 * 1024**2, 'bounded-public-static-response')
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        try: return e.code, dict(e.headers), e.read(1024)
        finally: e.close()

def verify_public(p):
    status, headers, body = http(); need(status == 200 and sha(body) == p['newManifest']['index.html'], 'new-public-index-exact')
    for name, expected_hash in dict(p['oldManifest'], **p['newManifest']).items():
        if name.startswith('assets/') or name in TEMPLATES:
            code, _, content = http(name); need(code == 200 and sha(content) == expected_hash, 'all-old-and-new-assets-public-exact')
    for key, request_header in (('etag', 'If-None-Match'), ('last-modified', 'If-Modified-Since')):
        code, _, content = http(headers={request_header: p['oldHeaders'][key]}); need(code == 200 and sha(content) == p['newManifest']['index.html'], 'old-browser-cache-revalidated-' + key)
    code, _, content = http('purchase'); need(code == 200 and sha(content) == p['newManifest']['index.html'], 'spa-fallback-new-index-without-provider-restart')
    code, _, _ = http('api/health'); need(code == 200, 'backend-health')
    code, _, _ = http('api/purchase'); need(code == 401, 'anonymous-purchase-protected')
    return {'index200': True, 'allOldAndNewAssets200AndExact': True, 'allThreeTemplates200AndExact': True, 'oldConditionalRequests200': True, 'spaFallback200': True, 'health200': True, 'anonymousPurchase401': True}

def extract_source(dest):
 dest.mkdir(mode=0o700);total=0;seen=set()
 with tarfile.open(fileobj=io.BytesIO(git('archive',TARGET,APP)))as t:
  for m in t.getmembers():
   n=m.name.rstrip('/');need(safe_relative(n)and n not in seen and(m.isdir()or m.isfile()),'safe-regular-source-archive');seen.add(n);total+=m.size
   need(total<=512*1024**2 and m.size<=128*1024**2 and(n==APP or n.startswith(APP+'/')or m.isdir()and APP.startswith(n+'/')),'bounded-app-only-source')
   need(m.isdir()or not pathlib.PurePosixPath(n).name.startswith('.env')or pathlib.PurePosixPath(n).name.endswith(('.example','.sample')),'no-environment-file-in-context')
   relative=n[len(APP)+1:]if n.startswith(APP+'/')else''
   need(m.isdir()or not any(relative.startswith(x+'/')for x in('data','data-test','storage','storage-test'))or relative.endswith('/.gitkeep'),'no-runtime-data-in-context')
   p=dest/n
   if m.isdir():p.mkdir(mode=0o755,parents=True,exist_ok=True)
   else:p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);private(p,t.extractfile(m).read());p.chmod(m.mode&0o755)

def derivative_contract(base_image,derivative):
 need(derivative['Architecture']==base_image['Architecture']and derivative['Os']==base_image['Os']and derivative['RootFS']['Layers'][:len(base_image['RootFS']['Layers'])]==base_image['RootFS']['Layers'],'derivative-retains-whole-base-layers-and-platform')
 before,after=dict(base_image['Config']),dict(derivative['Config']);left=before.pop('Labels',None)or{};right=after.pop('Labels',None)or{};before.pop('Image',None);after.pop('Image',None)
 need(before==after and right==dict(left,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.backend-image':LIVE_IMAGE,'io.rr-portal.frontend-app-tree':APP_TREE}),'full-config-including-exact-user-and-only-explicit-static-labels')

def pin(value,width=64):return type(value)is str and re.fullmatch('[a-f0-9]{%d}'%width,value)is not None

def read(path):
 need(path.is_file()and not path.is_symlink(),'regular-private-evidence');return json.loads(path.read_bytes())

def git(*args):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])

def initialize():
 global P,PDB
 for name,digest in[(COMMON_NAME,COMMON_SHA256),(PDB_NAME,PDB_SHA256)]:
  path=pathlib.Path(__file__).with_name(name);need(path.is_file()and not path.is_symlink()and sha(path.read_bytes())==digest,'pinned-reviewed-inert-helper-before-import')
  spec=importlib.util.spec_from_file_location(name.replace('.','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  if name==COMMON_NAME:P=m
  else:PDB=m
 P.OUT=OUT
 # Every repeated observation is separately retained; no overwrite of phase evidence.
 def save(name,value):
  global SERIAL
  SERIAL+=1;private(OUT/('%04d-'%SERIAL+name),value)
 P.private=save

def profile():
 path=ROOT/'deploy/backups/pr1042-indo-preflight-1/result.private.json'
 need(pin(EXPECTED_PROFILE_SHA256)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==EXPECTED_PROFILE_SHA256,'exact-fresh-root-reviewed-profile-bytes')
 v=read(path);inner=dict(v);inner.pop('resultSHA256',None)
 need(v['success']is True and v['phase']=='diagnose'and v['service']==SERVICE and v['resultSHA256']==EXPECTED_PROFILE_INNER_SHA256==sha(enc(inner)),'successful-self-sealed-fresh-profile')
 need(v['containerId']==EXPECTED_LIVE_CID and v['runtime']['image']==LIVE_IMAGE and v['canonicalImage']['id']==STATIC_BASE_IMAGE and v['hostGitHead']==HOST_BASE,'fresh-profile-identities-reviewed')
 need(v['wwwroot']['inventorySHA256']==EXPECTED_STATIC_INVENTORY_SHA256 and v['unstaged']['rawPathInventorySHA256']==EXPECTED_DIRTY_SHA256 and v['sharedMatchObservedHost']is True,'fresh-host-static-and-dirty-observations-reviewed')
 return v

def host_files():
 return {'shared':P.shared(),'unstaged':P.dirty(git('diff','--name-only','-z')),'staged':P.dirty(git('diff','--cached','--name-only','-z'))}

def maintenance():
 root=ROOT/'deploy/maintenance';need(root.is_dir()and not root.is_symlink(),'existing-service-maintenance-directory');result={}
 for p in[root,*sorted(root.rglob('*'))]:
  need(not p.is_symlink()and(p.is_dir()or p.is_file()),'regular-existing-maintenance-entry');relative=p.relative_to(root).as_posix();result[relative]=metadata(p)
  if p.is_file():result[relative].update(P.record(p,1024**2))
 need(len(result)<1000,'bounded-maintenance-inventory');return result

def inventory():
 records,r=P.runtime();need(r['Id']==EXPECTED_LIVE_CID and r['Image']==LIVE_IMAGE and not r['Mounts'],'same-accepted-live-indo-cid-image-and-no-mounts')
 need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','formal-indo-still-healthy')
 return r,records

def target_unchanged(before,after,cid):need(cid in before and cid in after and before==after,'all-original-runtime-pids-started-config-env-mounts-still-exact')

def live_static(r):
 rows=P.web_inventory(r)
 return {n:v['sha256']for n,v in rows['files'].items()}

def scratch_static(cid):
 # Public tar is hashed in memory instead of creating three redundant 65MB copies.
 raw=P.command(['docker','cp',cid+':/app/wwwroot/.','-'],limit=260*1024**2);result={};total=0
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as archive:
  for m in archive:
   name=m.name.rstrip('/')
   if name in('.','wwwroot'):
    need(m.isdir(),'static-root-directory-only');continue
   if name.startswith('./'):name=name[2:]
   if name.startswith('wwwroot/'):name=name[len('wwwroot/'):]
   need(safe_relative(name)and name not in result and(m.isdir()or m.isfile()),'regular-safe-scratch-static-member')
   if m.isdir():continue
   total+=m.size;need(0<=m.size<=64*1024**2 and total<=256*1024**2 and len(result)<1000,'bounded-candidate-static-tar');body=archive.extractfile(m).read();need(len(body)==m.size,'complete-candidate-static-file');result[name]=sha(body)
 need('index.html'in result,'candidate-static-index-present');return result

def binary(identity,name,candidate=False):
 need(name in['IndoShipping.Api.dll','IndoShipping.Api.pdb','IndoShipping.Domain.dll','IndoShipping.Domain.pdb','IndoShipping.Infrastructure.dll','IndoShipping.Infrastructure.pdb','db/postgres_schema.sql','seed/hs-dictionary.json'],'fixed-backend-proof-file-only')
 if candidate:
  raw=P.command(['docker','cp',identity+':/app/'+name,'-'],limit=64*1024**2)
  with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as t:
   members=t.getmembers();need(len(members)==1 and members[0].isfile()and members[0].name==pathlib.PurePosixPath(name).name and 0<=members[0].size<=32*1024**2,'single-fixed-never-started-scratch-file');body=t.extractfile(members[0]).read();need(len(body)==members[0].size,'complete-fixed-scratch-binary')
 else:
  _,r= P.runtime();need(r['Id']==identity and r['State']['Running']and type(r['State']['Pid'])is int and r['State']['Pid']>0,'same-live-process-for-backend-proof');path=pathlib.Path('/proc')/str(r['State']['Pid'])/'root/app'/name
  need(not any(p.is_symlink()for p in[path,*list(path.parents)[:len(pathlib.PurePosixPath(name).parts)]]),'fixed-live-backend-relative-no-symlink');meta=P.record(path,32*1024**2);body=path.read_bytes();need(len(body)==meta['bytes']and sha(body)==meta['sha256']and P.record(path,32*1024**2)==meta,'stable-live-backend-body')
 return body

def backend_proof(identity,candidate=False):
 scratch=scratch_create(identity)if candidate else identity
 try:
  bodies={n:binary(scratch,n,candidate)for n in[p+s for p in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure')for s in('.dll','.pdb')]+['db/postgres_schema.sql','seed/hs-dictionary.json']}
 finally:
  if candidate:scratch_remove(scratch,identity)
 projects={}
 for project in('IndoShipping.Api','IndoShipping.Domain','IndoShipping.Infrastructure'):
  prefix=APP+'/src/'+project;paths=[p.decode()for p in git('ls-tree','-r','--name-only','-z',BACKEND_REVISION,'--',prefix).split(b'\0')if p]
  docs={p[len(APP)+1:]:sha(git('show',BACKEND_REVISION+':'+p))for p in paths if p.endswith('.cs')and'/bin/'not in p and'/obj/'not in p};projects[project]=PDB.prove(bodies[project+'.dll'],bodies[project+'.pdb'],docs)
 for name in('db/postgres_schema.sql','seed/hs-dictionary.json'):need(sha(bodies[name])==sha(git('show',BACKEND_REVISION+':'+APP+'/'+name)),'fixed-runtime-schema-and-hs-seed-equal-backend705')
 value={'projects':projects,'fileSHA256':{n:sha(b)for n,b in bodies.items()},'backendSourceRevision':BACKEND_REVISION}
 private(OUT/('backend-proof-%06d.private.json'%SERIAL),value);return value

def source_check():
 need(all(pin(v,40)for v in(BASE,BACKEND_REVISION,PREVIOUS_FRONTEND,HOST_BASE,HEAD,TARGET,TREE,APP_TREE)),'all-final-reviewed-source-pins')
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'observed-host-source-never-checkout')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 git('fetch','--no-write-fetch-head','origin','+refs/pull/1042/head:refs/remotes/origin/pr1042-reviewed-head')
 need(git('rev-parse','refs/remotes/origin/pr1042-reviewed-head').decode().strip()==HEAD,'fetched-pr1042-head-equals-reviewed-commit')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-protected-main-target-and-tree')
 need(git('rev-parse',BASE+':'+APP).decode().strip()==git('rev-parse',PREVIOUS_FRONTEND+':'+APP).decode().strip()==SOURCE_APP_TREE,'logical-base-app-equals-last-accepted-frontend')
 need(git('rev-parse',TARGET+':'+APP).decode().strip()==git('rev-parse',HEAD+':'+APP).decode().strip()==APP_TREE,'exact-independently-reviewed-and-merged-app-tree')
 changed={p.decode()for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).split(b'\0')if p}
 need(REVIEWED_PATHS and len(REVIEWED_PATHS)==len(set(REVIEWED_PATHS))and changed=={APP+'/'+p for p in REVIEWED_PATHS}and all(p.startswith('web/')and p.endswith(('.ts','.tsx','.css','.html','.md'))for p in REVIEWED_PATHS),'exact-reviewed-web-only-changed-paths')
 for name in('src','db','seed','Dockerfile','.dockerignore','web/package.json','web/package-lock.json'):
  need(git('rev-parse',BACKEND_REVISION+':'+APP+'/'+name)==git('rev-parse',TARGET+':'+APP+'/'+name),'unchanged-entire-backend-db-seed-build-and-dependencies')

def ensure_build_space(label='before'):
 need(label in('before','after','preapply'),'fixed-adoption-capacity-observation')
 root=json.loads(P.command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(root)is str and pathlib.Path(root).is_absolute(),'typed-local-docker-root');s=os.statvfs(root);v={'available':s.f_bavail*s.f_frsize,'free':s.f_bfree*s.f_frsize,'minimumOrdinaryAvailable':1536*1024**2,'minimumPhysicalFree':9728*1024**2,'maximumObservedAdoptionGrowth':384*1024**2,'policy':'root-authorized-R3-adopt-only-thin-image-no-frontend-rebuild'}
 if label!='before':
  source=(OUT if label=='after'else PREPARE_OUT)/'docker-space-before.private.json';before=read(source);v['observedOrdinarySpaceDrop']=max(0,before['available']-v['available']);v['observedPhysicalSpaceDrop']=max(0,before['free']-v['free'])
 private(OUT/('docker-space-'+label+'.private.json'),v);need(v['available']>=v['minimumOrdinaryAvailable']and v['free']>=v['minimumPhysicalFree'],'adopt-thin-layer-one-point-five-gib-user-and-nine-point-five-gib-physical-free')
 if label!='before':need(v['observedOrdinarySpaceDrop']<=v['maximumObservedAdoptionGrowth']and v['observedPhysicalSpaceDrop']<=v['maximumObservedAdoptionGrowth'],'bounded-observed-adoption-space-drop-at-most384mib')

# R3 adopted preparation function follows below.

def manifest(directory):
 values=sorted(directory.rglob('*'));need(len(values)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in values),'regular-bounded-own-private-evidence');return{str(p.relative_to(directory)):sha(p.read_bytes())for p in values if p.is_file()}

def sealed(phase,digest):
 directory=ARCHIVE_ROOT/phase;need(pin(digest)and sha((directory/'manifest.json').read_bytes())==digest,'sealed-successful-prior-phase-manifest');actual=manifest(directory);actual.pop('manifest.json',None);actual.pop('result.private.json',None);need(actual==read(directory/'manifest.json'),'every-prior-private-evidence-byte-seal');r=read(directory/'result.private.json');inner=dict(r);inner.pop('resultSHA256',None);need(r['resultSHA256']==sha(enc(inner)),'prior-result-self-seal');need(r['success']is True and r['phase']==phase and r['base']==BASE and r['head']==HEAD and r['target']==TARGET and r['tree']==TREE and r['appTree']==APP_TREE and r['manifestSHA256']==digest,'exact-source-bound-prior-success');return directory,r

def load_prepared():
 directory,_=sealed('prepare',PREPARED_SHA256);p=read(directory/'prepared.private.json');need(all(p[k]==v for k,v in[('base',BASE),('head',HEAD),('target',TARGET),('tree',TREE),('appTree',APP_TREE),('hostBase',HOST_BASE)]),'prepared-final-source-pins');return p

def deploy():
 global RECOVERY
 p=load_prepared();r,rows=inventory();target_unchanged(p['runtime'],rows,r['Id']);need(host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['composeTagBefore']and image_id(p['durableTag'])==p['durableImage'],'all-prepared-config-maintenance-and-alias-pins')
 need(files(PREPARE_OUT/'old-wwwroot')==p['oldManifest']and files(PREPARE_OUT/'prepared-wwwroot')==p['newManifest']and static_plan(p['oldManifest'],p['newManifest'])==p['newAssets'],'sealed-add-only-static-plan')
 need(live_static(r)==p['oldManifest']and backend_proof(r['Id'])==p['oldProof']and index_metadata(r['Id'])==p['oldIndexMetadata'],'no-live-code-or-static-drift-before-publication');ensure_build_space('preapply')
 index_time=max(int(time.time()),p['oldIndexMetadata']['mtime']+2);need(index_time<=int(time.time())+3,'bounded-new-index-cache-time')
 while int(time.time())<index_time:time.sleep(.1)
 stage='/app/.pr1042-static-'+TARGET;next_index=stage+'/new/index.html';old_index=stage+'/old-index';index_attempted=False;tag_attempted=False
 private(OUT/'deploy.reservation',{'target':TARGET,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 try:
  run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; test ! -e "$1"; test ! -L "$1"; mkdir -m 700 "$1"; mkdir -m 700 "$1/new"','_',stage]);run(['docker','cp',str(PREPARE_OUT/'prepared-wwwroot')+'/.',r['Id']+':'+stage+'/new']);run(['docker','cp',str(PREPARE_OUT/'old-wwwroot/index.html'),r['Id']+':'+old_index])
  paths=[stage+'/new/'+n for n in sorted(p['newManifest'])]+[old_index];run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; owner=$1; shift; for f do test -f "$f"; test ! -L "$f"; chown "$owner" "$f"; chmod 644 "$f"; done','_','%d:%d'%(p['oldIndexMetadata']['uid'],p['oldIndexMetadata']['gid']),*paths]);sums=run(['docker','exec','--user','0',r['Id'],'sha256sum','--',*paths]).decode().splitlines();expected={stage+'/new/'+n:h for n,h in p['newManifest'].items()};expected[old_index]=p['oldManifest']['index.html'];need(len(sums)==len(expected)and{v.split('  ',1)[1]:v.split('  ',1)[0]for v in sums}==expected,'all-staged-static-and-rollback-byte-seals')
  for name in p['newAssets']:
   run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; test -d /app/wwwroot/assets; test ! -L /app/wwwroot/assets; ln -- "$1" "$2"','_',stage+'/new/'+name,'/app/wwwroot/'+name])
  need(remote_index(r['Id'])==p['oldManifest']['index.html'],'old-index-cas-immediately-before-atomic-publication');run(['docker','exec','--user','0',r['Id'],'touch','-d','@'+str(index_time),next_index]);index_attempted=True;run(['docker','exec','--user','0',r['Id'],'mv','-fT',next_index,'/app/wwwroot/index.html'])
  checks=verify_public(p);_,after=inventory();target_unchanged(rows,after,r['Id']);need(live_static(r)==dict(p['oldManifest'],**p['newManifest'])and backend_proof(r['Id'])==p['oldProof']and host_files()==p['hostFiles']and maintenance()==p['maintenance'],'actual-static-union-backend-env-and-all-runtime-exact')
  need(image_id(COMPOSE_TAG)==p['composeTagBefore'],'canonical-alias-cas-immediately-before-commit');tag_attempted=True;run(['docker','tag',p['durableImage'],COMPOSE_TAG]);need(image_id(COMPOSE_TAG)==p['durableImage'],'durable-canonical-static-image-committed')
  private(OUT/'deployed.private.json',{'target':TARGET,'runtime':after,'checks':checks,'durableImage':p['durableImage'],'retainedPublicRollbackStage':stage,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
  return{'frontendVersion':TARGET,'liveBackendImage':LIVE_IMAGE,'durableImage':p['durableImage'],'runtimeNotRestarted':True,'databaseReadOrWritten':False,'hostSourceCheckoutPerformed':False,'checks':checks}
 except BaseException:
  # Do not replay a partially applied phase or blindly overwrite a changed index.
  # Add-only assets remain safe for old/in-flight clients. A failed index/tag
  # commit requires independently reviewed reconciliation of these exact bytes.
  failure=STAGE;RECOVERY={'indexCommitAttempted':index_attempted,'tagCommitAttempted':tag_attempted,'automaticRetryOrRollbackPerformed':False,'newAssetsRetainedForInFlightClients':True}
  try:RECOVERY.update(observedIndexSHA256=remote_index(r['Id']),observedCanonicalImage=image_id(COMPOSE_TAG),observedHostHead=git('rev-parse','HEAD').decode().strip())
  except BaseException as e:RECOVERY.update(observationErrorType=type(e).__name__)
  private(OUT/'failed-deploy-observation.private.json',RECOVERY);globals()['STAGE']=failure;raise

def verify():
 p=load_prepared();directory,_=sealed('deploy',DEPLOY_SHA256);receipt=read(directory/'deployed.private.json');r,rows=inventory();need(rows==receipt['runtime']and host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['durableImage'],'final-runtime-config-maintenance-and-durable-image-exact');need(live_static(r)==dict(p['oldManifest'],**p['newManifest'])and backend_proof(r['Id'])==p['oldProof'],'final-whole-static-union-and-backend705-proof');return{'frontendVersion':TARGET,'durableImage':p['durableImage'],'liveBackendImage':LIVE_IMAGE,'runtimeNotRestarted':True,'databaseReadOrWritten':False,'verificationReadOnly':True,'checks':verify_public(p)}

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-scoped-frontend-release');os.umask(0o077);need(ARCHIVE_ROOT.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE_ROOT.parent,*ARCHIVE_ROOT.parent.parents)),'fixed-real-backup-parent');ARCHIVE_ROOT.mkdir(mode=0o700,exist_ok=True);need(not ARCHIVE_ROOT.is_symlink()and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode)==0o700,'own-private-release-archive');OUT=ARCHIVE_ROOT/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'one-phase-attempt-only');OUT.mkdir(mode=0o700)
 result={'phase':PHASE,'mode':PHASE,'service':SERVICE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'hostSourceCheckoutPerformed':False,'databaseReadOrWritten':False}
 try:initialize();source_check();result.update({'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE,noAutomaticRetry=True,recovery=RECOVERY)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private(OUT/'manifest.json',manifest(OUT));result['manifestSHA256']=sha((OUT/'manifest.json').read_bytes());result['resultSHA256']=sha(enc(result));private(OUT/'result.private.json',result);wire(result);return 0 if result['success']else 1

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-numeric-phase-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

# R3 adopts only the already-completed, independently compared R2 frontend build.
# These exact original failure records remain failures and are never replayed.
R2_ROOT=ROOT/'deploy/backups/pr1042-indo-static-r2-20261030/prepare'
R2_MANIFEST_SHA256='76dc0744821c46891e80d9a48a7d64420c6007e5a37086653364c8d874c178a7'
R2_FAILED_RESULT_INNER_SHA256='640f8211268ae514ed65864a8d268216a1721bdb8b210ce8d68ea02388888dc0'
R2_OPS_COMMIT='29b8ba2a17cbe0d29762e4a5ae195361d20095bb'
R2_PUBLISHED_HELPER_SHA256='fc1671860409e8f98de283c888f9c01150ac736c38796350aa19e7aa92208362'
ADOPTED_FRONTEND_IMAGE='sha256:61474ce3cacc2f22f98d7a42ec302e11e51b715acc8d2a8fdda354ee1d2777d0'
ADOPTED_FRONTEND_TAG='rrportal-indo-pr1042-frontend:'+TARGET
R2_PREPARED_PUBLIC_MANIFEST_SHA256='0cf99a792adfb496e366aaccb9f4e84f9e3d3965c74fc9d49ed767454c6fcce7'

def r2_evidence():
 need(R2_ROOT.is_dir()and not any(p.is_symlink()for p in(R2_ROOT,*R2_ROOT.parents)),'fixed-existing-r2-failed-archive')
 manifest_path=R2_ROOT/'manifest.json';need(manifest_path.is_file()and not manifest_path.is_symlink()and sha(manifest_path.read_bytes())==R2_MANIFEST_SHA256,'original-r2-failed-manifest-exact');expected=read(manifest_path)
 need(type(expected)is dict and 0<len(expected)<=100000 and all(safe_relative(n)and pin(v)for n,v in expected.items()),'bounded-safe-r2-original-manifest')
 # Stream hashes without copying or disclosing original private command contents.
 for name,digest in expected.items():
  need(P.record(R2_ROOT/name,64*1024**2)['sha256']==digest,'every-original-r2-evidence-body-still-exact')
 entries=list(R2_ROOT.rglob('*'));need(len(entries)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in entries),'only-regular-original-r2-evidence-entries');all_files={p.relative_to(R2_ROOT).as_posix()for p in entries if p.is_file()};need(all_files==set(expected)|{'manifest.json','result.private.json'},'no-missing-or-new-file-in-original-r2-archive')
 r=read(R2_ROOT/'result.private.json');inner=dict(r);inner.pop('resultSHA256',None)
 need(r['resultSHA256']==R2_FAILED_RESULT_INNER_SHA256==sha(enc(inner))and r['success']is False and r['phase']=='prepare'and r['stage']=='actual-cloud-build-equals-root-reviewed-local-build-manifest'and r['manifestSHA256']==R2_MANIFEST_SHA256,'only-the-known-root-reviewed-r2-build-graph-failure')
 need(all(r[k]==v for k,v in[('base',BASE),('head',HEAD),('target',TARGET),('tree',TREE),('appTree',APP_TREE),('hostBase',HOST_BASE)]),'r2-failure-bound-to-final-reviewed-source')
 need(not(R2_ROOT/'prepared.private.json').exists()and not(R2_ROOT/'prepared.private.json').is_symlink(),'do-not-pretend-failed-r2-prepare-succeeded')
 public={n.removeprefix('prepared-wwwroot/'):{'bytes':(R2_ROOT/n).stat().st_size,'sha256':digest}for n,digest in expected.items()if n.startswith('prepared-wwwroot/')};need(sha(enc(public))==R2_PREPARED_PUBLIC_MANIFEST_SHA256,'exact-readonly-compared-sixty-file-r2-public-byte-and-size-graph')
 raw=git('show',R2_OPS_COMMIT+':deploy/ops/pr1042-indo-static-release.py');need(sha(raw)==R2_PUBLISHED_HELPER_SHA256,'exact-published-original-r2-build-helper')
 return expected

def link_r2_public(source_name,destination_name,expected):
 need(source_name in('old-wwwroot','prepared-wwwroot')and destination_name==source_name,'fixed-public-r2-adoption-tree')
 source=R2_ROOT/source_name;source_manifest=files(source);needed={n.removeprefix(source_name+'/'):h for n,h in expected.items()if n.startswith(source_name+'/')};need(source_manifest==needed,'complete-r2-public-tree-byte-seal')
 destination=OUT/destination_name;need(not destination.exists()and not destination.is_symlink(),'fresh-own-adopted-public-tree');destination.mkdir(mode=0o700)
 for relative,digest in source_manifest.items():
  src=source/relative;target=destination/relative;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True);before=P.record(src);need(before['sha256']==digest,'sealed-public-r2-file-before-hardlink');os.link(src,target,follow_symlinks=False)
  need(P.record(target)==before and(src.stat().st_dev,src.stat().st_ino)==(target.stat().st_dev,target.stat().st_ino),'adopted-public-body-owner-mode-mtime-and-inode-exact')
 need(files(destination)==source_manifest,'whole-adopted-public-tree-exact');return destination

def adopted_frontend_static(cid):
 raw=P.command(['docker','cp',cid+':/src/web/dist/.','-'],limit=260*1024**2);result={};total=0;seen=set()
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/')
   if name in('.','dist'):
    need(member.isdir(),'frontend-public-root-directory-only');continue
   if name.startswith('./'):name=name[2:]
   if name.startswith('dist/'):name=name[len('dist/'):]
   need(safe_relative(name)and name not in seen and(member.isdir()or member.isfile()),'regular-safe-adopted-frontend-public-member');seen.add(name)
   if member.isdir():continue
   total+=member.size;need(0<=member.size<=64*1024**2 and total<=256*1024**2 and len(result)<1000,'bounded-adopted-frontend-public-tar');body=archive.extractfile(member).read();need(len(body)==member.size,'complete-adopted-frontend-public-body');result[name]=sha(body)
 need('index.html'in result,'adopted-frontend-index-present');return result

def prepare():
 prof=profile();expected=r2_evidence();need(type(ADOPTED_FRONTEND_IMAGE)is str and re.fullmatch('sha256:[a-f0-9]{64}',ADOPTED_FRONTEND_IMAGE)and EXPECTED_NEW_MANIFEST,'root-must-first-match-readonly-cloud-and-fresh-local-build-graphs')
 r,rows=inventory();need(rows==prof['allRuntime'],'same-fresh-profile-all-original-runtime');preserved=host_files();need(preserved=={k:prof[k]for k in('shared','unstaged','staged')},'same-fresh-shared-and-dirty-path-profile');protection=maintenance();ensure_build_space()
 need(image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE and image_id(ADOPTED_FRONTEND_TAG)==ADOPTED_FRONTEND_IMAGE,'same-original-canonical-and-exact-readonly-observed-r2-frontend-image')
 old=link_r2_public('old-wwwroot','old-wwwroot',expected);prepared=link_r2_public('prepared-wwwroot','prepared-wwwroot',expected);old_manifest=files(old);new_manifest=files(prepared)
 need(new_manifest==EXPECTED_NEW_MANIFEST and live_static(r)==old_manifest=={n:v['sha256']for n,v in prof['wwwroot']['files'].items()},'actual-r2-build-equals-fresh-reviewed-local-graph-and-live-old-tree')
 templates=preserve_templates(old,prepared,old_manifest);need(files(prepared)==new_manifest,'template-git-proof-cannot-change-sealed-adopted-tree');additions=static_plan(old_manifest,new_manifest)
 old_meta=index_metadata(r['Id']);need((prepared/'index.html').stat().st_size==old_meta['size'],'equal-index-byte-length-before-hot-publication');status,headers,body=http();need(status==200 and sha(body)==old_manifest['index.html'],'current-public-old-index-exact')
 scratch=scratch_create(ADOPTED_FRONTEND_IMAGE)
 try:raw_frontend=adopted_frontend_static(scratch)
 finally:scratch_remove(scratch,ADOPTED_FRONTEND_IMAGE)
 missing=set(TEMPLATES)-set(raw_frontend);private(OUT/'adopted-frontend-readback.private.json',{'files':raw_frontend,'missingGitProvenTemplates':sorted(missing)})
 need(missing<={'template-customs-rri.xlsx','template-customs-rrm.xlsx'}and raw_frontend=={n:h for n,h in new_manifest.items()if n not in missing},'immutable-r2-frontend-image-dist-exact-with-only-git-proven-missing-templates')
 original=backend_proof(r['Id']);need(backend_proof(STATIC_BASE_IMAGE,True)==original,'live-and-accepted-canonical-backend705-exact')
 context=OUT/'image-context';context.mkdir(mode=0o700);merged=context/'wwwroot';shutil.copytree(old,merged,copy_function=os.link)
 for src in prepared.rglob('*'):
  dest=merged/src.relative_to(prepared)
  if src.is_dir():dest.mkdir(exist_ok=True)
  else:
   if dest.exists():dest.unlink()
   os.link(src,dest,follow_symlinks=False)
 base_alias='rrportal-indo-pr1042-backend:'+STATIC_BASE_IMAGE.split(':')[1];need(image_id(base_alias,optional=True)in(None,STATIC_BASE_IMAGE),'own-base-alias-never-reassigned');run(['docker','tag',STATIC_BASE_IMAGE,base_alias]);base_image=json.loads(P.command(['docker','image','inspect',STATIC_BASE_IMAGE]))[0]
 scratch=scratch_create(STATIC_BASE_IMAGE)
 try:base_manifest=scratch_static(scratch)
 finally:scratch_remove(scratch,STATIC_BASE_IMAGE)
 need(base_manifest==old_manifest,'live-old-static-equals-accepted-durable-base')
 dockerfile=('FROM '+base_alias+'\nCOPY --chown=app:app wwwroot/ /app/wwwroot/\nLABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.backend-image="'+LIVE_IMAGE+'" io.rr-portal.frontend-app-tree="'+APP_TREE+'"\n').encode();private(context/'Dockerfile',dockerfile);need(all(p==context/'Dockerfile'or p==merged or merged in p.parents for p in context.rglob('*')),'only-public-assets-in-thin-derivative-context')
 tag='rrportal-indo-pr1042:'+TARGET;need(image_id(tag,optional=True)is None,'r2-never-built-durable-tag-and-new-thin-build-is-fresh');run(['docker','build','--pull=false','-t',tag,str(context)],timeout=300);derivative=json.loads(P.command(['docker','image','inspect',tag]))[0];iid=derivative['Id'];derivative_contract(base_image,derivative);need(image_id(base_alias)==STATIC_BASE_IMAGE,'frozen-base-alias-still-exact')
 scratch=scratch_create(iid)
 try:image_manifest=scratch_static(scratch)
 finally:scratch_remove(scratch,iid)
 need(image_manifest==dict(old_manifest,**new_manifest)and backend_proof(iid,True)==original,'one-thin-derivative-whole-static-union-and-backend-proof-exact');_,after=inventory();target_unchanged(rows,after,r['Id']);need(host_files()==preserved and maintenance()==protection and image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE and image_id(ADOPTED_FRONTEND_TAG)==ADOPTED_FRONTEND_IMAGE,'adoption-host-env-maintenance-canonical-and-frontend-image-unchanged')
 old_headers={k.lower():v for k,v in headers.items()if k.lower()in('etag','last-modified')};need(set(old_headers)=={'etag','last-modified'},'both-original-index-cache-validators');ensure_build_space('after');need(r2_evidence()==expected,'all-original-r2-failure-evidence-preserved-after-hardlink-adoption')
 p={'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'runtime':rows,'container':r['Id'],'hostFiles':preserved,'maintenance':protection,'oldManifest':old_manifest,'newManifest':new_manifest,'newAssets':additions,'oldHeaders':old_headers,'oldIndexMetadata':old_meta,'templateProofs':templates,'oldProof':original,'durableTag':tag,'durableImage':iid,'composeTagBefore':STATIC_BASE_IMAGE,'adoptedR2':{'success':False,'opsCommit':R2_OPS_COMMIT,'publishedHelperSHA256':R2_PUBLISHED_HELPER_SHA256,'manifestSHA256':R2_MANIFEST_SHA256,'failedResultInnerSHA256':R2_FAILED_RESULT_INNER_SHA256,'frontendImage':ADOPTED_FRONTEND_IMAGE,'frontendDistReadbackExactExceptRestoredTemplates':True,'frontendRebuilt':False,'sourceReextracted':False,'oldBackupRecopied':False,'thinDerivativeBuildCount':1}};private(OUT/'prepared.private.json',p)
 return{'durableImage':iid,'frontendImage':ADOPTED_FRONTEND_IMAGE,'newFileCount':len(new_manifest),'newAssetCount':len(additions),'databaseReadOrWritten':False,'runtimeNotRestarted':True,'hostSourceCheckoutPerformed':False,'adoptedR2FailurePreserved':True,'frontendRebuilt':False,'sourceReextracted':False,'oldBackupRecopied':False,'thinDerivativeBuildCount':1,'frontendRawFileCount':len(raw_frontend),'missingGitProvenTemplates':sorted(missing)}

if __name__=='__main__':sys.exit(main())

