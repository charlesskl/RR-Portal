import os
import tempfile
import pytest


@pytest.fixture()
def client(monkeypatch):
    # 每个测试用独立临时 DB，避免相互污染
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    monkeypatch.setenv("PCBA_DB", path)
    # 延迟导入，确保环境变量先生效
    from fastapi.testclient import TestClient
    import importlib
    import pcba.main
    importlib.reload(pcba.main)
    with TestClient(pcba.main.app) as c:
        yield c
    os.unlink(path)
