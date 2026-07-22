# 运维 Workflow + 内存管理 Runbook

> 背景：本机（开发机）对 ECS **没有 SSH**（无 key、host key 未验证）。所有主机侧操作都通过
> **手动触发的 GitHub Actions workflow**（`workflow_dispatch`）走 GHA 里的 `CLOUD_SSH_KEY` secret 执行。
> 这些 workflow 都沿用 `ecs-disk-ops.yml` 的模式：SSH fingerprint 校验 + `appleboy/ssh-action`，
> concurrency group 都是 `deploy-cloud`（`queue: max`）——**会和「Deploy to Cloud」排队**，别指望它在部署跑时立刻执行。

## 怎么跑这些 workflow

- **GitHub 网页**：仓库 → Actions → 左侧选对应 workflow → 右上 **Run workflow** → 选 `mode` → Run。
- **命令行**（本机用 git credential 里的 token 打 REST API）：
  ```bash
  TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/charlesskl/RR-Portal/actions/workflows/<文件名>.yml/dispatches" \
    -d '{"ref":"main","inputs":{"mode":"<mode>"}}'
  ```
  读运行日志：`GET /actions/runs?branch=main` 拿 run id → `GET /actions/jobs/<id>/logs`。
  注意 GHA 的 JSON 常含控制字符，`python3 -c "... json.loads(s, strict=False)"`。

---

## 1. 内存/磁盘紧张 —— `Mem Reclaim`（`mem-reclaim.yml`）

ECS 只有 **7.2 GB RAM**、跑着 **~32 个服务**，本来就偏紧、常年在用 swap。可用 RAM 经常掉到 2.3 GB 左右。

- `mode=diagnose`（只读）：`free -m` + 各容器内存占用（`docker stats`）+ `docker system df` + 占内存最高进程。先看清现状。
- `mode=reclaim`（安全，只清**磁盘**）：`docker builder prune -af` + 无容器引用的镜像 prune + 已退出容器 prune。
  **不动运行中的容器/volume/data**。今天多次重建后构建缓存能攒到 8~9 GB，清完能腾出大量磁盘。
  ⚠️ 释放的是**磁盘不是 RAM**——RAM 被运行中的容器占着，清缓存/镜像不还 RAM。
- `mode=restart-heavy`（**临时腾 RAM**）：重启内存大户**应用**容器
  （shipping-management / sprayplan / peise / zuru-master-schedule / hy-schedule-system / tomy-paiqi，**排除 SQL Server**——停它会断 indo 且立刻涨回）。
  实测一次腾出 **~980 MB**（2260 → 3241 可用），**顺带把卡了 5 周 unhealthy 的 hy-schedule 重启修好了**。
  各服务会有几秒~几十秒抖动；释放是**临时的**，RAM 会随使用回涨。
- `mode=restart-unhealthy`：只重启当前 `status=unhealthy` 的容器（释放泄漏内存 / 复活卡死进程）。

**治本**：32 个服务挤 7.2 GB 是根本瓶颈。要长期不为内存发愁，去**阿里云控制台把 ECS 升配**（如 7 → 16 GB），indo 部署也就不用再 stop。

---

## 2. indo-shipping 部署内存不足 —— indo-stop → 重跑部署

indo-shipping 带 SQL Server，部署有内存 **preflight：需 ≥2500 MB 空闲**。RAM 不够时部署会在
`[ERROR] Indonesia shipping deploy aborted: insufficient available memory` 处**秒失败**（build 之前）。

**标准处理流程：**
1. 跑 `ecs-disk-ops.yml` **`mode=indo-stop`** —— 停 `indo-shipping` + `indo-sqlserver` 容器腾内存
   （数据在 bind-mount，安全）。实测 2183 → 3126 MB 可用。
2. **重跑失败的那次部署**（Actions 里 re-run failed jobs，或 API `POST /actions/runs/<id>/rerun-failed-jobs`）。
   preflight 这次过 → 重建 indo-shipping + 重启 SQL Server + 应用。
3. ⚠️ 重跑期间 indo-shipping 后端会断 **~2-3 分钟**，用户此时访问 `/indo-shipping/*` 会看到 **502**——属正常，起来即恢复。
4. 烟测 `curl http://8.148.146.194/indo-shipping/health` → `{"ok":true,...}`。

> 也可先跑 `mem-reclaim mode=restart-heavy` 把可用 RAM 顶到 2500 以上，再直接部署（免 indo 短暂下线）。

---

## 3. Docker registry mirror 坏 —— `Docker Mirror Ops`（`docker-mirror-ops.yml`）

主机 `/etc/docker/daemon.json` 的 registry-mirror 若失效（历史上曾指向腾讯云内网镜像，在阿里云上 DNS 解析失败），
base image 拉取会 `no such host` 导致构建失败。

- `mode=diagnose`：只读打印 daemon.json + `docker info` 的 Registry Mirrors。
- `mode=apply`（`mirror_url` 输入镜像加速器地址，多个空格分隔）：备份 → python 合并保留其它键 → JSON 校验 →
  `systemctl reload docker`（registry-mirrors 可**热重载，零停机不重启容器**）→ `docker info` 验证 + test pull，失败自动回滚。
- `mode=rollback`：从最近 `.bak` 恢复。

当前已设为阿里云账号加速器 `https://qekk7wsi.mirror.aliyuncs.com` + `https://docker.1panel.live` 兜底。
另 `deploy/update-server.sh` 构建前有 base-image mirror guard 兜底（从公共镜像站预拉 + tag）。

---

## 4. 诊断 / 数据迁移 workflow

- **`factory-review-diag.yml`**（只读）：诊断 factory-review 的 pb_data——orders 行数、listRule、最新订单字段、
  `auxiliary.db` 里的请求日志（PocketBase 0.39 把 `_logs` 放在 auxiliary.db，不在 data.db）。
  排查「货期管理入单记录不显示」类问题时用。
- **`sprayplan-data-sync.yml`**：把业务数据迁到 sprayplan 生产 bind-mount。
  `mode=check` 只读看行数；`mode=apply` 备份 → 从 PR ref 取 dev.db 覆盖 `data/sprayplan.db` + PDF 到 `storage/pdf/` →
  force-recreate；`mode=rollback` 恢复。
  ⚠️ apply 内置健康检查等待窗口(90s)对 sprayplan 首启偏短会**误报 failure**，数据其实已迁好，用
  `curl http://8.148.146.194/sprayplan/api/health` 复核真实状态。
  **教训**：同步 app 业务数据别 commit dev.db / 上传件进仓库（`.gitignore` 已忽略 `prisma/*.db`）——正解是放到 bind-mount 目录再 recreate。

---

## 常用速查

```bash
# 看可用内存
ecs-disk-ops mode=diagnose        # 或 mem-reclaim mode=diagnose

# 内存紧 → 先清磁盘缓存，再重启大户腾 RAM
mem-reclaim mode=reclaim
mem-reclaim mode=restart-heavy

# indo 部署撞内存墙
ecs-disk-ops mode=indo-stop  →  重跑部署

# 服务器磁盘满
ecs-disk-ops mode=prune-safe      # 清构建缓存 + 无用镜像
ecs-disk-ops mode=grow-disk       # 云盘有空间时把根分区撑满
```
