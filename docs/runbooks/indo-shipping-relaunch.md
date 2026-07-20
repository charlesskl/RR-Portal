# indo-shipping（印尼走货明细）重新上线清单

> 背景：#280（干净重建版，取代含真实数据的 #268）曾在服务器未 provision seed 时合并，
> 导致部署失败并**阻断整个平台 CD**，已用 #282（commit `bddb061`）revert 下线。
> indo-shipping 代码保留在 git 历史与远端分支 `codex/indo-shipping-clean`，4 个 `INDO_*` GitHub Secret 已配好可复用。
> 本清单用于日后条件齐备时**按正确顺序**重新上线。

## 为什么必须"先备服务器、再合代码"

- `deploy.yml` 第一步无条件 `encode_indo_secret`：4 个 `INDO_*` Secret 缺任一即 `exit 1`。
- `update-server.sh` 里 `indo_secret_transport_changed` 只要服务器 `.env.cloud.production` 未持久化这些密钥就恒为真
  → 每次 push main 都走 indo 路径 → 撞上 `require_indo_seed_file data/indo-shipping-seed/business-data.json` 硬失败（发生在密钥持久化之前，会永远重复）→ **拖垮全平台 CD**。
- 结论：seed 必须**先**在服务器就位，代码才能合。`data/indo-shipping-seed/` 在 git 之外、跨部署保留，所以先放安全。

---

## Part A —— 进服务器（无需旧 SSH 密钥，用阿里云控制台）

1. 浏览器登录**阿里云控制台** → 云服务器 ECS → 实例列表。
2. 找公网 IP = **8.148.146.194** 的实例。
3. 点该实例 **「远程连接」→「Workbench 远程连接」**。
4. 用 **root 密码**登录（忘记可在同页「重置实例密码」，重置后需重启实例一次）。
5. 进入后是一个网页终端，后续命令都贴这里。

> 备选：拿到旧电脑后把其 `~/.ssh/` 私钥拷到新电脑并配 `~/.ssh/config`，即可本地 `ssh`。

## Part B —— 查资源 + 放 seed（在服务器终端执行）

**① 确认资源够（SQL Server 2022 preflight）：**
```bash
cd /opt/rr-portal
free -m | awk '/Mem:/{print "可用内存: "$7" MB (需≥2500)"}'
df -Pm /opt/rr-portal | awk 'NR==2{print "空闲磁盘: "$4" MB (需≥10240)"}'
```
内存 < 2500MB 则先腾内存 / 调 SQL 内存上限，别硬上。

**② 放 seed 文件** `data/indo-shipping-seed/business-data.json`：
```bash
mkdir -p /opt/rr-portal/data/indo-shipping-seed
# 用下面方式把 business-data.json 内容写进去（真实快照优先；或先用样本）：
cat > /opt/rr-portal/data/indo-shipping-seed/business-data.json <<'EOF'
<在这里粘贴 business-data.json 完整内容>
EOF
ls -l /opt/rr-portal/data/indo-shipping-seed/business-data.json   # 确认非空
```
seed 内容来源二选一：
- **真实印尼数据**：手上/备份里的 `business-data.json`。
- **先用样本上线**：仓库 `apps/印尼小组/印尼走货明细/seed/example-data.json`（结构：schemaVersion + tables + images + users，可直接用作 business-data.json）。注意 revert 后服务器 checkout 里暂时没有该文件，需要时从 git 或本地取内容。

## Part C —— 重新上代码 + 部署（由 Claude 执行）

seed 就位、内存确认够之后：
1. 把 indo-shipping 代码重新合回 main（revert 掉 #282 的 revert，或从 `codex/indo-shipping-clean` 开干净 PR）。
2. admin 合并触发部署，监控（首次含 SQL Server，约 5–15 分钟）。
3. 抓烟测试 `curl --noproxy '*' http://8.148.146.194/indo-shipping/health`，确认门户「印尼小组」下亮起来。

## 关键顺序

**Part A → B（人工，先放 seed）→ 通知 → Part C（合代码 + 部署）。** 顺序反了会重演 #280 的翻车。

## 参考
- 端口 5180，路径 `/indo-shipping/`，部门 印尼小组。
- 阈值：`MIN_INDO_AVAILABLE_MEMORY_MB=2500`、`MIN_INDO_FREE_DISK_MB=10240`（见 `deploy/update-server.sh`）。
- 4 个 Secret：`INDO_SQL_SA_PASSWORD`、`INDO_SQL_APP_PASSWORD`、`INDO_SHIPPING_JWT_KEY`、`INDO_SHIPPING_ADMIN_PASSWORD`（已配）。

---

## 实战记录 2026-07-20（✅ 已上线）

indo-shipping 于 2026-07-20 通过 PR #291 成功上线，`/indo-shipping/health` 返回 200，门户首页「印尼小组」亮起，真实数据（snapshot 2026-07-15）已导入，密钥已持久化（CD 恢复健康），其他服务不受影响。过程中的关键经验，供以后维护 / 类似新 app 参考：

### 用 GHA 代做服务器操作（本机/新电脑没配 SSH 时）
Part A/B 原设计是人工登阿里云控制台。实际本机无 ECS SSH（私钥只在 GitHub Secret `CLOUD_SSH_KEY` + 原作者手里），改用 **GHA `workflow_dispatch` + `appleboy/ssh-action`** 代做，全程无需本地 SSH。做了两个可复用 workflow（都在 main）：
- **`.github/workflows/provision-indo-seed.yml`**（Provision Indo Seed）：从私有分支 `codex/indonesia-shipping-portal` 的 blob 用 `git cat-file` 取真实 seed（6.86MB, sha256 `a657b1ca…c7590`, schemaVersion 2026-07-15）落到 `data/indo-shipping-seed/business-data.json`，含资源预检 + SHA256 双校验。**只放文件、不部署、不阻塞 CD。** 6.86MB 太大无法塞 base64 secret，也不宜粘进网页终端，走 git blob 最干净。
- **`.github/workflows/ecs-disk-ops.yml`**（ECS Disk Ops）：`diagnose`（只读 df/lsblk/growpart dry-run/docker system df）/ `prune-safe`（`docker builder prune` + 无容器引用镜像 prune，不动运行容器/volume/data）/ `grow-disk`（growpart + resize2fs 扩分区）。
- 所有 workflow 都校验 `CLOUD_HOST_FINGERPRINT` 防中间人，沿用 `appleboy/ssh-action@0ff4204…` 固定版本。

### 坑 1：磁盘"不足"多半是分区没扩满，不是真容量不足
`df` 显示 `/dev/vda3 40G` 让人误判容量不足，但阿里云控制台看**系统盘实际是 70GiB ESSD**，只是根分区没占满整块盘（~30GB 未分配）。用 `ECS Disk Ops` 的 `grow-disk` 模式（`growpart /dev/vda 3` + `resize2fs /dev/vda3`，在线扩、不影响容器/数据）分区 40G→69G，空闲从 9.4GB→38GB，瓶颈消失。**遇 ECS 磁盘告急先比对「云盘大小 vs `lsblk` 分区大小」。**

### 坑 2：Dockerfile `addgroup app` 与 aspnet:8.0 基础镜像冲突
`mcr.microsoft.com/dotnet/aspnet:8.0` 自 .NET 8 起自带非 root `app` 用户 → `addgroup --system app` 报 `The group 'app' already exists` → 整镜像 build 失败。修法：`(getent group app || addgroup --system app)` + `(getent passwd app || adduser …)` 幂等守卫。#280 当年卡在 seed 门槛没走到 build，所以这个 bug 直到 seed 就位后才暴露。

### 坑 3：indo 部署失败 = 阻塞全平台 CD，必须立刻 revert
`indo_secret_transport_changed` 只要密钥没持久化（持久化发生在 indo 成功部署的最后一步）就恒为真 → 每次 push 都走 indo 路径 → 任一步失败即 `exit 1` 阻塞所有人的部署。中途两次失败（Dockerfile build、资源预检）都立即回滚保平台，查清根因后再上。SQL Server 有 `MSSQL_MEMORY_LIMIT_MB=1536` + `mem_limit: 2304m` 兜底，OOM 只 kill indo 自身容器，不波及其他服务。

### 成功路径（复现用）
1. `ECS Disk Ops` → `diagnose` 看 df/分区；若分区没扩满 → `grow-disk`。
2. `ECS Disk Ops` → `prune-safe` 清残骸（尤其失败重试后）。
3. `Provision Indo Seed`（幂等，可反复跑校验 seed 在位 + 拿 mem/disk 准数，需 mem≥2500/disk≥10240）。
4. 合并 indo 代码（含 Dockerfile getent 修复）→ 盯部署 → 冒烟 `/indo-shipping/health`。失败先 revert 再排查。
