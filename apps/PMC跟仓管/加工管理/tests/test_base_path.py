import importlib

from fastapi.testclient import TestClient


def test_rendered_static_pages_include_base_path(monkeypatch, tmp_path):
    monkeypatch.setenv("PCBA_DB", str(tmp_path / "pcba.db"))
    monkeypatch.setenv("PCBA_BASE_PATH", "/cpg")

    import pcba.main

    importlib.reload(pcba.main)
    with TestClient(pcba.main.app) as client:
        app_page = client.get("/static/app.html")
        summary_page = client.get("/static/public-summary.html")

    assert app_page.status_code == 200
    assert 'window.APP_BASE="/cpg"' in app_page.text
    assert 'href="/cpg/static/style.css' in app_page.text
    assert 'src="/cpg/static/app.js' in app_page.text

    assert summary_page.status_code == 200
    assert 'window.APP_BASE="/cpg"' in summary_page.text
    assert 'href="/cpg/static/style.css' in summary_page.text
