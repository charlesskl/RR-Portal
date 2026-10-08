#!/usr/bin/env bash
# 复刻 db/run-db.ps1 的脚本枚举顺序（Linux 版，供 Dockerfile.dbinit 使用）：
#   1) 编号迁移 NN[_字母]_*.sql 按数字升序，同号无字母后缀在前；排除文件名含 demo 的；
#      01/02 以 lenient: 前缀执行（逐语句、失败跳过），其余严格模式出错即止。
#   2) seed_*_perms.sql 按文件名字母序。
#   3) 最后 seed_92125_zuru_engineering.sql。
# DbDeploy 会自动建库（Chinese_PRC_CI_AS），全部脚本幂等，可重复执行。
set -euo pipefail
: "${ERP_DB:?需要 ERP_DB 连接串}"

cd /db
specs=()
while IFS='|' read -r _num _suffix file; do
  spec="/db/$file"
  # 01_rebuild_schema.sql / 02_rebuild_relations.sql 逐语句容错执行
  if [[ "$_num" == "1" || "$_num" == "2" ]]; then spec="lenient:$spec"; fi
  specs+=("$spec")
done < <(
  for f in *.sql; do
    if [[ $f =~ ^([0-9]+)([A-Za-z]*)_ ]] && [[ ! $f =~ [Dd][Ee][Mm][Oo] ]]; then
      printf '%d|%s|%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$f"
    fi
  done | LC_ALL=C sort -t'|' -k1,1n -k2,2
)

while IFS= read -r f; do specs+=("/db/$f"); done < <(ls seed_*_perms.sql 2>/dev/null | LC_ALL=C sort)
[[ -f seed_92125_zuru_engineering.sql ]] && specs+=("/db/seed_92125_zuru_engineering.sql")

echo "共 ${#specs[@]} 个迁移脚本"
exec dotnet /opt/dbinit/DbDeploy.dll "$ERP_DB" "${specs[@]}"
