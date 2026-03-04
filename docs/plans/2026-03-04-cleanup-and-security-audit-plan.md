# RR Portal 代码清理与安全审计 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 清理本地 Docker 运行相关文件，修复安全漏洞，加固 .gitignore。

**Architecture:** 纯文件删除 + 配置修改，无功能代码变更。分三个阶段：安全修复 → 文件清理 → gitignore 加固。

**Tech Stack:** git, bash

---

### Task 1: 修复 .gitignore 保护所有子目录 .env

**Files:**
- Modify: `.gitignore`

**Step 1: 更新 .gitignore**

将第 8 行 `.env` 改为 `**/.env`，并添加 `**/.env.local`：

```
**/.env
**/.env.local
!.env.example
!**/.env.example
!**/.env.production.example
```

**Step 2: 从 git 追踪中移除已暴露的 .env 文件**

Run: `git rm --cached plugins/3D打印/.env 2>/dev/null; echo done`

注意：这不会删除本地文件，只是从 git 追踪中移除。

**Step 3: 验证**

Run: `git status`
Expected: `.gitignore` 显示为 modified，`plugins/3D打印/.env` 不再被追踪

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "security: protect all subdirectory .env files from git tracking"
```

---

### Task 2: 删除危险文件 deploy/_run.py

**Files:**
- Delete: `deploy/_run.py`

**Step 1: 删除文件**

Run: `rm deploy/_run.py`

该文件未被 git 追踪（untracked），直接删除即可，无需 git rm。

**Step 2: 验证**

Run: `ls deploy/`
Expected: 只剩 `remote-exec.py`, `setup-server.sh`, `update-server.sh`, 以及待删除的文档

---

### Task 3: 删除 deploy/ 下的未提交文档

**Files:**
- Delete: `deploy/DEPLOYMENT_AUDIT.md`
- Delete: `deploy/ENV_CONTRACT.md`
- Delete: `deploy/STACK_INVENTORY.md`

**Step 1: 删除文件**

Run: `rm deploy/DEPLOYMENT_AUDIT.md deploy/ENV_CONTRACT.md deploy/STACK_INVENTORY.md`

这些都是 untracked 文件，直接删除。

**Step 2: 验证**

Run: `ls deploy/`
Expected: 只剩 `remote-exec.py`, `setup-server.sh`, `update-server.sh`

---

### Task 4: 删除本地 Docker 编排和启动脚本

**Files:**
- Delete (git rm): `docker-compose.yml`
- Delete (git rm): `docker-compose.local.yml`
- Delete (git rm): `启动Portal.bat`
- Delete (git rm): `一键更新全部.bat`

**Step 1: 从 git 中删除**

```bash
git rm docker-compose.yml docker-compose.local.yml "启动Portal.bat" "一键更新全部.bat"
```

**Step 2: 验证**

Run: `git status`
Expected: 4 个文件显示为 deleted（staged）

**Step 3: Commit**

```bash
git commit -m "cleanup: remove local Docker compose and startup scripts

Portal is now cloud-hosted, local machine is dev-only."
```

---

### Task 5: 删除本地 nginx 配置和异常残留

**Files:**
- Delete (git rm): `nginx/nginx.conf`
- Delete: `nginx/nginx.cloud.conf;D` (可能是 untracked 异常文件)

**Step 1: 删除 nginx.conf**

```bash
git rm nginx/nginx.conf
```

**Step 2: 删除异常文件**

```bash
rm -f "nginx/nginx.cloud.conf;D"
```

**Step 3: 验证**

Run: `ls nginx/`
Expected: 只剩 `nginx.cloud.conf` (和 `.htpasswd` 被 gitignore 隐藏)

**Step 4: Commit**

```bash
git commit -m "cleanup: remove local nginx config and stale file"
```

---

### Task 6: 清理印尼小组插件的 Python SDK 残留

**Files:**
- Delete (git rm): `plugins/印尼小组/app/__init__.py`
- Delete (git rm): `plugins/印尼小组/app/main.py`
- Delete (git rm): `plugins/印尼小组/app/models.py`
- Delete (git rm): `plugins/印尼小组/app/router.py`
- Delete (git rm): `plugins/印尼小组/plugin.yaml`
- Delete (git rm): `plugins/印尼小组/requirements.txt`

**Step 1: 从 git 中删除**

```bash
git rm -r "plugins/印尼小组/app/" "plugins/印尼小组/plugin.yaml" "plugins/印尼小组/requirements.txt"
```

注意：这些文件在 git status 中已显示为 deleted（unstaged），git rm 会将删除操作暂存。

**Step 2: 验证**

Run: `git status -- "plugins/印尼小组/"`
Expected: 所有删除操作显示为 staged

---

### Task 7: 清理工程啤办单插件的 Python SDK 残留和本地脚本

**Files:**
- Delete (git rm): `plugins/工程啤办单/app/__init__.py`
- Delete (git rm): `plugins/工程啤办单/app/main.py`
- Delete (git rm): `plugins/工程啤办单/app/models.py`
- Delete (git rm): `plugins/工程啤办单/app/router.py`
- Delete (git rm): `plugins/工程啤办单/Dockerfile`（旧 Python 版）
- Delete (git rm): `plugins/工程啤办单/plugin.yaml`
- Delete (git rm): `plugins/工程啤办单/requirements.txt`
- Delete (git rm): `plugins/工程啤办单/部署教程.txt`
- Delete (git rm): `plugins/工程啤办单/deploy.bat`
- Delete (git rm): `plugins/工程啤办单/start.bat`
- Delete (git rm): `plugins/工程啤办单/start-auto-sync.bat`

**Step 1: 从 git 中删除 SDK 残留**

```bash
git rm -r "plugins/工程啤办单/app/" "plugins/工程啤办单/Dockerfile" "plugins/工程啤办单/plugin.yaml" "plugins/工程啤办单/requirements.txt"
```

**Step 2: 删除本地脚本和教程**

```bash
git rm "plugins/工程啤办单/部署教程.txt" "plugins/工程啤办单/deploy.bat" "plugins/工程啤办单/start.bat" "plugins/工程啤办单/start-auto-sync.bat"
```

**Step 3: 验证**

Run: `git status -- "plugins/工程啤办单/"`
Expected: 所有删除操作显示为 staged

**Step 4: Commit（Task 6 + 7 一起）**

```bash
git commit -m "cleanup: remove Python SDK remnants and local scripts from plugins

印尼小组 and 工程啤办单 have migrated away from plugin_sdk.
Removed unused Python files, Dockerfiles, and local deployment scripts."
```

---

### Task 8: 最终验证

**Step 1: 检查 git 状态**

Run: `git status`
Expected: 工作区干净（除了仍有未提交修改的文件如 CLAUDE.md、插件数据文件等）

**Step 2: 检查删除结果**

Run: `ls deploy/ && ls nginx/ && ls "plugins/印尼小组/" && ls "plugins/工程啤办单/"`

验证各目录只剩下应保留的文件。

**Step 3: 确认 .env 保护**

Run: `git ls-files | grep '\.env'`
Expected: 只看到 `.env.example` 和 `.env.production.example` 等模板文件，不包含任何 `.env`（无后缀）
