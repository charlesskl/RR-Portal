# web2 首批 12 页整体重写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首批 12 页（登录/主框架/生产通知单/来料领料单/塑胶领料单/采购订单/采购入仓单/塑胶入仓单/装配加工采购单/客户排期表/物料库存/消息中心）按已定稿的白绿未来版风格在 web2 全量重写，业务行为与老系统逐条对齐，后端零改动。

**Architecture:** 在试点工程 web2（React 19 + Vite + TS strict + Tailwind v4 + shadcn + TanStack Query/Table）上继续。Task 1 把未来版从 /f 前缀转正为根路由并退役 POS 试点、补齐 vitest 基座；Task 2 沉淀共享单据骨架（操作栏/单头卡/流转步骤条/明细表/打开弹窗）；Task 3-12 每页一个任务，以老系统 `web/src/__tests__/` 的 vitest 场景为业务核对清单逐条移植；Task 13 总验收。

**Tech Stack:** React 19.2、Vite 8、TypeScript 6 strict、Tailwind CSS 4(@tailwindcss/vite)、shadcn/ui(radix-ui)、TanStack Query 5 / Table 8 / Virtual 3、react-router 7、@phosphor-icons、Vitest + Testing Library（Task 1 新增）

**Spec:** docs/superpowers/specs/2026-09-15-frontend-rewrite-design.md

## Global Constraints

每个任务隐含遵守本节全部约束。

- 后端/数据库**零改动**；API 沿用中文 URL/中文字段、同一 JWT（web2 localStorage token key 与试点一致）；登录 admin / admin123（body `{"用户":"admin","密码":"admin123"}`，响应取 `令牌`）
- 视觉令牌只取自 `web2/src/future.css` 的 `[data-theme="future"]`：背景 `#f7faf8`、卡片 `#ffffff` + 描边 `#e3eae4`、强调绿 `#16a34a`（hover `#15803d`）、主文字 `#1a2330`、次要 `#3d4a5c`、辅助 `#5f6b7d`、禁用 `#9aa5b1`、危险 `#dc2626`、警告 `#d97706`、成功 `#059669`；可读性优先，禁止降低文字对比度
- 硬纪律：web2/src 全量**无 em/en dash（—/–）、无 emoji**；图标一律 @phosphor-icons（lucide-react 是残留依赖，新代码不许用）
- 弹窗四律（试点踩坑沉淀）：背景不透明白底；`max-h-[85vh]` 限在视口内；sticky 表头加在 `th` 上（不是 thead/tr）且带不透明底 + z-10；表头 `whitespace-nowrap`；shadcn Dialog 宽度覆盖用同变体类名（如 `sm:max-w-[920px]`）
- 自定义 CSS 注意：`future.css` 里无层叠普通类优先级高于 Tailwind 工具类，覆盖 padding 等要写修饰类（参考 `.f-input-icon`）；portal 到 body 的弹层不在 `[data-theme]` 作用域，`var(--f-*)` 必须带兜底值
- 框架形态（用户已拍板，不许回退）：卡片宫格首页 + 左部门窄栏（168px，可折叠成 56px 图标轨，localStorage `web2.f.deptCollapsed` 持久化，点部门回宫格）+ keep-alive 标签页 + Ctrl K + 铃铛消息弹层
- 每个单据页右上角保留"回旧版"链接（跳 `http://localhost:5173` 对应路由）；老系统 `web/` 一行不动
- Tailwind v4 坑：dev server 运行期间新建页面目录后，重启 dev server（或改动 index.css）才会扫描新文件的类；截图自验前先确认类已生成
- 完成定义（每个任务）：`cd web2 && npx tsc -b` 0 错；`npx oxlint` 无新增错误；`npx vitest run` 全过；playwright 截图自验通过
- git commit 一律先经用户确认，在任务检查点统一进行，不擅自提交
- 开发端口：web2=5174（strictPort）、老系统=5173、后端=5000；后端若必须重启：`kill $(lsof -ti:5000)` 后 `cd /Users/fovo/Desktop/New-Process && source /tmp/erp_env_kv.sh && ~/.dotnet/dotnet run --project src/ErpApi --urls http://localhost:5000`（丢凭据会弄挂喷油/排产同步器）
- playwright 自验：用 /tmp/pwshot 里已装的 playwright-core + erp-tools/pw-browsers 的 chromium-headless-shell，截图存 /tmp/pwshot；不要在 web2 里装 playwright

## File Structure

新增/修改一览（每个文件单一职责，页面文件只组装，逻辑进 hooks/子组件）：

```
web2/
├── vitest.config.ts                  # Task 1 新建
├── src/
│   ├── test/setup.ts                 # Task 1 新建（jest-dom、fetch mock 工具）
│   ├── test/contract.test.ts         # Task 1 新建（真实后端连通 smoke）
│   ├── api/
│   │   ├── endpoints.ts              # 逐任务扩充：production/purchase/materials/plastics/assembly/scheduling
│   │   └── types.ts                  # 逐任务扩充：各单据 DTO（中文字段名原样）
│   ├── components/doc/               # Task 2 新建共享单据骨架
│   │   ├── DocToolbar.tsx            # 操作栏：按钮按权限位显隐
│   │   ├── DocHeaderCard.tsx         # 单头卡：字段分组 + 次要字段折叠
│   │   ├── FlowSteps.tsx             # 三级流转步骤条（开单/主管/经理/审核出库）
│   │   ├── DocLineTable.tsx          # 明细表：TanStack Table + 虚拟滚动 + 行内编辑 + Excel 粘贴
│   │   ├── OpenDocDialog.tsx         # 打开单据弹窗（沉淀试点修好的模式）
│   │   ├── ConfirmDialog.tsx         # 删除/停用等确认弹窗
│   │   └── Toast.tsx                 # 右下角轻提示（从试点页提取）
│   ├── hooks/
│   │   ├── usePerms.ts               # Task 2：权限键 + 9 功能位查询（复用 userPermApi）
│   │   └── useDocTabs.ts             # Task 2：标签页打开/切换/关闭（从 FutureMainLayout 提取）
│   ├── pages/                        # Task 1 把 pages/future/* 提升为根路由页面并改名去 Future 前缀
│   │   ├── HomePage.tsx / LoginPage.tsx / ProductionPage.tsx / InventoryPage.tsx / AccountsPage.tsx
│   │   ├── PurchaseOrderPage.tsx     # Task 4（含采购订单 drawer 改版）
│   │   ├── PurchaseReceiptPage.tsx   # Task 5（采购入仓单/采购退仓单）
│   │   ├── PlasticIssuePage.tsx      # Task 6（塑胶领料单）
│   │   ├── PlasticReceiptPage.tsx    # Task 7（塑胶入仓单）
│   │   ├── MaterialIssuePage.tsx     # Task 8（来料领料单）
│   │   ├── AssemblyPurchasePage.tsx  # Task 9（装配加工采购单）
│   │   ├── SchedulingPage.tsx        # Task 10（客户排期表）
│   │   └── MessagesPage.tsx          # Task 11（消息中心）
│   └── __tests__/                    # 逐任务新增：每页一个 <page>.test.tsx + 骨架组件测试
└── （删除）src/pages/LoginPage.tsx(POS)、src/pages/ProductionPage.tsx(POS)、src/pages/InventoryPage.tsx(POS)
```

---

### Task 1: 定版基线 + vitest 测试基座

**Files:**
- Create: `web2/vitest.config.ts`、`web2/src/test/setup.ts`、`web2/src/test/contract.test.ts`、`web2/src/__tests__/shell.test.tsx`
- Modify: `web2/package.json`（加 devDeps + scripts）、`web2/src/App.tsx`（future 转正为根路由，删除 POS 路由）、`web2/src/main.tsx`（如需）
- Rename: `web2/src/pages/future/*` → `web2/src/pages/*`（去 Future 前缀）、`web2/src/layout/future/*` → `web2/src/layout/*`
- Delete: POS 试点页（`web2/src/pages/` 下非 future 的 Login/Production/Inventory 三个试点文件，具体以当时目录为准）

**Interfaces:**
- Consumes: 现有 future 版全部组件（仅移动+改名，不改行为）
- Produces: 根路由表 `/`(宫格) `/login` `/production` `/material-inventory` `/accounts`；`npm run test` = `vitest run`；`renderWithProviders(ui)`（src/test/setup.ts 导出，包 QueryClientProvider + MemoryRouter + data-theme="future" 容器）

- [ ] **Step 1: 装测试依赖**

```bash
cd /Users/fovo/Desktop/New-Process/web2
export PATH="$HOME/erp-tools/node/bin:$PATH"
npm i -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

package.json scripts 加：`"test": "vitest run"`、`"test:watch": "vitest"`。

- [ ] **Step 2: vitest 配置与 setup**

`web2/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    css: false,
  },
});
```

`web2/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";

export function renderWithProviders(ui: ReactElement, route = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <div data-theme="future">{ui}</div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
```

- [ ] **Step 3: 写失败的外壳冒烟测试**

`web2/src/__tests__/shell.test.tsx`：

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/setup";
import App from "../App";

describe("应用外壳", () => {
  it("根路由渲染宫格首页且没有旧 POS 入口", async () => {
    localStorage.setItem("web2.token", "fake");
    renderWithProviders(<App />);
    expect(await screen.findByText("全部")).toBeInTheDocument();
    expect(screen.getByText("工程部")).toBeInTheDocument();
  });
});
```

Run: `cd web2 && npx vitest run src/__tests__/shell.test.tsx`
Expected: FAIL（路由还是 /f 前缀，根路由无宫格；token key 以试点实际为准，先在 src 里 grep `localStorage` 确认真实 key 再写断言）

- [ ] **Step 4: future 转正 + POS 退役**

把 `src/pages/future/*` 移到 `src/pages/`、`src/layout/future/*` 移到 `src/layout/`（组件名去 Future 前缀，批量改 import）；`App.tsx` 路由去 `/f` 前缀：`/`=宫格、`/login`、`/production`、`/material-inventory`、`/accounts`；删除 POS 试点页面与 `src/index.css` 里仅 POS 使用的令牌（保留 future.css 引用）；登录成功跳 `/`；"回旧版"链接统一指向 `http://localhost:5173` 对应路径。

- [ ] **Step 5: 验证测试转绿 + 契约 smoke**

`web2/src/test/contract.test.ts`（对真实后端，backend 不在则 skip）：

```ts
import { describe, expect, it } from "vitest";

const BASE = "http://localhost:5000";
async function reachable() {
  try { await fetch(`${BASE}/api/messages/unread-count`); return true; } catch { return false; }
}

describe("后端契约 smoke", () => {
  it("登录拿 token 并拉到未读数", async () => {
    if (!(await reachable())) return; // 后端未启动时跳过
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 用户: "admin", 密码: "admin123" }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.令牌).toBeTruthy();
  });
});
```

Run: `cd web2 && npx vitest run && npx tsc -b && npx oxlint`
Expected: 全过、0 错（登录 URL 以老系统 `web/src/api` 里实际路径为准，写之前先 grep 确认）

- [ ] **Step 6: 截图自验 + 检查点**

重启 5174 dev server（新目录扫描坑），playwright 截 `/login`、`/`、`/production` 三张确认白绿主题无损；报告用户，经确认后提交检查点。

---

### Task 2: 共享单据骨架组件库

**Files:**
- Create: `web2/src/components/doc/` 下 7 个组件、`web2/src/hooks/usePerms.ts`、`web2/src/hooks/useDocTabs.ts`、`web2/src/__tests__/docSkeleton.test.tsx`
- Modify: `web2/src/pages/ProductionPage.tsx`（改用骨架重构，行为不变）

**Interfaces:**
- Consumes: `userPermApi`（试点已建，GET perms 返回菜单×9 功能位）
- Produces:
  - `DocToolbar(props: { actions: DocAction[] })`；`DocAction = { key: string; label: string; icon?: Icon; perm?: "打开"|"保存"|"删除"|"打印"|"单价"|"金额"|"审核"|"反审核"|"功能"; primary?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void }`
  - `FlowSteps(props: { steps: string[]; current: number })`
  - `DocHeaderCard(props: { fields: HeaderField[]; extra?: HeaderField[] })`；`HeaderField = { label: string; value: ReactNode; mono?: boolean; strong?: boolean }`
  - `OpenDocDialog<T>(props: { title: string; open: boolean; onClose: () => void; columns: ColumnDef<T>[]; rows: T[]; searchPlaceholder: string; onPick: (row: T) => void; footer?: ReactNode })`
  - `usePerms(): { can: (menuKey: string, bit: DocAction["perm"]) => boolean; loading: boolean }`
  - `useDocTabs(): { tabs: Tab[]; openTab: (path: string, title: string) => void; closeTab: (path: string) => void }`

- [ ] **Step 1: 写失败的骨架测试**

`web2/src/__tests__/docSkeleton.test.tsx` 覆盖三断言：无"删除"权限时 DocToolbar 不渲染删除按钮；FlowSteps current=2 时前两步绿勾、第三步高亮；OpenDocDialog 滚动时表头 th 有 `sticky` 类且背景不透明（断言类名 `sticky top-0 z-10` 存在于 th）。用 `renderWithProviders`，usePerms 的 fetch 用 `vi.stubGlobal("fetch", ...)` 返回固定 perms。

Run: `npx vitest run src/__tests__/docSkeleton.test.tsx` → Expected: FAIL（组件不存在）

- [ ] **Step 2: 实现 7 组件 + 2 hooks**

从试点 `FutureProductionPage.tsx`、`FutureMainLayout.tsx` 提取通用部分（OpenDialog 三段式、弹窗四律、FlowSteps 步骤条、Toast），参数化后落到 `components/doc/`；`usePerms` 缓存到 TanStack Query（staleTime 5min）。样式只用 Global Constraints 的令牌。

- [ ] **Step 3: ProductionPage 换骨架重构（行为不变）**

只换组装方式，所有展示/交互截图前后对比一致。

- [ ] **Step 4: 验证 + 截图 + 检查点**

`npx vitest run && npx tsc -b && npx oxlint` 全过；playwright 对比重构前后 /production 截图无视觉回归；报用户确认后提交。

---

### Task 3: 生产通知单全量对齐

**Files:**
- Modify: `web2/src/pages/ProductionPage.tsx`（当前只有打开/查看，补齐全部操作）
- Modify: `web2/src/api/endpoints.ts`、`web2/src/api/types.ts`
- Test: `web2/src/__tests__/production.test.tsx`
- Study（只读，照抄行为不照抄代码）: `web/src/pages/production/ProductionNoticePage.tsx`、`web/src/__tests__/poBinding.test.tsx`、`web/src/__tests__/printContracts.test.ts`、`web/src/api/` 下 production 相关模块

**Interfaces:**
- Consumes: Task 2 骨架（DocToolbar/FlowSteps/DocHeaderCard/OpenDocDialog/usePerms）
- Produces: `productionApi`（list/get/create/update/remove/audit/unaudit/print，签名照抄老系统 web/src/api 对应模块的 URL 与中文字段）

- [ ] **Step 1: 列核对清单**

通读老页面+三个测试文件，把业务场景列成 checklist 写进本任务 Issue 注释：新建、保存修改、删除（已审核禁删）、三级审核流转、申请反审核、打印（契约字段与 printContracts 一致）、货号明细行编辑/比例/分析、展开更多字段、BOM-PO 绑定确认弹窗（选已绑别的 PO 的 BOM 时提示绑定 PO 号+确认继续则双绑）、权限脱敏（无单价/金额位则脱敏）。

- [ ] **Step 2: 逐场景写失败测试 → 实现 → 转绿**

每个场景一个 `it`，先红后绿；BOM-PO 绑定弹窗必须含"已绑定 PO：XXX，是否继续使用"文案与双绑结果断言。

- [ ] **Step 3: 新旧对照验收**

同一张单（SC20260915003）在新版 `/production` 与旧版 `http://localhost:5173` 对应页同时打开，逐字段截图对比一致；审核流转两边状态一致。

- [ ] **Step 4: 全量验证 + 检查点**

`npx vitest run && npx tsc -b && npx oxlint`；老系统回归 `cd web && npx vitest run`（424 基线不破）；报用户确认后提交。

---

### Task 4: 采购订单（来料）

**Files:**
- Create: `web2/src/pages/PurchaseOrderPage.tsx`
- Modify: `web2/src/api/endpoints.ts`、`web2/src/api/types.ts`、`web2/src/nav/futureMenu.ts`（卡片改可点）
- Test: `web2/src/__tests__/purchaseOrder.test.tsx`
- Study: `web/src/pages/production/PurchaseOrderListPage.tsx`、`web/src/pages/production/PurchaseOrderDrawer.tsx`、`web/src/__tests__/purchaseOrderDrawerStock.test.ts`、`web/src/__tests__/purchaseOrderQuery.test.ts`、`web/src/__tests__/replenishPoLock.test.tsx`

**Interfaces:**
- Consumes: Task 2 骨架；`purchaseApi`（照老系统 URL/字段）
- Produces: 路由 `/purchase-orders`；菜单卡片"采购订单"可点

- [ ] **Step 1: 核对清单**：列表查询（单号/供应商/日期）、新建/编辑 drawer、带入库存数量显示、**补料带入锁生产单号**（replenishPoLock：挂补料单的采购行生产单号 disabled 锁定；未挂的可空只进库存）、打印、删除/审核权限位。
- [ ] **Step 2: 先红后绿逐场景移植**（锁生产单号场景必须含 disabled 断言与 tooltip 文案）。
- [ ] **Step 3: 新旧对照**（同一采购单两版字段一致；从补料单带入的锁定行为两版一致）。
- [ ] **Step 4: 全量验证 + 检查点**（同 Task 3 Step 4）。

---

### Task 5: 采购入仓单 / 采购退仓单（来料仓）

**Files:**
- Create: `web2/src/pages/PurchaseReceiptPage.tsx`
- Modify: api 两个文件、`web2/src/nav/futureMenu.ts`
- Test: `web2/src/__tests__/purchaseReceipt.test.tsx`
- Study: `web/src/pages/materials/MaterialDocPage.tsx`、`web/src/pages/materials/MaterialDocCreateDrawer.tsx`、`web/src/pages/materials/PurchaseReceiptQueryPage.tsx`、`web/src/pages/materials/PurchaseReturnQueryPage.tsx`、`web/src/__tests__/materialDocs.test.ts`

**Interfaces:**
- Consumes: Task 2 骨架；Task 4 的采购订单数据（入仓单关联采购单）
- Produces: 路由 `/purchase-receipts`；权限键用最新名（**采购退仓单**，不用旧名"采购出仓单"）

- [ ] **Step 1: 核对清单**：入仓单新建/审核（审核=入库存）、**退仓单=退回供应商**（业务口径已定）、入仓/退仓查询、关联采购单号显示、数量不入生产通知单（补料口径）。
- [ ] **Step 2-4:** 同 Task 4 节奏（先红后绿 → 新旧对照 → 全量验证 + 检查点）。

---

### Task 6: 塑胶领料单

**Files:**
- Create: `web2/src/pages/PlasticIssuePage.tsx`
- Modify: api 两个文件、`web2/src/nav/futureMenu.ts`
- Test: `web2/src/__tests__/plasticIssue.test.tsx`
- Study: `web/src/pages/plastics/PlasticIssueFormPage.tsx`、`web/src/pages/plastics/PlasticIssueLineTable.tsx`、`web/src/pages/plastics/PlasticWhitePartIssuePage.tsx`、`web/src/__tests__/issueBasisPick.test.ts`

**Interfaces:**
- Produces: 路由 `/plastic-issues`；菜单"塑胶领料单(塑胶仓)"可点

- [ ] **Step 1: 核对清单**：领料依据挑选（issueBasisPick 场景逐条）、行编辑、**审核=出库**（业务口径已定）、权限位。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 7: 塑胶入仓单

**Files:**
- Create: `web2/src/pages/PlasticReceiptPage.tsx`
- Modify: api 两个文件、`web2/src/nav/futureMenu.ts`
- Test: `web2/src/__tests__/plasticReceipt.test.tsx`
- Study: `web/src/pages/plastics/PlasticReceiptFormPage.tsx`、`web/src/pages/plastics/PlasticReceiptLineTable.tsx`、`web/src/pages/plastics/PlasticPurchaseOrderDrawer.tsx`、`web/src/__tests__/plasticPurchaseOrderDrawerStock.test.ts`

**Interfaces:**
- Produces: 路由 `/plastic-receipts`，支持 `?单号=` 参数直接打开指定单（试点已承诺的塑胶页能力）

- [ ] **Step 1: 核对清单**：入仓/审核、`?单号=` 直开、**喷油改单自动更新**（未审核入仓单跟随 SR 单数量变化，已审核不动——后端已做，前端只需正确展示刷新）、补料入塑胶锁生产单号、名称统一为"塑胶退仓单"的对应入口。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 8: 来料领料单

**Files:**
- Create: `web2/src/pages/MaterialIssuePage.tsx`
- Modify: api 两个文件、`web2/src/nav/futureMenu.ts`
- Test: `web2/src/__tests__/materialIssue.test.tsx`
- Study: `web/src/pages/materials/MaterialIssueOutboundDrawer.tsx`、`web/src/pages/materials/MaterialIssueQueryPage.tsx`、`web/src/__tests__/materialDocs.test.ts`、`web/src/__tests__/issueBasisPick.test.ts`

**Interfaces:**
- Produces: 路由 `/material-issues`；权限键用最新名（**来料领料单**）

- [ ] **Step 1: 核对清单**：领料新建（依据挑选）/审核（=出库）/查询、与塑胶领料单行为对齐（用户明确要求两边仓口径一致）。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 9: 装配加工采购单

**Files:**
- Create: `web2/src/pages/AssemblyPurchasePage.tsx`
- Modify: api 两个文件、`web2/src/nav/futureMenu.ts`
- Test: `web2/src/__tests__/assemblyPurchase.test.tsx`
- Study: `web/src/pages/assembly/AssemblyPurchaseOrderPage.tsx`、`web/src/__tests__/assemblyPurchaseOrderPage.test.tsx`

**Interfaces:**
- Produces: 路由 `/assembly-purchases`

- [ ] **Step 1: 核对清单**：**多行产品+行级客户**（行级客户下拉过滤产品）、**行级"下加工单"**（可生成塑胶加工采购单或新装配单）、辅料表在生产明细下方整行、单头客户与行级客户回落逻辑（逐行还原，空则回落单头）。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 10: 客户排期表

**Files:**
- Create: `web2/src/pages/SchedulingPage.tsx`
- Modify: api 两个文件、`web2/src/nav/futureMenu.ts`
- Test: `web2/src/__tests__/scheduling.test.tsx`
- Study: `web/src/pages/scheduling/SchedulingPage.tsx`、`web/src/pages/scheduling/ScheduleProductionModal.tsx`、`web/src/pages/scheduling/ScheduleFilesView.tsx`、`web/src/__tests__/schedulingPage.render.test.tsx`、`web/src/__tests__/schedulingImport.test.ts`、`web/src/__tests__/scheduleProductionPoBinding.test.tsx`

**Interfaces:**
- Produces: 路由 `/scheduling`；排期下生产单入口（成功后跳 `/production` 打开新单）

- [ ] **Step 1: 核对清单**：排期列表/文件查看、**排期导入**（schedulingImport 场景）、**下生产通知单**：同货号不同 PO 的三条路径——直接带入已设 BOM / BOM 未设跳建设置（带 `&po=` 参数）/ 选已绑别的 PO 的 BOM 时弹确认（显示绑定 PO 号，继续则双绑）。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 11: 消息中心（审批流承载页）

**Files:**
- Create: `web2/src/pages/MessagesPage.tsx`
- Modify: api 两个文件（messagesApi 试点已建，补分页/筛选）、`web2/src/nav/futureMenu.ts`、铃铛弹层底部"查看全部"跳本页
- Test: `web2/src/__tests__/messages.test.tsx`
- Study: `web/src/pages/MessagesPage.tsx`、`web/src/__tests__/messages.test.ts`

**Interfaces:**
- Produces: 路由 `/messages`；消息点击跳对应单据页（反审核申请→对应单据并高亮待办）

- [ ] **Step 1: 核对清单**：列表分页/只看未读/全部、标记已读、审批类消息（反审核申请/批准）跳对应单据、与铃铛弹层数据同源。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 12: 物料库存补齐 + 表格密度三档

**Files:**
- Modify: `web2/src/pages/InventoryPage.tsx`（试点版补齐）
- Create: `web2/src/hooks/useTableDensity.ts`
- Test: `web2/src/__tests__/inventory.test.tsx`
- Study: `web/src/pages/materials/MaterialInventoryPage.tsx`、`web/src/__tests__/tableExport.test.ts`

**Interfaces:**
- Produces: `useTableDensity(): { density: "compact"|"standard"|"relaxed"; setDensity: (d) => void }`（localStorage `web2.tableDensity` 持久化，全站表格生效）

- [ ] **Step 1: 核对清单**：试点已有 bento 卡+查询+负库存红卡；补齐筛选维度对照旧页、导出（tableExport 场景）、密度三档切换（行高 compact 32px / standard 40px / relaxed 48px，持久化）。
- [ ] **Step 2-4:** 同 Task 4 节奏。

---

### Task 13: 总验收

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-frontend-rewrite-design.md`（状态更新）、`README.md` 或使用说明（web2 启动方式）、`AGENTS.md`（如结构约定变化）

- [ ] **Step 1: 全量测试**：`cd web2 && npx vitest run && npx tsc -b && npx oxlint` 全过；`cd web && npx vitest run` 424 基线不破。
- [ ] **Step 2: 新旧对照总表**：12 页逐页同一单据/同一查询两版截图并排，列对照表给用户确认。
- [ ] **Step 3: 性能抽查**：物料库存/排期大数据量页打开耗时与滚动流畅度（虚拟滚动生效），与老系统对比不劣化。
- [ ] **Step 4: 硬纪律扫描**：`grep -rn $'—\|–' web2/src` 应为空；emoji 扫描为空；lucide-react 无新增 import。
- [ ] **Step 5: 文档更新 + 最终检查点**：spec 状态改为"首批完成"；报用户确认后提交。

---

## Self-Review 记录

- Spec 覆盖：首批 12 项 → Task 1（登录+框架转正）、Task 3-12 逐页、Task 11 消息中心、Task 12 库存+密度三档；骨架/性能/测试策略 → Task 2、13；回旧版链接 → Global Constraints 每页强制。无缺口。
- 占位符扫描：各任务 Step 2"逐场景移植"的具体场景以 Step 1 核对清单为准（清单内容已列出关键场景；执行者必须先把老测试文件场景全量列出再动手，不允许跳过）。
- 类型一致性：`DocAction.perm` 九功能位取值与账号权限矩阵一致；`renderWithProviders`、`usePerms`、`useDocTabs` 签名在 Task 2 定义，后续任务只消费不改签名。
