"""INERT one-shot read-only observer of an existing failed diagnosis. No account mutation."""
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys

EXECUTE = False
BRANCH = 'refs/heads/codex/ops-engineering-admin-access-20261103'
SCOPE_SHA256 = '156c0b41ead9816ff65b8caf904c865512a5e3fe5b3ddd7a6d6473dfa123aa50'
BASE = pathlib.Path('/opt/rr-portal/deploy/backups/engineering-admin-access-1-20261103')
SOURCE = BASE / 'diagnose-attempt1/container-result.private.json'


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()


def require(value):
    if not value:
        raise RuntimeError('observer_refused')


def selected_failure(value):
    require(type(value) is dict)
    fields = ('success', 'errorType', 'errorCode', 'stage', 'mutationOutcome', 'updateCount')
    result = {key: value[key] for key in fields if key in value}
    require(result.get('success') is False)
    for key in ('errorType', 'errorCode', 'stage'):
        if key in result:
            require(type(result[key]) is str and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}', result[key]))
    require(result.get('mutationOutcome') in ('rolled_back', 'not_attempted'))
    if 'updateCount' in result:
        require(type(result['updateCount']) is int and result['updateCount'] == 0)
    return result


def read_private(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 1024**2)
        return json.loads(stream.read())


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(encode(value))
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def command(args, limit=16 * 1024**2):
    run = subprocess.run(args, capture_output=True, timeout=35)
    require(run.returncode == 0 and len(run.stdout) <= limit and len(run.stderr) <= 1024**2)
    return run.stdout


def runtime_profile():
    ids = command(['docker', 'ps', '-aq', '--no-trunc']).decode().split()
    require(len(ids) == len(set(ids)) == 46)
    rows = json.loads(command(['docker', 'inspect', *ids]))
    require({r['Id'] for r in rows} == set(ids))
    core = [r for r in rows if (r['Config'].get('Labels') or {}).get('com.docker.compose.project') == 'rr-portal'
            and (r['Config'].get('Labels') or {}).get('com.docker.compose.service') == 'core']
    require(len(core) == 1 and core[0]['State']['Running'] is True
            and core[0]['State'].get('Health', {}).get('Status') == 'healthy')
    safe = {r['Id']: {'image': r['Image'], 'configSHA256': digest(r['Config']),
                     'hostConfigSHA256': digest(r['HostConfig']),
                     'mountsSHA256': digest(sorted(r['Mounts'], key=encode)),
                     'pid': r['State']['Pid'], 'startedAt': r['State']['StartedAt'],
                     'status': r['State']['Status'], 'running': r['State']['Running'],
                     'paused': r['State'].get('Paused'), 'restarting': r['State'].get('Restarting'),
                     'dead': r['State'].get('Dead'), 'exitCode': r['State'].get('ExitCode'),
                     'oomKilled': r['State'].get('OOMKilled'), 'restarts': r['RestartCount'],
                     'health': r['State'].get('Health', {}).get('Status')} for r in rows}
    return safe, core[0]['Id']


PROBE = r'''import asyncio,json,re,sys
async def main():
 stage='engine_import';readonly=False;c=None;tx=None
 try:
  from sqlalchemy import text
  from app.database import engine
  engine.echo=False
  stage='connect';c=await engine.connect();tx=await c.begin()
  stage='read_only';await c.execute(text('SET TRANSACTION READ ONLY'))
  readonly=(await c.execute(text('SHOW transaction_read_only'))).scalar_one()=='on'
  if not readonly:raise RuntimeError()
  await c.execute(text("SET LOCAL statement_timeout='8s'"))
  await c.execute(text("SET LOCAL lock_timeout='5s'"))
  await c.execute(text("SET LOCAL idle_in_transaction_session_timeout='30s'"))
  fp="encode(sha256(convert_to((to_jsonb(u)-ARRAY['department','permissions','updated_at'])::text,'UTF8')),'hex')"
  queries=[
   ('count_normalized_admin',"SELECT count(*) FROM public.users WHERE lower(btrim(username))=:username",{'username':'admin'}),
   ('exact_safe_target',"SELECT u.id,u.username,u.department,u.role,u.is_active,u.permissions,u.created_at,u.updated_at,"+fp+" AS fingerprint FROM public.users u WHERE u.id=:id AND u.username=:username",{'id':1,'username':'admin'}),
   ('relation_kind',"SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='users'",{}),
   ('noninternal_triggers',"SELECT t.tgname FROM pg_trigger t WHERE t.tgrelid='public.users'::regclass AND NOT t.tgisinternal ORDER BY t.tgname",{}),
   ('column_metadata',"SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position",{}),
   ('constraint_metadata',"SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.users'::regclass ORDER BY conname",{}),
   ('index_metadata',"SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='users' ORDER BY indexname",{}),
   ('rules',"SELECT rulename FROM pg_rules WHERE schemaname='public' AND tablename='users' ORDER BY rulename",{}),
   ('row_security',"SELECT relrowsecurity OR relforcerowsecurity FROM pg_class WHERE oid='public.users'::regclass",{})]
  for stage,sql,params in queries:
   result=await c.execute(text(sql),params)
   result.fetchall() # Discard all row/schema values; report no data, only statement success/failure.
  await tx.rollback();await c.close();await engine.dispose()
  print(json.dumps({'success':True,'readOnlyTransaction':True,'allProbeStatementsSucceeded':True,'rollbackCompleted':True,'rowAndSchemaValuesReturned':False}),flush=True)
  return 0
 except Exception as exc:
  original=getattr(exc,'orig',None)
  safeclass=lambda x:type(x).__name__ if x is not None and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}',type(x).__name__) else None
  state=getattr(original,'sqlstate',None) if original is not None else getattr(exc,'sqlstate',None)
  if type(state)is not str or not re.fullmatch('[0-9A-Z]{5}',state):state=None
  rolledback=False
  if tx is not None:
   try:await tx.rollback();rolledback=True
   except Exception:pass
  if c is not None:
   try:await c.close()
   except Exception:pass
  try:await engine.dispose()
  except Exception:pass
  print(json.dumps({'success':False,'stage':stage,'errorType':safeclass(exc),'originalErrorType':safeclass(original),'sqlstate':state,'readOnlyTransaction':readonly,'rollbackCompleted':rolledback,'rowAndSchemaValuesReturned':False}),flush=True)
  return 1
sys.exit(asyncio.run(main()))
'''


def wire(value):
    raw = encode(value)
    parts = [raw[i:i+900] for i in range(0, len(raw), 900)]
    digits = lambda h: [int(x, 16) for x in h]
    number = lambda n: digits(format(n, 'x'))
    h = hashlib.sha256(raw).hexdigest()
    for i, part in enumerate(parts, 1):
        print(json.dumps([0, number(i), number(len(parts)), number(len(raw)), digits(h), digits(part.hex())], separators=(',', ':')))
    print(json.dumps([1, number(len(parts)), number(len(raw)), digits(h)], separators=(',', ':')))


def main():
    value = {'phase': 'diagnose', 'operation': 'observe_diagnose_failure', 'service': 'core',
             'success': False, 'accountWrites': False, 'configurationWrites': False,
             'lifecycleWrites': False, 'sourceWrites': False, 'automaticRetry': False,
             'scopeSHA256': SCOPE_SHA256, 'rawPasswordOrPasswordHashReturned': False}
    before = None
    directory = None
    try:
        require(EXECUTE is True and sys.argv[1:] == ['diagnose']
                and os.environ.get('RELEASE_BRANCH') == BRANCH and os.environ.get('RELEASE_MODE') == 'diagnose'
                and os.environ.get('RELEASE_ATTEMPT') == '1' and os.environ.get('ACCOUNT_SCOPE_SHA256') == SCOPE_SHA256)
        base_info = BASE.lstat()
        require(stat.S_ISDIR(base_info.st_mode) and base_info.st_uid == os.getuid()
                and stat.S_IMODE(base_info.st_mode) == 0o700)
        candidate = BASE / 'observe-diagnose-failure-attempt1'
        candidate.mkdir(mode=0o700)
        directory = candidate
        write_new(directory / 'intent.private.json', {'operation': value['operation'], 'sourceRelative': 'diagnose-attempt1/container-result.private.json', 'scopeSHA256': SCOPE_SHA256})
        before, cid = runtime_profile()
        write_new(directory / 'runtime-before.private.json', before)
        selected = selected_failure(read_private(SOURCE))
        write_new(directory / 'selected-failure.private.json', selected)
        value['savedFailure'] = selected
        value['sqlProbeAttempted'] = False
        if selected.get('errorType') == 'RuntimeBoundaryError':
            value['sqlProbeAttempted'] = True
            run = subprocess.run(['docker', 'exec', '-i', cid, 'python', '-B', '-c', PROBE],
                                 capture_output=True, timeout=100)
            require(run.returncode in (0, 1) and len(run.stdout) <= 4096 and len(run.stderr) <= 4096)
            probe = json.loads(run.stdout)
            require(set(probe) <= {'success','stage','errorType','originalErrorType','sqlstate','readOnlyTransaction','rollbackCompleted','rowAndSchemaValuesReturned','allProbeStatementsSucceeded'}
                    and probe.get('rowAndSchemaValuesReturned') is False)
            for key in ('errorType', 'originalErrorType', 'stage'):
                if probe.get(key) is not None:
                    require(type(probe[key]) is str and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}', probe[key]))
            require(probe.get('sqlstate') is None or re.fullmatch('[0-9A-Z]{5}', probe['sqlstate']))
            write_new(directory / 'sql-probe.private.json', probe)
            value['sqlProbe'] = probe
        after, cid_after = runtime_profile()
        write_new(directory / 'runtime-after.private.json', after)
        value.update(all46RuntimeUnchanged=before == after, coreRuntimeUnchanged=cid == cid_after and before[cid] == after.get(cid), runtimeSHA256=digest(after))
        require(before == after and cid == cid_after)
        value['success'] = True
    except Exception as exc:
        value['errorType'] = type(exc).__name__
        if before is not None:
            try:
                after, _ = runtime_profile()
                value['all46RuntimeUnchanged'] = before == after
            except Exception:
                value['runtimeProofUnavailable'] = True
    value['resultSHA256'] = digest(value)
    if directory is not None:
        try:
            write_new(directory / 'receipt.private.json', value)
        except Exception:
            value.pop('resultSHA256', None)
            value.update(success=False, errorType='EvidenceWriteFailure')
            value['resultSHA256'] = digest(value)
    wire(value)
    return 0 if value['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
