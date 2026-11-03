"""CLOSED #1061 frontend-only publication, completed 2026-11-03.
Reviewed source, measured payload, prepare/deploy/verify seals and rollback resources
remain pinned for audit. EXECUTE=False rejects entry before any remote side effect.
Final verify: GitHub Actions 41615925108, result a6747106cb4aaeacf4aac23f912aee3ecf4f1fe465e6efc47c2a290ad9be3b11.
No backend restart, migration, business write, old asset/template deletion or cleanup
of historical backups/images was performed. Do not reactivate or replay this archive.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal');ARCHIVE_ROOT=ROOT/'deploy/backups/batch1061-indo-static-20261103-1'
OUT=None;PREPARE_OUT=ARCHIVE_ROOT/'prepare'
APP='apps/印尼小组/印尼走货明细';SERVICE='indo-shipping'
BASE='e6459c7e9d7483527f7b22abbe93753183075fb8';HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c';HEAD='84bcd989ce13d1e8255d4ed27321f1fa5d4ab324';TARGET='bc94908439ed3414b013d72f00f128a6459cf0aa';TREE='cf83eca5a36a0adbf97710bd43b5d5ee8a839435';APP_TREE='848f96985403eef1a38102a4f6a0613eb6901552';SOURCE_APP_TREE='61606ef0d93d366b71ce7b3a1ea0e9c136bd9610';PREVIOUS_FRONTEND='114b5cc9867960518ebe70f6731475c97fec3747'
REVIEWED_PATHS=('web/src/components/ShipmentImport.tsx', 'web/src/utils/engineeringImages.test.ts', 'web/src/utils/engineeringImport.ts', 'web/src/utils/shipmentImagePaths.test.ts', 'web/src/utils/shipmentImport.test.ts', 'web/src/utils/shipmentImport.ts', 'web/src/utils/shipmentImportApply.ts', 'web/src/utils/shipmentImportAsync.test.ts', 'web/src/utils/shipmentImportLinked.test.ts', 'web/src/utils/shipmentXmlBudget.test.ts');EXPECTED_NEW_MANIFEST={'assets/CustomersPage-Cusz5Sd1.js': '189615be662173420ba499137ad171fe91640ac7c0004f86ea8510619fb8dbc1', 'assets/DbAdminPage-9mlycqGt.js': '072ee7933663bb84376b479e3c3a202ccb3e1a33c35bc6bc446c84ed6fd7dc64', 'assets/DictionariesPage-Dv1uLFQ9.js': '0360d15353af0ea07904ffaf7838d6ea1ca6df4acf15bad0b2cb9793ac4aeba9', 'assets/EditOutlined-DFm7PdNh.js': '005b146948aa66cb7f40f234654ef93cfacccd3a128297ed12e004a00c67bb55', 'assets/LoginPage-CXOsfCwP.js': 'bf7ee229c39bd224319647e5931946cfd30fff8c62674f897eced2841dc189df', 'assets/MaterialAlertsPage-D5tOW4Hz.js': 'c850465cac74e9c2b89f7620e9406c6d7b0004e038e47fc05e044def7485db32', 'assets/MoldingPosPage-CdxY2mxi.js': '73d9b865ecc54b0b80b883035a0f45c3491cced963593813df1184ad470013c4', 'assets/OutboundPage-BQsxaIWx.css': 'b4f7372b122d76eebee9521327f40ab96530c2315df0b63ab49a74310fce55a5', 'assets/OutboundPage-DG6HFKQH.js': '0625767d0180bda9cc27876d3adf7816d3f590302c427f8e5a471cb605668ac8', 'assets/PlusOutlined-BB6Z8XWU.js': '80d8bf4fd9a8453b6d68270c1f23ccfa12a90cc7d89139659a3a8266d47e72d0', 'assets/ProductsPage-CvoSTJIj.js': '0fd15b7f0a6d0af79afdfdf0d7c53ca8b366d1828cb8c41b39cf7cfa111e6fd6', 'assets/PurchasePage-B8YonOf3.css': 'd2ea560788ecb0057235649740060f8e6fbb0495b65017913d39193397cd3da3', 'assets/PurchasePage-K2NsizVW.js': 'ed5cbbe008f03d95726f245495f279591c4cfccba12731d132fc7b72fa8c7fa2', 'assets/QuotesPage-DDVRdRl_.css': 'd9351cb3c2d4e8e5a76d947bf0e9731bac2260fb7b9abe8733daf9b3df4bbcbd', 'assets/QuotesPage-EO1FqXgz.js': '66e2ee63d184abaf6699b4b6ef2f826f03dac358480176efbcbb8e0b93c656c2', 'assets/ReloadOutlined-BsxcQVFl.js': '624272e62f885c02e27387319d6f24e0367d607e87dfaa13df905409b4b1eb80', 'assets/SchedulesPage-WX4g5D22.js': 'dbd72bf97e8749743bba66ba8345bca2b4f96799d289e9fa550cc221d0c9d0a4', 'assets/ShipmentsPage-COssvjuP.css': 'f0913b15ddcbe7cba9c5265c636c4ad69d64ad59f22c002c8076dc29059a127b', 'assets/ShipmentsPage-CeUkg49_.js': 'bb86d25b9fc0ae4dff23c183805133e7635c85aa9bfe90c9a070fa9823b6eb72', 'assets/SupplierProfileEditor-DILpBQEh.js': 'a8113e1a5c649654e3fc9654f84d0f269f00ba5921364585d87d87acbb80e7c4', 'assets/SupplierSummaryPage-B6T3u7wq.js': '30fbeb0f158976208ebf5dd2c6e7702a6cb062e5d5e23d4fe9e727921b386f2e', 'assets/ToolMaterialsPage-DjpPT-Uj.js': 'cd4e910ceea75e72cebad08c5f0728fbb3e0bd85f7904d96bbe7e06754536538', 'assets/UsersPage-IXLgW6GZ.js': 'e689e35b4a9921e0b2642f81552e5546cc6b4afd0dd1322992257d2410b37e5e', 'assets/auto-complete-OBX4jwDS.js': '7d27d675eaf3c63d4cb8a0f9a76075b921db35508c6a269f2f5abcc1d77939d3', 'assets/chunk-BVpWp9h4.js': 'd68000f91e617e39707775fbbf502ae057f963da84e1d06dd6129df60614fb8a', 'assets/client-S6mPGKVM.js': '0619bdac1ca199b0cd07d9d54bd7a4c7e2320ac4fd6e6db5fe8a413b8c02838a', 'assets/customsExport-DTXd_v1j.js': '0fa4030a00b00300ded5e66987afe996241da2eb8e02ef2bbcbf164f695d476c', 'assets/date-picker-BZZ9hqTZ.js': '971568ad1b860f96d95dee25c5e54e74916029ade3d255d5445e5511d6b6d5b6', 'assets/engineeringImport-BiwFuexA.js': 'f59a9e7c898d2c362113e5f44cb4d07ab35eafc853e4b060705f9994029b1628', 'assets/form-ClzP9m7o.js': '48a553b1af833ae00407d55f2c7a799080b9a1d95c196c9ceef0cc136e9905b9', 'assets/grid-XHR7pZWf.js': '6215ac866d6196aa5554e635ec88412e93f493bf86819ec9147fed95148724eb', 'assets/imageUpload-DgJ9GzqX.js': '2ae7e23008960198e74d812c83429f8845cc5a7fe0e509b9cf5248c9244f35fb', 'assets/index-C0na1Xgd.js': 'ce9f771b9614f65bd0fd09b54b0d778bc53817c7bbfbadbde5e8afe668c61ddc', 'assets/index-Tu04tXLf.css': '52155b5185a7b6e40e4220a5ca913de309663c04263c268cdb46d630b2114f06', 'assets/input-CXl0CrxM.js': '25e158d41520991da9483332d71a6d82274b492b067cb61ae6e8b1db4ddc4e49', 'assets/input-number-CC_vC4xv.js': 'dd27ed0a354695df30ee6c95c3424f57cb580eccfb0e4a58c054478e93a57756', 'assets/jsx-runtime-CPIq3nuo.js': 'd2ea580ed7e6f97b65ce1f80560677bfcbab839e64ddeed93044accd603de09a', 'assets/modal-Bj4MRGag.js': '902ae841a5557a5b90f5ad671054735c8b9c2d2369a207523227b3914063b4c6', 'assets/moldingPoExport-DskrH8Av.js': '94274fed5b9e9e6d8fe02791d57b282eb4f5939b44221055c93261901164bdc5', 'assets/pagination-LhGL_5kc.js': '2282ab0540887d8564f54ab3dc0ebbb2a071fa58a9fa22037b8e0ef4dd6a68e9', 'assets/popconfirm-B1z_5MKo.js': 'f842c546baacffb045267a31c1408153e3d857bcc7c88300130e4ef85daa5b30', 'assets/progress-CJwc4b9M.js': '8d31d7000dc848498c19bfaff18d76702f007d327b1b8f789f61dc687dd66bd1', 'assets/row-Uqt-8IP_.js': 'e7db1ecbe47d2146443f04fa6abe083eb12a670acdc06713b07430c07612d4aa', 'assets/scheduleImport-D1nq1GIV.js': 'b387f3b8ed16102b34ebb907197ecb0ebbe267974eb0cbca201b8a50bad55932', 'assets/scheduleLineStatus-DhsZTTpa.js': '9d27284a276d471be9a420d812a7f689bbaad3765a206c6c27dceeb594da42ad', 'assets/shipmentDates-Dw6ZTnGA.js': '7019cd5075618676d28b942598adbf6584f101276d8ed86346a09937883efea3', 'assets/spin-N1N-gDTY.js': '59c0d5f6333af35f664aa80a2c951afad3984b62bc70dd6a5d035782ad49a310', 'assets/supplierProfiles-DdACjIXN.js': '52db3c57474848d19f0cbc130afb9628d268ce6903a35050d192041268f78870', 'assets/switch-cHCC8vmb.js': '5cce03714ee315742df2528ff937536851f8738e464718d27f6ff50de5cb1e2a', 'assets/table-BOwV5v9A.js': '94919afd1585e5d6b4c05b6e9fd21d4c78c8310b4eacdb376527d9b0d6bbde84', 'assets/toolImportDefaults-CiT6Fg2f.js': 'a628a9026c3520a0edcbe098c9a202cf43bda62776527e8736c41a4bdf817254', 'assets/useForm-Bk0qN2Jh.js': '2f3fb45e485cbad0abb2b386f35134e59744d63fc7f7153abf809283ac2dfc56', 'assets/xlsx-CGtpuIau.js': '768312094736c47185e84a085235cff804c378eba126a425fa5153e221e78e5d', 'assets/xlsx.min-DqAMbf-a.js': 'e2c2a477cfde2c9a1301515a0e1b73b28f2f70ddeaf262042e24ef4292d1f275', 'favicon.svg': '61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', 'icons.svg': 'b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a', 'index.html': '0483c8e544496e6ef37ef63b9652e185ea4f31d477cda04294b26e504b35203e', 'template-customs-rri.xlsx': 'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647', 'template-customs-rrm.xlsx': '21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984', 'template-customs.xlsx': '24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'};EXPECTED_NEW_MANIFEST_SHA256='0c370a73e5a4e17dc7e62b615aed4d15146e44bfbae982b312536f8dd2920226'
EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256='f130e4799f900f3ec5b03ed52030f7f52fbd9cafa8922859384a6a661367b780';LOCAL_BUILD_PROVENANCE_NAME='batch1061-indo-build-provenance.json'
PAYLOAD_NAME='batch1061-indo-static-payload.tar';PAYLOAD_SHA256='5537c9fec5227d282783868cced76ab2b1409ef47caad5a72b5b209c15c3eec4'
PROFILE_PATH='/opt/rr-portal/deploy/backups/batch1061-indo-preflight-2-20261103/result.private.json';EXPECTED_PROFILE_SHA256='cef1f320d5ce144be0e7020714a851138aef193a75370e53c739f536205ecfe4';EXPECTED_PROFILE_INNER_SHA256='2e1ab5d9dcbd8ccc7d7a1a938bedbd1951651d5a739bdb0e87aff844abe21af8'
EXPECTED_STATIC_INVENTORY_SHA256='7a17a180b9fa76541efd17f645c99e10d6b1cf772f5d0e6a4e5743af235623d4';EXPECTED_DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e';EXPECTED_BACKEND_SHA256={'IndoShipping.Api.dll': 'e49a0c0bfe9c975cc47c32c79f1a2e5e2da3f96a56bd8f1abe8b65a85941eed3', 'IndoShipping.Api.pdb': '8e69c746e887a26c801b7297eaf7acbc965b0751080ff40362f23b7188c9d78f', 'IndoShipping.Domain.dll': 'eee8752df80db878a9605d35b0acbb83759d4dcd291641c0c6017854a0c8d469', 'IndoShipping.Domain.pdb': '4e106e105f395402042226c1816e6f71dbaacf9de9b84c5a4165df6fb26150c1', 'IndoShipping.Infrastructure.dll': '942bc5b97e045d6304686190d3589b3116103e39fc5a2529b8d4e9e9071ce857', 'IndoShipping.Infrastructure.pdb': '048e7e7419e44aa2398ed4818e165a1eb0599c176b735852911db4243317ab46', 'db/postgres_schema.sql': 'e37f93e8c00089a6126cd8ef821e35e68110a5ef047dc1495a91f08701ddb7ab', 'seed/hs-dictionary.json': 'f7f1e63b11a48ff54804cdccc5f667f6bb7f291cde0d874da28cf085e04e8a85'}
EXPECTED_CONTAINER_COUNT=47;EXPECTED_LIVE_CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a';LIVE_IMAGE='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9';STATIC_BASE_IMAGE='sha256:51b0e822e58671ff523f0212bae7a7f7593e1c46c2882418df0594374498f31f'
EXECUTE=False;PHASE='verify';PREPARED_SHA256='fcc436568a0a85a272db366cc5769e4b8105fba4e7ca472276792aa112e503ee';DEPLOY_SHA256='4683dda9037ee703dc4bfacef3d2d2c9379fd4e18ad1a874fe7da5e54b94b3a0'
BRANCH='refs/heads/codex/ops-batch1056-1060-20261103';COMPOSE_TAG='rr-portal-indo-shipping:latest'
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')
PUBLIC='http://127.0.0.1/indo-shipping/'
COMMON_NAME='pr1044-indo-preflight.py';COMMON_SHA256='940e9675d628bc0af628ac3964b9073069f99d682a7bc812960ac6e1b88d3004'
AUTH_COMMON_NAME='pr1035-quote-preflight.py';AUTH_COMMON_SHA256='2b2739aa00cad03bfce8472b7416d725364b8d4ed354a5a7e9ca905a47aaffa5'
P=None;Q=None;SERIAL=0;STAGE='entry';RECOVERY={};CAPACITY_PROGRESS={'image_growth':0,'stage':None,'pid':None,'published':False}
# Measured bounds must be filled/reviewed after the final payload and fresh profile.
CAPACITY_BUDGET={'approved': True, 'profileSHA256': 'cef1f320d5ce144be0e7020714a851138aef193a75370e53c739f536205ecfe4', 'ordinaryReserveBytes': 268435456, 'physicalReserveBytes': 8589934592, 'archiveUpperBytes': 4194304, 'imageGrowthUpperBytes': 4194304, 'liveStageUpperBytes': 4194304, 'evidenceUpperBytes': 4194304, 'payloadUpperBytes': 3145728}
CAPACITY_BUDGET_SHA256='de2d51e9334a38ba0e45aa29f91f6795cb590efd01ee92da132522869cd1ee6f'

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
 if type(name)is not str:return False
 p=pathlib.PurePosixPath(name)
 return bool(name)and str(p)==name and not p.is_absolute()and all(part not in('','..','.')for part in p.parts)and '\\'not in name and all(ord(c)>=32 for c in name)

def image_id(name, optional=False):
    p = subprocess.run(['docker', 'image', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, cwd=ROOT)
    if optional and p.returncode != 0:
        need(b'No such image:' in p.stderr or b'No such object:' in p.stderr, 'only-known-absent-local-image')
        return None
    need(p.returncode == 0, 'local-image-inspect'); rows = json.loads(p.stdout)
    need(len(rows) == 1 and re.fullmatch('sha256:[a-f0-9]{64}', rows[0]['Id']), 'one-immutable-local-image')
    return rows[0]['Id']

def scratch_create(image):
    config = json.loads(P.command(['docker', 'image', 'inspect', image]))[0]; need(config['Id'] == image and not config['Config'].get('Volumes'), 'scratch-image-without-volumes')
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--label', 'io.rr-portal.batch1061-scratch='+PHASE, '--entrypoint', '/bin/true', image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}', cid), 'own-full-scratch-id')
    return cid

def scratch_remove(cid, image):
    r = json.loads(P.command(['docker', 'inspect', cid]))[0]
    need(r['Id'] == cid and r['Image'] == image and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and (r['Config'].get('Labels') or {}).get('io.rr-portal.batch1061-scratch')==PHASE and r['HostConfig']['NetworkMode'] == 'none', 'remove-only-own-never-started-scratch')
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
    return {'index200': True, 'allOldAndNewAssets200AndExact': True, 'allThreeTemplates200AndExact': True, 'oldConditionalRequests200': True, 'spaFallback200': True, 'health200': True, 'healthDatabaseReadOnlySelect1': True, 'anonymousPurchase401': True}


def derivative_contract(base_image,derivative):
 need(derivative['Architecture']==base_image['Architecture']and derivative['Os']==base_image['Os']and derivative['RootFS']['Layers'][:len(base_image['RootFS']['Layers'])]==base_image['RootFS']['Layers'],'derivative-retains-whole-base-layers-and-platform')
 before,after=dict(base_image['Config']),dict(derivative['Config']);left=before.pop('Labels',None)or{};right=after.pop('Labels',None)or{};before.pop('Image',None);after.pop('Image',None)
 need(before==after and right==dict(left,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.backend-image':LIVE_IMAGE,'io.rr-portal.frontend-app-tree':APP_TREE}),'full-config-including-exact-user-and-only-explicit-static-labels')

def pin(value,width=64):return type(value)is str and re.fullmatch('[a-f0-9]{%d}'%width,value)is not None

def read(path):
 need(path.is_file()and not path.is_symlink(),'regular-private-evidence');return json.loads(path.read_bytes())

def git(*args):return run(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args])

def initialize():
 global P,Q
 path=pathlib.Path(__file__).with_name(COMMON_NAME)
 need(pin(COMMON_SHA256)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==COMMON_SHA256,'pinned-reviewed-readonly-indo-helper-before-import')
 spec=importlib.util.spec_from_file_location('batch1061_indo_readonly',path);P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P);P.OUT=OUT
 def save(name,value):
  global SERIAL
  SERIAL+=1;private(OUT/('%04d-'%SERIAL+name),value)
 P.private=save
 auth_path=pathlib.Path(__file__).with_name(AUTH_COMMON_NAME)
 need(pin(AUTH_COMMON_SHA256)and auth_path.is_file()and not auth_path.is_symlink()and sha(auth_path.read_bytes())==AUTH_COMMON_SHA256,'pinned-reviewed-hash-only-environment-and-gateway-helper-before-import')
 auth_spec=importlib.util.spec_from_file_location('batch1061_hash_only_auth',auth_path);Q=importlib.util.module_from_spec(auth_spec);auth_spec.loader.exec_module(Q);Q.ROOT=ROOT
 # Q's original command archives raw output. Use P's bounded in-memory read command instead.
 def auth_command(args,limit=8*1024**2,data=None,timeout=90):
  need(data is None,'hash-only-auth-helper-never-sends-command-input')
  return P.command(args,timeout=timeout,limit=limit)
 Q.command=auth_command

def profile():
 need(type(PROFILE_PATH)is str and re.fullmatch(r'/opt/rr-portal/deploy/backups/batch1061-indo-preflight-[1-9][0-9]*-20261103/result[.]private[.]json',PROFILE_PATH),'exact-fresh-numbered-indo-profile-path')
 path=pathlib.Path(PROFILE_PATH)
 need(pin(EXPECTED_PROFILE_SHA256)and path.is_file()and not path.is_symlink()and sha(path.read_bytes())==EXPECTED_PROFILE_SHA256,'reviewed-fresh-profile-bytes')
 value=read(path);inner=dict(value);inner.pop('resultSHA256',None)
 need(value.get('success')is True and value.get('readOnly')is True and value.get('allOriginalRuntimeUnchanged')is True and value.get('service')==SERVICE and value.get('sourceHint')==BASE and value.get('resultSHA256')==EXPECTED_PROFILE_INNER_SHA256==sha(enc(inner)),'successful-self-sealed-service-source-bound-readonly-profile')
 need(all(value.get(k)is False for k in('lifecycleOrConfigOrBusinessWrites','explicitSqlAccessPerformed','environmentFileBodiesCopied','rawDockerConfigOrEnvExported','plaintextCredentialsWritten','businessFileBodiesCopied')),'profile-no-lifecycle-sql-config-plaintext-env-credential-or-business-file-exports');need(all(value.get(k)is True for k in('environmentFileRead','environmentFileHashedOnly','healthReadOnlyProbe','sourceHintOnly'))and value.get('liveSourceMatchClaimed')is False,'profile-explicit-hash-only-env-read-health-probe-and-hint-only-source')
 need(value['containerId']==EXPECTED_LIVE_CID and value['runtime']['image']==LIVE_IMAGE and value['canonicalImage']['id']==STATIC_BASE_IMAGE and value['hostGitHead']==HOST_BASE,'fresh-profile-exact-runtime-source-and-canonical-images')
 need(value['wwwroot']['inventorySHA256']==EXPECTED_STATIC_INVENTORY_SHA256 and value['unstaged']['rawPathInventorySHA256']==EXPECTED_DIRTY_SHA256 and value['staged']['trackedPathCount']==0,'reviewed-full-old-static-and-dirty-inventory')
 need(type(EXPECTED_CONTAINER_COUNT)is int and len(value['allRuntime'])==EXPECTED_CONTAINER_COUNT,'fresh-profile-includes-every-existing-and-stopped-container')
 return value

def environment_files():
 paths=sorted(ROOT.glob('.env*'));need(0<len(paths)<=100,'bounded-existing-environment-files-hash-only');result={}
 for path in paths:
  need(path.is_file()and not path.is_symlink(),'environment-file-is-regular-no-link-follow')
  result[str(path.relative_to(ROOT))]=Q.shared_file(str(path))
 need('.env.cloud.production'in result,'actual-production-env-file-hashed-without-export');return result

def host_files():
 return {'shared':P.shared(),'unstaged':P.dirty(git('diff','--name-only','-z')),'staged':P.dirty(git('diff','--cached','--name-only','-z')),'env':environment_files(),'gatewayAuth':Q.gateway_auth()}

def maintenance():
 root=ROOT/'deploy/maintenance';need(root.is_dir()and not root.is_symlink(),'existing-service-maintenance-directory');result={}
 for p in[root,*sorted(root.rglob('*'))]:
  need(not p.is_symlink()and(p.is_dir()or p.is_file()),'regular-existing-maintenance-entry');relative=p.relative_to(root).as_posix();result[relative]=metadata(p)
  if p.is_file():result[relative].update(P.record(p,1024**2))
 need(len(result)<1000,'bounded-maintenance-inventory');return result

def inventory():
 records,r=P.runtime()
 need(type(EXPECTED_CONTAINER_COUNT)is int and len(records)==EXPECTED_CONTAINER_COUNT,'all-profiled-containers-including-stopped-backup')
 need(r['Id']==EXPECTED_LIVE_CID and r['Image']==LIVE_IMAGE and not r['Mounts'],'exact-active-indo-cid-image-and-no-mounts')
 need(r['State']['Running']and not r['State']['OOMKilled']and r['State'].get('Health',{}).get('Status')=='healthy','indo-remains-healthy-without-restart')
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
 observed={n:sha(body)for n,body in bodies.items()}
 need(EXPECTED_BACKEND_SHA256 and observed==EXPECTED_BACKEND_SHA256,'every-accepted-backend-binary-pdb-schema-and-seed-hash-exact-no-rebuild')
 private(OUT/('backend-proof-%06d.private.json'%SERIAL),observed);return observed

def source_check():
 need(all(pin(v,40)for v in(BASE,PREVIOUS_FRONTEND,SOURCE_APP_TREE,HOST_BASE,HEAD,TARGET,TREE,APP_TREE)),'all-final-reviewed-source-pins')
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'host-checkout-never-changed')
 git('fetch','--no-write-fetch-head','origin','+refs/heads/main:refs/remotes/origin/main')
 git('fetch','--no-write-fetch-head','origin','+refs/pull/1061/head:refs/remotes/origin/pr1061-reviewed-head')
 need(git('rev-parse','refs/remotes/origin/pr1061-reviewed-head').decode().strip()==HEAD,'latest-author-head-is-exact-reviewed-head')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-protected-main-and-tree')
 need(git('rev-parse',BASE+':'+APP).decode().strip()==git('rev-parse',PREVIOUS_FRONTEND+':'+APP).decode().strip()==SOURCE_APP_TREE,'logical-base-equals-accepted-frontend-source-tree')
 need(git('rev-parse',TARGET+':'+APP).decode().strip()==git('rev-parse',HEAD+':'+APP).decode().strip()==APP_TREE,'reviewed-and-merged-app-tree-exact')
 changed={p.decode()for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).split(b'\0')if p}
 need(REVIEWED_PATHS and len(REVIEWED_PATHS)==len(set(REVIEWED_PATHS))and changed=={APP+'/'+p for p in REVIEWED_PATHS}and all(p.startswith('web/')and p.endswith(('.ts','.tsx','.css','.html','.md'))for p in REVIEWED_PATHS),'exact-reviewed-frontend-only-diff')
 for name in('src','tests/IndoShipping.Api.Tests','db','seed','Dockerfile','.dockerignore','web/package.json','web/package-lock.json'):
  need(git('rev-parse',BASE+':'+APP+'/'+name)==git('rev-parse',TARGET+':'+APP+'/'+name),'backend-db-migrations-seed-build-and-dependencies-entirely-unchanged')

def ensure_build_space(label='before',image_growth=0,stage=None,pid=None,published=False):
 global CAPACITY_PROGRESS
 need(label in('before','after','preapply','staged','published','verify','seal'),'fixed-capacity-observation')
 budget=capacity_contract();root=json.loads(P.command(['docker','info','--format','{{json .DockerRootDir}}']))
 need(type(root)is str and pathlib.Path(root).is_absolute(),'actual-docker-root');fs=os.statvfs(root)
 archive=allocated_paths([ARCHIVE_ROOT]);live=live_stage_allocation(stage,pid,published)
 remaining=remaining_capacity(budget,archive,image_growth,live)
 value={'available':fs.f_bavail*fs.f_frsize,'free':fs.f_bfree*fs.f_frsize,**remaining,'budgetSHA256':CAPACITY_BUDGET_SHA256}
 need(value['available']>=value['minimumOrdinaryAvailable']and value['free']>=value['minimumPhysicalFree'],'retain-256-mib-ordinary-eight-gib-physical-plus-actual-remaining-growth-no-cleanup')
 # The measurement record itself and directory entry need allocation too.
 need(archive+8192<=budget['archiveUpperBytes']+budget['evidenceUpperBytes'],'measurement-record-fits-remaining-own-archive-bound')
 private(OUT/('docker-space-'+label+'.private.json'),value)
 CAPACITY_PROGRESS={'image_growth':image_growth,'stage':stage,'pid':pid,'published':published};return value

def local_build_contract():
 path=pathlib.Path(__file__).with_name(LOCAL_BUILD_PROVENANCE_NAME)
 need(pin(EXPECTED_NEW_MANIFEST_SHA256)and pin(EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256)and path.is_file()and not path.is_symlink()and path.stat().st_size<=1024**2,'reviewed-final-clean-local-build-provenance')
 need(sha(path.read_bytes())==EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256,'local-build-provenance-exact-bytes');v=read(path)
 need(all(v.get(k)==value for k,value in[('sourceHead',TARGET),('appTree',APP_TREE),('newManifestSHA256',EXPECTED_NEW_MANIFEST_SHA256),('VITE_BASE_PATH','/indo-shipping/'),('sourceExtraction','git-archive'),('freshExtraction',True),('freshNpmCi',True),('npmCiExitCode',0),('buildExitCode',0),('nodeModulesRootSymlink',False),('nodeModulesExternalSymlinks',0)]),'fresh-reviewed-source-npm-ci-and-build-no-inherited-modules')
 need(EXPECTED_NEW_MANIFEST and sha(enc(EXPECTED_NEW_MANIFEST))==EXPECTED_NEW_MANIFEST_SHA256,'complete-final-local-build-manifest');return v



def capacity_contract():
 b=CAPACITY_BUDGET;keys={'approved','profileSHA256','ordinaryReserveBytes','physicalReserveBytes','archiveUpperBytes','imageGrowthUpperBytes','liveStageUpperBytes','evidenceUpperBytes','payloadUpperBytes'}
 need(type(b)is dict and set(b)==keys and b['approved']is True and b['profileSHA256']==EXPECTED_PROFILE_SHA256 and pin(CAPACITY_BUDGET_SHA256)and sha(enc(b))==CAPACITY_BUDGET_SHA256,'explicit-reviewed-fresh-profile-bound-capacity')
 need(all(type(b[k])is int and b[k]>0 for k in keys-{'approved','profileSHA256'}),'positive-exact-integer-budget-bounds')
 need(b['ordinaryReserveBytes']>=256*1024**2 and b['physicalReserveBytes']>=8*1024**3,'minimum-reserves-never-relaxed')
 need(b['archiveUpperBytes']>=b['payloadUpperBytes']+1024**2 and b['liveStageUpperBytes']>=b['payloadUpperBytes']+1024**2,'payload-and-old-index-covered-in-archive-and-stage')
 return b

def payload_members(path,expected,max_bytes):
 need(type(max_bytes)is int and max_bytes>0 and expected and all(safe_relative(n)and pin(h)for n,h in expected.items()),'typed-safe-reviewed-payload-manifest')
 found={};total=0
 with tarfile.open(path,'r:')as archive:
  for m in archive:
   need(m.isfile()and not m.issym()and not m.islnk()and safe_relative(m.name)and m.name in expected and m.name not in found,'only-unique-reviewed-regular-tar-members-no-paths-links-or-directories')
   total+=m.size;need(0<=m.size<=max_bytes and total<=max_bytes,'bounded-actual-payload-member-bytes');body=archive.extractfile(m).read()
   need(len(body)==m.size and sha(body)==expected[m.name],'every-payload-body-exact-reviewed-sha');found[m.name]=body
 need(set(found)==set(expected),'complete-payload-no-omitted-or-extra-member');return found

def candidate_growth(base,candidate,upper):
 a=base.get('Size');b=candidate.get('Size')
 need(type(a)is int and type(b)is int and a>0 and b>0 and type(upper)is int and upper>0 and 0<b-a<=upper,'actual-positive-integer-candidate-size-increment-within-reviewed-bound')
 return b-a

def measured_payload_budget(bodies,old_index_bytes,budget):
 need(type(old_index_bytes)is int and old_index_bytes>0,'positive-old-index-size')
 payload=sum(map(len,bodies.values()));allocated=sum((len(body)+4095)//4096*4096 for body in bodies.values())
 stage=allocated+(old_index_bytes+4095)//4096*4096+64*1024
 archive=stage+64*1024
 image=payload+len(bodies)*8192+64*1024
 need(payload<=budget['payloadUpperBytes']and stage<=budget['liveStageUpperBytes']and archive<=budget['archiveUpperBytes']and image<=budget['imageGrowthUpperBytes'],'actual-payload-count-size-and-filesystem-overhead-fit-every-reviewed-bound-before-build')
 return {'payloadBytes':payload,'payloadFiles':len(bodies),'stageUpperEstimate':stage,'archiveUpperEstimate':archive,'imageUpperEstimate':image}

def static_records_preserved(before,after,new_manifest,new_assets,index_metadata):
 need({n:v['sha256']for n,v in after.items()}==dict({n:v['sha256']for n,v in before.items()},**new_manifest),'whole-public-static-graph-is-exact-old-new-union')
 need(all(after.get(n)==v for n,v in before.items()if n!='index.html'),'every-old-nonindex-file-body-owner-mode-and-mtime-preserved')
 for name in['index.html',*new_assets]:
  need(after[name]['uid']==index_metadata['uid']and after[name]['gid']==index_metadata['gid']and after[name]['mode']==0o644,'published-files-retain-reviewed-readable-owner-and-mode')
 return True

def allocated_paths(roots):
 seen=set();total=0;entries=0
 def walk(path):
  nonlocal total,entries
  meta=path.lstat();need(not stat.S_ISLNK(meta.st_mode)and(stat.S_ISREG(meta.st_mode)or stat.S_ISDIR(meta.st_mode)),'allocation-only-regular-owned-stage-or-archive-paths')
  key=(meta.st_dev,meta.st_ino)
  if key in seen:return
  seen.add(key);entries+=1;need(entries<=100000 and type(meta.st_blocks)is int and meta.st_blocks>=0,'bounded-exact-allocation-blocks')
  total+=meta.st_blocks*512
  if stat.S_ISDIR(meta.st_mode):
   for child in sorted(path.iterdir()):walk(child)
 for root in roots:
  if root.exists()or root.is_symlink():walk(root)
 return total

def live_stage_allocation(stage,pid,published):
 if stage is None:
  need(pid is None and published is False,'no-live-allocation-before-own-stage');return 0
 need(type(pid)is int and pid>0 and stage=='/app/.batch1061-static-'+TARGET,'only-own-fixed-stage-in-current-unchanged-container-namespace')
 root=pathlib.Path('/proc')/str(pid)/'root';paths=[root/stage.lstrip('/')]
 if published:paths.append(root/'app/wwwroot/index.html')
 return allocated_paths(paths)

def remaining_capacity(budget,archive,image,live):
 limits={'archive':budget['archiveUpperBytes']+budget['evidenceUpperBytes'],'image':budget['imageGrowthUpperBytes'],'live':budget['liveStageUpperBytes']}
 used={'archive':archive,'image':image,'live':live}
 need(all(type(used[k])is int and 0<=used[k]<=limits[k]for k in limits),'actual-own-archive-image-and-live-stage-allocations-within-every-reviewed-bound')
 remaining={key:limits[key]-used[key]for key in limits};total=sum(remaining.values())
 return {'allocatedArchiveBytes':archive,'measuredImageGrowthBytes':image,'allocatedLiveStageBytes':live,'remainingArchiveBytes':remaining['archive'],
  'remainingImageBytes':remaining['image'],'remainingLiveStageBytes':remaining['live'],'remainingPlannedGrowth':total,'ordinaryReserve':budget['ordinaryReserveBytes'],
  'physicalReserve':budget['physicalReserveBytes'],'minimumOrdinaryAvailable':budget['ordinaryReserveBytes']+total,'minimumPhysicalFree':budget['physicalReserveBytes']+total}

def publication_command(container,stage,index_time,metadata,old_hash):
 need(pin(container)and pin(old_hash)and stage=='/app/.batch1061-static-'+TARGET and type(index_time)is int and index_time>0,'fixed-nearby-recheck-and-rename-identities')
 old_meta='%d|%d|%o|%d|%d'%(metadata['uid'],metadata['gid'],metadata['mode'],metadata['mtime'],metadata['size'])
 shell='set -eu\nstage=$1; new=$2; index=$3; oldhash=$4; oldmeta=$5; timestamp=$6\nfor d in /app /app/wwwroot /app/wwwroot/assets "$stage" "$stage/new"; do test -d "$d"; test ! -L "$d"; done\ntest -f "$new"; test ! -L "$new"\ntouch -d "@$timestamp" "$new"\n# Cooperative deploy-cloud serialization is external. This is a nearby recheck,\n# followed by one atomic rename; comparison plus rename is NOT atomic CAS.\ntest -f "$index"; test ! -L "$index"\nactual=$(sha256sum -- "$index"); test "${actual%% *}" = "$oldhash"\ntest "$(stat -c \'%u|%g|%a|%Y|%s\' -- "$index")" = "$oldmeta"\nmv -fT -- "$new" "$index"\n'
 return ['docker','exec','--user','0',container,'sh','-c',shell,'_',stage,stage+'/new/index.html','/app/wwwroot/index.html',old_hash,old_meta,str(index_time)]

def seal_capacity(result):
 ensure_build_space('seal',**CAPACITY_PROGRESS)
 budget=capacity_contract();files=manifest(OUT)
 upper=((len(enc(files))+4096+4095)//4096+(len(enc(result))+4096+4095)//4096)*4096+8192
 used=allocated_paths([ARCHIVE_ROOT]);need(used+upper<=budget['archiveUpperBytes']+budget['evidenceUpperBytes'],'final-manifest-and-result-have-explicit-remaining-archive-allocation')
 result['capacitySeal']={'allocatedArchiveBytesBeforeSeal':used,'finalWritesUpperBytes':upper,'hardlinksCountedOnce':True,'remainingEvidenceRetainedAfterPublication':True}
 return files

def validate_archive_root(path):
 meta=path.lstat();need(stat.S_ISDIR(meta.st_mode)and not stat.S_ISLNK(meta.st_mode)and stat.S_IMODE(meta.st_mode)==0o700,'own-real-private-archive-root-never-follow-link')

def prepare():
 prof=profile();local=local_build_contract();budget=capacity_contract();r,rows=inventory()
 need(rows==prof['allRuntime'],'all-fresh-profile-runtime-including-stopped-containers-exact')
 protected=host_files();need(protected=={k:prof[k]for k in('shared','unstaged','staged','env','gatewayAuth')},'shared-config-env-gateway-auth-and-host-dirty-paths-exact');gates=maintenance();ensure_build_space()
 old_records=P.web_inventory(r);need(old_records['inventorySHA256']==EXPECTED_STATIC_INVENTORY_SHA256,'live-whole-static-metadata-matches-reviewed-profile')
 old={n:v['sha256']for n,v in old_records['files'].items()};new=EXPECTED_NEW_MANIFEST;additions=static_plan(old,new)
 original=backend_proof(r['Id']);need(image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE,'canonical-image-cas-before-candidate')
 need(backend_proof(STATIC_BASE_IMAGE,True)==original,'canonical-image-backend-is-exact-accepted-live-backend')
 scratch=scratch_create(STATIC_BASE_IMAGE)
 try:need(scratch_static(scratch)==old,'canonical-static-graph-is-whole-current-accepted-graph')
 finally:scratch_remove(scratch,STATIC_BASE_IMAGE)
 for name in TEMPLATES:
  need(git('rev-parse',BASE+':'+APP+'/web/public/'+name)==git('rev-parse',TARGET+':'+APP+'/web/public/'+name),'unchanged-template-git-blobs')
 meta=index_metadata(r['Id']);status,headers,index=http();need(status==200 and sha(index)==old['index.html']and len(index)==meta['size'],'old-public-index-and-size-exact')
 old_headers={k.lower():v for k,v in headers.items()if k.lower()in('etag','last-modified')};need(set(old_headers)=={'etag','last-modified'},'old-cache-validators-observed')
 payload_path=pathlib.Path(__file__).with_name(PAYLOAD_NAME);need(pin(PAYLOAD_SHA256)and payload_path.is_file()and not payload_path.is_symlink()and payload_path.stat().st_size<=budget['payloadUpperBytes']+1024**2 and sha(payload_path.read_bytes())==PAYLOAD_SHA256,'bounded-reviewed-public-payload-archive')
 expected={n:new[n]for n in['index.html',*additions]};bodies=payload_members(payload_path,expected,budget['payloadUpperBytes'])
 need(len(bodies['index.html'])==meta['size'],'equal-index-byte-length-before-hot-publication');bounds=measured_payload_budget(bodies,meta['size'],budget)
 private(OUT/'old-index.html',index);prepared=OUT/'prepared-wwwroot';prepared.mkdir(mode=0o700)
 for name,body in bodies.items():
  path=prepared/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);private(path,body);path.chmod(0o644)
 private(OUT/'payload-manifest.private.json',{n:sha(v)for n,v in bodies.items()})
 context=OUT/'image-context';context.mkdir(mode=0o700);recipe=[];base_alias='rrportal-indo-batch1061-base:'+STATIC_BASE_IMAGE.split(':')[1]
 need(image_id(base_alias,optional=True)in(None,STATIC_BASE_IMAGE),'own-base-alias-never-reassigned');run(['docker','tag',STATIC_BASE_IMAGE,base_alias]);recipe.append('FROM '+base_alias)
 for i,name in enumerate(sorted(bodies)):
  path=context/('file'+str(i));os.link(prepared/name,path);recipe.append('COPY --chown=%d:%d %s /app/wwwroot/%s'%(meta['uid'],meta['gid'],path.name,name))
 recipe.append('LABEL org.opencontainers.image.revision="'+TARGET+'" io.rr-portal.backend-image="'+LIVE_IMAGE+'" io.rr-portal.frontend-app-tree="'+APP_TREE+'"')
 private(context/'Dockerfile',('\n'.join(recipe)+'\n').encode());tag='rrportal-indo-batch1061:'+TARGET;need(image_id(tag,optional=True)is None,'fresh-owned-candidate-tag')
 run(['docker','build','--network=none','--pull=false','-t',tag,str(context)],timeout=300)
 base_image=json.loads(P.command(['docker','image','inspect',STATIC_BASE_IMAGE]))[0];candidate=json.loads(P.command(['docker','image','inspect',tag]))[0];derivative_contract(base_image,candidate);growth=candidate_growth(base_image,candidate,budget['imageGrowthUpperBytes'])
 need(backend_proof(candidate['Id'],True)==original,'candidate-backend-binaries-schema-seed-exact-no-rebuild');scratch=scratch_create(candidate['Id'])
 try:need(scratch_static(scratch)==dict(old,**new),'candidate-entire-old-new-union-retains-all-old-hashed-assets-and-templates')
 finally:scratch_remove(scratch,candidate['Id'])
 _,after=inventory();target_unchanged(rows,after,r['Id']);need(host_files()==protected and maintenance()==gates and live_static(r)==old and image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE,'prepare-never-changed-live-static-runtime-config-gates-or-compose-tag');ensure_build_space('after',image_growth=growth)
 p={'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'runtime':rows,'container':r['Id'],'hostFiles':protected,'maintenance':gates,'oldManifest':old,'oldStaticRecords':old_records['files'],'newManifest':new,'newAssets':additions,'payloadManifest':expected,'oldHeaders':old_headers,'oldIndexMetadata':meta,'oldProof':original,'durableTag':tag,'durableImage':candidate['Id'],'composeTagBefore':STATIC_BASE_IMAGE,'actualImageGrowth':growth,'payloadBounds':bounds,'freshLocalBuildProvenance':local,'payloadSHA256':PAYLOAD_SHA256};private(OUT/'prepared.private.json',p)
 return {'durableImage':candidate['Id'],'newAssetCount':len(additions),'payloadBytes':sum(map(len,bodies.values())),'actualImageGrowth':growth,'payloadBounds':bounds,'backendNotRestarted':True,'oldStaticResourcesNotCopiedOrDeleted':True,'explicitSqlAccessPerformed':False,'databaseBusinessWrites':False,'healthReadOnlyProbe':True}

def manifest(directory):
 values=sorted(directory.rglob('*'));need(len(values)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in values),'regular-bounded-own-private-evidence');return{str(p.relative_to(directory)):sha(p.read_bytes())for p in values if p.is_file()}

def sealed(phase,digest):
 directory=ARCHIVE_ROOT/phase;need(pin(digest)and sha((directory/'manifest.json').read_bytes())==digest,'sealed-successful-prior-phase-manifest');actual=manifest(directory);actual.pop('manifest.json',None);actual.pop('result.private.json',None);need(actual==read(directory/'manifest.json'),'every-prior-private-evidence-byte-seal');r=read(directory/'result.private.json');inner=dict(r);inner.pop('resultSHA256',None);need(r['resultSHA256']==sha(enc(inner)),'prior-result-self-seal');need(r['success']is True and r['phase']==phase and r['base']==BASE and r['head']==HEAD and r['target']==TARGET and r['tree']==TREE and r['appTree']==APP_TREE and r['manifestSHA256']==digest,'exact-source-bound-prior-success');return directory,r

def load_prepared():
 directory,_=sealed('prepare',PREPARED_SHA256);p=read(directory/'prepared.private.json');need(all(p[k]==v for k,v in[('base',BASE),('head',HEAD),('target',TARGET),('tree',TREE),('appTree',APP_TREE),('hostBase',HOST_BASE)]),'prepared-final-source-pins');return p

def deploy():
 global RECOVERY,CAPACITY_PROGRESS
 p=load_prepared();r,rows=inventory();target_unchanged(p['runtime'],rows,r['Id']);need(host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['composeTagBefore']and image_id(p['durableTag'])==p['durableImage'],'all-prepared-config-maintenance-and-alias-pins')
 need(sha((PREPARE_OUT/'old-index.html').read_bytes())==p['oldManifest']['index.html']and files(PREPARE_OUT/'prepared-wwwroot')==p['payloadManifest']and static_plan(p['oldManifest'],p['newManifest'])==p['newAssets'],'sealed-add-only-static-plan')
 need(live_static(r)==p['oldManifest']and backend_proof(r['Id'])==p['oldProof']and index_metadata(r['Id'])==p['oldIndexMetadata'],'no-live-code-or-static-drift-before-publication');ensure_build_space('preapply',image_growth=p['actualImageGrowth'])
 index_time=max(int(time.time()),p['oldIndexMetadata']['mtime']+2);need(index_time<=int(time.time())+3,'bounded-new-index-cache-time')
 while int(time.time())<index_time:time.sleep(.1)
 stage='/app/.batch1061-static-'+TARGET;next_index=stage+'/new/index.html';old_index=stage+'/old-index';index_attempted=False;tag_attempted=False
 CAPACITY_PROGRESS={'image_growth':p['actualImageGrowth'],'stage':stage,'pid':r['State']['Pid'],'published':False}
 private(OUT/'deploy.reservation',{'target':TARGET,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 try:
  run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; test -d /app; test ! -L /app; test ! -e "$1"; test ! -L "$1"; mkdir -m 700 "$1"; mkdir -m 700 "$1/new"','_',stage]);run(['docker','cp',str(PREPARE_OUT/'prepared-wwwroot')+'/.',r['Id']+':'+stage+'/new']);run(['docker','cp',str(PREPARE_OUT/'old-index.html'),r['Id']+':'+old_index])
  paths=[stage+'/new/'+n for n in sorted(p['payloadManifest'])]+[old_index];run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; owner=$1; shift; for f do test -f "$f"; test ! -L "$f"; chown "$owner" "$f"; chmod 644 "$f"; done','_','%d:%d'%(p['oldIndexMetadata']['uid'],p['oldIndexMetadata']['gid']),*paths]);sums=run(['docker','exec','--user','0',r['Id'],'sha256sum','--',*paths]).decode().splitlines();expected={stage+'/new/'+n:h for n,h in p['payloadManifest'].items()};expected[old_index]=p['oldManifest']['index.html'];need(len(sums)==len(expected)and{v.split('  ',1)[1]:v.split('  ',1)[0]for v in sums}==expected,'all-staged-static-and-rollback-byte-seals')
  for name in p['newAssets']:
   run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; for d in /app /app/wwwroot /app/wwwroot/assets; do test -d "$d"; test ! -L "$d"; done; test ! -e "$2"; test ! -L "$2"; ln -T -- "$1" "$2"','_',stage+'/new/'+name,'/app/wwwroot/'+name])
  ensure_build_space('staged',image_growth=p['actualImageGrowth'],stage=stage,pid=r['State']['Pid']);index_attempted=True;run(publication_command(r['Id'],stage,index_time,p['oldIndexMetadata'],p['oldManifest']['index.html']));CAPACITY_PROGRESS['published']=True
  checks=verify_public(p);static_records_preserved(p['oldStaticRecords'],P.web_inventory(r)['files'],p['newManifest'],p['newAssets'],p['oldIndexMetadata']);_,after=inventory();target_unchanged(rows,after,r['Id']);need(live_static(r)==dict(p['oldManifest'],**p['newManifest'])and backend_proof(r['Id'])==p['oldProof']and host_files()==p['hostFiles']and maintenance()==p['maintenance'],'actual-static-union-backend-env-and-all-runtime-exact')
  ensure_build_space('published',image_growth=p['actualImageGrowth'],stage=stage,pid=r['State']['Pid'],published=True)
  need(image_id(COMPOSE_TAG)==p['composeTagBefore'],'canonical-alias-nearby-recheck-immediately-before-cooperative-tag');tag_attempted=True;run(['docker','tag',p['durableImage'],COMPOSE_TAG]);need(image_id(COMPOSE_TAG)==p['durableImage'],'durable-canonical-static-image-committed')
  private(OUT/'deployed.private.json',{'target':TARGET,'runtime':after,'checks':checks,'durableImage':p['durableImage'],'retainedPublicRollbackStage':stage,'indexPublication':'single-exec-nearby-recheck-then-atomic-rename-not-atomic-CAS','externalWorkflowSerialization':'deploy-cloud-cooperative','thirdPartyWritesPrevented':False,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
  return{'frontendVersion':TARGET,'liveBackendImage':LIVE_IMAGE,'durableImage':p['durableImage'],'runtimeNotRestarted':True,'explicitSqlAccessPerformed':False,'databaseBusinessWrites':False,'healthReadOnlyProbe':True,'hostSourceCheckoutPerformed':False,'checks':checks}
 except BaseException:
  # Do not replay a partially applied phase or blindly overwrite a changed index.
  # Add-only assets remain safe for old/in-flight clients. A failed index/tag
  # commit requires independently reviewed reconciliation of these exact bytes.
  failure=STAGE;RECOVERY={'indexCommitAttempted':index_attempted,'tagCommitAttempted':tag_attempted,'automaticRetryOrRollbackPerformed':False,'newAssetsRetainedForInFlightClients':True}
  try:RECOVERY.update(observedIndexSHA256=remote_index(r['Id']),observedCanonicalImage=image_id(COMPOSE_TAG),observedHostHead=git('rev-parse','HEAD').decode().strip())
  except BaseException as e:RECOVERY.update(observationErrorType=type(e).__name__)
  if RECOVERY.get('observedIndexSHA256')==p['newManifest']['index.html']:CAPACITY_PROGRESS['published']=True
  private(OUT/'failed-deploy-observation.private.json',RECOVERY);globals()['STAGE']=failure;raise

def verify():
 p=load_prepared();directory,_=sealed('deploy',DEPLOY_SHA256);receipt=read(directory/'deployed.private.json');r,rows=inventory();ensure_build_space('verify',image_growth=p['actualImageGrowth'],stage=receipt['retainedPublicRollbackStage'],pid=r['State']['Pid'],published=True);need(rows==receipt['runtime']and host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['durableImage'],'final-runtime-config-maintenance-and-durable-image-exact');need(live_static(r)==dict(p['oldManifest'],**p['newManifest'])and backend_proof(r['Id'])==p['oldProof'],'final-whole-static-union-and-accepted-backend-proof');static_records_preserved(p['oldStaticRecords'],P.web_inventory(r)['files'],p['newManifest'],p['newAssets'],p['oldIndexMetadata']);return{'frontendVersion':TARGET,'durableImage':p['durableImage'],'liveBackendImage':LIVE_IMAGE,'runtimeNotRestarted':True,'explicitSqlAccessPerformed':False,'databaseBusinessWrites':False,'healthReadOnlyProbe':True,'verificationReadOnly':True,'checks':verify_public(p)}

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','inert-single-attempt-frontend-only-phase')
 need(all(pin(v,40)for v in(BASE,PREVIOUS_FRONTEND,SOURCE_APP_TREE,HOST_BASE,HEAD,TARGET,TREE,APP_TREE))and all(pin(v)for v in(EXPECTED_PROFILE_SHA256,EXPECTED_PROFILE_INNER_SHA256,EXPECTED_STATIC_INVENTORY_SHA256,EXPECTED_DIRTY_SHA256,EXPECTED_NEW_MANIFEST_SHA256,EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256,EXPECTED_LIVE_CID,PAYLOAD_SHA256,COMMON_SHA256))and all(type(v)is str and re.fullmatch('sha256:[a-f0-9]{64}',v)for v in(LIVE_IMAGE,STATIC_BASE_IMAGE))and EXPECTED_BACKEND_SHA256 and all(pin(v)for v in EXPECTED_BACKEND_SHA256.values())and EXPECTED_NEW_MANIFEST and(PHASE=='prepare'or pin(PREPARED_SHA256))and(PHASE!='verify'or pin(DEPLOY_SHA256)),'all-source-profile-build-image-and-phase-pins-before-side-effects')
 capacity_contract();os.umask(0o077);need(ARCHIVE_ROOT.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE_ROOT.parent,*ARCHIVE_ROOT.parent.parents)),'real-private-backup-parent');ARCHIVE_ROOT.mkdir(mode=0o700,exist_ok=True);validate_archive_root(ARCHIVE_ROOT);OUT=ARCHIVE_ROOT/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'new-private-phase-never-replayed');OUT.mkdir(mode=0o700)
 result={'phase':PHASE,'mode':PHASE,'service':SERVICE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'backendRestarted':False,'hostSourceCheckoutPerformed':False,'explicitSqlAccessPerformed':False,'databaseBusinessWrites':False,'healthReadOnlyProbe':True,'environmentFileRead':True,'environmentFileHashedOnly':True,'environmentFileBodiesCopied':False,'rawDockerConfigOrEnvExported':False,'plaintextCredentialsWritten':False,'oldBackupsOrImagesCleaned':False}
 try:initialize();source_check();result.update({'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE,noAutomaticRetry=True,recovery=RECOVERY)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:files=seal_capacity(result)
 except Exception as error:
  result.update(success=False,errorType=type(error).__name__,stage=STAGE,sealWritesSkipped=True,noAutomaticRetry=True);result['resultSHA256']=sha(enc(result));wire(result);return 1
 private(OUT/'manifest.json',files);result['manifestSHA256']=sha((OUT/'manifest.json').read_bytes());result['resultSHA256']=sha(enc(result));private(OUT/'result.private.json',result);wire(result);return 0 if result['success']else 1

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-numeric-phase-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

if __name__=='__main__':sys.exit(main())

