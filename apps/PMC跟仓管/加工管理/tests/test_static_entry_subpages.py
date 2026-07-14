from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_shaoyang_reconcile_has_separate_page_controls():
    html = (ROOT / "pcba/static/app.html").read_text(encoding="utf-8")
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert 'data-tab="shaoyangReconcile"' in html
    assert 'id="shaoyangReconcile"' in html
    assert 'id="shaoyangIssueFile"' in html
    assert 'id="shaoyangFinishedFile"' in html
    assert 'onclick="exportShaoyangIssueWorkbook()"' in html
    assert "function reconcileShaoyangCd()" in js
    assert "function exportShaoyangIssueWorkbook()" in js
    assert "/api/shaoyang-cd/reconcile" in js
    assert "/api/shaoyang-cd/export-issue" in js
    assert "'shaoyangReconcile'" in js


def test_shaoyang_reconcile_uses_modern_file_buttons():
    html = (ROOT / "pcba/static/app.html").read_text(encoding="utf-8")
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")
    css = (ROOT / "pcba/static/style.css").read_text(encoding="utf-8")

    assert 'class="file-upload-card"' in html
    assert 'id="shaoyangIssueFileName"' in html
    assert 'id="shaoyangFinishedFileName"' in html
    assert 'onclick="chooseImportFile(\'shaoyangIssueFile\')"' in html
    assert 'onchange="updateFileName(\'shaoyangIssueFile\', \'shaoyangIssueFileName\')"' in html
    assert "function updateFileName(inputId, labelId)" in js
    assert ".file-upload-trigger" in css


def test_entry_page_exposes_type_subpage_container():
    html = (ROOT / "pcba/static/app.html").read_text(encoding="utf-8")

    assert 'id="entryTypeTabs"' in html
    assert 'id="entryMaterialTabs"' in html
    assert 'id="recType" style="display:none"' in html
    assert 'id="material" title="物料名称" style="display:none"' in html
    assert 'onclick="exportRecords()"' in html


def test_entry_page_exposes_clear_and_bulk_delete_controls():
    html = (ROOT / "pcba/static/app.html").read_text(encoding="utf-8")
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert 'id="clearDataPanel"' in html
    assert 'id="clearDepartment"' in html
    assert 'id="clearMaterial"' in html
    assert 'onclick="clearRecordsByDepartmentMaterial()"' in html
    assert 'id="recordBulkBar"' in html
    assert 'id="recordSelectAll"' in js
    assert "function deleteSelectedRecords()" in js
    assert "function clearRecordsByDepartmentMaterial()" in js
    assert "/api/records/bulk-delete" in js
    assert "/api/records/clear" in js


def test_admin_department_switcher_controls_exist():
    html = (ROOT / "pcba/static/app.html").read_text(encoding="utf-8")
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert 'id="adminDepartmentSwitcher"' in html
    assert 'id="currentDepartmentSelect"' in html
    assert 'onchange="switchCurrentDepartment()"' in html
    assert "function configureAdminDepartmentSwitcher()" in js
    assert "async function switchCurrentDepartment()" in js
    assert "/api/me/department" in js


def test_entry_records_are_filtered_by_active_type():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "let ACTIVE_ENTRY_TYPE" in js
    assert "let ACTIVE_ENTRY_MATERIAL" in js
    assert "function setEntryType(type)" in js
    assert "function setEntryMaterial(material)" in js
    assert "function withEntryExportFilters(path)" in js
    assert "params.set('material', ACTIVE_ENTRY_MATERIAL)" in js
    assert "function exportRecords()" in js
    assert "function renderRecordsTable()" in js
    assert "x.rec_type === ACTIVE_ENTRY_TYPE" in js
    assert "x.material === ACTIVE_ENTRY_MATERIAL" in js


def test_entry_tabs_bind_clicks_without_inline_material_arguments():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert 'data-entry-type="${esc(opt.value)}"' in js
    assert "addEventListener('click', () => setEntryType" in js
    assert 'data-entry-material="${esc(mat.name)}"' in js
    assert "addEventListener('click', () => setEntryMaterial" in js
    assert "onclick=\"setEntryMaterial('${esc(mat.name)}')\"" not in js


def test_lihong_entry_uses_semifinished_outbound_without_finished_entry():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "function isLihong()" in js
    assert "if (isLihong()) {\n    if (type === 'semi_finished') return '半成品出库';\n  }" in js
    assert (
        "if (isLihong()) {\n"
        "    return [\n"
        "      {value: 'issue', label: '领料'},\n"
        "      {value: 'semi_finished', label: '半成品出库'},\n"
        "    ];\n"
        "  }"
    ) in js
    assert "<th>领料总数</th><th>半成品出库总数</th><th>应存数</th>" in js


def test_location_dropdown_hides_current_department():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "function entryLocationOptions(locs)" in js
    assert "loc.name !== ME.department" in js
    assert "entryLocationOptions(locs)" in js


def test_summary_page_prefers_monthly_location_totals():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "function renderMonthlyLocationSummary(summary)" in js
    assert "s.monthly_locations" in js


def test_monthly_summary_hides_zero_quantities():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "function fmtNonZero(n)" in js
    assert "return value ? fmt(value) : '';" in js
    assert "fmtNonZero((values[index] || {})[key])" in js
    assert "fmtNonZero(total)" in js


def test_monthly_summary_skips_rows_without_quantities():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "function hasMonthlyQuantity(total, values, key)" in js
    assert "return (values || []).some(value => Number(((value || {})[key]) || 0) !== 0);" in js
    assert "if (!hasMonthlyQuantity(total, values, key)) return '';" in js


def test_monthly_summary_shows_material_name():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "<th>物料名称</th>" in js
    assert "dataRow(row.location, row.material" in js
    assert "<td>${esc(material || '')}</td>" in js
    assert "6月月结" in js
    assert "累计总数" in js


def test_public_summary_shows_material_quantity_by_department():
    html = (ROOT / "pcba/static/public-summary.html").read_text(encoding="utf-8")

    assert "部门物料数量" in html
    assert 'id="publicMaterialDepartmentRows"' in html
    assert "data.material_department" in html
    assert "<td>${esc(row.department)}</td>" in html
    assert "<td>${esc(row.material)}</td>" in html
