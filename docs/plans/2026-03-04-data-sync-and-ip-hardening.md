# 数据同步 & IP 适配性修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 同步工程啤办单数据到云端，修复所有硬编码 IP 和安全问题，使 Portal 可在任意 IP 下正常运行。

**Architecture:** 数据通过 SFTP 直传云端；前端硬编码 IP 改为相对路径；裸 fetch 统一改用 apiFetch()；部署脚本密码改为环境变量。

**Tech Stack:** Python/paramiko (SFTP), HTML/JS (前端修复), Bash (部署验证)

---

### Task 1: SFTP 同步工程啤办单数据到云端

**Files:**
- Read: `plugins/工程啤办单/data/data.json`
- Read: `plugins/工程啤办单/data/default-material-prices.json`

**Step 1: 通过 paramiko SFTP 上传数据文件**

```python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("8.148.146.194", username="root", password="<CLOUD_PASS>", timeout=20, banner_timeout=60, auth_timeout=30)
sftp = ssh.open_sftp()
sftp.put("plugins/工程啤办单/data/data.json", "/opt/rr-portal/plugins/工程啤办单/data/data.json")
sftp.put("plugins/工程啤办单/data/default-material-prices.json", "/opt/rr-portal/plugins/工程啤办单/data/default-material-prices.json")
sftp.close()
ssh.close()
```

**Step 2: 验证云端数据文件存在**

Run: `py deploy/remote-exec.py "ls -la '/opt/rr-portal/plugins/工程啤办单/data/'"`
Expected: 两个 JSON 文件存在且大小 > 0

**Step 3: 重启 rr-production 容器加载新数据**

Run: `py deploy/remote-exec.py "cd /opt/rr-portal && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production restart rr-production"`

---

### Task 2: P0 — deploy/remote-exec.py 移除明文密码

**Files:**
- Modify: `deploy/remote-exec.py`

**Step 1: 改为从环境变量读取凭据**

将第 7-9 行：
```python
HOST = "8.148.146.194"
USER = "root"
PASS = "<CLOUD_PASS>"
```

改为：
```python
import os

HOST = os.environ.get("CLOUD_HOST", "")
USER = os.environ.get("CLOUD_USER", "root")
PASS = os.environ.get("CLOUD_PASS", "")

if not HOST or not PASS:
    print("Error: Set CLOUD_HOST and CLOUD_PASS environment variables.", file=sys.stderr)
    sys.exit(1)
```

**Step 2: 验证脚本仍可正常工作**

设置环境变量后运行：
```bash
CLOUD_HOST=8.148.146.194 CLOUD_PASS='<CLOUD_PASS>' py deploy/remote-exec.py "echo ok"
```
Expected: 输出 `ok`

**Step 3: Commit**

```bash
git add deploy/remote-exec.py
git commit -m "security: remove hardcoded credentials from remote-exec.py"
```

---

### Task 3: P1a — frontend/index.html 移除硬编码 IP

**Files:**
- Modify: `frontend/index.html:355,418`

**Step 1: 替换排期系统链接**

第 355 行：
```html
<!-- 旧 -->
<a href="//192.168.2.151:5000/" target="_blank" class="btn btn-primary">打开系统</a>
<!-- 新 -->
<a href="/schedule/" target="_blank" class="btn btn-primary">打开系统</a>
```

**Step 2: 替换 3D 打印链接**

第 418 行：
```html
<!-- 旧 -->
<a href="//192.168.2.151:3001/" target="_blank" class="btn btn-primary">打开系统</a>
<!-- 新 -->
<a href="/3d/" target="_blank" class="btn btn-primary">打开系统</a>
```

**Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "fix: replace hardcoded LAN IPs with relative paths in portal homepage"
```

---

### Task 4: P1b — 工程啤办单裸 fetch 改用 apiFetch

**Files:**
- Modify: `plugins/工程啤办单/public/injection.html:700,702,724,725`
- Modify: `plugins/工程啤办单/public/engineering.html:882`
- Modify: `plugins/工程啤办单/public/assembly.html:370`

**Step 1: injection.html — 修复 material-stats fetch**

第 700-702 行：
```javascript
// 旧
const statsUrl = '/api/material-stats' + (params.toString() ? '?' + params : '');
Promise.all([
  fetch(statsUrl).then(r => r.json()),

// 新
const statsUrl = '/api/material-stats' + (params.toString() ? '?' + params : '');
Promise.all([
  apiFetch(statsUrl).then(r => r.json()),
```

**Step 2: injection.html — 修复 injection-costs fetch**

第 724-725 行：
```javascript
// 旧
const url = month ? `/api/injection-costs?month=${month}` : '/api/injection-costs';
fetch(url).then(r => r.json()).then(items => {

// 新
const url = month ? `/api/injection-costs?month=${month}` : '/api/injection-costs';
apiFetch(url).then(r => r.json()).then(items => {
```

**Step 3: engineering.html — 修复 save fetch**

第 882 行：
```javascript
// 旧
fetch(url, { method, headers: hdrs, body: JSON.stringify(body) })

// 新
apiFetch(url, { method, headers: hdrs, body: JSON.stringify(body) })
```

**Step 4: assembly.html — 修复 save fetch**

第 370 行：
```javascript
// 旧
fetch(url, { method, headers: hdrs, body: JSON.stringify(body) })

// 新
apiFetch(url, { method, headers: hdrs, body: JSON.stringify(body) })
```

**Step 5: Commit**

```bash
git add plugins/工程啤办单/public/injection.html plugins/工程啤办单/public/engineering.html plugins/工程啤办单/public/assembly.html
git commit -m "fix: replace bare fetch() with apiFetch() for proxy compatibility"
```

---

### Task 5: 部署验证

**Step 1: Push 所有修复到 GitHub**

```bash
git push origin main
```

**Step 2: 云端 git pull 并重建**

```bash
py deploy/remote-exec.py "cd /opt/rr-portal && git pull && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production restart nginx"
```

**Step 3: 验证所有服务正常**

```bash
py deploy/remote-exec.py "cd /opt/rr-portal && docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production ps"
```
Expected: 6 个容器全部运行中

**Step 4: 从浏览器验证**

- http://8.148.146.194/ — Portal 首页
- http://8.148.146.194/rr/ — 工程啤办单（应有数据）
- http://8.148.146.194/indonesia/ — 印尼小组
