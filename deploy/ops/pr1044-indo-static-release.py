"""INERT PR1044 Indo-only static publication. No app start, SQL, env read or host checkout.
Root must replace every blank reviewed/fresh-profile pin, review and activate one phase.
"""
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path('/opt/rr-portal')
ARCHIVE_ROOT=ROOT/'deploy/backups/pr1044-indo-static-r2-20261031'
OUT=None
PREPARE_OUT=ARCHIVE_ROOT/'prepare'
BASE='65e20c72c61d8a8dff6263f903dc5f9b6b3e52c9'
BACKEND_REVISION='70590f6d0dc1c691cfcc7c6b85c67e4a3574e571'
PREVIOUS_FRONTEND='1e4366f2803bd5ea19b07b787a12a7d7b66c5ff4'
SOURCE_APP_TREE='fc63cee79ae886eb53ae44cc8986ea29ccd56aa1'
HOST_BASE='f22fbffa1789234fe1c78bf776f4dcb3fe867d0c'
HEAD='b3693d755283f23518fe478ee7e46e1c22545f0d'
APP_TREE='2bb9d25768d10e9dde67b2eb889ec48be1aeb5fd'
TARGET='9947afd48c2bc6f4bd2f12757789368460990c36'
TREE='49747db74a59a3567a26fd09b3c60e5002c62f02'
REVIEWED_PATHS=('web/src/components/ShipmentNumberCell.tsx', 'web/src/components/ShipmentSheetTable.tsx', 'web/src/deployment.test.ts', 'web/src/pages/ShipmentsPage.tsx', 'web/src/utils/customsExport.ts', 'web/src/utils/shipmentConsolidation.test.ts', 'web/src/utils/shipmentDates.test.ts', 'web/src/utils/shipmentDeclaration.ts', 'web/src/utils/shipmentDeclarationEditingRegression.test.ts', 'web/src/utils/shipmentDeclarationPrecision.test.ts', 'web/src/utils/shipmentDisplay.test.ts', 'web/src/utils/shipmentDisplay.ts', 'web/src/utils/shipmentMergedEditor.ts', 'web/src/utils/shipmentPalletLineBreak.test.ts', 'web/src/utils/shipmentPurchaseExport.test.ts', 'web/src/utils/shipmentSheet.ts', 'web/src/utils/shipmentSheetClear.test.ts', 'web/src/utils/shipmentSheetNavigation.test.ts', 'web/src/utils/supplierDocuments.test.ts', 'web/tests/fixtures/shipments/README.md')
EXPECTED_NEW_MANIFEST={'assets/CustomersPage-Cl8fnDMT.js': 'd687733d81b7b7a1bf9eca2ab89c2d2a46d6b40563bfa3e48d7ef1a0ef16155f', 'assets/DbAdminPage-DZI2xwmk.js': 'f9f3934386dbebf3d6a83efa2b860f25f78716c5f89744d180b99ccf3ae0b45b', 'assets/DictionariesPage-Bqu6ehox.js': '4313737e5cfea7838e2fbf61eb69ee1692f3b0c84e70b99abd29bbce5100e197', 'assets/EditOutlined-D174HrYw.js': '90193df66a8b096dffd454b57df5d2f1f6a9383bf2ca7f06167680924c653893', 'assets/LoginPage-4c8FiKuY.js': '73a441e6ae54083eba28ab9821bf80aab3e74fceb7c5542d72ffb02ea2528e28', 'assets/MaterialAlertsPage-CYzgZJju.js': '894e3b1488b1c502ba80a59f9e054d2c72093c3e1a90507ad39ee70d502037ab', 'assets/MoldingPosPage-Bm5avrd9.js': '40d63760616ecf393c4347fd5c53086380caf09a7f71c444fe3af6f2f57e17f4', 'assets/OutboundPage-BQsxaIWx.css': 'b4f7372b122d76eebee9521327f40ab96530c2315df0b63ab49a74310fce55a5', 'assets/OutboundPage-iCL1FgI5.js': '885132fddc1e069312224703387569c91b173406043eca564414a6af434eec49', 'assets/PlusOutlined-i4GxCoXK.js': 'c97c267d368baed8a93fc4d33e620740c6fa4958c46c416385919a3e355c7220', 'assets/ProductsPage-BOtL8KH9.js': 'e3f97e6e42d2c9e297a88c5e1da447be347d62bc57e4d00038b31fee7957038e', 'assets/PurchasePage-B8YonOf3.css': 'd2ea560788ecb0057235649740060f8e6fbb0495b65017913d39193397cd3da3', 'assets/PurchasePage-BitYnuXL.js': '546acdb11c1b6b68e46066b216d71452e36ea1eabaeff409eab1a146b6754276', 'assets/QuotesPage-DDVRdRl_.css': 'd9351cb3c2d4e8e5a76d947bf0e9731bac2260fb7b9abe8733daf9b3df4bbcbd', 'assets/QuotesPage-DnvHpv3q.js': '1c7662e3dfaf42cbbe6250791ac87898d316b779b0ddf6e0a937cc2c56b014f3', 'assets/ReloadOutlined-BxqQ9352.js': '40ac582d2581424cf313973d26aff5c347d87bf2a4cf7f64513d790845203267', 'assets/SchedulesPage-2AhQklOn.js': 'ba8baaa63b30e7b77929983292e2e49f4693fe4c939420729812353f5675d47d', 'assets/ShipmentsPage-COssvjuP.css': 'f0913b15ddcbe7cba9c5265c636c4ad69d64ad59f22c002c8076dc29059a127b', 'assets/ShipmentsPage-C_bvrVVj.js': '309bd96f5da2b083050d8269544c980027c751649aeeeb160b2a104bda31ef13', 'assets/SupplierProfileEditor-wo5LJ8bn.js': '203098522d2513dac22b5f39dec0f6757d05d81a7555aea1ef45fd44f8a8a4a4', 'assets/SupplierSummaryPage-jc4yv8KB.js': '6ac69e8a381c37ef7de63703f08fc4c3ef12f15765c16d12baf1158f3796487d', 'assets/ToolMaterialsPage-D-d51cfi.js': '8e673dc12f2cb03398a8c94d543ff5156248ca2df790fddf001b997e43b6c244', 'assets/UsersPage-CX_8Vqfu.js': '953bc6e9845f785d8c08172c0bea24e0380adaf4509ad8f342fa10a926ff5e57', 'assets/auto-complete-OBX4jwDS.js': '7d27d675eaf3c63d4cb8a0f9a76075b921db35508c6a269f2f5abcc1d77939d3', 'assets/chunk-BVpWp9h4.js': 'd68000f91e617e39707775fbbf502ae057f963da84e1d06dd6129df60614fb8a', 'assets/client-S6mPGKVM.js': '0619bdac1ca199b0cd07d9d54bd7a4c7e2320ac4fd6e6db5fe8a413b8c02838a', 'assets/customsExport-BqITFkNb.js': '0934d649cf5340acc2f71572c37441d7eb7107460dd3a199b20fe3fcf574e8c2', 'assets/date-picker-DbP3giq-.js': '05ceb0b7a99c931e4032eada646a07a0170da1903a9ffe2271e8de180ede5453', 'assets/engineeringImport-XIqm9GiY.js': 'f67e995d82f650cdb575b1b3d713ce151f5e7f001b94aedd67dc83091c4c3b5d', 'assets/form-CXVyFXAD.js': '26e2ada78702c5c0d3a4ee95a06b25eb05e0546d65f437751b09c7d8f6bb42a8', 'assets/grid-C3n0JxkK.js': 'aa3b7f499c0d1b658124af6189d6a3eeb1a0bbe660ef4782afe7ac5b0f7db0bb', 'assets/imageUpload-DgJ9GzqX.js': '2ae7e23008960198e74d812c83429f8845cc5a7fe0e509b9cf5248c9244f35fb', 'assets/index-CGRrrY22.js': '3bc3b5fb081535d77fed35fbff01a86f58b05eb458bc581596284daca9a56d65', 'assets/index-Tu04tXLf.css': '52155b5185a7b6e40e4220a5ca913de309663c04263c268cdb46d630b2114f06', 'assets/input-CXl0CrxM.js': '25e158d41520991da9483332d71a6d82274b492b067cb61ae6e8b1db4ddc4e49', 'assets/input-number-CC_vC4xv.js': 'dd27ed0a354695df30ee6c95c3424f57cb580eccfb0e4a58c054478e93a57756', 'assets/jsx-runtime-CPIq3nuo.js': 'd2ea580ed7e6f97b65ce1f80560677bfcbab839e64ddeed93044accd603de09a', 'assets/modal-DeB1TAFM.js': 'debb4d5b2641363de0a254bf6cb3121e8eb3a108e13cae74e83b9650824c7ddf', 'assets/moldingPoExport-DskrH8Av.js': '94274fed5b9e9e6d8fe02791d57b282eb4f5939b44221055c93261901164bdc5', 'assets/pagination-LhGL_5kc.js': '2282ab0540887d8564f54ab3dc0ebbb2a071fa58a9fa22037b8e0ef4dd6a68e9', 'assets/popconfirm-B-4T9t-k.js': '8140f7b123a893b37c6646d605744fa1900ff6accd1e1fa9a767b8eba2d8a909', 'assets/progress-CJwc4b9M.js': '8d31d7000dc848498c19bfaff18d76702f007d327b1b8f789f61dc687dd66bd1', 'assets/row-BzsbQ_fH.js': '578f7817684c703ac1ae4f455246f3ce7c0f11ba8c2c16d44347cfa0b408d822', 'assets/scheduleImport-D1nq1GIV.js': 'b387f3b8ed16102b34ebb907197ecb0ebbe267974eb0cbca201b8a50bad55932', 'assets/scheduleLineStatus-DhsZTTpa.js': '9d27284a276d471be9a420d812a7f689bbaad3765a206c6c27dceeb594da42ad', 'assets/shipmentDates-CXbAzbOH.js': 'edee8b7cf573975bb3668bcbc0f1deab64ab323efb6929ea39c4f23ea53a9936', 'assets/spin-N1N-gDTY.js': '59c0d5f6333af35f664aa80a2c951afad3984b62bc70dd6a5d035782ad49a310', 'assets/supplierProfiles-DdACjIXN.js': '52db3c57474848d19f0cbc130afb9628d268ce6903a35050d192041268f78870', 'assets/switch-cHCC8vmb.js': '5cce03714ee315742df2528ff937536851f8738e464718d27f6ff50de5cb1e2a', 'assets/table-BGwmasci.js': '4ae03c9b2dffc72acdf54576323d8e7ad810f28d177a70487bb1399a2a8cc54d', 'assets/toolImportDefaults-DhIz_EXv.js': 'd515d56e897c4b386795a2f8542a517b90e69809352ba2f70d4798d5f7f58a41', 'assets/useForm-Bk0qN2Jh.js': '2f3fb45e485cbad0abb2b386f35134e59744d63fc7f7153abf809283ac2dfc56', 'assets/xlsx-CGtpuIau.js': '768312094736c47185e84a085235cff804c378eba126a425fa5153e221e78e5d', 'assets/xlsx.min-DqAMbf-a.js': 'e2c2a477cfde2c9a1301515a0e1b73b28f2f70ddeaf262042e24ef4292d1f275', 'favicon.svg': '61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', 'icons.svg': 'b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a', 'index.html': 'ba01c758128ad25e9e80b7d8552de21460bf75b18809c3e1db051e85661d02b3', 'template-customs-rri.xlsx': 'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647', 'template-customs-rrm.xlsx': '21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984', 'template-customs.xlsx': '24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'}
EXPECTED_NEW_MANIFEST_SHA256='b3e2ad1b9450de358c61c7b35b0cfc69b6a96d400af0380104696a7c70566cfa'
EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256='a0afa2173f3960cce28cc040a486559fbb71696fb703dffef9d109ad27b9a5a9'
LOCAL_BUILD_PROVENANCE_NAME='pr1044-local-build-provenance.json'
EXPECTED_PROFILE_SHA256='ef3e8e8c37d062c0b4d5e3fb0fb1a9ba849f6495bb621ddce9c9c90781e0acc2'
EXPECTED_PROFILE_INNER_SHA256='6cba0924b449143c364ea03562dcdc27adec3a61fad678d32c687b6739dc131c'
EXPECTED_STATIC_INVENTORY_SHA256='feec565ca36163a4935005159589a33363243861efe2876752d496ad51fc6df3'
EXPECTED_DIRTY_SHA256='74b8a9c5caefdc5a220f12cd14972229312beef004e76129d0fb2bb691a0507e'
EXECUTE=False
PHASE='verify'
PREPARED_SHA256='124560121bfac7e4d3e18d5d8513294f9ec70e75492292f85a161f0e76625389'
DEPLOY_SHA256='3b402aaa5b272b82bffbdcf530198317afc858fe2da916c2e976da327444517f'
BRANCH='refs/heads/codex/ops-pr-1044-20261031-indo'
APP='apps/印尼小组/印尼走货明细'
SERVICE='indo-shipping'
LIVE_IMAGE='sha256:79c441c8c2df6d6df6fcc475e865535c3ed5c4e884e56bcb1a2a772c5163b0a9'
STATIC_BASE_IMAGE='sha256:d490c0729e6604fed85993e4b95d423d206eeeac38d4f0f6358af682ec33faed'
EXPECTED_LIVE_CID='58a9bc0a94611e21a4d8987edd85857fa3f53521ca649bafa3a166890cf3eb2a'
COMPOSE_TAG='rr-portal-indo-shipping:latest'
OLD=PREVIOUS_FRONTEND
TEMPLATES=('template-customs.xlsx','template-customs-rri.xlsx','template-customs-rrm.xlsx')
TEMPLATE_PROOFS={'template-customs.xlsx':(144045,'24ea412592b3b656a872950c8a3985813fb3dd647c26df495bc882791e9bcaf6'),'template-customs-rri.xlsx':(43375953,'cb37324b0b4d659d55a8b2ddf012f0b6bbef8b1ee7f368448b3e0ad0fff23647'),'template-customs-rrm.xlsx':(835559,'21fa65679165883c8ed9f100af96c581d79a35da9644464548c765e10f1d2984')}
PUBLIC='http://127.0.0.1/indo-shipping/'
COMMON_NAME='pr1044-indo-preflight.py'
COMMON_SHA256='940e9675d628bc0af628ac3964b9073069f99d682a7bc812960ac6e1b88d3004'
PDB_NAME='portable-pdb-library.py'
PDB_SHA256='cf66f655a1e166491c4da67da0824f42ac8cdae3f844044cb5d8f7233ba105c5'
P=None
PDB=None
SERIAL=0
STAGE='entry'
RECOVERY={}
FAILED_ROOT=ROOT/'deploy/backups/pr1044-indo-static-1-20261031/prepare'
FAILED_MANIFEST_SHA256='064c7010013d1de91715667243e56006e9e3afc3f11adc54398dc540e47a8e5f'
FAILED_RESULT_INNER_SHA256='9522942e5d48291541fd8ee554dcc90f5234bd9b10ba8dd1c473cf28e3df9d48'
DIAGNOSIS_PATH=ROOT/'deploy/backups/pr1044-prepare-failure-readonly-1/result.private.json'
DIAGNOSIS_RAW_SHA256='67c82bcc86730e04ac33cf721890e450d4467f38c4adf7ee645c692659d2d18f'
DIAGNOSIS_INNER_SHA256='7a7e39253f25d1be1e6805aaa0cd9c8df79adff2ba4ec766678d5345871bd06b'
RAW_FRONTEND_RECORD_SHA256='74ef92388668d23a08b8aa698cd2b4619c1b603a170f9487fe07a17402642a70'
ADOPTED_FRONTEND_IMAGE='sha256:959c93d938343526e04c83c9cbf6604bcc9499462e08e70b640383d9a6dec601'
ADOPTED_CANDIDATE_IMAGE='sha256:805586529a8575ef0dc5f9161d619dd4fb62f67b0b6b68ae5995ac922b860503'
ADOPTED_FRONTEND_TAG='rrportal-indo-pr1044-frontend:'+TARGET
ADOPTED_CANDIDATE_TAG='rrportal-indo-pr1044:'+TARGET
EVIDENCE_BUDGET=33554432
ORDINARY_RESERVE=134217728
DELTA_BYTES=1980800
DELTA_FILE_ALLOCATED=2060288
DELTA_ALLOCATED_BOUND=2125824
ORDINARY_REQUIRED=172023808
PHYSICAL_REQUIRED=8627740672

def need(v,label):
 global STAGE
 STAGE=label
 if not v:raise RuntimeError(label)

def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

def sha(v):return hashlib.sha256(v).hexdigest()

def private(p,v):
 raw=v if type(v)is bytes else enc(v);usage=evidence_usage();limit=EVIDENCE_BUDGET if p.name in('manifest.json','result.private.json')else EVIDENCE_BUDGET-2*1024**2
 need(p.parent==OUT and len(raw)<=4*1024**2 and usage['allocatedBytes']+((len(raw)+4095)//4096)*4096+4096<=limit,'bounded-own-evidence-write-before-open')
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 need(evidence_usage()['allocatedBytes']<=EVIDENCE_BUDGET,'own-evidence-actual-allocation-cap')

def run(args,data=None,timeout=180):
 global SERIAL,STAGE
 need(OUT is not None and type(args)is list and args and type(args[0])is str and len(pathlib.Path(args[0]).name)<=64,'bounded-fixed-command-before-reservation');usage=evidence_usage();need(usage['allocatedBytes']+8192<=EVIDENCE_BUDGET-2*1024**2,'post-command-digest-eight-kib-reserved-before-child')
 SERIAL+=1;STAGE='command-'+pathlib.Path(args[0]).name;result=subprocess.run(args,input=data,capture_output=True,cwd=ROOT,timeout=timeout);need(len(result.stdout)<=16*1024**2 and len(result.stderr)<=1024**2,'bounded-command-streams-memory-only');record={'program':pathlib.Path(args[0]).name,'exitCode':result.returncode,'stdoutBytes':len(result.stdout),'stdoutSHA256':sha(result.stdout),'stderrBytes':len(result.stderr),'stderrSHA256':sha(result.stderr)};need(len(enc(record))<=4096,'command-digest-within-reserved-one-block');private(OUT/('%06d-command.private.json'%SERIAL),record);need(result.returncode==0,'command-'+pathlib.Path(args[0]).name);return result.stdout

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
    config = json.loads(P.command(['docker', 'image', 'inspect', image]))[0]; need(config['Id'] == image and not config['Config'].get('Volumes'), 'scratch-image-without-volumes')
    cid = run(['docker', 'create', '--network', 'none', '--restart', 'no', '--log-driver', 'none', '--label', 'io.rr-portal.pr1044-scratch='+PHASE, '--entrypoint', '/bin/true', image]).decode().strip()
    need(re.fullmatch('[a-f0-9]{64}', cid), 'own-full-scratch-id')
    return cid

def scratch_remove(cid, image):
    r = json.loads(P.command(['docker', 'inspect', cid]))[0]
    need(r['Id'] == cid and r['Image'] == image and not r['State']['Running'] and r['State']['Pid'] == 0 and r['State']['StartedAt'].startswith('0001-') and not r['Mounts'] and (r['Config'].get('Labels') or {}).get('io.rr-portal.pr1044-scratch')==PHASE and r['HostConfig']['NetworkMode'] == 'none', 'remove-only-own-never-started-scratch')
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
    need(not missing,'adoption-never-restores-or-writes-original-templates')
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


def derivative_contract(base_image,derivative):
 need(derivative['Architecture']==base_image['Architecture']and derivative['Os']==base_image['Os']and derivative['RootFS']['Layers'][:len(base_image['RootFS']['Layers'])]==base_image['RootFS']['Layers'],'derivative-retains-whole-base-layers-and-platform')
 before,after=dict(base_image['Config']),dict(derivative['Config']);left=before.pop('Labels',None)or{};right=after.pop('Labels',None)or{};before.pop('Image',None);after.pop('Image',None)
 need(before==after and right==dict(left,**{'org.opencontainers.image.revision':TARGET,'io.rr-portal.backend-image':LIVE_IMAGE,'io.rr-portal.frontend-app-tree':APP_TREE}),'full-config-including-exact-user-and-only-explicit-static-labels')

def pin(value,width=64):return type(value)is str and re.fullmatch('[a-f0-9]{%d}'%width,value)is not None

def read(path):
 need(path.is_file()and not path.is_symlink(),'regular-private-evidence');return json.loads(path.read_bytes())

def git(*args):
 global SERIAL
 SERIAL+=1;body=P.command(['git','-C',str(ROOT),'-c','core.hooksPath=/dev/null',*args],timeout=180,limit=64*1024**2);private(OUT/('%06d-git-memory.private.json'%SERIAL),{'operation':args[0],'bytes':len(body),'sha256':sha(body)});return body

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
 path=ROOT/'deploy/backups/pr1044-indo-preflight-1/result.private.json'
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
 need(all(pin(v,40)for v in(BASE,BACKEND_REVISION,PREVIOUS_FRONTEND,SOURCE_APP_TREE,HOST_BASE,HEAD,TARGET,TREE,APP_TREE)),'all-final-reviewed-source-pins')
 need(git('rev-parse','HEAD').decode().strip()==HOST_BASE,'observed-host-source-never-checkout')
 remote=git('ls-remote','--exit-code','origin','refs/heads/main','refs/pull/1044/head').decode('ascii').splitlines();need(len(remote)==2 and all(re.fullmatch('[a-f0-9]{40}\trefs/(?:heads/main|pull/1044/head)',line)for line in remote),'exact-two-remote-public-source-refs');refs={ref:revision for revision,ref in(line.split('\t')for line in remote)};need(refs=={'refs/heads/main':TARGET,'refs/pull/1044/head':HEAD},'remote-main-and-pr-head-still-exact-without-fetch')
 git('cat-file','-e',HEAD+'^{commit}');git('cat-file','-e',TARGET+'^{commit}')
 need(git('rev-parse','refs/remotes/origin/pr1044-reviewed-head').decode().strip()==HEAD,'fetched-pr1044-head-equals-reviewed-commit')
 need(git('rev-parse','origin/main').decode().strip()==TARGET and git('rev-parse',TARGET+'^{tree}').decode().strip()==TREE,'exact-protected-main-target-and-tree')
 need(git('rev-parse',BASE+':'+APP).decode().strip()==git('rev-parse',PREVIOUS_FRONTEND+':'+APP).decode().strip()==SOURCE_APP_TREE,'logical-base-app-equals-last-accepted-frontend')
 need(git('rev-parse',TARGET+':'+APP).decode().strip()==git('rev-parse',HEAD+':'+APP).decode().strip()==APP_TREE,'exact-independently-reviewed-and-merged-app-tree')
 changed={p.decode()for p in git('diff','--name-only','-z',BASE,TARGET,'--',APP).split(b'\0')if p}
 need(REVIEWED_PATHS and len(REVIEWED_PATHS)==len(set(REVIEWED_PATHS))and changed=={APP+'/'+p for p in REVIEWED_PATHS}and all(p.startswith('web/')and p.endswith(('.ts','.tsx','.css','.html','.md'))for p in REVIEWED_PATHS),'exact-reviewed-web-only-changed-paths')
 for name in('src','db','seed','Dockerfile','.dockerignore','web/package.json','web/package-lock.json'):
  need(git('rev-parse',BACKEND_REVISION+':'+APP+'/'+name)==git('rev-parse',TARGET+':'+APP+'/'+name),'unchanged-entire-backend-db-seed-build-and-dependencies')


def local_build_contract():
 path=pathlib.Path(__file__).with_name(LOCAL_BUILD_PROVENANCE_NAME)
 need(pin(EXPECTED_NEW_MANIFEST_SHA256)and pin(EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256)and path.is_file()and not path.is_symlink()and path.stat().st_size<=1024**2,'reviewed-fresh-local-build-provenance-required-before-any-build')
 body=path.read_bytes();need(sha(body)==EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256,'exact-reviewed-fresh-local-build-provenance-bytes');value=json.loads(body)
 need(type(value)is dict and all(value.get(k)==v for k,v in[('sourceHead',HEAD),('appTree',APP_TREE),('newManifestSHA256',EXPECTED_NEW_MANIFEST_SHA256),('VITE_BASE_PATH','/indo-shipping/'),('sourceExtraction','git-archive'),('freshExtraction',True),('freshNpmCi',True),('npmCiExitCode',0),('buildExitCode',0),('nodeModulesRootSymlink',False),('nodeModulesExternalSymlinks',0)]),'fresh-source-real-npm-ci-build-and-no-external-node-modules-contract')
 need(EXPECTED_NEW_MANIFEST and sha(enc(EXPECTED_NEW_MANIFEST))==EXPECTED_NEW_MANIFEST_SHA256,'sealed-complete-reviewed-local-build-graph')
 return value

def prepare():
 prof=profile();provenance=local_build_contract();m,diagnosis=failure_artifacts();r,rows=inventory();need(rows==prof['allRuntime']==diagnosis['allRuntime'],'unchanged-all-forty-six-runtime-baseline');preserved=host_files();need(preserved=={k:prof[k]for k in('shared','unstaged','staged')},'same-host-shared-and-unknown-dirty-inventory');protection=maintenance();ensure_small_capacity('prepare-before')
 need(image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE and image_id(ADOPTED_FRONTEND_TAG)==ADOPTED_FRONTEND_IMAGE and image_id(ADOPTED_CANDIDATE_TAG)==ADOPTED_CANDIDATE_IMAGE,'exact-alias-and-two-existing-adopted-images')
 old,old_records=public_tree('old-wwwroot',m);new,new_records=public_tree('prepared-wwwroot',m);need(len(old)==372 and len(new)==60 and new==EXPECTED_NEW_MANIFEST and live_static(r)==old=={n:v['sha256']for n,v in prof['wwwroot']['files'].items()},'complete-old372-new60-and-live-old-public-byte-graphs');templates=preserve_templates(FAILED_ROOT/'old-wwwroot',FAILED_ROOT/'prepared-wwwroot',old);additions=static_plan(old,new)
 base_image=json.loads(P.command(['docker','image','inspect',STATIC_BASE_IMAGE]))[0];candidate=json.loads(P.command(['docker','image','inspect',ADOPTED_CANDIDATE_IMAGE]))[0];front=json.loads(P.command(['docker','image','inspect',ADOPTED_FRONTEND_IMAGE]))[0];need(sha(enc(candidate['Config']))==diagnosis['candidateImages'][ADOPTED_CANDIDATE_TAG]['configSHA256']and sha(enc(front['Config']))==diagnosis['candidateImages'][ADOPTED_FRONTEND_TAG]['configSHA256'],'both-adopted-image-full-configs-exact-readonly-observation');derivative_contract(base_image,candidate)
 scratch=scratch_create(ADOPTED_FRONTEND_IMAGE)
 try:raw_graph=frontend_static(scratch)
 finally:scratch_remove(scratch,ADOPTED_FRONTEND_IMAGE)
 need(raw_graph==new,'actual-never-started-frontend-image-full-sixty-file-graph')
 for image,expected in((STATIC_BASE_IMAGE,old),(ADOPTED_CANDIDATE_IMAGE,dict(old,**new))):
  scratch=scratch_create(image)
  try:actual=scratch_static(scratch)
  finally:scratch_remove(scratch,image)
  need(actual==expected,'actual-durable-image-complete-static-byte-graph')
 original=backend_proof(r['Id']);need(all(original['fileSHA256'][n]==prof['backendFiles'][n]['sha256']for n in original['fileSHA256'])and backend_proof(STATIC_BASE_IMAGE,True)==original and backend_proof(ADOPTED_CANDIDATE_IMAGE,True)==original,'actual-live-base-and-candidate-dll-pdb-705-schema-seed-proofs')
 old_meta=index_metadata(r['Id']);need(new_records['index.html']['bytes']==old_meta['size']==882,'equal-entry-length-for-original-cache-contract');status,headers,body=http();need(status==200 and sha(body)==old['index.html'],'old-public-index-still-exact');old_headers={k.lower():v for k,v in headers.items()if k.lower()in('etag','last-modified')};need(set(old_headers)=={'etag','last-modified'},'both-old-cache-validators')
 p={'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'runtime':rows,'container':r['Id'],'hostFiles':preserved,'maintenance':protection,'oldManifest':old,'newManifest':new,'newAssets':additions,'oldHeaders':old_headers,'oldIndexMetadata':old_meta,'templateProofs':templates,'oldProof':original,'durableTag':ADOPTED_CANDIDATE_TAG,'durableImage':ADOPTED_CANDIDATE_IMAGE,'composeTagBefore':STATIC_BASE_IMAGE,'oldSourceRecords':old_records,'newSourceRecords':new_records,'artifactRoot':str(FAILED_ROOT),'originalFailurePreserved':True,'failedManifestSHA256':FAILED_MANIFEST_SHA256,'diagnosisRawSHA256':DIAGNOSIS_RAW_SHA256,'frontendRawGraph':raw_graph,'localBuildProvenance':provenance,'frontendRebuilt':False,'largePublicTreesCopied':False};delta_records(p)
 _,after=inventory();target_unchanged(rows,after,r['Id']);need(host_files()==preserved and maintenance()==protection and image_id(COMPOSE_TAG)==STATIC_BASE_IMAGE and image_id(ADOPTED_CANDIDATE_TAG)==ADOPTED_CANDIDATE_IMAGE,'prepare-runtime-host-maintenance-and-alias-unchanged');need(public_tree('old-wwwroot',m)==(old,old_records)and public_tree('prepared-wwwroot',m)==(new,new_records),'original-public-artifacts-remain-byte-and-metadata-exact');failure_artifacts();ensure_small_capacity('prepare-after');private(OUT/'prepared.private.json',p)
 return{'durableImage':ADOPTED_CANDIDATE_IMAGE,'frontendImage':ADOPTED_FRONTEND_IMAGE,'runtimeNotRestarted':True,'databaseReadOrWritten':False,'frontendRebuilt':False,'largePublicTreesCopied':False,'originalFailedPrepareStillFailed':True,'newIndependentPrepare':True,'deltaBytes':DELTA_BYTES,'deltaAllocatedBound':DELTA_ALLOCATED_BOUND}

def manifest(directory):
 values=sorted(directory.rglob('*'));need(len(values)<=100000 and all(not p.is_symlink()and(p.is_file()or p.is_dir())for p in values),'regular-bounded-own-private-evidence');return{str(p.relative_to(directory)):sha(p.read_bytes())for p in values if p.is_file()}

def sealed(phase,digest):
 directory=ARCHIVE_ROOT/phase;need(pin(digest)and sha((directory/'manifest.json').read_bytes())==digest,'sealed-successful-prior-phase-manifest');actual=manifest(directory);actual.pop('manifest.json',None);actual.pop('result.private.json',None);need(actual==read(directory/'manifest.json'),'every-prior-private-evidence-byte-seal');r=read(directory/'result.private.json');inner=dict(r);inner.pop('resultSHA256',None);need(r['resultSHA256']==sha(enc(inner)),'prior-result-self-seal');need(r['success']is True and r['phase']==phase and r['base']==BASE and r['head']==HEAD and r['target']==TARGET and r['tree']==TREE and r['appTree']==APP_TREE and r['manifestSHA256']==digest,'exact-source-bound-prior-success');return directory,r

def load_prepared():
 directory,_=sealed('prepare',PREPARED_SHA256);p=read(directory/'prepared.private.json');need(all(p[k]==v for k,v in[('base',BASE),('head',HEAD),('target',TARGET),('tree',TREE),('appTree',APP_TREE),('hostBase',HOST_BASE),('artifactRoot',str(FAILED_ROOT)),('durableImage',ADOPTED_CANDIDATE_IMAGE),('failedManifestSHA256',FAILED_MANIFEST_SHA256),('diagnosisRawSHA256',DIAGNOSIS_RAW_SHA256)]),'new-independent-prepared-source-and-old-artifact-bindings');m,_=failure_artifacts();need(public_tree('old-wwwroot',m)==(p['oldManifest'],p['oldSourceRecords'])and public_tree('prepared-wwwroot',m)==(p['newManifest'],p['newSourceRecords']),'all-original-referenced-public-artifacts-still-exact');delta_records(p);return p

def stage_layout(cid,stage,p):
 rows=run(['docker','exec','--user','0',cid,'find',stage,'-xdev','-printf','%y|%P|%b\n']).decode().splitlines();directories={};files_seen={}
 for line in rows:
  fields=line.split('|');need(len(fields)==3 and fields[0]in('d','f')and fields[2].isdigit(),'regular-fixed-stage-layout-record');kind,name,blocks=fields;target=directories if kind=='d'else files_seen;need(name not in target,'unique-fixed-stage-entry');target[name]=int(blocks)*512
 expected={'old-index','new/index.html',*('new/'+n for n in p['newAssets'])};need(set(directories)=={'','new','new/assets'}and set(files_seen)==expected and len(files_seen)==33,'exact-three-directories-and-thirty-three-delta-files');need(sum(directories.values())<=16*4096 and sum(files_seen.values())<=DELTA_FILE_ALLOCATED,'actual-stage-directory-and-file-allocation-within-explicit-bound');return{'fileCount':33,'directoryCount':3,'fileAllocatedBytes':sum(files_seen.values()),'directoryAllocatedBytes':sum(directories.values())}

def deploy():
 global RECOVERY
 p=load_prepared();r,rows=inventory();target_unchanged(p['runtime'],rows,r['Id']);need(host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['composeTagBefore']and image_id(p['durableTag'])==p['durableImage'],'prepared-host-maintenance-and-alias-cas');need(live_static(r)==p['oldManifest']and backend_proof(r['Id'])==p['oldProof']and index_metadata(r['Id'])==p['oldIndexMetadata'],'actual-live-old-static-and-code-exact');records,old_record=delta_records(p);ensure_small_capacity('deploy-before')
 stage='/app/.pr1044-static-r2-'+TARGET;next_index=stage+'/new/index.html';old_index=stage+'/old-index';index_attempted=tag_attempted=False;private(OUT/'deploy.reservation',{'target':TARGET,'deltaFiles':33,'deltaBytes':DELTA_BYTES})
 try:
  run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; test ! -e "$1"; test ! -L "$1"; mkdir -m 700 "$1"; mkdir -m 700 "$1/new"; mkdir -m 700 "$1/new/assets"','_',stage])
  for name in[*p['newAssets'],'index.html']:run(['docker','cp',str(FAILED_ROOT/'prepared-wwwroot'/name),r['Id']+':'+stage+'/new/'+name])
  run(['docker','cp',str(FAILED_ROOT/'old-wwwroot/index.html'),r['Id']+':'+old_index]);paths=[stage+'/new/'+n for n in[*p['newAssets'],'index.html']]+[old_index];need(len(paths)==33 and all(not any(t in path for t in TEMPLATES)for path in paths),'only-fixed-thirty-three-delta-stage-files-no-templates')
  run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; owner=$1; shift; for f do test -f "$f"; test ! -L "$f"; chown "$owner" "$f"; chmod 644 "$f"; done','_','%d:%d'%(p['oldIndexMetadata']['uid'],p['oldIndexMetadata']['gid']),*paths]);expected={stage+'/new/'+n:p['newManifest'][n]for n in records};expected[old_index]=p['oldManifest']['index.html'];sums=run(['docker','exec','--user','0',r['Id'],'sha256sum','--',*paths]).decode().splitlines();need(len(sums)==33 and{v.split('  ',1)[1]:v.split('  ',1)[0]for v in sums}==expected,'every-staged-delta-and-old-index-byte-hash')
  stat_expected={stage+'/new/'+n:{'uid':p['oldIndexMetadata']['uid'],'gid':p['oldIndexMetadata']['gid'],'mode':0o644,'size':v['bytes'],'mtime':v['mtimeNS']//1000000000}for n,v in records.items()};stat_expected[old_index]={'uid':p['oldIndexMetadata']['uid'],'gid':p['oldIndexMetadata']['gid'],'mode':0o644,'size':old_record['bytes'],'mtime':old_record['mtimeNS']//1000000000};stage_metadata(r['Id'],paths,stat_expected);stage_layout(r['Id'],stage,p);ensure_small_capacity('all-staged');delta_records(p)
  for name in p['newAssets']:run(['docker','exec','--user','0',r['Id'],'sh','-c','set -eu; test -d /app/wwwroot/assets; test ! -L /app/wwwroot/assets; ln -- "$1" "$2"','_',stage+'/new/'+name,'/app/wwwroot/'+name])
  index_time=max(int(time.time()),p['oldIndexMetadata']['mtime']+2);need(index_time<=int(time.time())+3,'bounded-new-index-cache-time')
  while int(time.time())<index_time:time.sleep(.1)
  run(['docker','exec','--user','0',r['Id'],'touch','-d','@'+str(index_time),next_index]);stat_expected[next_index]['mtime']=index_time;stage_metadata(r['Id'],paths,stat_expected);stage_layout(r['Id'],stage,p);ensure_small_capacity('index-cas');need(remote_index(r['Id'])==p['oldManifest']['index.html']and host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['composeTagBefore'],'old-index-host-and-alias-cas-before-atomic-publish');index_attempted=True;run(['docker','exec','--user','0',r['Id'],'mv','-fT',next_index,'/app/wwwroot/index.html'])
  checks=verify_public(p);_,after=inventory();target_unchanged(rows,after,r['Id']);need(live_static(r)==dict(p['oldManifest'],**p['newManifest'])and backend_proof(r['Id'])==p['oldProof']and host_files()==p['hostFiles']and maintenance()==p['maintenance'],'entire-old-new-public-union-and-code-runtime-exact');need(image_id(COMPOSE_TAG)==p['composeTagBefore'],'canonical-alias-cas-before-tag');tag_attempted=True;run(['docker','tag',p['durableImage'],COMPOSE_TAG]);need(image_id(COMPOSE_TAG)==p['durableImage'],'durable-adopted-candidate-alias-committed');ensure_small_capacity('complete');private(OUT/'deployed.private.json',{'target':TARGET,'runtime':after,'checks':checks,'durableImage':p['durableImage'],'retainedPublicRollbackStage':stage,'deltaFiles':33,'deltaBytes':DELTA_BYTES});return{'frontendVersion':TARGET,'durableImage':p['durableImage'],'runtimeNotRestarted':True,'databaseReadOrWritten':False,'frontendRebuilt':False,'deltaFiles':33,'checks':checks}
 except BaseException:
  failure=STAGE;RECOVERY={'indexCommitAttempted':index_attempted,'tagCommitAttempted':tag_attempted,'automaticRetryOrRollbackPerformed':False,'newAssetsRetainedForInFlightClients':True}
  try:RECOVERY.update(observedIndexSHA256=remote_index(r['Id']),observedCanonicalImage=image_id(COMPOSE_TAG))
  except BaseException as e:RECOVERY.update(observationErrorType=type(e).__name__)
  private(OUT/'failed-deploy-observation.private.json',RECOVERY);globals()['STAGE']=failure;raise

def verify():
 p=load_prepared();directory,_=sealed('deploy',DEPLOY_SHA256);receipt=read(directory/'deployed.private.json');r,rows=inventory();need(rows==receipt['runtime']and host_files()==p['hostFiles']and maintenance()==p['maintenance']and image_id(COMPOSE_TAG)==p['durableImage'],'final-runtime-host-maintenance-and-durable-alias-exact');need(live_static(r)==dict(p['oldManifest'],**p['newManifest'])and backend_proof(r['Id'])==p['oldProof'],'final-whole-public-union-and-code-proof');checks=verify_public(p);ensure_small_capacity('verify-complete');return{'frontendVersion':TARGET,'durableImage':p['durableImage'],'runtimeNotRestarted':True,'databaseReadOrWritten':False,'verificationReadOnly':True,'checks':checks}

def main():
 global OUT
 need(EXECUTE is True and PHASE in('prepare','deploy','verify')and sys.argv[1:]==[PHASE]and os.environ.get('RELEASE_BRANCH')==BRANCH and os.environ.get('RELEASE_MODE')==PHASE and os.environ.get('RELEASE_ATTEMPT')=='1','inert-first-scoped-frontend-release');need(all(pin(v,40)for v in(BASE,BACKEND_REVISION,PREVIOUS_FRONTEND,SOURCE_APP_TREE,HOST_BASE,HEAD,TARGET,TREE,APP_TREE))and all(pin(v)for v in(EXPECTED_PROFILE_SHA256,EXPECTED_PROFILE_INNER_SHA256,EXPECTED_STATIC_INVENTORY_SHA256,EXPECTED_DIRTY_SHA256,EXPECTED_NEW_MANIFEST_SHA256,EXPECTED_LOCAL_BUILD_PROVENANCE_SHA256,EXPECTED_LIVE_CID))and type(LIVE_IMAGE)is str and re.fullmatch('sha256:[a-f0-9]{64}',LIVE_IMAGE)and type(STATIC_BASE_IMAGE)is str and re.fullmatch('sha256:[a-f0-9]{64}',STATIC_BASE_IMAGE)and REVIEWED_PATHS and EXPECTED_NEW_MANIFEST and sha(enc(EXPECTED_NEW_MANIFEST))==EXPECTED_NEW_MANIFEST_SHA256 and(PHASE=='prepare'or pin(PREPARED_SHA256))and(PHASE!='verify'or pin(DEPLOY_SHA256)),'all-source-profile-build-and-prior-phase-bindings-before-any-side-effect');os.umask(0o077);need(ARCHIVE_ROOT.parent.is_dir()and not any(p.is_symlink()for p in(ARCHIVE_ROOT.parent,*ARCHIVE_ROOT.parent.parents)),'fixed-real-backup-parent');ARCHIVE_ROOT.mkdir(mode=0o700,exist_ok=True);need(not ARCHIVE_ROOT.is_symlink()and stat.S_IMODE(ARCHIVE_ROOT.stat().st_mode)==0o700,'own-private-release-archive');OUT=ARCHIVE_ROOT/PHASE;need(not OUT.exists()and not OUT.is_symlink(),'one-phase-attempt-only');OUT.mkdir(mode=0o700)
 result={'phase':PHASE,'mode':PHASE,'service':SERVICE,'base':BASE,'head':HEAD,'target':TARGET,'tree':TREE,'appTree':APP_TREE,'hostBase':HOST_BASE,'success':False,'hostSourceCheckoutPerformed':False,'databaseReadOrWritten':False}
 try:initialize();ensure_small_capacity('phase-entry');source_check();result.update({'prepare':prepare,'deploy':deploy,'verify':verify}[PHASE]());result['success']=True
 except Exception as e:result.update(errorType=type(e).__name__,stage=STAGE,noAutomaticRetry=True,recovery=RECOVERY)
 result['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();private(OUT/'manifest.json',manifest(OUT));result['manifestSHA256']=sha((OUT/'manifest.json').read_bytes());result['resultSHA256']=sha(enc(result));private(OUT/'result.private.json',result);wire(result);return 0 if result['success']else 1

def wire(v):
 raw=enc(v);need(len(raw)<=4*1024**2,'bounded-numeric-phase-receipt');nib=lambda x:[int(c,16)for c in(format(x,'x')if type(x)is int else x)];parts=[raw[i:i+1024]for i in range(0,len(raw),1024)];digest=nib(sha(raw))
 for i,b in enumerate(parts):print(enc([0,nib(i+1),nib(len(parts)),nib(len(raw)),digest,nib(b.hex())]).decode(),flush=True)
 print(enc([1,nib(len(parts)),nib(len(raw)),digest]).decode(),flush=True)

def evidence_usage():
 total=allocated=entries=0
 for path in [OUT,*sorted(OUT.rglob('*'))]:
  need(not path.is_symlink()and(path.is_file()or path.is_dir()),'only-regular-own-small-evidence');entries+=1;need(entries<=10000,'bounded-own-evidence-entry-count');s=path.stat();allocated+=s.st_blocks*512
  if path.is_file():total+=s.st_size
 return{'bytes':total,'allocatedBytes':allocated,'entries':entries}


def ensure_small_capacity(label):
 global SERIAL
 need(label in('phase-entry','prepare-before','prepare-after','deploy-before','all-staged','index-cas','complete','verify-complete'),'fixed-small-write-capacity-boundary');docker_root=json.loads(P.command(['docker','info','--format','{{json .DockerRootDir}}']));need(type(docker_root)is str and pathlib.Path(docker_root).is_absolute(),'actual-docker-root');docker_root=pathlib.Path(docker_root);values={}
 for name,path in(('archive',OUT),('docker',docker_root)):
  s=os.statvfs(path);unit=s.f_frsize;need(type(unit)is int and 0<unit<=4096 and 4096%unit==0,'actual-allocation-unit-covered-by-four-kib-bound');values[name]={'available':s.f_bavail*unit,'free':s.f_bfree*unit,'fragmentSize':unit,'device':path.stat().st_dev};need(values[name]['available']>=ORDINARY_REQUIRED and values[name]['free']>=PHYSICAL_REQUIRED,'explicit-no-build-small-write-byte-budget')
 usage=evidence_usage();need(usage['allocatedBytes']<=EVIDENCE_BUDGET,'actual-small-evidence-budget');SERIAL+=1;v={'boundary':label,'filesystems':values,'sameDevice':values['archive']['device']==values['docker']['device'],'eachFilesystemIndependentlyBudgeted':True,'ordinaryRequired':ORDINARY_REQUIRED,'physicalRequired':PHYSICAL_REQUIRED,'evidenceBudget':EVIDENCE_BUDGET,'ordinaryReserve':ORDINARY_RESERVE,'twoDeltaAllocatedBound':2*DELTA_ALLOCATED_BOUND,'evidenceActual':usage};private(OUT/('%06d-small-capacity.private.json'%SERIAL),v);return v


def sealed_artifact(path,digest,limit=4*1024**2):
 need(path.is_file()and not any(p.is_symlink()for p in(path,*path.parents)),'fixed-selected-artifact-no-symlink');meta=P.record(path,limit);need(meta['sha256']==digest,'selected-original-artifact-sha256');body=path.read_bytes();need(len(body)==meta['bytes']and sha(body)==digest and P.record(path,limit)==meta,'stable-selected-original-artifact');return body


def failure_artifacts():
 manifest_body=sealed_artifact(FAILED_ROOT/'manifest.json',FAILED_MANIFEST_SHA256,16*1024**2);m=json.loads(manifest_body);need(type(m)is dict and 0<len(m)<=100000 and all(safe_relative(n)and pin(h)for n,h in m.items()),'bounded-original-failed-manifest')
 result=read(FAILED_ROOT/'result.private.json');inner=dict(result);inner.pop('resultSHA256',None);need(result['resultSHA256']==FAILED_RESULT_INNER_SHA256==sha(enc(inner))and result['success']is False and result['phase']=='prepare'and result['stage']=='reviewed-realistic-capacity-floor'and all(result[k]==v for k,v in[('base',BASE),('head',HEAD),('target',TARGET),('tree',TREE),('appTree',APP_TREE),('hostBase',HOST_BASE),('manifestSHA256',FAILED_MANIFEST_SHA256)]),'original-failed-prepare-remains-failed-not-replayed')
 diagnosis=json.loads(sealed_artifact(DIAGNOSIS_PATH,DIAGNOSIS_RAW_SHA256));inner=dict(diagnosis);inner.pop('resultSHA256',None);need(diagnosis['resultSHA256']==DIAGNOSIS_INNER_SHA256==sha(enc(inner))and diagnosis['success']is True and diagnosis['phase']==diagnosis['mode']=='diagnose'and diagnosis['archive']['manifestSHA256']==FAILED_MANIFEST_SHA256 and diagnosis['archive']['capacityFailureLocation']=='after'and all(diagnosis['baselineComparison'][k]is True for k in('all46RuntimeExact','canonicalImageExact','liveIndexExact','publicIndexExact')),'exact-successful-readonly-after-floor-diagnosis')
 raw=json.loads(sealed_artifact(FAILED_ROOT/'frontend-raw-dist.private.json',RAW_FRONTEND_RECORD_SHA256));need(m.get('frontend-raw-dist.private.json')==RAW_FRONTEND_RECORD_SHA256 and raw['image']==ADOPTED_FRONTEND_IMAGE and raw['files']==EXPECTED_NEW_MANIFEST and sha(enc(raw['files']))==EXPECTED_NEW_MANIFEST_SHA256 and raw['missingGitProvenTemplates']==[]and raw['noCacheFrontendBuild']is True,'complete-original-fresh-sixty-file-frontend-graph')
 for name in('docker-space-before.private.json','docker-space-after.private.json','image-context/Dockerfile'):
  need(name in m,'selected-original-structure-present');sealed_artifact(FAILED_ROOT/name,m[name])
 after=json.loads(sealed_artifact(FAILED_ROOT/'docker-space-after.private.json',m['docker-space-after.private.json']));need(after['available']==164048896 and after['free']==8965345280 and after['observedOrdinarySpaceDrop']==1509920768,'exact-original-after-floor-and-growth-still-failed')
 need(not(FAILED_ROOT/'prepared.private.json').exists()and 'prepared.private.json'not in m,'failed-phase-has-no-fabricated-prepared-success')
 return m,diagnosis


def public_tree(name,m):
 need(name in('old-wwwroot','prepared-wwwroot'),'only-two-original-public-trees');root=FAILED_ROOT/name;need(root.is_dir()and not any(p.is_symlink()for p in(root,*root.parents)),'fixed-original-public-tree');actual=files(root);expected={n[len(name)+1:]:h for n,h in m.items()if n.startswith(name+'/')};need(actual==expected,'every-selected-public-artifact-seal-and-no-extra-files');records={n:P.record(root/n)for n in actual};need(all(records[n]['sha256']==h for n,h in actual.items()),'all-public-source-file-hash-size-owner-mode-mtime-stable');return actual,records


def frontend_static(cid):
 raw=P.command(['docker','cp',cid+':/src/web/dist/.','-'],limit=260*1024**2);result={};total=0;seen=set()
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:')as archive:
  for member in archive:
   name=member.name.rstrip('/')
   if name in('.','dist'):need(member.isdir(),'frontend-public-root-directory');continue
   if name.startswith('./'):name=name[2:]
   if name.startswith('dist/'):name=name[5:]
   need(safe_relative(name)and name not in seen and(member.isdir()or member.isfile()),'safe-regular-frontend-image-public-tar');seen.add(name)
   if member.isdir():continue
   total+=member.size;need(0<=member.size<=64*1024**2 and total<=256*1024**2 and len(result)<1000,'bounded-memory-only-frontend-tar');body=archive.extractfile(member).read();need(len(body)==member.size,'complete-memory-frontend-file');result[name]=sha(body)
 need('index.html'in result,'frontend-image-index-present');return result


def delta_records(p):
 names=[*p['newAssets'],'index.html'];need(len(p['newAssets'])==31 and len(names)==32 and len(set(names))==32 and all(n.startswith('assets/')and pathlib.PurePosixPath(n).parent.as_posix()=='assets'for n in p['newAssets']),'exact-thirty-one-flat-new-assets-and-new-index')
 records={n:P.record(FAILED_ROOT/'prepared-wwwroot'/n)for n in names};need(all(records[n]==p['newSourceRecords'][n]and records[n]['sha256']==p['newManifest'][n]for n in names),'every-delta-source-size-owner-mode-mtime-and-hash-before-copy');old=P.record(FAILED_ROOT/'old-wwwroot/index.html');need(old==p['oldSourceRecords']['index.html'],'old-index-source-exact-before-copy');total=sum(v['bytes']for v in records.values())+old['bytes'];blocks=sum(((v['bytes']+4095)//4096)*4096 for v in[*records.values(),old]);need(total==DELTA_BYTES and blocks==DELTA_FILE_ALLOCATED and blocks+16*4096==DELTA_ALLOCATED_BOUND,'exact-thirty-three-file-byte-and-sixteen-directory-block-budget');return records,old


def stage_metadata(cid,paths,expected):
 raw=run(['docker','exec','--user','0',cid,'stat','-c','%u|%g|%a|%s|%Y','--',*paths]).decode().splitlines();need(len(raw)==len(paths),'all-thirty-three-stage-stat-rows')
 for path,line in zip(paths,raw):
  need(re.fullmatch('[0-9]+[|][0-9]+[|][0-7]+[|][0-9]+[|][0-9]+',line),'typed-stage-owner-mode-size-mtime');uid,gid,mode,size,mtime=line.split('|');wanted=expected[path];need({'uid':int(uid),'gid':int(gid),'mode':int(mode,8),'size':int(size),'mtime':int(mtime)}==wanted,'each-staged-file-exact-size-owner-mode-and-mtime')

if __name__=='__main__':sys.exit(main())

