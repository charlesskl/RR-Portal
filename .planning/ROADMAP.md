# Roadmap

## Milestone: v1.1 — 双格式支持

### Phase 1: 基础修复与代码整理
**Goal**: 提交现有未提交代码，确保注塑产品的 Raw Material 提取和产品编号识别正常工作
**Depends on**: Nothing
**Requirements**: FIX-01, FIX-02, CLEAN-01
**Success Criteria**:
  1. 导入 47712 报价明细后 Raw Material tab 显示 4 种材料（ABS 1778g、PVC 430g、PC 70g、PP 145g）
  2. 导入 L21014 报价后产品编号显示 `L21014-毛绒公仔` 而非 sheet 名称
  3. 21 个未提交文件已 commit
  4. 现有功能无回归
**Plans**: TBD

### Phase 2: 毛绒公仔解析引擎
**Goal**: 完整解析毛绒公仔报价 Excel 的所有数据，存入数据库
**Depends on**: Phase 1
**Requirements**: PLUSH-01, PLUSH-02, PLUSH-03, PLUSH-04, PLUSH-05, PLUSH-06, PLUSH-07, DB-01, DB-02, DB-03
**Success Criteria**:
  1. 导入 L21014 报价后 MoldPart 表有包胶件数据（PVC 22g）
  2. 搪胶件数据正确存储（搪胶脸 3.77 HK$、搪胶脚 3.43 HK$）
  3. 车缝明细数据正确存储（布料名称、部位、用量、物料价、码点、总价）
  4. 五金/吊咭/贴纸等子 sheet 数据正确存储
  5. 成本汇总数据（料价、人工、运费、码点、总价 USD）正确存储
  6. QuoteVersion.format_type 区分两种格式
**Plans**: TBD

### Phase 4: 修复毛绒公仔 UI Tab 与格式字段
**Goal**: 修复审计发现的三个缺口：添加车缝明细和搪胶件 tab 导航按钮，修复版本复制时 format_type 丢失，强化格式检测逻辑
**Depends on**: Phase 3
**Requirements**: UI-02, UI-03, DB-03, PLUSH-01
**Gap Closure**: 关闭 v1.1 里程碑审计缺口
**Success Criteria**:
  1. 毛绒公仔报价页面的 Body Cost Breakdown 区域可见并可点击「车缝明细」tab
  2. 毛绒公仔报价页面的 Body Cost Breakdown 区域可见并可点击「搪胶件」tab
  3. 复制毛绒公仔版本后，复制版本的 format_type 仍为 plush（而非默认 injection）
  4. 格式检测同时支持 3K报价-* sheet 名称检测和子 sheet 名称检测
**Plans**: TBD

### Phase 3: 前端双格式展示
**Goal**: 前端界面能正确展示毛绒公仔格式的所有数据，包括新增的车缝明细和搪胶件 tab
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03
**UI hint**: yes
**Success Criteria**:
  1. 切换到 L21014 版本时，Raw Material 显示包胶件 PVC 材料数据
  2. 毛绒公仔版本显示车缝明细 tab，列出所有布料裁片及价格
  3. 毛绒公仔版本显示搪胶件 tab，列出搪胶部件及价格
  4. 注塑产品版本不显示车缝/搪胶 tab（格式敏感）
  5. 两种格式的 Body Cost Summary 均正确计算
**Plans**: TBD
