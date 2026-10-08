# web2 — WebpageERP 前端（新版）

老系统 web/ 的全量重写版本：React 19 + Vite + TS strict + Tailwind v4 + shadcn + TanStack + Vitest。
第二阶段完成后（2026-09-18），功能全集等于老系统内部页面（外部系统入口除外）。

## 开发

```bash
# 需要 node（仓库外工具链:~/erp-tools/node/bin）
export PATH="$HOME/erp-tools/node/bin:$PATH"
npm install
npm run dev        # http://localhost:5174(后端 5000、老前端 5173)
```

## 验证（提交前必跑）

```bash
npx vitest run     # 单测
npx tsc -b         # 类型 0 错
npx oxlint         # ≤4 warning(存量基线:ui/button.tsx、TabsContext.tsx、AccountsPage.tsx、ProductionPage.tsx)
```

## 约定

- 菜单树/卡片宫格:`src/nav/menu.ts`;新旧路由映射:`src/nav/legacy.ts`
- 权限菜单键逐页 `const MENU = "..."`,须与后端 `src/ErpApi/Features/Admin/MenuCatalog.cs` 一致
- 设计令牌:`src/future.css`;硬纪律:无 em/en dash、无 emoji、图标仅 @phosphor-icons、弹窗必有 DialogHeader/Title
