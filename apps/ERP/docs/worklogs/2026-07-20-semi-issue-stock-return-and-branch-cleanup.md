# 2026-07-20 · 半成品出库/退库单 + 系统性接线修复 + 分支彻底清理

**分支** `codex/semi-finished-label-order` → 合并 master `928ec20`。

## 一、本会话交付的单据(逐单复刻,自由选产品版)

延续「半成品退仓单(自由选产品版)」,本会话按用户截图新增两张 + 收尾一张:

### 1. 半成品退仓单(自由选产品版)· 收尾合并
- 上一会话 Task1-6 已提交,本会话做 **Task7 冒烟 + 终审 + 合并**。
- 冒烟修两处:①迁移只部署了 erp_test 漏 erp(create 515)→ 部署到 erp;②权限种子漏 单价/金额(新页金额列超管都看不到)→ 补位 commit `f1e3347`。
- 合并 master(快进)。详见 [memory] semi-warehouse-return-freeselect-wip。

### 2. 半成品出库单(= 现有 SemiIssue / 半成品领料单)· 重写
- **识别**:菜单 `半成品出库单 → /semi-issues → 半成品领料`,后端 SemiIssue 已存在但是旧列表+抽屉极简形态 → **重写**为全屏领料式主从 + 自由选产品(镜像退仓)。
- 复用 半成品领料单/明细单表(方向减已在 union);富领料头(部门/领料人/拉长/收件人/领料备注/件数/卡板数/制单人)加 6 列;右侧库存参考网格;无价;审核复用 PostingEngine;前缀 BL。
- 8 任务 subagent-driven(两阶段审查);P5c 集成测试 5/5、HTTP 冒烟 98→68→98。合并 master `53b69dd`。详见 [memory] semi-issue-freeselect。

### 3. 半成品退库单(净新)· 新建
- **净新单据**(退库=生产领用料退回仓,方向 **+ 增库存**,出库的对手单)。净新两表 `半成品退库单/明细单`;SemiSql 加第 5 分支 `数量*+1`;简头(部门/退料人);无右侧网格;无价;审核 PostingEngine;前缀 BTK。
- 全套接入(表/种子/DI/白名单/MenuCatalog/菜单/路由/union)。8 任务;DB 测试 100→130→100、HTTP 冒烟 98→128→98。详见 [memory] semi-stock-return-freeselect。

## 二、系统性发现与修复(本会话最重要)

做退库单时,subagent 整文件提交共享 wiring(App.tsx/Program.cs/menuTree)暴露出:**本分支长期堆积大量未提交在建工作,导致此前"已合并"的功能在 master 上实际损坏**:

1. **共享 picker `SemiFinishedLabelProductPicker.tsx` + `api/semiFinishedLabelOrders.ts` 从未提交** → master 上退仓/出库两页前端**编译不过**。
2. 退仓的 SemiSql union 分支、DI 注册、PostableDocuments 白名单也一直未提交 → master 上退仓审核不减库存 + 端点 500。
3. App.tsx/Program.cs 里还有 assembly/auxiliary/plastics 等**引用 43 个未提交页面 + 若干未提交服务类**的在建接线;subagent 整文件 `git add` 把它们提进来 → **HEAD 不自洽(干净检出构建失败)**。

**关键手段:用干净 git worktree(`git worktree add --detach HEAD`)检出 HEAD 双验 `dotnet build` + `npx tsc -b` 才发现**(工作树 build 能过是因为有未提交文件兜底;grep 顶层 import 抓不到页面内部依赖如 picker)。node_modules 用 PowerShell `New-Item -ItemType Junction` 免管理员软链到 worktree。

**修复(git 手术,绝不丢用户在建工作)**:
- 提交 picker + 其 api(正当依赖)、退仓 union 分支、白名单、**退仓 DI**(用户选"先补退仓DI再合并")→ 退仓/出库/退库三单在 master 上全部可用。
- 把 App.tsx/Program.cs/menuTree 已提交版**缩减为「master + 仅退库」**(`git checkout master -- <file>` → Edit 加退库 hunk → commit → 从备份恢复工作树 bloat),其余 bloat 退回未提交。

## 三、分支彻底清理(收尾)

用户选"继续",清理分支上全部历史在建工作:

1. **补 `.gitignore`**:此前竟没忽略 `.venv/`(1849 未跟踪里绝大多数)、`publish/`、`src/ErpApi/wwwroot/`(前端构建产物)、`*.log`、`backups/`(含 `.mdf`/`.zip`)、`.superpowers/`、`.claude/worktrees/`。
2. **分 5 组提交 231 真实功能文件 + 65 改动**(后端 80 / 前端 / db / tests / docs+scripts):**辅料仓库(22页)/原料扩展(18页)/外发装配(9页)/半成品标签·欠料(5页)全部功能上 master**。
3. **干净 worktree 双验**后端 build + 前端 tsc 全 0 错 → 快进 master `928ec20`。**工作树彻底干净(0 未跟踪 / 0 改动)**。

## 四、教训(记入记忆)

- **逐单复刻应每单及时提交全部相关文件(含共享依赖 picker、wiring App.tsx/Program.cs/menuTree/白名单/MenuCatalog)并 gitignore 垃圾**,避免 HEAD 与工作树长期背离——否则冒烟用工作树能过、master 实际是坏的。
- **净新单据/共享依赖首次引入,合并前必须用干净 worktree 检出 HEAD 双验 build/tsc**,不能只靠工作树 build。
- **subagent 提交共享文件会连带 staged 该文件的预存未提交改动**;在有大量在建工作的分支上须 `git diff` 核实,整文件提交可能带进引用未提交文件的 bloat 致 HEAD 不自洽。

## 五、部署提醒

生产库须部署本会话各功能的 db 迁移/种子:半成品退库 `db/migrate_semi_stock_returns.sql`+`db/seed_semi_stock_return_perms.sql`,以及一并提交的辅料/原料/装配等模块 db 脚本。
