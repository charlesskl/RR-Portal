"""Clear only PrintLink's maintenance flag after the reviewed container is healthy."""
import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path('/opt/rr-portal')
HEAD='52c090589d6da542fee74ef17c8edd3b0dfe4fe6'
CID='41e7255835dee76723a084f49fe95f9108dcb80ac3f19f2e38c3d46c23bdfe51'
PIN_FROZEN=True
SCRIPT='''set -euo pipefail
MAINT_FLAG_DIR=/opt/rr-portal/deploy/maintenance
COMPOSE_FILE=/opt/rr-portal/docker-compose.cloud.yml
ENV_FILE=/opt/rr-portal/.env.cloud.production
MAINT_COMPOSE_SERVICES=printlink
source /opt/rr-portal/deploy/service-maintenance.sh
maintenance_off printlink
require_maintenance_cleared printlink
'''

def command(args):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25)
 if p.returncode or len(p.stdout)>32768:raise ValueError()
 return p.stdout


def main():
 result={'completed':False,'businessWrites':False,'onlyPrintlinkMaintenanceFlagTouched':True}
 try:
  if not PIN_FROZEN or command(['git','rev-parse','HEAD']).decode().strip()!=HEAD:raise ValueError()
  expected=command(['git','show',HEAD+':deploy/service-maintenance.sh'])
  if (ROOT/'deploy/service-maintenance.sh').read_bytes()!=expected:raise ValueError()
  value=json.loads(command(['docker','inspect','--format','{"id":{{json .Id}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}}}',CID]))
  if value!={'id':CID,'running':True,'health':'healthy'}:raise ValueError()
  flag=ROOT/'deploy/maintenance/services/printlink'
  if flag.is_symlink()or flag.exists()and not flag.is_file():raise ValueError()
  result['flagPresentBefore']=flag.exists()
  command(['bash','-c',SCRIPT])
  result['flagAbsentAfter']=not flag.exists()and not flag.is_symlink()
  result['completed']=result['flagAbsentAfter']
 except Exception:result['safeFailure']='PRINTLINK_MAINTENANCE_CLEAR_GUARD_FAILED'
 print(json.dumps(result,sort_keys=True,separators=(',',':')))
 return 0 if result['completed']else 1

if __name__=='__main__':raise SystemExit(main())
