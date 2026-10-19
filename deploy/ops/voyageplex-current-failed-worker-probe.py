"""UNEXECUTED: exact current-seven sealed raw samples, candidate 48MiB isolated proof.

Only newly labelled disposable containers and this exclusive private archive are
written. No live container, API, environment, mailbox, business DB or old archive
is changed. Candidate overlays are fixed source bytes, not runtime mutations.
"""
import ast, collections, hashlib, json, math, os, pathlib, re, signal, stat, subprocess, threading, time
ROOT=pathlib.Path('/opt/rr-portal')
MAIN='f853c7a2ec47f3cff11e456f874218d2324ad217'
# Separate the captured source provenance from a future explicitly reviewed
# runtime head. A later unrelated deployment must never rewrite RAW provenance.
EXPECTED_RUNTIME_HEAD='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
CANDIDATE_HEAD='f753dee05d4458bab895fdacfb13f5e27a22b4a4'
IMAGE='sha256:dde9f61a68de1fcbf118c1a9011335c671dde83f0a5ee6bb36e41060f60c04b9'
API_IMAGE='sha256:67b3b5aa27964341342ff0b3f67433a6297ae5a39278dcaeb3f43f5f1dfa7abd'
PROBE_PIN_FROZEN=True
OUTPUT=ROOT/'deploy/backups/voyageplex-current-failed-worker-probe-20261019'
RAW_INPUTS=OUTPUT/'raw-inputs';FIXTURES=OUTPUT/'fixture'
LABEL='com.rr-portal.diagnostic=voyageplex-current-seven-worker-20261019'
VARIANTS=('current-seven-48m',)
LIB_COMMIT='c94ea2e93f6ea81e24d409a188ff6fed31b35b07'
LIB_SHA='59cec17eb70984e9b3b628c3c461f01cbf3358c1ffc46fe1c9a761a8c0d4b5ac'
APP='apps/船务部/VoyagePlex船务协同系统/services/email-parser/app/'
RAW_ARCHIVE=ROOT/'deploy/backups/voyageplex-current-failed-raw-20261019'
RAW_RESULT_SHA='f9576931cf8a0c9332b940ff0412c597d612aa529332c5c62479856bec002650'
RAW_SEAL_SHA='11e7cac28ab24486eb3a3f453eae0bd714ee6e565ac5ebcbdc1fb32c801fe13f'
RAW_EXPECTED={0:(2,10460380,'56e50d5ae5859ae1b3e2c8b20406e97c53763c818677a067b99e6572831057c5'),1:(2,46195009,'dc89d06c03d074099bd8872af6b593f6776167d7cd01d7878f4ae742b661af3e'),2:(3,10460380,'56e50d5ae5859ae1b3e2c8b20406e97c53763c818677a067b99e6572831057c5'),3:(3,4672127,'6fc846054a20f2377eca19b57a49ef2b97cb247f409ad9f09b3487890f09f892'),4:(3,46195009,'dc89d06c03d074099bd8872af6b593f6776167d7cd01d7878f4ae742b661af3e'),5:(5,10460380,'56e50d5ae5859ae1b3e2c8b20406e97c53763c818677a067b99e6572831057c5'),6:(5,46195009,'dc89d06c03d074099bd8872af6b593f6776167d7cd01d7878f4ae742b661af3e')}
CANDIDATE_APP_PATHS={'mail_worker.py':'deploy/ops/voyageplex-current-worker-candidate-mail-worker.py','mailbox.py':'deploy/ops/voyageplex-current-worker-candidate-mailbox.py'}
BASE_APP_SHA={'__init__.py': '3f5a2cf489561fc9222935999781b8276588a9ad87fce22aa0513c52beb9aef8', 'attachments.py': '6a89728651cc4bb94d91ff44d92aef5a8fa0df32e034139584db7ee6a1e40bfb', 'carrier_schedule.py': 'ea912722b8583f54a8f01bba725a1102a7ce1ac760ed0211d9a0598de642aea6', 'destination_country.py': 'a0f37fb06787c387e0c080167b1f26f434253ca2f862e199438d5f2b504efd2d', 'eml.py': '72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28', 'factory-mappings.json': '09e982b6a30bdeb44fe96ec90013aa09a42492632ed7fd3cb2dfeedf7b0cbbd9', 'factory_mapping.py': '95bf73bd2bedf0c811b1861d4dc8f846f1031351361e3c377eb64c415e8233bb', 'factory_workbook.py': '5abfac2c34798bb7184a41efb1387bbe26be275bea4e2d8ceec853737a473723', 'huadeng_export.py': 'ff18f2f8348299ed3bd8b53da4a27428add61aa619280f48f4521348102b37c5', 'huadeng_forms.py': '5a88cc39fdad2eaf439993aa0b3803bf18ff84fe13537c3a9edaac5fd52201b9', 'inventory_writeback.py': '3bba37883628930d577ba83c735c6008ff0eee69bcfccab7c1af1c9e460292d9', 'mail_worker.py': 'ad1f81f485198261b5625e1f96b7017644624dd80ba65d4011f65ac558b21d7e', 'mailbox.py': '4707664cb2a158c76f5df639972b3d7c475cead0f1297d0b8c52b125dbed267e', 'main.py': 'a77bada52192c5d66a9709bb4363bb96dbce869e922f70b8a59d3ff67da7d7f5', 'multi_container.py': 'cf73e324da061d57325bca2b61467b2b5c9df894d05e90a0e528c83ac4ee97b0', 'parsing_policy.py': '7c43e394f2a28a8b07807d4952db33699d0ae8be9080ba6e23b755650926d509', 'product_brand.py': 'e555acb447e3770fc2c394b477719c023db8c54bc247118ad6e93817fe9e3304', 'product_workbook.py': '059b21360bca7fbabd9e48602ff22a6ee73bfd854d5f7e534c9d571d82190b5a', 'readonly_workbook.py': '76a8da4c34a6a8f04fa95e6e86cb38cbe1a618c9ef82f9bcadf4a726e7006602', 'rules.py': '0815a26b28f64d685063d8785a3158b4c2ed8a44345dda55bceb11551269b91f', 'shipment_export.py': '4f6dceaafd7de7089eba0b73fdf02fc675f49a3bda9a1cc675235ebbcb21aad4', 'sky_castle_export.py': 'ed3aa662064aa9162ed73f40888a1e0f4e9c8a2ea2d99720275405fdbda419f6', 'spreadsheets.py': '173eb4fc2fa82519834f5f74958e1df900933ecccde4b21f4879284341dd5d89', 'warehouse_name.py': 'a016ddfa2d9f70fa9d9053613181c6757092488d7af71d2732d3b91472d3dfa4'}
CANDIDATE_APP_SHA={'__init__.py': '3f5a2cf489561fc9222935999781b8276588a9ad87fce22aa0513c52beb9aef8', 'attachments.py': '6a89728651cc4bb94d91ff44d92aef5a8fa0df32e034139584db7ee6a1e40bfb', 'carrier_schedule.py': 'ea912722b8583f54a8f01bba725a1102a7ce1ac760ed0211d9a0598de642aea6', 'destination_country.py': 'a0f37fb06787c387e0c080167b1f26f434253ca2f862e199438d5f2b504efd2d', 'eml.py': '72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28', 'factory-mappings.json': '09e982b6a30bdeb44fe96ec90013aa09a42492632ed7fd3cb2dfeedf7b0cbbd9', 'factory_mapping.py': '95bf73bd2bedf0c811b1861d4dc8f846f1031351361e3c377eb64c415e8233bb', 'factory_workbook.py': '5abfac2c34798bb7184a41efb1387bbe26be275bea4e2d8ceec853737a473723', 'huadeng_export.py': 'ff18f2f8348299ed3bd8b53da4a27428add61aa619280f48f4521348102b37c5', 'huadeng_forms.py': '5a88cc39fdad2eaf439993aa0b3803bf18ff84fe13537c3a9edaac5fd52201b9', 'inventory_writeback.py': '3bba37883628930d577ba83c735c6008ff0eee69bcfccab7c1af1c9e460292d9', 'mail_worker.py': 'bef93230f3edc46951a2a4b3fa11294c2f05f5eee763dc09cf8bb8120b8d5399', 'mailbox.py': 'cd067755cc66c497008458ea558443b8770d2ce4e0cc40ad2b484fb608372d74', 'main.py': 'a77bada52192c5d66a9709bb4363bb96dbce869e922f70b8a59d3ff67da7d7f5', 'multi_container.py': 'cf73e324da061d57325bca2b61467b2b5c9df894d05e90a0e528c83ac4ee97b0', 'parsing_policy.py': '7c43e394f2a28a8b07807d4952db33699d0ae8be9080ba6e23b755650926d509', 'product_brand.py': 'e555acb447e3770fc2c394b477719c023db8c54bc247118ad6e93817fe9e3304', 'product_workbook.py': '059b21360bca7fbabd9e48602ff22a6ee73bfd854d5f7e534c9d571d82190b5a', 'readonly_workbook.py': '76a8da4c34a6a8f04fa95e6e86cb38cbe1a618c9ef82f9bcadf4a726e7006602', 'rules.py': '0815a26b28f64d685063d8785a3158b4c2ed8a44345dda55bceb11551269b91f', 'shipment_export.py': '4f6dceaafd7de7089eba0b73fdf02fc675f49a3bda9a1cc675235ebbcb21aad4', 'sky_castle_export.py': 'ed3aa662064aa9162ed73f40888a1e0f4e9c8a2ea2d99720275405fdbda419f6', 'spreadsheets.py': '173eb4fc2fa82519834f5f74958e1df900933ecccde4b21f4879284341dd5d89', 'warehouse_name.py': 'a016ddfa2d9f70fa9d9053613181c6757092488d7af71d2732d3b91472d3dfa4'}
CANDIDATE_MANIFEST_SHA='c41c293e47b3b69a8b87176b7e0e8306ae1b7fd8be0a49ffd47c3b6618c947fb'
END=None

FIXTURE = r'''

"""Disposable fixture only: no real credentials or database paths."""
import collections, contextlib, hashlib, json, os, pathlib, re, resource, sys, threading, time, urllib.request
os.umask(0o077)
sys.path.insert(0,'/app')
KINDS={'metadata','message_size','body_read','parse_memory','parse_timeout','parse_result_size','parse_process','parse_cancelled'}
TYPES={'MemoryError','TimeoutError','ValueError','OSError','RuntimeError','ImportError','ModuleNotFoundError','KeyError','TypeError','BadZipFile','XMLSyntaxError','ParseError','FileNotFoundError','CalledProcessError','Other'}
SUFFIXES={'.xlsx','.xlsm','.xls','.pdf','.docx','.png','.jpg','.jpeg','.zip','.eml','other'}
STAGES={'import-main','mail-pipeline','mime','attachment','workbook-read-only','workbook-full','workbook-other','parse-complete','zip-central-directory','excel-read-strings','excel-stylesheet','excel-value-styles','excel-workbook','excel-worksheets'}
MODES={'read-only','full','other'}
READER_STAGES={'excel-read-strings','excel-stylesheet','excel-value-styles','excel-workbook','excel-worksheets'}
ZIP_CLASSES={'styles','sharedStrings','worksheets','media','other'}
EXPECTED={'__init__.py': '3f5a2cf489561fc9222935999781b8276588a9ad87fce22aa0513c52beb9aef8', 'attachments.py': '6a89728651cc4bb94d91ff44d92aef5a8fa0df32e034139584db7ee6a1e40bfb', 'carrier_schedule.py': 'ea912722b8583f54a8f01bba725a1102a7ce1ac760ed0211d9a0598de642aea6', 'destination_country.py': 'a0f37fb06787c387e0c080167b1f26f434253ca2f862e199438d5f2b504efd2d', 'eml.py': '72a1d04812db00f8ba78a8ce5deb9ac49e60b89cadd81a8f8f44cf8eb94aca28', 'factory-mappings.json': '09e982b6a30bdeb44fe96ec90013aa09a42492632ed7fd3cb2dfeedf7b0cbbd9', 'factory_mapping.py': '95bf73bd2bedf0c811b1861d4dc8f846f1031351361e3c377eb64c415e8233bb', 'factory_workbook.py': '5abfac2c34798bb7184a41efb1387bbe26be275bea4e2d8ceec853737a473723', 'huadeng_export.py': 'ff18f2f8348299ed3bd8b53da4a27428add61aa619280f48f4521348102b37c5', 'huadeng_forms.py': '5a88cc39fdad2eaf439993aa0b3803bf18ff84fe13537c3a9edaac5fd52201b9', 'inventory_writeback.py': '3bba37883628930d577ba83c735c6008ff0eee69bcfccab7c1af1c9e460292d9', 'mail_worker.py': 'bef93230f3edc46951a2a4b3fa11294c2f05f5eee763dc09cf8bb8120b8d5399', 'mailbox.py': 'cd067755cc66c497008458ea558443b8770d2ce4e0cc40ad2b484fb608372d74', 'main.py': 'a77bada52192c5d66a9709bb4363bb96dbce869e922f70b8a59d3ff67da7d7f5', 'multi_container.py': 'cf73e324da061d57325bca2b61467b2b5c9df894d05e90a0e528c83ac4ee97b0', 'parsing_policy.py': '7c43e394f2a28a8b07807d4952db33699d0ae8be9080ba6e23b755650926d509', 'product_brand.py': 'e555acb447e3770fc2c394b477719c023db8c54bc247118ad6e93817fe9e3304', 'product_workbook.py': '059b21360bca7fbabd9e48602ff22a6ee73bfd854d5f7e534c9d571d82190b5a', 'readonly_workbook.py': '76a8da4c34a6a8f04fa95e6e86cb38cbe1a618c9ef82f9bcadf4a726e7006602', 'rules.py': '0815a26b28f64d685063d8785a3158b4c2ed8a44345dda55bceb11551269b91f', 'shipment_export.py': '4f6dceaafd7de7089eba0b73fdf02fc675f49a3bda9a1cc675235ebbcb21aad4', 'sky_castle_export.py': 'ed3aa662064aa9162ed73f40888a1e0f4e9c8a2ea2d99720275405fdbda419f6', 'spreadsheets.py': '173eb4fc2fa82519834f5f74958e1df900933ecccde4b21f4879284341dd5d89', 'warehouse_name.py': 'a016ddfa2d9f70fa9d9053613181c6757092488d7af71d2732d3b91472d3dfa4'}

def rss():
 for line in pathlib.Path('/proc/self/status').read_text().splitlines():
  if line.startswith('VmRSS:'):return int(line.split()[1])
 return None

def peak():
 for path in ['/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory/memory.max_usage_in_bytes']:
  try:
   value=pathlib.Path(path).read_text().strip()
   if value.isdigit():return int(value)
  except OSError:pass
 return None

def processes():
 return sum(1 for path in pathlib.Path('/proc').iterdir() if path.name.isdigit() and int(path.name)!=os.getpid())

def kind(error):
 value=type(error).__name__
 return value if value in TYPES else 'Other'

def worker(round_index,company,filename):
 import app.mail_worker as module
 if module.WORKER_ADDRESS_SPACE!=320*1024*1024 or module.MAX_RAW_BYTES!=48*1024*1024 or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
 original=module._parse
 def observed(raw,name,company):
  observation={'lastComponentStage':'import-main','componentRSSPeaksKiB':{},'attachmentAttempts':0,'attachmentFailures':0,
    'exceptionTypes':{},'suffixCounts':{},'workbookLoadModeCounts':{},'workbookExceptionTypeCounts':{},'topExceptionType':None,'readerStageCalls':{},'readerStageFailures':{},'zipCentralDirectoryClasses':{},
    'componentExclusiveWallSeconds':{},'failureFunctionCounts':{},'zipCentralDirectoryClassificationComplete':True,'zipCentralDirectoryMembersSeen':0,'zipCentralDirectoryArchivesClassified':0}
  reserve=bytearray(65536);stage_clock=time.monotonic()
  def checkpoint():
   # Atomic, safe-only breadcrumbs survive SIGXCPU/worker death. No mail values.
   try:
    observation['parseChildMaxRSSKiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    path=pathlib.Path('/tmp/worker-observation-%d.json'%round_index);temporary=path.with_suffix('.tmp')
    with temporary.open('w') as out:json.dump(observation,out,separators=(',',':'))
    temporary.replace(path)
   except BaseException:pass
  def stage(value):
   nonlocal stage_clock
   now=time.monotonic();prior=observation['lastComponentStage'];times=observation['componentExclusiveWallSeconds']
   times[prior]=round(times.get(prior,0)+max(0,now-stage_clock),6);stage_clock=now
   observation['lastComponentStage']=value
   current=rss()
   if current is not None:observation['componentRSSPeaksKiB'][value]=max(current,observation['componentRSSPeaksKiB'].get(value,0))
   checkpoint()
  def exception(error,function='mail-parse'):
   bucket=observation['failureFunctionCounts'].setdefault(function,{});token=kind(error);bucket[token]=bucket.get(token,0)+1
   token=kind(error);observation['exceptionTypes'][token]=observation['exceptionTypes'].get(token,0)+1
  try:
   stage('import-main');import app.main as main
   import openpyxl
   import openpyxl.reader.excel as excel
   import app.readonly_workbook as values
   parse_mime=main.parse_eml;parse_attachment=main.parse_attachment;load=openpyxl.load_workbook
   def mime(*args,**kwargs):
    stage('mime')
    try:value=parse_mime(*args,**kwargs)
    except BaseException as error:exception(error,'mime');raise
    else:stage('mail-pipeline');return value
    finally:
     current=rss()
     if current is not None:observation['componentRSSPeaksKiB']['mime']=max(current,observation['componentRSSPeaksKiB'].get('mime',0))
   def attachment(path,name):
    stage('attachment');observation['attachmentAttempts']+=1
    suffix=pathlib.Path(name).suffix.lower();suffix=suffix if suffix in SUFFIXES else 'other'
    observation['suffixCounts'][suffix]=observation['suffixCounts'].get(suffix,0)+1
    try:value=parse_attachment(path,name)
    except BaseException as error:observation['attachmentFailures']+=1;exception(error,'attachment');raise
    else:stage('mail-pipeline');return value
   def workbook(*args,**kwargs):
    readonly=kwargs.get('read_only',False);mode='read-only' if readonly is True else 'full' if readonly is False else 'other'
    prior=observation['lastComponentStage'];stage('workbook-'+mode)
    observation['workbookLoadModeCounts'][mode]=observation['workbookLoadModeCounts'].get(mode,0)+1
    try:value=load(*args,**kwargs)
    except BaseException as error:
     buckets=observation['workbookExceptionTypeCounts'].setdefault(mode,{})
     token=kind(error);buckets[token]=buckets.get(token,0)+1;exception(error,'workbook');raise
    else:stage(prior);return value
   def classify_zip(reader):
    if getattr(reader,'_voyageplex_diag_zip_seen',False):return
    prior=observation['lastComponentStage'];stage('zip-central-directory')
    try:
     reader._voyageplex_diag_zip_seen=True
     for info in reader.archive.filelist:
      if observation['zipCentralDirectoryMembersSeen']>=20000:
       observation['zipCentralDirectoryClassificationComplete']=False;break
      observation['zipCentralDirectoryMembersSeen']+=1
      member=info.filename
      bucket='styles' if member=='xl/styles.xml' else 'sharedStrings' if member=='xl/sharedStrings.xml' else 'worksheets' if re.fullmatch(r'xl/worksheets/[^/]+\.xml',member) else 'media' if member.startswith('xl/media/') else 'other'
      if type(info.compress_size) is not int or type(info.file_size) is not int or not 0<=info.compress_size<=2**63-1 or not 0<=info.file_size<=2**63-1:
       observation['zipCentralDirectoryClassificationComplete']=False;continue
      total=observation['zipCentralDirectoryClasses'].setdefault(bucket,{'members':0,'compressedBytes':0,'declaredUncompressedBytes':0})
      total['members']+=1;total['compressedBytes']+=info.compress_size;total['declaredUncompressedBytes']+=info.file_size
     observation['zipCentralDirectoryArchivesClassified']+=1
    except BaseException:observation['zipCentralDirectoryClassificationComplete']=False
    finally:stage(prior)
   def instrument_reader(name,call,classify=False):
    def wrapped(*args,**kwargs):
     if classify:classify_zip(args[0])
     prior=observation['lastComponentStage'];counts=observation['readerStageCalls'];counts[name]=counts.get(name,0)+1;stage(name)
     try:value=call(*args,**kwargs)
     except BaseException as error:
      tokens=observation['readerStageFailures'].setdefault(name,{})
      token=kind(error);tokens[token]=tokens.get(token,0)+1;exception(error,name);raise
     else:stage(prior);return value
    return wrapped
   excel.ExcelReader.read_strings=instrument_reader('excel-read-strings',excel.ExcelReader.read_strings,True)
   excel.ExcelReader.read_workbook=instrument_reader('excel-workbook',excel.ExcelReader.read_workbook,True)
   excel.ExcelReader.read_worksheets=instrument_reader('excel-worksheets',excel.ExcelReader.read_worksheets,True)
   excel.apply_stylesheet=instrument_reader('excel-stylesheet',excel.apply_stylesheet)
   # The callsites import load_values_workbook aliases. Observe the candidate's
   # class read method itself, so every real invocation is counted despite aliases.
   values_read=values._ValuesExcelReader.read
   def value_workbook(reader,*args,**kwargs):
    prior=observation['lastComponentStage'];stage('workbook-read-only')
    observation['workbookLoadModeCounts']['read-only']=observation['workbookLoadModeCounts'].get('read-only',0)+1
    try:value=values_read(reader,*args,**kwargs)
    except BaseException as error:
     buckets=observation['workbookExceptionTypeCounts'].setdefault('read-only',{})
     token=kind(error);buckets[token]=buckets.get(token,0)+1;exception(error,'values-workbook');raise
    else:stage(prior);return value
   values._ValuesExcelReader.read=value_workbook
   values._read_value_styles=instrument_reader('excel-value-styles',values._read_value_styles)
   main.parse_eml=mime;main.parse_attachment=attachment;openpyxl.load_workbook=workbook
   stage('mail-pipeline');value=original(raw,name,company);stage('parse-complete');return value
  except BaseException as error:
   observation['topExceptionType']=kind(error);exception(error,'mail-parse');raise
  finally:
   del reserve
   stage(observation['lastComponentStage']);checkpoint()
 module._parse=observed
 raw=sys.stdin.buffer.read(module.MAX_RAW_BYTES+1)
 value=module.failed(filename,'parse_memory') if len(raw)>module.MAX_RAW_BYTES else module.supervise(raw,filename,company)
 print(json.dumps(value,ensure_ascii=True,separators=(',',':')),flush=True)

def observation(round_index):
 path=pathlib.Path('/tmp/worker-observation-%d.json'%round_index)
 try:
  if path.stat().st_size>16384:raise ValueError()
  value=json.loads(path.read_text())
 except (OSError,ValueError):return {'observationAvailable':False}
 def counts(value,allowed):
  return {key:number for key,number in value.items() if key in allowed and type(number) is int and number>=0} if isinstance(value,dict) else {}
 return {'observationAvailable':True,'lastComponentStage':value.get('lastComponentStage') if value.get('lastComponentStage') in STAGES else 'other',
  'componentRSSPeaksKiB':counts(value.get('componentRSSPeaksKiB'),STAGES),
  'attachmentAttempts':max(0,int(value.get('attachmentAttempts',0))),'attachmentFailures':max(0,int(value.get('attachmentFailures',0))),
  'safeExceptionTypes':counts(value.get('exceptionTypes'),TYPES),'attachmentSuffixCounts':counts(value.get('suffixCounts'),SUFFIXES),
  'workbookLoadModeCounts':counts(value.get('workbookLoadModeCounts'),MODES),
  'workbookExceptionTypeCounts':{mode:counts(bucket,TYPES) for mode,bucket in value.get('workbookExceptionTypeCounts',{}).items() if mode in MODES},
  'topExceptionType':value.get('topExceptionType') if value.get('topExceptionType') in TYPES else None,
  'parseChildMaxRSSKiB':max(0,int(value.get('parseChildMaxRSSKiB',0))),
  'componentExclusiveWallSeconds':{key:round(number,6) for key,number in value.get('componentExclusiveWallSeconds',{}).items() if key in STAGES and type(number) in (int,float) and 0<=number<300},
  'failureFunctionCounts':{key:counts(bucket,TYPES) for key,bucket in value.get('failureFunctionCounts',{}).items() if key in {'mail-parse','mime','attachment','workbook','values-workbook'}|READER_STAGES},
  'readerStageCalls':counts(value.get('readerStageCalls'),READER_STAGES),
  'readerStageFailures':{name:counts(bucket,TYPES) for name,bucket in value.get('readerStageFailures',{}).items() if name in READER_STAGES},
  'zipCentralDirectoryClasses':{name:counts(bucket,{'members','compressedBytes','declaredUncompressedBytes'}) for name,bucket in value.get('zipCentralDirectoryClasses',{}).items() if name in ZIP_CLASSES},
  'zipCentralDirectoryClassificationComplete':value.get('zipCentralDirectoryClassificationComplete') is True,
  'zipCentralDirectoryMembersSeen':max(0,int(value.get('zipCentralDirectoryMembersSeen',0))),
  'zipCentralDirectoryArchivesClassified':max(0,int(value.get('zipCentralDirectoryArchivesClassified',0))),
  'zipSizesAreDeclaredMetadataOnly':True}

def driver():
 started=time.monotonic();payload=json.load(sys.stdin);name=payload['rawName'];digest=payload['rawSHA256']
 if payload.get('budget')!=320 or not re.fullmatch('mail-[a-f0-9]{32}\\.eml',name) or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError()
 variant=payload.get('variant')
 if variant!='current-seven-48m':raise ValueError()
 expected=EXPECTED
 sample=pathlib.Path('/samples')/name
 if sample.is_symlink() or not 0<sample.stat().st_size<=48*1024*1024:raise ValueError()
 raw=sample.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError()
 if any(hashlib.sha256((pathlib.Path('/app/app')/key).read_bytes()).hexdigest()!=value for key,value in expected.items()):raise ValueError()
 with open(os.devnull,'w') as null,contextlib.redirect_stdout(null),contextlib.redirect_stderr(null):
  import app.main as production_main
  import app.mail_worker as module
  import app.mailbox as mailbox
  import uvicorn
  if production_main.parse_isolated is not module.parse_isolated or module.WORKER_ADDRESS_SPACE!=320*1024*1024 or module.MAX_RAW_BYTES!=48*1024*1024 or mailbox.MAX_MESSAGE_BYTES!=48*1024*1024 or mailbox.MAX_BATCH_BYTES!=48*1024*1024 or module.WORKER_SECONDS!=18 or module.MAX_RESULT_BYTES!=1024*1024:raise ValueError()
  batch=bytearray(48*1024*1024)
  for offset in range(0,len(batch),4096):batch[offset]=1
  touched=sum(batch[offset] for offset in range(0,len(batch),4096));parent_loaded=rss()
  config=uvicorn.Config(production_main.app,host='127.0.0.1',port=18894,loop='asyncio',lifespan='off',access_log=False,log_config=None,log_level='critical')
  server=uvicorn.Server(config);server_thread=threading.Thread(target=server.run,daemon=True)
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));health_stop=threading.Event();health=[];rounds=[]
  def health_once():
   start=time.monotonic();passed=False
   try:
    with opener.open('http://127.0.0.1:18894/health',timeout=1) as response:
     passed=response.status==200 and json.loads(response.read(1024)).get('status')=='ok'
   except Exception:pass
   return (passed,round(time.monotonic()-start,4))
  def health_loop():
   while not health_stop.is_set():health.append(health_once());health_stop.wait(.2)
  health_thread=threading.Thread(target=health_loop,daemon=True)
  server_thread.start()
  try:
   ready=time.monotonic()+5
   while time.monotonic()<ready:
    if health_once()[0]:break
    time.sleep(.05)
   else:raise ValueError()
   health_thread.start()
   for round_index in [1,2]:
    before=rss();case_started=time.monotonic()
    module.WORKER_COMMAND=[sys.executable,'/diag/fixture.py','worker',str(round_index)]
    diagnostic_failure=False
    try:result=production_main.parse_isolated(raw,'diagnostic.eml','Huadeng',threading.Event(),time.monotonic()+30)
    except Exception:result={};diagnostic_failure=True
    status=result.get('status');failure=result.get('failure_kind');items=result.get('items');attachments=result.get('attachments')
    rounds.append({'diagnosticFailure':diagnostic_failure,'round':round_index,'status':status if status in {'parsed','failed'} else 'other','failureKind':failure if failure in KINDS else 'other',
     'allBusinessAttachmentsUnparseable':result.get('error')=='邮件中的业务附件均无法解析',
     'attachmentsCount':len(attachments) if isinstance(attachments,list) else None,'itemsCount':len(items) if isinstance(items,list) else 0,
     'wallSeconds':round(time.monotonic()-case_started,3),'parentRSSBeforeKiB':before,'parentRSSAfterKiB':rss(),
     'reapedChildrenMaxRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'otherProcessesAfterCleanup':processes(),**observation(round_index)})
    del result
   module.WORKER_COMMAND=[sys.executable,'/diag/fixture.py','worker','3']
   normal=production_main.parse_isolated(b'From: fixture@example.invalid\r\nSubject: Synthetic health fixture\r\n\r\nSynthetic normal message.','diagnostic.eml','Huadeng',threading.Event(),time.monotonic()+30)
   next_normal=normal.get('status')=='parsed';del normal
   final_health=health_once()[0]
  finally:
   health_stop.set()
   if health_thread.is_alive():health_thread.join(timeout=3)
   server.should_exit=True;server_thread.join(timeout=5)
  output={'variant':variant,'fullProductionMainImported':True,'syntheticBatchBytes':len(batch),'syntheticPagesTouched':touched,
   'syntheticBatchRetainedThroughoutBothRounds':touched==12288 and sum(batch[offset] for offset in range(0,len(batch),4096))==12288,
   'actualRawBytesRetainedAdditionally':len(raw),'parentLoadedRSSKiB':parent_loaded,'rounds':rounds,
   'parentFinalRSSKiB':rss(),'maxParentRSSKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'cgroupPeakBytesInside':peak(),
   'workerAddressSpaceMiB':320,'productionTimeAndResultLimitsUnchanged':True,'nextNormalEmailParsed':next_normal,
   'nextHealthPassed':final_health,'healthSamples':len(health),'healthFailures':sum(not item[0] for item in health),
   'maxHealthLatencySeconds':max((item[1] for item in health),default=None),'otherProcessesAfterFinalCleanup':processes(),
   'ownHealthServerStopped':not server_thread.is_alive(),'wallSeconds':round(time.monotonic()-started,3)}
 print(json.dumps(output,separators=(',',':'),ensure_ascii=True),flush=True)

if __name__=='__main__':
 try:
  if sys.argv[1:2]==['worker']:
   round_index=int(sys.argv[2]);company,filename=sys.argv[3:]
   if round_index not in {1,2,3} or company!='Huadeng' or filename!='diagnostic.eml':raise ValueError()
   worker(round_index,company,filename)
  elif sys.argv[1:]==['driver']:driver()
  else:raise ValueError()
 except BaseException:
  print('{"status":"failed","failureKind":"diagnostic_fixture"}',flush=True)
  raise SystemExit(1)


'''

def library():
    result=subprocess.run(['git','-C',str(ROOT),'show',LIB_COMMIT+':deploy/ops/voyageplex-mail-recovery.py'],
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    if result.returncode or len(result.stdout)>262144 or hashlib.sha256(result.stdout).hexdigest()!=LIB_SHA:
        raise ValueError()
    lib={'__name__':'reviewed_recovery_library'};exec(compile(result.stdout,'reviewed-helper','exec'),lib);return lib

def require(value,code='CURRENT_RAW_WORKER_PROBE_BOUND'):
    if not value or END is not None and time.monotonic()>=END:raise ValueError(code)

def digest(path):
    require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode));value=hashlib.sha256()
    with path.open('rb') as stream:
        while True:
            require(True);block=stream.read(1048576)
            if not block:break
            value.update(block)
    return value.hexdigest()

def runtime(lib):
    require(lib['command'](['git','-C',str(ROOT),'rev-parse','HEAD'],seconds=4,cap=128).decode().strip()==EXPECTED_RUNTIME_HEAD,'FIXED_REVIEWED_RUNTIME_REQUIRED')
    result={};template='{"id":{{json .Id}},"image":{{json .Image}},"name":{{json .Name}},"running":{{json .State.Running}},"restarts":{{.RestartCount}},"oomKilled":{{json .State.OOMKilled}}}'
    for kind,image in [('api',API_IMAGE),('parser',IMAGE)]:
        name='rr-portal-voyageplex-'+kind+'-1';value=json.loads(lib['command'](['docker','inspect','--format',template,name],seconds=4,cap=2048))
        require(set(value)=={'id','image','name','running','restarts','oomKilled'} and value['image']==image and value['name']=='/'+name and re.fullmatch('[a-f0-9]{64}',value['id']) is not None and value['running'] is True and type(value['restarts']) is int and value['oomKilled'] is False,'FIXED_CURRENT_SERVICE_IMAGE_AND_ID')
        result[kind]=value
    code='import hashlib,json,pathlib;names='+repr(sorted(BASE_APP_SHA))+';print(json.dumps({n:hashlib.sha256((pathlib.Path("/app/app")/n).read_bytes()).hexdigest() for n in names},sort_keys=True))'
    hashes=json.loads(lib['command'](['docker','exec',result['parser']['id'],'python','-c',code],seconds=6,cap=8192))
    require(hashes==BASE_APP_SHA,'EXACT_ALL_DEPLOYED_PARSER_APP_BYTES')
    return result

def guards(lib):
    require(PROBE_PIN_FROZEN and re.fullmatch('[a-f0-9]{64}',RAW_RESULT_SHA) is not None and re.fullmatch('[a-f0-9]{64}',RAW_SEAL_SHA) is not None,'PROBE_GATE_AND_EXACT_RAW_RECEIPTS_REQUIRED')
    require(digest(RAW_ARCHIVE/'first-result.json')==RAW_RESULT_SHA and digest(RAW_ARCHIVE/'seal.json')==RAW_SEAL_SHA,'EXACT_SEALED_CURRENT_SEVEN_RAW_RECEIPT')
    lib['verify_seal'](RAW_ARCHIVE)
    return runtime(lib)

def make_fixtures(lib):
    require(set(CANDIDATE_APP_PATHS)=={'mail_worker.py','mailbox.py'} and {name for name in BASE_APP_SHA if BASE_APP_SHA[name]!=CANDIDATE_APP_SHA[name]}==set(CANDIDATE_APP_PATHS))
    staged={}
    for name,path in CANDIDATE_APP_PATHS.items():
        data=lib['command'](['git','-C',str(ROOT),'show',os.environ['MAILDIAG_REF']+':'+path],seconds=8,cap=131072)
        require(hashlib.sha256(data).hexdigest()==CANDIDATE_APP_SHA[name],'EXACT_CANDIDATE_SOURCE_BYTES');staged[name]=data
    manifest=lib['command'](['git','-C',str(ROOT),'show',os.environ['MAILDIAG_REF']+':deploy/ops/voyageplex-current-worker-candidate-source.json'],seconds=8,cap=16384)
    require(hashlib.sha256(manifest).hexdigest()==CANDIDATE_MANIFEST_SHA,'EXACT_CANDIDATE_MANIFEST')
    parsed=json.loads(manifest);require(parsed['baselineHead']==MAIN and parsed['candidateHead']==CANDIDATE_HEAD and parsed['candidateAppSHA256']==CANDIDATE_APP_SHA and parsed['baselineAppSHA256']==BASE_APP_SHA)
    declaration=next(node.value for node in ast.parse(FIXTURE).body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='EXPECTED' for target in node.targets))
    require(ast.literal_eval(declaration)==CANDIDATE_APP_SHA,'PARENT_CHILD_ALL_SOURCE_PINS_AGREE')
    for name,data in [('fixture.py',FIXTURE.encode()),*staged.items()]:
        with (FIXTURES/name).open('xb') as out:out.write(data);out.flush();os.fsync(out.fileno())
        (FIXTURES/name).chmod(0o600)
    lib['write_new'](OUTPUT/'candidate-sources.private.json',parsed)

def samples(lib):
    result=lib['read_json'](RAW_ARCHIVE/'first-result.json');items=lib['read_json'](RAW_ARCHIVE/'item-map.private.json');sealed=lib['read_json'](RAW_ARCHIVE/'seal.json')
    require(result.get('source')==MAIN and all(result.get(k) is True for k in ['completed','runtimeAndPriorEvidenceAndRowsUnchanged','readOnly']) and all(result.get(k) is False for k in ['businessWrites','APIOrSyncCalls','mailboxFlagsChanged','authorizationCodesPrintedOrSaved','oldEvidenceWrites']) and result.get('completeRawPayloads')==7 and result.get('distinctCompleteRawPayloads')==3,'EXACT_COMPLETE_READONLY_RAW_CAPTURE')
    require(isinstance(items,list) and len(items)==7 and isinstance(result.get('items'),list) and len(result['items'])==7)
    by_slot={row.get('slot'):row for row in result['items']};require(set(by_slot)==set(RAW_EXPECTED) and {item.get('slot')for item in items}==set(RAW_EXPECTED))
    RAW_INPUTS.mkdir(mode=0o700);chosen={};seen_names=set()
    for item in items:
        slot=item['slot'];row=by_slot[slot];owner,size,sha=RAW_EXPECTED[slot];name=item.get('rawName')
        require(type(slot)is int and item.get('owner')==owner and row.get('owner')==owner and item.get('rawSHA256')==sha and row.get('rawSHA256')==sha and isinstance(name,str) and re.fullmatch(r'mail-[a-f0-9]{32}\.eml',name) is not None and name not in seen_names,'EXACT_RAW_SLOT_OWNER_AND_DIGEST');seen_names.add(name)
        require(type(row.get('actualRawBytes'))is int and row['actualRawBytes']==size and 0<size<=48*1024**2 and row.get('sizeDifference') in (0,-2) and row.get('declaredSize')==item.get('declaredSize')==size-row['sizeDifference'] and row.get('failureKind')==item.get('failureKind') and all(row.get(k)is True for k in ['completeLiteralAndFraming','metadataInstantAndDateMatch','privateCopySaved']),'EXACT_RAW_COMPLETENESS_AND_SIZE')
        require(row.get('sourceFingerprintMatchesRaw') is (True if item.get('sourceFingerprint') else None))
        if item.get('sourceFingerprint'):require(item['sourceFingerprint'].lower()==sha)
        path=RAW_ARCHIVE/name;require(sealed.get(name)==sha and not path.is_symlink() and path.is_file() and path.stat().st_size==size and path.stat().st_mode&0o777==0o600 and digest(path)==sha,'SEALED_PRIVATE_RAW_BYTES_REQUIRED')
        if sha not in chosen:
            target=RAW_INPUTS/name
            with path.open('rb') as source,target.open('xb') as out:
                while True:
                    require(True);block=source.read(1048576)
                    if not block:break
                    out.write(block)
                out.flush();os.fsync(out.fileno())
            target.chmod(0o600);require(digest(target)==sha)
            chosen[sha]={'rawName':name,'rawSHA256':sha,'rawBytes':size,'equivalentSourceSamples':0,'sourceSlots':[],'originCounts':{'current-seven':0}}
        chosen[sha]['equivalentSourceSamples']+=1;chosen[sha]['sourceSlots'].append(slot);chosen[sha]['originCounts']['current-seven']+=1
    require(len(chosen)==3 and sum(x['equivalentSourceSamples']for x in chosen.values())==7,'ALL_SEVEN_THREE_UNIQUE_RAW_SELECTION')
    return list(chosen.values()),7

def inspect_owned(lib,cid,name):
    template='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"label":{{json (index .Config.Labels "com.rr-portal.diagnostic")}},"caseLabel":{{json (index .Config.Labels "com.rr-portal.case")}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{.State.ExitCode}},"hostPid":{{.State.Pid}},"memory":{{.HostConfig.Memory}},"memorySwap":{{.HostConfig.MemorySwap}},"nanoCpus":{{.HostConfig.NanoCpus}},"pidsLimit":{{.HostConfig.PidsLimit}},"network":{{json .HostConfig.NetworkMode}}}'
    value=json.loads(lib['command'](['docker','inspect','--format',template,cid],seconds=4,cap=8192))
    lib['require'](value.get('id')==cid and value.get('name')=='/'+name and value.get('label')=='voyageplex-current-seven-worker-20261019' and
        value.get('caseLabel')==name.split('20261019-',1)[1] and value.get('image')==IMAGE and value.get('memory')==512*1024**2 and value.get('memorySwap')==512*1024**2 and value.get('nanoCpus')==2000000000 and value.get('pidsLimit')==128 and value.get('network')=='none',
        'OWN_EXACT_512_NO_SWAP_DIAGNOSTIC_CONTAINER_ONLY')
    return value

def cgroup_sample(pid,cid):
    # Resolve only our exact created CID; never enumerate or print host paths.
    if type(pid) is not int or pid<=0:return None
    proc=pathlib.Path('/proc')/str(pid)/'cgroup'
    if proc.stat().st_size>16384:return None
    for line in proc.read_text()[:16384].splitlines():
        version,controllers,relative=line.split(':',2)
        if not re.fullmatch('/(?:system.slice/)?docker-'+cid+r'\.scope|/docker/'+cid,relative):continue
        v2=version=='0' and controllers==''
        if not v2 and 'memory' not in controllers.split(','):continue
        base=pathlib.Path('/sys/fs/cgroup')/('' if v2 else 'memory')/relative.lstrip('/')
        names={'current':'memory.current','peak':'memory.peak','limit':'memory.max'} if v2 else {'current':'memory.usage_in_bytes','peak':'memory.max_usage_in_bytes','limit':'memory.limit_in_bytes'}
        value={'version':2 if v2 else 1}
        for key,name in names.items():
            try:
                raw=(base/name).read_text().strip()
                if re.fullmatch('[0-9]{1,20}',raw):value[key]=int(raw)
            except OSError:pass
        if v2:
            try:
                for row in (base/'memory.events').read_text().splitlines():
                    key,number=row.split()
                    if key in {'low','high','max','oom','oom_kill','oom_group_kill'} and number.isdigit():value[key]=int(number)
            except OSError:pass
        return value
    return None

def run_case(lib,sample,index,variant):
    lib['require'](variant in VARIANTS,'FIXED_CANDIDATE_VARIANT_REQUIRED')
    name='rr-voyageplex-currentseven48-20261019-%s-s%d'%(variant,index);cid=None;started=time.monotonic();stop=threading.Event();monitor=None
    readings=[];result={'variant':variant,'sampleIndex':index,'workerAddressSpaceMiB':320,'sourceOriginCounts':sample['originCounts'],
            'equivalentSourceSamples':sample['equivalentSourceSamples'],'completed':False,'cleanupVerified':False}
    def sample_memory():
        while not stop.is_set():
            try:
                state=inspect_owned(lib,cid,name)
                reading=cgroup_sample(state.get('hostPid'),cid) if state.get('running') else None
                if reading is not None:readings.append(reading)
            except Exception:pass
            stop.wait(.1)
    try:
        candidate_overlays=[]
        for filename in CANDIDATE_APP_PATHS:
            candidate_overlays.extend(['--mount','type=bind,src='+str(FIXTURES/filename)+',dst=/app/app/'+filename+',readonly'])
        cid=lib['command'](['docker','create','-i','--name',name,'--label',LABEL,'--label','com.rr-portal.case='+variant+'-s'+str(index),'--network','none',
             '--memory','512m','--memory-swap','512m','--pids-limit','128','--cpus','2',
             '--cap-drop','ALL','--security-opt','no-new-privileges',
             '--mount','type=bind,src='+str(RAW_INPUTS)+',dst=/samples,readonly',
             '--mount','type=bind,src='+str(FIXTURES)+',dst=/diag,readonly',
             *candidate_overlays,'--entrypoint','python',IMAGE,'/diag/fixture.py','driver'],seconds=10,cap=128).decode().strip()
        lib['require'](re.fullmatch('[a-f0-9]{64}',cid) is not None,'CREATED_DIAGNOSTIC_ID_REQUIRED')
        lib['write_new'](OUTPUT/('container-%s-%d.private.json'%(variant,index)),{'id':cid,'name':name,'image':IMAGE,'variant':variant})
        inspect_owned(lib,cid,name);monitor=threading.Thread(target=sample_memory,daemon=True);monitor.start()
        remaining=120-(time.monotonic()-started)-14;lib['require'](remaining>0,'CASE_DEADLINE')
        value=json.loads(lib['command'](['docker','start','-ai',cid],seconds=remaining,cap=16384,stdin=lib['encoded']({**sample,'budget':320,'variant':variant})))
        allowed={'variant','fullProductionMainImported','syntheticBatchBytes','syntheticPagesTouched','syntheticBatchRetainedThroughoutBothRounds',
                 'actualRawBytesRetainedAdditionally','parentLoadedRSSKiB','rounds','parentFinalRSSKiB','maxParentRSSKiB',
                 'cgroupPeakBytesInside','workerAddressSpaceMiB','productionTimeAndResultLimitsUnchanged','wallSeconds',
                 'nextNormalEmailParsed','nextHealthPassed','healthSamples','healthFailures','maxHealthLatencySeconds',
                 'otherProcessesAfterFinalCleanup','ownHealthServerStopped'}
        lib['require'](isinstance(value,dict) and set(value)==allowed and len(value['rounds'])==2,'SAFE_FULL_PARENT_SUMMARY_SHAPE')
        lib['require'](value['variant']==variant and value['workerAddressSpaceMiB']==320 and value['syntheticBatchBytes']==48*1024*1024 and
            value['productionTimeAndResultLimitsUnchanged'] is True,'EXACT_CANDIDATE_RESOURCE_SCENARIO_REQUIRED')
        value=safe_summary(value,sample)
        result.update({'summary':value,'completed':True})
    except Exception:
        result['safeFailure']='FULL_PARENT_ISOLATED_CASE_DID_NOT_COMPLETE'
    finally:
        stop.set()
        if monitor:monitor.join(timeout=5)
        result['hostCgroupMemory']={'samples':len(readings),'version':readings[-1]['version'] if readings else None,
            'maxSampledCurrentBytes':max((r.get('current',0) for r in readings),default=None),
            'kernelPeakBytes':max((r['peak'] for r in readings if 'peak' in r),default=None),
            'limitBytes':readings[-1].get('limit') if readings else None,
            'oomEvents':max((r['oom'] for r in readings if 'oom' in r),default=None),'oomKillEvents':max((r['oom_kill'] for r in readings if 'oom_kill' in r),default=None)}
        try:
            list_owned=['docker','ps','-a','--no-trunc','--filter','label='+LABEL,'--filter','name=^/'+name+'$','--format','{{.ID}}']
            if not cid or re.fullmatch('[a-f0-9]{64}',cid) is None:
                possible=lib['command'](list_owned,seconds=4,cap=256).decode().split()
                lib['require'](len(possible)<=1 and all(re.fullmatch('[a-f0-9]{64}',value) for value in possible),'UNIQUE_OWN_CREATED_CONTAINER_REQUIRED')
                cid=possible[0] if possible else None
                if cid is None:result['cleanupVerified']=True
            if cid:
                state=inspect_owned(lib,cid,name);result['containerState']={key:state[key] for key in ['running','oomKilled','exitCode']}
                lib['command'](['docker','rm','-f',cid],seconds=6,cap=256)
                result['cleanupVerified']=lib['command'](list_owned,seconds=4,cap=256).strip()==b''
        except Exception:
            result['cleanupVerified']=False;result['safeFailure']='OWNED_DIAGNOSTIC_CLEANUP_NOT_CONFIRMED'
        result['caseWallSeconds']=round(time.monotonic()-started,3)
    return result


def safe_summary(value,sample):
    # Every string-bearing nested shape is closed; parsed filenames, cargo values,
    # error text and stacks can never become host output through this boundary.
    # Read only literal allowlists from our frozen fixture. Do not execute it on
    # the host or import production modules to validate a safe summary.
    tree={node.targets[0].id:ast.literal_eval(node.value) for node in ast.parse(FIXTURE).body if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in {'STAGES','TYPES','READER_STAGES','SUFFIXES','MODES','ZIP_CLASSES','KINDS'}}
    stages=tree['STAGES'];types=tree['TYPES'];readers=tree['READER_STAGES'];suffixes=tree['SUFFIXES'];modes=tree['MODES'];zipclasses=tree['ZIP_CLASSES']
    functions={'mail-parse','mime','attachment','workbook','values-workbook'}|readers
    def number(value,real=False):return type(value) in ((int,float)if real else (int,)) and math.isfinite(value) and 0<=value<2**63
    def counts(value,allowed,real=False):
        require(isinstance(value,dict)and set(value)<=allowed and all(number(x,real)for x in value.values()),'SAFE_NUMERIC_BUCKETS');return value
    def nested(value,allowed,inner):
        require(isinstance(value,dict)and set(value)<=allowed)
        for row in value.values():counts(row,inner)
    require(value['actualRawBytesRetainedAdditionally']==sample['rawBytes'] and value['syntheticPagesTouched']==12288 and value['fullProductionMainImported'] is True and value['syntheticBatchRetainedThroughoutBothRounds'] is True)
    for key in ['nextNormalEmailParsed','nextHealthPassed','ownHealthServerStopped']:require(type(value[key])is bool)
    for key,row in value.items():
        if key in {'variant','rounds','fullProductionMainImported','syntheticBatchRetainedThroughoutBothRounds','productionTimeAndResultLimitsUnchanged','nextNormalEmailParsed','nextHealthPassed','ownHealthServerStopped'}:continue
        require(row is None or number(row,True),'SAFE_TOP_RESOURCE_NUMBER')
    required={'diagnosticFailure','round','status','failureKind','allBusinessAttachmentsUnparseable','attachmentsCount','itemsCount','wallSeconds','parentRSSBeforeKiB','parentRSSAfterKiB','reapedChildrenMaxRSSKiB','otherProcessesAfterCleanup','observationAvailable'}
    extra={'lastComponentStage','componentRSSPeaksKiB','attachmentAttempts','attachmentFailures','safeExceptionTypes','attachmentSuffixCounts','workbookLoadModeCounts','workbookExceptionTypeCounts','topExceptionType','parseChildMaxRSSKiB','readerStageCalls','readerStageFailures','zipCentralDirectoryClasses','zipCentralDirectoryClassificationComplete','zipCentralDirectoryMembersSeen','zipCentralDirectoryArchivesClassified','zipSizesAreDeclaredMetadataOnly','componentExclusiveWallSeconds','failureFunctionCounts'}
    for index,row in enumerate(value['rounds'],1):
        require(isinstance(row,dict)and required<=set(row)and set(row)<=required|extra and row['round']==index and row['status']in {'parsed','failed','other'}and row['failureKind']in tree['KINDS']|{'other'})
        for key in ['diagnosticFailure','allBusinessAttachmentsUnparseable','observationAvailable']:require(type(row[key])is bool)
        for key in ['attachmentsCount','itemsCount','wallSeconds','parentRSSBeforeKiB','parentRSSAfterKiB','reapedChildrenMaxRSSKiB','otherProcessesAfterCleanup']:require(row[key] is None or number(row[key],True))
        if row['observationAvailable']:
            require(extra<=set(row)and row['lastComponentStage']in stages|{'other'}and row['topExceptionType']in types|{None})
            for key in ['zipCentralDirectoryClassificationComplete','zipSizesAreDeclaredMetadataOnly']:require(type(row[key])is bool)
            for key in ['attachmentAttempts','attachmentFailures','parseChildMaxRSSKiB','zipCentralDirectoryMembersSeen','zipCentralDirectoryArchivesClassified']:require(number(row[key]))
            for key,allowed,real in [('componentRSSPeaksKiB',stages,False),('componentExclusiveWallSeconds',stages,True),('safeExceptionTypes',types,False),('attachmentSuffixCounts',suffixes,False),('workbookLoadModeCounts',modes,False),('readerStageCalls',readers,False)]:counts(row[key],allowed,real)
            nested(row['workbookExceptionTypeCounts'],modes,types);nested(row['readerStageFailures'],readers,types);nested(row['failureFunctionCounts'],functions,types);nested(row['zipCentralDirectoryClasses'],zipclasses,{'members','compressedBytes','declaredUncompressedBytes'})
        else:require(set(row)==required)
    return value

def case_passed(row):
    value=row.get('summary',{});rounds=value.get('rounds',[]);state=row.get('containerState',{});memory=row.get('hostCgroupMemory',{})
    return row.get('completed')is True and row.get('cleanupVerified')is True and state.get('oomKilled')is False and state.get('exitCode')==0 and memory.get('samples',0)>0 and memory.get('limitBytes')==512*1024**2 and memory.get('oomEvents')==0 and memory.get('oomKillEvents')==0 and value.get('nextNormalEmailParsed')is True and value.get('nextHealthPassed')is True and value.get('healthFailures')==0 and value.get('healthSamples',0)>0 and value.get('otherProcessesAfterFinalCleanup')==0 and value.get('ownHealthServerStopped')is True and len(rounds)==2 and all(x.get('status')=='parsed' and x.get('diagnosticFailure')is False and x.get('observationAvailable')is True and x.get('attachmentFailures')==0 and x.get('otherProcessesAfterCleanup')==0 for x in rounds)

def main():
    global END
    END=time.monotonic()+18*60
    require(os.environ.get('MAILDIAG_BRANCH')=='refs/heads/ops/voyageplex-maildiag-20261019'and os.environ.get('MAILDIAG_ATTEMPT')=='1'and re.fullmatch('[a-f0-9]{40}',os.environ.get('MAILDIAG_REF',''))is not None)
    require(PROBE_PIN_FROZEN,'UNREVIEWED_PROBE_STOPS_BEFORE_GIT_OR_DOCKER')
    lib=library();lib['file_sha']=digest;lib['require']=require;before=guards(lib)
    os.umask(0o077);OUTPUT.mkdir(mode=0o700);FIXTURES.mkdir(mode=0o700)
    result={'source':MAIN,'expectedRuntimeHead':EXPECTED_RUNTIME_HEAD,'candidateHead':CANDIDATE_HEAD,'productionImageUnmodified':True,'productionLimitsUnchanged':True,'network':'none','candidateAppSHA256':CANDIDATE_APP_SHA,'overlays':list(CANDIDATE_APP_PATHS),'workerAddressSpaceMiB':320,'memoryMiB':512,'swapDisabled':True,'cpus':2,'retainedSyntheticBatchMiB':48,'rawDatabaseAndMetadataMountedIntoDocker':False,'priorResultsPreserved':False,'cases':[],'completed':False,'allSamplesParsedBothRounds':False}
    try:
        make_fixtures(lib);selected,count=samples(lib);lib['write_new'](OUTPUT/'sample-map.private.json',selected)
        result.update(originalSourceSamples=count,uniqueRawSamples=len(selected))
        for index,sample in enumerate(selected,1):
            require(time.monotonic()<END-140,'GLOBAL_CASE_RESERVATION')
            row=run_case(lib,sample,index,VARIANTS[0]);result['cases'].append(row);lib['write_new'](OUTPUT/('case-%d.json'%index),row)
        result['completed']=len(result['cases'])==len(selected) and all(row.get('completed')is True and row.get('cleanupVerified')is True for row in result['cases'])
        result['allSamplesParsedBothRounds']=result['completed'] and all(case_passed(row)for row in result['cases'])
    except Exception:result['safeFailure']='CURRENT_SEVEN_ISOLATED_PROBE_INCOMPLETE'
    finally:
        try:require(guards(lib)==before);result['priorResultsPreserved']=True
        except Exception:result['completed']=False;result['allSamplesParsedBothRounds']=False;result['safeFailure']='SOURCE_RUNTIME_OR_RAW_EVIDENCE_CHANGED'
        lib['write_new'](OUTPUT/'first-result.json',result);lib['seal'](OUTPUT);lib['emit'](result)
        lib['emit']({'kind':'receipt','resultSHA256':digest(OUTPUT/'first-result.json'),'sealSHA256':digest(OUTPUT/'seal.json')})
    return 0 if result['completed']else 1

if __name__=='__main__':
    def expired(*_):raise TimeoutError()
    signal.signal(signal.SIGALRM,expired);signal.signal(signal.SIGTERM,expired);signal.alarm(19*60)
    try:raise SystemExit(main())
    except Exception:
        print('{"failed":true,"reason":"REDACTED_CURRENT_SEVEN_WORKER_SETUP_OR_RECEIPT_FAILURE","businessWrites":false}',flush=True)
        raise SystemExit(1)
