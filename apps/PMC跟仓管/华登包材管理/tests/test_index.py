"""Task 6: 首页 / — 3 party 卡片。"""


def test_index_shows_3_cards(client):
    rv = client.get('/')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert '华登' in html
    assert '邵阳华登' in html
    assert '兴信' in html
    # 每个 card 链接到 /party/<code>
    assert 'href="/party/hd"' in html
    assert 'href="/party/sy"' in html
    assert 'href="/party/xx"' in html


def test_index_has_reports_link(client):
    rv = client.get('/')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert '/reports' in html
