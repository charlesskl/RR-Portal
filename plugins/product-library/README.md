# 产品资料库 (product-library)

RR Portal Engineering 部门插件 —— 产品工程资料集中管理系统。

## 功能

- 按客户 → 产品两级筛选查找工程资料
- 产品×工厂独立资料集（华登 / 兴信）
- 5 预置资料槽位 + 可追加：作业指导书 / 生产注意事项 / 外箱资料 / 外购清单 / 排模表
- 版本自动保留，永不丢失
- 按产品一键打包下载，保留中文文件夹结构
- 对接 RR Portal 登录系统

## 技术栈

- Node.js + Express
- PostgreSQL (schema: `product_library`)
- 存储：本地 bind mount（`./data/files/`），未来可切 OSS

## 设计文档

见 [`docs/superpowers/specs/2026-04-13-product-library-design.md`](../../docs/superpowers/specs/2026-04-13-product-library-design.md)

## 状态

🚧 设计阶段，代码未实现。
