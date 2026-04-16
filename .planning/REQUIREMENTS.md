# Requirements — v1.2 SPIN 报价支持

## v1 Requirements

### SPIN 内部报价解析

- [ ] **SPIN-01**: 识别 SPIN 报价格式（主 sheet 含"报价明细"关键字，与毛绒公仔格式区分）
- [ ] **SPIN-02**: 解析 SPIN 主 sheet 的 MoldPart 区域（料型、料重、机型、件数）
- [ ] **SPIN-03**: 解析 SPIN 车缝明细 sheet（布料名称、用量、物料价等）
- [ ] **SPIN-04**: 将 SPIN 解析数据正确存入现有数据库表

### SPIN Vendor Quote Form 导出

- [ ] **EXP-01**: 单款导出 — 从一个版本生成含 Summary + 款式 sheet 的 SPIN Excel
- [ ] **EXP-02**: 款式 sheet 填写 Purchased Parts（布料 Fabric Cost 区域）
- [ ] **EXP-03**: 款式 sheet 填写 Packaging（H-tag、CDU、Master carton）
- [ ] **EXP-04**: 款式 sheet 填写 Labor（Sewing、Packing、Cutting 等工时和工价）
- [ ] **EXP-05**: 款式 sheet 填写 Markup 汇总（Material / Packaging / Labor markup）
- [ ] **EXP-06**: 批量多款导出 — 选多个版本，生成一个含 Summary + 多款式 sheet 的 SPIN 文件

### v1.1 缺口修复

- [ ] **FIX2-03**: 修复版本复制时 format_type 丢失（server/routes/versions.js duplicate endpoint）

## Future Requirements (Deferred)

- SPIN 装配 sheet 解析（产能、工序）
- SPIN Metal Parts / Electronic Parts 区域导出
- SPIN Special Parts 区域导出
- Transportation 成本自动计算
- 其他客户模板（非 TOMY/SPIN）

## Out of Scope

- 修改 SPIN 模板结构
- 后端认证
- 在线部署

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| FIX2-03 | Phase 4 | Pending |
| SPIN-01 | Phase 5 | Pending |
| SPIN-02 | Phase 5 | Pending |
| SPIN-03 | Phase 5 | Pending |
| SPIN-04 | Phase 5 | Pending |
| EXP-01 | Phase 6 | Pending |
| EXP-02 | Phase 6 | Pending |
| EXP-03 | Phase 6 | Pending |
| EXP-04 | Phase 6 | Pending |
| EXP-05 | Phase 6 | Pending |
| EXP-06 | Phase 7 | Pending |
