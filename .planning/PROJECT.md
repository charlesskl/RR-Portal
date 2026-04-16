# 报价管理系统 (Vendor Quotation System)

## What This Is

基于浏览器的报价管理系统，导入本厂报价明细 Excel，交互式编辑成本数据，导出客户格式的 Vendor Quotation Excel。支持注塑产品和毛绒公仔两种报价格式，当前导出支持 TOMY 模板。

## Core Value

准确高效地将内部报价明细转换为客户报价单，消除手工填写的错误和重复劳动。

## Current State

**Shipped:** v1.1 双格式支持 (2026-04-16)

- 注塑产品和毛绒公仔两种 Excel 格式均可导入解析
- Raw Material 自动从 MoldPart 提取（两种格式）
- SewingDetail、RotocastItem 新数据表，format_type 字段
- 前端展示车缝明细和搪胶件数据
- 导出：TOMY 模板（当前唯一支持的客户格式）

**Tech stack:** Node.js + Express + SQLite + ExcelJS + vanilla HTML/CSS/JS
**Codebase:** ~3000+ 行，client/server 结构，Docker 部署

## Requirements

### Validated

- ✓ Excel 文件导入解析（SheetJS/ExcelJS） — existing
- ✓ 注塑产品报价明细解析（47712 格式） — existing
- ✓ 产品/版本 CRUD 管理 — existing
- ✓ 11 个 tab 的交互式编辑界面 — existing
- ✓ 参数面板（汇率、加价率等）自动重算 — existing
- ✓ 成本计算引擎 — existing
- ✓ TOMY 模板驱动的 Excel 导出 — existing
- ✓ Docker 部署 — existing
- ✓ SQLite 数据持久化 — existing
- ✓ Raw Material 自动从 MoldPart 提取 — v1.1
- ✓ 产品编号从主报价 sheet B1 正确识别 — v1.1
- ✓ 毛绒公仔格式完整解析（格式检测、搪胶件、车缝明细） — v1.1
- ✓ SewingDetail / RotocastItem 数据表 — v1.1
- ✓ format_type 字段区分格式 — v1.1 (partial — frontend not consuming)

### Active

- [ ] SPIN 客户报价表导出格式支持
- [ ] 修复 v1.1 已知缺口：车缝明细/搪胶件 tab 导航按钮、format_type 版本复制丢失

### Out of Scope

- 后端服务器认证 — 内部工具无需登录
- 在线部署 — 本地工具
- 修改 TOMY 模板结构
- 数据库迁移工具 — 开发阶段直接重建

## Context

- 现有完整系统：注塑产品（47712）+ 毛绒公仔（L21014）两种格式均支持导入
- 导出目前仅支持 TOMY 模板；SPIN 是下一个目标客户格式
- v1.1 已知未修复缺口见 `.planning/v1.1-MILESTONE-AUDIT.md`

## Constraints

- **Tech stack**: Node.js + Express + SQLite + ExcelJS + vanilla HTML/CSS/JS
- **Architecture**: 现有 client/server 结构不变
- **Templates**: 客户模板格式不可修改（TOMY、SPIN 各有固定格式）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Raw Material 从 MoldPart.unit_price_hkd_g 取价格 | MoldPart 自带对应料价，比从 MaterialPrice 匹配更准确 | ✓ Good |
| Raw Material weight 不乘 sets_per_toy | sets_per_toy 是啤工计算用，原料重量应为单件克重累加 | ✓ Good |
| 产品编号从主报价 sheet B1 提取 | 车缝明细等子 sheet 的 B1 不是货号 | ✓ Good |
| 不根据 format_type 动态隐藏 tab（D-02） | 简化前端逻辑 | — Revisit（导致 tab 按钮缺失问题） |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-04-16 after v1.1 milestone*
