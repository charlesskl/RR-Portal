# VoyagePlex 船务协同系统

V0.1项目骨架，面向公司局域网部署。

## 当前模块

- 信息导入：批量 EML 解析、邮箱自动收取与按收件日期查询读取明细
- 走柜任务：日历安排、任务列表、走柜表生成入口与已完成记录
- 验货结果补录
- 订单信息库
- 系统设置
- 用户管理：登录、三类角色、账号启停与密码重置

## 首次使用

首次打开系统会进入管理员初始化页面。创建首个管理员后即可登录，并在“用户管理”中创建船务员和仓库文员账号。密码至少 8 位；重置密码或停用账号会使该用户现有登录立即失效。

## 技术栈

- Next.js 14.2、React 18、TypeScript 5、Tailwind CSS 3
- ASP.NET Core 8、Entity Framework Core 8、SQLite
- 后续接入ExcelJS与Open XML处理导入导出

## 本地运行

前端：`npm install && npm run dev`

后端：`dotnet run --project server/VoyagePlex.Api`

邮件解析服务：参见 `services/email-parser/README.md`。该服务与
`legacy-reference/READ_ONLY_RR_PORTAL/` 旧系统参考代码完全隔离。

## 邮箱自动收信

- 凭据只配置在邮件解析服务（email-parser），通过环境变量注入：
  `VOYAGEPLEX_MAIL_ADDRESS`（邮箱地址）、`VOYAGEPLEX_MAIL_AUTH_CODE`（客户端授权码）、
  `VOYAGEPLEX_MAIL_IMAP_HOST`（默认 `imaphz.qiye.163.com`）、`VOYAGEPLEX_MAIL_FOLDER`（默认 `INBOX`）。
- 首次同步读取最近 7 天邮件，每次最多 50 封，后台每 5 分钟续同步；断点续取。
- 历史初始化：管理员在“信息导入 → 邮件解析”页面预览起始日期（当前 2026-08-01）之后的邮件，
  分批确认入库；清理操作不影响已关联走柜任务的邮件。
