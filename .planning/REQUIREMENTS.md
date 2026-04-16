# Requirements

## v1 Requirements

### 基础修复
- [ ] **FIX-01**: 导入时自动将 MoldPart 材料汇总到 RawMaterial 表（不乘 sets_per_toy）
- [ ] **FIX-02**: 产品编号从主报价 sheet（含"报价"关键字）的 B1 提取，而非 fallback 到最后一个 sheet

### 毛绒公仔格式支持
- [ ] **PLUSH-01**: 识别毛绒公仔报价格式（主 sheet 为 `3K报价-*` 模式）
- [ ] **PLUSH-02**: 解析 3K报价主 sheet 的 MoldPart 区域（R16-R18，含包胶件）
- [ ] **PLUSH-03**: 解析搪胶件表（R20-R23：模号、名称、出数、用量、单价）
- [ ] **PLUSH-04**: 解析车缝明细 sheet（布料名称、部位、裁片数、用量、物料价、码点、总价）
- [ ] **PLUSH-05**: 解析五金/吊咭/贴纸/PE袋等子 sheet 物料数据
- [ ] **PLUSH-06**: 解析 3K报价主 sheet 的成本汇总区域（R25-R69：料价、人工、运费、码点、总价等）
- [ ] **PLUSH-07**: 将毛绒公仔的所有物料数据正确映射到现有数据库表（RawMaterial、HardwareItem、PackagingItem 等）

### 数据库扩展
- [ ] **DB-01**: 新增车缝明细表（SewingDetail）存储布料裁片数据
- [ ] **DB-02**: 新增搪胶件表（RotocastItem）存储搪胶部件数据
- [ ] **DB-03**: QuoteVersion 添加 format_type 字段区分注塑/毛绒公仔格式

### 前端适配
- [ ] **UI-01**: Raw Material tab 正确显示两种格式的原料数据
- [ ] **UI-02**: 新增车缝明细 tab 显示布料裁片数据（毛绒公仔格式）
- [ ] **UI-03**: 新增搪胶件 tab 显示搪胶部件数据（毛绒公仔格式）

### 代码整理
- [ ] **CLEAN-01**: 提交现有 21 个未提交文件（header-info 面板、tab 优化等）

## v2 Requirements (Deferred)

- 批量导入多个报价文件
- 不同客户模板导出（非 TOMY）
- 报价版本对比功能

## Out of Scope

- 用户认证 — 内部工具
- 数据库迁移工具 — 开发阶段直接重建
- 其他产品类型（电子类）的专用格式

## Traceability

| REQ-ID | Phase |
|--------|-------|
| FIX-01, FIX-02 | Phase 1 |
| CLEAN-01 | Phase 1 |
| PLUSH-01 ~ PLUSH-07 | Phase 2 |
| DB-01 ~ DB-03 | Phase 2 |
| UI-01 ~ UI-03 | Phase 3 |
| UI-02, UI-03, DB-03, PLUSH-01 | Phase 4 (gap closure) |
