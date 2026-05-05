"""最基础烟测：app 能启动，/health 返回 ok。"""


def test_health_endpoint(client):
    rv = client.get('/health')
    assert rv.status_code == 200
    assert rv.get_json() == {'status': 'ok'}
