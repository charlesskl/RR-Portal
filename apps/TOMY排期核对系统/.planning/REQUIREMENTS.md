# Requirements: TOMY排期核对系统

**Defined:** 2026-03-20
**Core Value:** 准确核对PO与排期表数据，快速发现不一致项并标红提示，减少人工核对的时间和出错率

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### 文件处理

- [x] **FILE-01**: User can upload multiple PDF PO files in one session
- [x] **FILE-02**: System extracts text data from PDF POs (text-selectable PDFs)
- [x] **FILE-03**: User can upload existing Excel scheduling template
- [x] **FILE-04**: System reads and parses Excel template preserving structure
- [x] **FILE-05**: User sees processing progress and status feedback during parsing

### 核对比对

- [x] **COMP-01**: System matches PO data to schedule rows by TOMY PO number
- [x] **COMP-02**: System compares 接单期国家 field between PO and schedule
- [x] **COMP-03**: System compares 第三客户名称 field between PO and schedule
- [x] **COMP-04**: System compares 客跟单 field between PO and schedule
- [x] **COMP-05**: System compares TOMY PO field between PO and schedule
- [x] **COMP-06**: System compares CUSTOMER PO field between PO and schedule
- [x] **COMP-07**: System compares 货号 field between PO and schedule
- [x] **COMP-08**: System compares 数量 field between PO and schedule
- [x] **COMP-09**: System compares 外箱 field between PO and schedule
- [x] **COMP-10**: System compares 总箱数 field between PO and schedule
- [x] **COMP-11**: System compares PO走货期 field between PO and schedule
- [x] **COMP-12**: System compares 箱唛资料 field between PO and schedule
- [x] **COMP-13**: Mismatched cells are highlighted with red background in output Excel
- [x] **COMP-14**: POs without matching schedule rows are flagged as unmatched

### 分类输出

- [x] **OUT-01**: System classifies orders by factory code (RR01=东莞, RR02=印尼)
- [x] **OUT-02**: Output results are separated into Dongguan and Indonesia folders
- [x] **OUT-03**: User can download results as ZIP file containing both folders
- [x] **OUT-04**: System generates a summary report listing all discrepancies (PO number, factory, mismatched fields, values)

### 日期码

- [x] **DATE-01**: System generates date code in format: month letter + day + 2-digit year + factory code (e.g., D1526RR02)
- [x] **DATE-02**: Month letters: A=Jan, B=Feb, C=Mar, D=Apr, E=May, F=Jun, G=Jul, H=Aug, I=Sep, J=Oct, K=Nov, L=Dec
- [x] **DATE-03**: Date code date is calculated as PO走货期 minus 1 month
- [x] **DATE-04**: If calculated date falls on weekend or Chinese public holiday, roll back to nearest prior working day
- [x] **DATE-05**: Date code is auto-filled into the scheduling Excel output

### 平台

- [ ] **PLAT-01**: Application runs as a web app accessible via browser
- [ ] **PLAT-02**: Application works across different computers without installation

## v2 Requirements

### 增强功能

- **ENH-01**: Historical reconciliation run archive
- **ENH-02**: Configurable field mapping (adapt to template changes)
- **ENH-03**: Batch scheduling across multiple schedule files

## Out of Scope

| Feature | Reason |
|---------|--------|
| OCR for scanned PDFs | All current POs are text-extractable; OCR adds massive complexity |
| ERP system integration | Scope creep; standard XLSX output can be manually imported |
| User accounts / login | Internal tool; access control at network level |
| Auto-write-back to schedule | Dangerous without human review; output annotated copy instead |
| Mobile optimization | Desktop workflow; Excel handling poor on mobile |
| Real-time collaboration | Stateless file processing tool; each user works independently |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILE-01 | Phase 2 | Complete |
| FILE-02 | Phase 2 | Complete |
| FILE-03 | Phase 2 | Complete |
| FILE-04 | Phase 2 | Complete |
| FILE-05 | Phase 2 | Complete |
| COMP-01 | Phase 3 | Complete |
| COMP-02 | Phase 3 | Complete |
| COMP-03 | Phase 3 | Complete |
| COMP-04 | Phase 3 | Complete |
| COMP-05 | Phase 3 | Complete |
| COMP-06 | Phase 3 | Complete |
| COMP-07 | Phase 3 | Complete |
| COMP-08 | Phase 3 | Complete |
| COMP-09 | Phase 3 | Complete |
| COMP-10 | Phase 3 | Complete |
| COMP-11 | Phase 3 | Complete |
| COMP-12 | Phase 3 | Complete |
| COMP-13 | Phase 3 | Complete |
| COMP-14 | Phase 3 | Complete |
| OUT-01 | Phase 4 | Complete |
| OUT-02 | Phase 4 | Complete |
| OUT-03 | Phase 4 | Complete |
| OUT-04 | Phase 4 | Complete |
| DATE-01 | Phase 3 | Complete |
| DATE-02 | Phase 3 | Complete |
| DATE-03 | Phase 3 | Complete |
| DATE-04 | Phase 3 | Complete |
| DATE-05 | Phase 3 | Complete |
| PLAT-01 | Phase 1 | Pending |
| PLAT-02 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---

*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after roadmap creation — traceability complete*
