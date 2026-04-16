# Roadmap: 报价管理系统

## Milestones

- ✅ **v1.1 双格式支持** — Phases 1-3 (shipped 2026-04-16)
- **v1.2 SPIN 报价支持** — Phases 4-7 (active)

## Phases

<details>
<summary>✅ v1.1 双格式支持 (Phases 1-3) — SHIPPED 2026-04-16</summary>

- [x] Phase 1: 基础修复与代码整理 (1/1 plans) — completed 2026-03-28
- [x] Phase 2: 毛绒公仔解析引擎 (2/2 plans) — completed 2026-03-28
- [x] Phase 3: 前端双格式展示 (1/1 plan) — completed 2026-03-28

Full details: `.planning/milestones/v1.1-ROADMAP.md`

**Known gaps (deferred):** UI-02/UI-03 tab buttons, DB-03 duplicate fix, PLUSH-01 detection — see `.planning/v1.1-MILESTONE-AUDIT.md`

</details>

### v1.2 SPIN 报价支持

- [ ] **Phase 4: v1.1 缺口修复** — 补齐 v1.1 遗留的 UI 导航按钮和版本复制 bug
- [ ] **Phase 5: SPIN 解析引擎** — 识别 SPIN 格式并将报价明细完整存入数据库
- [ ] **Phase 6: SPIN 单款导出** — 从单个版本生成完整 SPIN Vendor Quote Form
- [ ] **Phase 7: SPIN 批量导出** — 选多个版本生成含 Summary + 多款式 sheet 的 SPIN 文件

## Phase Details

### Phase 4: v1.1 缺口修复
**Goal**: 修复版本复制时 format_type 丢失的 bug
**Depends on**: Nothing (standalone fix)
**Requirements**: FIX2-03
**Success Criteria** (what must be TRUE):
  1. 复制一个毛绒公仔版本后，新版本的 format_type 与原版本一致（不丢失）
**Plans**: 1 plan
Plans:
- [x] 04-01-PLAN.md — 在 duplicate INSERT 中补充 format_type 字段

### Phase 5: SPIN 解析引擎
**Goal**: 用户可导入 SPIN 内部报价明细 Excel，系统正确识别格式并将全部数据存入数据库
**Depends on**: Phase 4
**Requirements**: SPIN-01, SPIN-02, SPIN-03, SPIN-04
**Success Criteria** (what must be TRUE):
  1. 上传 SPIN 报价明细 Excel 后，系统识别格式为 SPIN（不误判为注塑或毛绒公仔）
  2. 导入后数据库中 MoldPart 区域数据（料型、料重、机型、件数）与源 Excel 一致
  3. 导入后数据库中车缝明细数据（布料名称、用量、物料价）与源 Excel 一致
  4. 导入的版本 format_type 字段标记为 SPIN
**Plans**: 1 plan
Plans:
- [ ] 05-01-PLAN.md — SPIN 格式识别 + MoldPart/车缝明细解析

### Phase 6: SPIN 单款导出
**Goal**: 用户可从任意 SPIN 版本导出一个完整 SPIN Vendor Quote Form Excel 文件
**Depends on**: Phase 5
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04, EXP-05
**Success Criteria** (what must be TRUE):
  1. 点击导出后可下载一个 Excel 文件，包含 Summary sheet 和对应款式 sheet
  2. 款式 sheet 的 Purchased Parts（Fabric Cost）区域数据与版本布料明细一致
  3. 款式 sheet 的 Packaging 区域（H-tag、CDU、Master carton）数据正确填入
  4. 款式 sheet 的 Labor 区域（Sewing、Packing、Cutting 工时/工价）数据正确填入
  5. 款式 sheet 的 Markup 汇总区域（Material / Packaging / Labor markup）数值正确
**Plans**: 1 plan
Plans:
- [ ] 05-01-PLAN.md — SPIN 格式识别 + MoldPart/车缝明细解析
**UI hint**: yes

### Phase 7: SPIN 批量导出
**Goal**: 用户可一次选择多个 SPIN 版本，导出含 Summary + 所有款式 sheet 的单个 SPIN 文件
**Depends on**: Phase 6
**Requirements**: EXP-06
**Success Criteria** (what must be TRUE):
  1. 导出界面支持勾选多个 SPIN 版本（至少 2 个）并触发批量导出
  2. 导出的 Excel 文件中，Summary sheet 列出所有所选款式
  3. 导出的 Excel 文件中，每个所选版本对应一个独立的款式 sheet，数据各自正确
**Plans**: 1 plan
Plans:
- [ ] 05-01-PLAN.md — SPIN 格式识别 + MoldPart/车缝明细解析
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. 基础修复与代码整理 | v1.1 | 1/1 | Complete | 2026-03-28 |
| 2. 毛绒公仔解析引擎 | v1.1 | 2/2 | Complete | 2026-03-28 |
| 3. 前端双格式展示 | v1.1 | 1/1 | Complete | 2026-03-28 |
| 4. v1.1 缺口修复 | v1.2 | 0/1 | Not started | - |
| 5. SPIN 解析引擎 | v1.2 | 0/? | Not started | - |
| 6. SPIN 单款导出 | v1.2 | 0/? | Not started | - |
| 7. SPIN 批量导出 | v1.2 | 0/? | Not started | - |
