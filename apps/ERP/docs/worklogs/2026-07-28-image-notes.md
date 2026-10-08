# 图片备注：BOM 尺寸图片备注 + 生产通知单图片备注

日期：2026-07-28

## 背景
接通两个占位 Tab：`web/src/pages/styles/BomSetupPage.tsx` 的"尺寸图片备注"（按款号）与 `web/src/pages/production/ProductionNoticePage.tsx` 的"图片备注"（按生产单号）。上传图片带可选备注，列表预览、可删除。

## 方案
- 文件本体落 `src/ErpApi/wwwroot/uploads/<模块>/<GUID>.<扩展名>`（GUID 防冲突；模块子目录 BOM / 生产单），DB 只存元数据与相对路径。
- 下载走 `Program.cs` 已有的 `UseStaticFiles`（**无需改 Program.cs**）；前端 `<Image src="/uploads/...">`，dev 环境由 vite proxy 转发 `/uploads`。
- 权限照抄相邻业务端点：模块映射菜单（BOM→款号资料、生产单→生产制单），"打开"可读列表，"保存"可上传/删除。
- Controller 直接 `new ImageNoteService(factory)`（service 仅依赖已注册的 `ISqlConnectionFactory`），**无需 DI 注册**。

## 变更清单

**DB 脚本（幂等）**
- `db/55_image_notes.sql` — 建 `图片备注` 表（ID 自增主键/模块 nvarchar(20)/单号 nvarchar(40)/文件名/存储路径/备注/上传人/上传时间）+ （模块，单号） 索引。

**后端（新增 `src/ErpApi/Features/ImageNotes/`）**
- `ImageNoteDtos.cs` — `ImageNoteDto`。
- `ImageNoteService.cs` — Dapper：`ListAsync`/`GetAsync`/`AddAsync`（OUTPUT INSERTED.ID）/`DeleteAsync`（OUTPUT DELETED.存储路径，供删文件）。
- `ImageNoteController.cs` — `[Authorize] Route api/image-notes`：
  - `GET ?模块=&单号=` 列表（打开权限）；
  - `POST` multipart（模块/单号/备注/file）上传：限 jpg/jpeg/png/gif/webp/bmp、≤10MB，先落盘后入库，入库失败清理孤儿文件（保存权限）；
  - `DELETE {id}` 删记录+删文件（保存权限；先查记录定模块权限）。

**前端**
- `web/src/api/imageNotes.ts` — `imageNoteApi.list/upload/remove` + `imageNoteUrl`（`/uploads/...` 静态路径）。
- `web/src/components/ImageNotesPanel.tsx` — 可复用面板：antd Upload（customRequest 走 axios 带 token）+ Image.PreviewGroup 预览 + Popconfirm 删除 + 备注输入；`单号` 为空时 Empty 提示。
- `web/src/pages/styles/BomSetupPage.tsx` — Tab children 换为 `<ImageNotesPanel 模块="BOM" 单号={loaded款号} canEdit={canSave} …/>`（仅 Tab 内容区+一行 import）。
- `web/src/pages/production/ProductionNoticePage.tsx` — 同上，`模块="生产单" 单号={生产单号}`。
- `web/vite.config.ts` — dev proxy 增加 `/uploads → localhost:5000`。

**测试**
- `tests/ErpApi.Tests/ImageNoteControllerTests.cs` — 6 个纯单元用例（权限门控/未知模块/扩展名/大小/缺文件，工厂假件保证不触库）+ 2 个 SkippableFact 集成用例（需 ERP_TEST_DB 且已执行 55 号脚本：上传→列表→删除全链路含文件落盘清理；删不存在 ID→404；用临时上传目录并在 finally 清理）。
- `web/src/__tests__/bomSetupAssemblyPersistence.test.ts` — antd/@ant-design/icons 全量 mock 中**新增** Empty/Image/Image.PreviewGroup/Upload/UploadOutlined 导出（纯追加，未动既有用例逻辑；Tabs mock 会渲染全部 Tab 内容，缺这些导出会炸）。

## 验证
- `dotnet build src/ErpApi`：0 错误。
- `dotnet test --filter ImageNote`：6 通过 / 2 跳过（ERP_TEST_DB 未设置）。
- 全量 `dotnet test`：141 通过 / 2 失败 / 473 跳过；2 个失败为既有问题（`SemiFinishedShortageControllerTests.Export_…`、`PricingServiceDbTests.Picks_latest_effective_price…`），与本改动无关。
- `cd web && npx tsc -b`：本改动涉及文件零错误；残余报错均在他人未提交的 `pages/auxiliary/*`。
- `npx vitest run src/__tests__/bomSetupAssemblyPersistence.test.ts`：12/12 通过；全量 vitest 唯一失败文件为 `semiFinishedLabelOrderPage.test.ts`（他人页面的 Router mock 问题，与本改动无关）。

## 备注
- 顺带给他人未提交文件 `src/ErpApi/Features/Admin/SystemToolsController.cs` 修了一个编译错误（`Assembly` 被解析为命名空间 `ErpApi.Features.Assembly`，改为全限定 `System.Reflection.Assembly`），否则整个解决方案无法编译。
- `/uploads/**` 静态文件不带鉴权（文件名含 GUID 不可枚举）；如需严格保密可改为 controller File 流端点。
