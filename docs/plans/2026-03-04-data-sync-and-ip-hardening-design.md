# 数据同步 & IP 适配性修复设计

**日期**: 2026-03-04
**状态**: 已批准

## 背景

RR Portal Batch A 已部署到阿里云 ECS (8.148.146.194)，但存在两个问题：
1. 云端工程啤办单数据为空，需要从本地同步
2. 代码中存在硬编码 IP、明文密码、裸 fetch 调用等问题，影响跨 IP 可用性

## 任务 1：数据同步

### 范围
- 同步 `plugins/工程啤办单/data/data.json` 到云端
- 同步 `plugins/工程啤办单/data/default-material-prices.json` 到云端

### 方式
通过 paramiko SFTP 直接传输文件到 `/opt/rr-portal/plugins/工程啤办单/data/`

## 任务 2：IP 适配性修复

### P0 — 安全：移除明文密码

**文件**: `deploy/remote-exec.py`
**问题**: 第 7-9 行硬编码服务器 IP 和密码
**修复**: 改为从环境变量 `CLOUD_HOST`、`CLOUD_USER`、`CLOUD_PASS` 读取，或从 `deploy/.env` 加载

### P1a — 前端硬编码 IP

**文件**: `frontend/index.html`
**问题**: 第 355 行 `//192.168.2.151:5000/`（排期）、第 418 行 `//192.168.2.151:3001/`（3D打印）
**修复**: 改为相对路径 `/schedule/` 和 `/3d/`（与 nginx location 一致）

### P1b — 裸 fetch 缺少 API_BASE

**文件**: `plugins/工程啤办单/public/injection.html`
- 第 700-702 行: `fetch('/api/material-stats')` → `apiFetch('/api/material-stats')`
- 第 724-725 行: `fetch('/api/injection-costs')` → `apiFetch('/api/injection-costs')`

**文件**: `plugins/工程啤办单/public/engineering.html`
- 第 878-882 行: 裸 `fetch(url)` → `apiFetch(url)`

**文件**: `plugins/工程啤办单/public/assembly.html`
- 第 366-370 行: 裸 `fetch(url)` → `apiFetch(url)`

### P2 — 敏感文件从 git 移除

**文件**: `plugins/3D打印/.env`
**问题**: 含真实打印机 IP、序列号、ACCESS_CODE，已提交 git
**修复**: 添加到 `.gitignore`，从 git 追踪中移除（本地文件保留）
