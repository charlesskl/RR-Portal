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
  # 两个兼容坑（2026-10-08 erp-db-init exit 139 实录）：
  # ① BASH_REMATCH 须在匹配成功后立即取走——第二个 =~ 会覆盖它（bash 5 不匹配也清空）。
  # ② bash 3.2 的 for 循环体经进程替换喂给 while 时，case 里的 continue 会直接解析失败；
  #    这里改用嵌套 if，不用 continue。
  for f in *.sql; do
    if [[ $f =~ ^([0-9]+)([A-Za-z]*)_ ]]; then
      num="${BASH_REMATCH[1]}"; suffix="${BASH_REMATCH[2]}"
      if [[ ! $f = *[Dd][Ee][Mm][Oo]* ]]; then
        # 10#$num：去掉前导零强制十进制，否则 08/09 会被 printf %d 当八进制报错
        printf '%d|%s|%s\n' "$((10#$num))" "$suffix" "$f"
      fi
    fi
  done | LC_ALL=C sort -t'|' -k1,1n -k2,2
)

while IFS= read -r f; do specs+=("/db/$f"); done < <(ls seed_*_perms.sql 2>/dev/null | LC_ALL=C sort)
[[ -f seed_92125_zuru_engineering.sql ]] && specs+=("/db/seed_92125_zuru_engineering.sql")

echo "共 ${#specs[@]} 个迁移脚本"
exec dotnet /opt/dbinit/DbDeploy.dll "$ERP_DB" "${specs[@]}"
