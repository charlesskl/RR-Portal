from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_entry_page_exposes_type_subpage_container():
    html = (ROOT / "pcba/static/app.html").read_text(encoding="utf-8")

    assert 'id="entryTypeTabs"' in html
    assert 'id="entryMaterialTabs"' in html
    assert 'id="recType" style="display:none"' in html
    assert 'id="material" title="物料名称" style="display:none"' in html


def test_entry_records_are_filtered_by_active_type():
    js = (ROOT / "pcba/static/app.js").read_text(encoding="utf-8")

    assert "let ACTIVE_ENTRY_TYPE" in js
    assert "let ACTIVE_ENTRY_MATERIAL" in js
    assert "function setEntryType(type)" in js
    assert "function setEntryMaterial(material)" in js
    assert "function renderRecordsTable()" in js
    assert "x.rec_type === ACTIVE_ENTRY_TYPE" in js
    assert "x.material === ACTIVE_ENTRY_MATERIAL" in js
