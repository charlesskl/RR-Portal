# StitchCostPro 前端

车缝核价对比系统前端。React + TypeScript + Vite + Ant Design + ProComponents。

## 本地运行

需先启动后端（默认 http://localhost:5100，见 `../backend/README.md`）。

```bash
npm install
npm run dev        # http://localhost:5200（5173 已被本机 ERP 占用）
```

后端 CORS 已放行 `http://localhost:5200`。如后端地址变了，设环境变量 `VITE_API_BASE`。

默认账号：`admin` / `admin123`。

## 结构

```
src/
 ├ api/        axios 客户端(JWT拦截器/401跳登录) + 各接口封装 + 类型
 ├ auth/       AuthContext（登录态、启动校验 token）
 ├ layouts/    MainLayout（侧边菜单 + 登录守卫）
 └ pages/      LoginPage、ProductsPage（ProTable + ModalForm 范式）
```

## 已实现（第二线 · 地基）

- 登录页 + JWT 持久化 + 路由守卫（未登录跳 /login）
- 主布局（侧边菜单、用户下拉退出）
- 货号档案页：ProTable 列表/搜索/分页 + ModalForm 新增/编辑（对接后端 6 个 CRUD 接口）

## 待开发

- 其余 5 个基础档案管理页（工序大类/小工序/工种费率/外发厂/部门）——照货号页范式复制
- 模块 2~7（核价引擎、外发价、对比主界面等，待第一线公式确认）

## 备注

- 当前打包为单 chunk（~2MB，ProComponents 较重），后续可用动态 import 做路由级代码分割。
