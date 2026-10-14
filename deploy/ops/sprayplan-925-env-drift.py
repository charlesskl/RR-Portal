"""PR925 environment diagnosis: in-memory reconstruction, no writes or guard exemptions."""
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess

ROOT = pathlib.Path('/opt/rr-portal')
APP = 'apps/喷油部/喷油排期系统'
TARGET = '87844f57efe1b3387c9a18b51f4736489d01be98'
BEFORE = 'dfc6e4dd807bd5b5e8b2f1e2e883499590f5f890'
BACKUP = ROOT / 'deploy/backups/sprayplan-pre-925-20261014T135131087222Z'
SERVICES = ('sprayplan', 'sprayplan-test')
OVERRIDES = {'NODE_ENV', 'NEXT_PUBLIC_BASE_PATH', 'DOTNET_API_URL', 'DATA_PATH', 'TZ'}
PROTECTED = {'JWT_SECRET', 'JWT_ISSUER', 'Jwt__Secret', 'Jwt__Issuer', 'SPRAYPLAN_DB_PATH',
             'SPRAYPLAN_BASE_PATH', 'HOSTNAME', 'PATH', 'PWD', 'OLDPWD', 'SHLVL', '_'}
VERSION_KEYS = ('DOTNET_VERSION', 'ASPNET_VERSION')
CONFIG = ('docker-compose.cloud.yml', APP + '/Dockerfile', APP + '/docker-entrypoint.sh',
          APP + '/next.config.mjs', APP + '/prisma/schema.prisma',
          APP + '/server/SprayPlan.Api/Program.cs', APP + '/server/SprayPlan.Api/Data/AppDbContext.cs',
          APP + '/server/SprayPlan.Api/Services/JwtService.cs', APP + '/server/SprayPlan.Api/appsettings.json',
          APP + '/server/SprayPlan.Api/Features/Auth/AuthController.cs',
          APP + '/server/SprayPlan.Api/Features/Users/UsersController.cs')
CONTAINER_FORMAT = '{"containerId":{{json .Id}},"imageId":{{json .Image}},"environment":{{json .Config.Env}},"hostname":{{json .Config.Hostname}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}'
IMAGE_FORMAT = '{"imageId":{{json .Id}},"environment":{{json .Config.Env}}}'
PROCESS_READ = r"""
const fs=require('fs'),crypto=require('crypto');let result={};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
for(const id of fs.readdirSync('/proc').filter(v=>/^\d+$/.test(v))){
 let cmd;try{cmd=fs.readFileSync('/proc/'+id+'/cmdline','utf8').replace(/\0/g,' ');}
 catch(e){if(e.code==='ENOENT')continue;process.exit(4);}
 const kind=cmd.startsWith('dotnet publish/SprayPlan.Api.dll')?'api':cmd.startsWith('next-server ')?'web':null;
 if(kind){if(result[kind])process.exit(2);let env;try{env=fs.readFileSync('/proc/'+id+'/environ','utf8').split('\0').filter(Boolean).sort();}
 catch(e){process.exit(4);}
 result[kind]={environment:env,completeSha256:hash(env),withoutHostnameSha256:hash(env.filter(v=>!v.startsWith('HOSTNAME=')))};}}
if(Object.keys(result).length!==2)process.exit(3);process.stdout.write(JSON.stringify(result));
"""
FAILED = 'entrypoint'


def require(value, label):
    global FAILED
    FAILED = label
    if not value:
        raise RuntimeError('PR925_ENVIRONMENT_DIAGNOSIS_FAILED')


def command(args, label):
    global FAILED
    FAILED = label
    value = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=15, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'})
    require(value.returncode == 0 and len(value.stdout) <= 1024**2, label)
    return value.stdout


def read_file(path, private=False):
    metadata = path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_size <= 8 * 1024**2,
            'boundedRegularReadOnlyFile')
    require(not private or stat.S_IMODE(metadata.st_mode) & 0o077 == 0, 'privateBaselineFile')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= 8 * 1024**2
                and (metadata.st_dev, metadata.st_ino) == (before.st_dev, before.st_ino)
                and (not private or stat.S_IMODE(before.st_mode) & 0o077 == 0), 'openedReadOnlyFileIdentity')
        content = source.read(before.st_size + 1)
        after = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and len(content) == before.st_size
                and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'readOnlyFileStable')
        return content


def sha(content):
    return hashlib.sha256(content).hexdigest()


def valid_hash(value, image=False):
    return isinstance(value, str) and re.fullmatch(('sha256:' if image else '') + '[a-f0-9]{64}', value) is not None


def env_map(rows):
    require(isinstance(rows, list) and len(rows) <= 1000, 'boundedEnvironmentArray')
    result = {}
    for row in rows:
        require(isinstance(row, str) and '=' in row and len(row.encode('utf-8')) <= 65536,
                'validEnvironmentEntry')
        key, value = row.split('=', 1)
        require(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) is not None and key not in result
                and '\x00' not in value, 'uniqueCanonicalEnvironmentKey')
        result[key] = value
    return result


def env_rows(value):
    return sorted(key + '=' + item for key, item in value.items())


def env_hash(value, process=False):
    return sha(json.dumps(env_rows(value), ensure_ascii=not process, separators=(',', ':')).encode('utf-8'))


def baseline():
    require(BACKUP.parent.is_dir() and not BACKUP.parent.is_symlink()
            and BACKUP.is_dir() and not BACKUP.is_symlink()
            and stat.S_IMODE(BACKUP.stat().st_mode) & 0o077 == 0, 'exactPrivateBackupDirectory')
    manifest = json.loads(read_file(BACKUP / 'manifest.json', private=True))
    content = read_file(BACKUP / 'baseline.json', private=True)
    require(isinstance(manifest, dict) and manifest.get('baseline.json') == sha(content), 'baselineManifestHash')
    value = json.loads(content)
    require(value['sourceCommit'] == BEFORE and value['deploymentLabel'] == 'PR925'
            and value['onlineSqliteBackupApi'] is True and set(value['services']) == set(SERVICES)
            and set(value['configurationFiles']) == set(CONFIG), 'exactBaselineIdentity')
    for service in SERVICES:
        old = value['services'][service]['runtime']
        require(valid_hash(old['imageId'], image=True) and valid_hash(old['containerId'])
                and valid_hash(old['configEnvSha256']) and old['explicitHostnameConfigured'] is False
                and old['containerHostname'] == old['containerId'][:12]
                and set(old['processEnvironments']) == {'api', 'web'}, 'baselineRuntimeMetadata:' + service)
        for process in old['processEnvironments'].values():
            require(process['hostname'] == old['containerHostname'] and valid_hash(process['completeSha256'])
                    and valid_hash(process['withoutHostnameSha256']), 'baselineAutomaticHostname:' + service)
    env_before = read_file(BACKUP / 'env.before', private=True)
    require(manifest.get('env.before') == sha(env_before), 'baselineEnvironmentManifest')
    assert_source(value, sha(env_before))
    return value, sha(env_before)


def assert_source(value, environment_hash):
    require(command(['git', 'rev-parse', 'HEAD'], 'exactSourceVersion').decode('ascii').strip() == TARGET,
            'exactSourceVersion')
    require(sha(read_file(ROOT / '.env.cloud.production')) == environment_hash, 'productionEnvironmentUnchanged')
    for name in CONFIG:
        require(valid_hash(value['configurationFiles'][name])
                and sha(read_file(ROOT / name)) == value['configurationFiles'][name], 'configurationUnchanged')
    require(b'FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime\n'
            in read_file(ROOT / APP / 'Dockerfile'), 'knownFloatingRuntimeBaseDeclaration')


def container(service):
    require(service in SERVICES, 'knownService')
    value = json.loads(command(['docker', 'inspect', '--format', CONTAINER_FORMAT, 'rr-portal-' + service + '-1'],
                               'readContainerEnvironment:' + service))
    require(set(value) == {'containerId', 'imageId', 'environment', 'hostname', 'service', 'running', 'health'}
            and valid_hash(value['containerId']) and valid_hash(value['imageId'], image=True)
            and value['hostname'] == value['containerId'][:12] and value['service'] == service
            and value['running'] is True and value['health'] == 'healthy', 'currentContainerIdentity:' + service)
    environment = env_map(value['environment'])
    require('HOSTNAME' not in environment, 'automaticContainerHostname:' + service)
    return value, environment


def image(identifier, service, generation):
    require(valid_hash(identifier, image=True) and service in SERVICES and generation in ('old', 'new'), 'knownImageIdentity')
    value = json.loads(command(['docker', 'image', 'inspect', '--format', IMAGE_FORMAT, identifier],
                               'readRetainedImage:' + service + ':' + generation))
    require(set(value) == {'imageId', 'environment'} and value['imageId'] == identifier,
            'retainedImageIdentity:' + service + ':' + generation)
    return env_map(value['environment'])


def processes(identifier, service):
    require(valid_hash(identifier) and service in SERVICES, 'knownProcessContainer')
    value = json.loads(command(['docker', 'exec', identifier, 'node', '-e', PROCESS_READ], 'readCurrentProcessEnvironments:' + service))
    require(isinstance(value, dict) and set(value) == {'api', 'web'}, 'bothCurrentRuntimeProcesses:' + service)
    result = {}
    for kind, row in value.items():
        require(set(row) == {'environment', 'completeSha256', 'withoutHostnameSha256'}, 'currentProcessMetadata:' + service)
        environment = env_map(row['environment'])
        require(env_hash(environment, process=True) == row['completeSha256']
                and env_hash({k: v for k, v in environment.items() if k != 'HOSTNAME'}, process=True)
                == row['withoutHostnameSha256'], 'processJsonHashExact:' + service)
        result[kind] = environment
    return result


def substitute(environment, changed, old_image):
    value = dict(environment)
    for key in changed:
        if key in old_image:
            value[key] = old_image[key]
        else:
            value.pop(key, None)
    return value


def diagnose_service(service, old, with_state=False):
    current, configuration = container(service)
    old_image = image(old['imageId'], service, 'old')
    new_image = image(current['imageId'], service, 'new')
    changed = {key for key in set(old_image) | set(new_image)
               if (key in old_image) != (key in new_image) or old_image.get(key) != new_image.get(key)}
    require(not (changed & PROTECTED), 'protectedImageEnvironmentUnchanged:' + service)
    require(not (changed & OVERRIDES) and all((key in configuration) == (key in new_image)
            and configuration.get(key) == new_image.get(key) for key in changed), 'changedKeysInheritedFromImage:' + service)
    reconstructed = substitute(configuration, changed, old_image)
    require(env_hash(reconstructed) == old['configEnvSha256'], 'oldContainerEnvironmentReconstructedExact:' + service)
    active = processes(current['containerId'], service)
    for kind, environment in active.items():
        require(environment.get('HOSTNAME') == current['hostname']
                and all((key in environment) == (key in configuration) and environment.get(key) == configuration.get(key)
                        for key in changed), 'changedProcessKeysInheritedFromConfiguration:' + service)
        prior = substitute(environment, changed, old_image)
        prior['HOSTNAME'] = old['containerHostname']
        proof = old['processEnvironments'][kind]
        require(env_hash(prior, process=True) == proof['completeSha256']
                and env_hash({k: v for k, v in prior.items() if k != 'HOSTNAME'}, process=True)
                == proof['withoutHostnameSha256'], 'oldProcessEnvironmentReconstructedExact:' + service + ':' + kind)
    require(container(service) == (current, configuration)
            and processes(current['containerId'], service) == active, 'environmentObservationWindowStable:' + service)
    version_metadata = bool(changed) and changed <= {'DOTNET_VERSION', 'ASPNET_VERSION'} and all(
        re.fullmatch(r'8\.0\.[0-9]+', values.get(key, '')) is not None for key in changed for values in (old_image, new_image))
    result = {'oldImageAvailable': True, 'newImageAvailable': True,
            'oldContainerEnvironmentReconstructedExact': True, 'oldApiEnvironmentReconstructedExact': True,
            'oldWebEnvironmentReconstructedExact': True, 'imageInheritedChangedKeys': sorted(changed),
            'automaticHostnameLifecycleValidated': True,
            'allImageChangesAreDotnet8VersionMetadata': version_metadata,
            'environmentObservationWindowStable': True,
            'reasonVerified': 'changed-image-inherited-environment-and-automatic-container-hostname'}
    return (result, (current, configuration, active)) if with_state else result


def diagnose():
    value, environment_hash = baseline()
    services, observed = {}, {}
    for service in SERVICES:
        services[service], observed[service] = diagnose_service(service, value['services'][service]['runtime'], with_state=True)
    for service, (current, configuration, active) in observed.items():
        require(container(service) == (current, configuration)
                and processes(current['containerId'], service) == active, 'completeEnvironmentObservationWindowStable:' + service)
    assert_source(value, environment_hash)
    return {'mode': 'environment-drift-925', 'sourceCommit': TARGET, 'services': services,
            'allPriorEnvironmentHashesReconstructedExact': True, 'unchangedFloatingRuntimeBaseDeclaration': True,
            'verificationGuardChanged': False, 'secretsOutputOrSaved': False,
            'sourceWritesPerformed': False, 'containerChangesPerformed': False, 'businessRowsRead': False}


def version_candidate(configuration, baseline_hash, service):
    # Enumerate public runtime version metadata only. No secret, path or other key is guessed.
    require(service in SERVICES and valid_hash(baseline_hash), 'fixedVersionCandidateInputs')
    require(all(key in configuration for key in VERSION_KEYS), 'bothCurrentPublicVersionKeys:' + service)
    matches, candidate = 0, None
    for dotnet_patch in range(100):
        for aspnet_patch in range(100):
            value = dict(configuration)
            value['DOTNET_VERSION'] = '8.0.' + str(dotnet_patch)
            value['ASPNET_VERSION'] = '8.0.' + str(aspnet_patch)
            if env_hash(value) == baseline_hash:
                matches += 1
                candidate = value
    require(matches == 1, 'uniqueCompleteConfigVersionFingerprintMatch:' + service)
    return candidate


def diagnose_version_service(service, old, with_state=False):
    current, configuration = container(service)
    new_image = image(current['imageId'], service, 'new')
    require(all(key in configuration and configuration[key] == new_image.get(key)
                and re.fullmatch(r'8\.0\.(0|[1-9][0-9]?)', configuration[key]) is not None
                for key in VERSION_KEYS), 'currentImageConfigPublicVersionsAgree:' + service)
    active = processes(current['containerId'], service)
    for environment in active.values():
        require(environment.get('HOSTNAME') == current['hostname']
                and all(environment.get(key) == configuration[key] for key in VERSION_KEYS),
                'currentImageConfigProcessPublicVersionsAgree:' + service)
    reconstructed = version_candidate(configuration, old['configEnvSha256'], service)
    for kind, environment in active.items():
        prior = dict(environment)
        for key in VERSION_KEYS:
            prior[key] = reconstructed[key]
        prior['HOSTNAME'] = old['containerHostname']
        proof = old['processEnvironments'][kind]
        require(env_hash(prior, process=True) == proof['completeSha256']
                and env_hash({k: v for k, v in prior.items() if k != 'HOSTNAME'}, process=True)
                == proof['withoutHostnameSha256'], 'oldProcessVersionFingerprintExact:' + service + ':' + kind)
    require(container(service) == (current, configuration)
            and processes(current['containerId'], service) == active, 'versionFingerprintObservationWindowStable:' + service)
    result = {'newImageAvailable': True, 'legacyImageRead': False,
              'candidateCombinationsChecked': 10000, 'uniqueFullConfigFingerprintMatch': True,
              'candidateScope': 'DOTNET_VERSION-and-ASPNET_VERSION-each-8.0.0-through-8.0.99',
              'oldApiCompleteAndWithoutHostnameFingerprintsMatched': True,
              'oldWebCompleteAndWithoutHostnameFingerprintsMatched': True,
              'changedPublicVersionKeys': sorted(key for key in VERSION_KEYS if configuration[key] != reconstructed[key]),
              'allOtherConfigAndProcessEnvironmentPreserved': True, 'automaticHostnameLifecycleValidated': True,
              'priorRuntimeBinaryVersionVerified': False, 'priorImageInheritanceVerified': False,
              'environmentObservationWindowStable': True}
    return (result, (current, configuration, active)) if with_state else result


def diagnose_version_fingerprint():
    value, environment_hash = baseline()
    services, observed = {}, {}
    for service in SERVICES:
        services[service], observed[service] = diagnose_version_service(
            service, value['services'][service]['runtime'], with_state=True)
    for service, (current, configuration, active) in observed.items():
        require(container(service) == (current, configuration)
                and processes(current['containerId'], service) == active, 'completeVersionFingerprintWindowStable:' + service)
    assert_source(value, environment_hash)
    return {'mode': 'environment-version-fingerprint-925', 'sourceCommit': TARGET, 'services': services,
            'allPriorEnvironmentFingerprintsMatchedExactly': True, 'oldImageRequired': False,
            'sha256CollisionResistanceAssumed': True, 'verificationGuardChanged': False,
            'originalStrictVerificationReclassified': False, 'secretsOutputOrSaved': False,
            'sourceWritesPerformed': False, 'containerChangesPerformed': False, 'businessRowsRead': False}


if __name__ == '__main__':
    method = os.environ.get('SPRAY_ENV_DIAG_METHOD', 'retained-image')
    try:
        require(os.environ.get('SPRAY_STATUS_TARGET') == TARGET, 'fixedTargetInput')
        require(method in ('retained-image', 'version-fingerprint'), 'fixedDiagnosticMethod')
        result = diagnose_version_fingerprint() if method == 'version-fingerprint' else diagnose()
        print(json.dumps(result, ensure_ascii=True))
    except Exception:
        print(json.dumps({'mode': 'environment-version-fingerprint-925' if method == 'version-fingerprint' else 'environment-drift-925',
                          'error': 'ENVIRONMENT_RECONSTRUCTION_UNAVAILABLE',
                          'failedCheck': FAILED, 'allPriorEnvironmentHashesReconstructedExact': False,
                          'verificationGuardChanged': False, 'secretsOutputOrSaved': False,
                          'sourceWritesPerformed': False, 'containerChangesPerformed': False, 'businessRowsRead': False}))
        raise SystemExit(1)
