"""pytest fixtures: 临时 SQLite DB + Flask test client。"""
import shutil
import tempfile
import pytest


@pytest.fixture
def tmp_data_dir(monkeypatch):
    """给每个测试一个独立的临时 DATA_PATH 目录。app.py 会在此目录建 huadeng.db。"""
    d = tempfile.mkdtemp(prefix='huadeng_test_')
    monkeypatch.setenv('DATA_PATH', d)
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(tmp_data_dir):
    """Flask test client，自动完成 init_db 建表。"""
    import importlib
    import app as app_module
    importlib.reload(app_module)
    app_module.app.config['TESTING'] = True
    app_module.app.config['WTF_CSRF_ENABLED'] = False
    with app_module.app.test_client() as c:
        yield c


@pytest.fixture
def smoke_check(client):
    """最小烟测：确认 /health 返回 ok。"""
    rv = client.get('/health')
    assert rv.status_code == 200
