def _login(client, party='hd'):
    with client.session_transaction() as sess:
        sess['party'] = party


def test_party_page_shows_two_counterparty_panels(client):
    _login(client, 'hd')
    rv = client.get('/party/hd')
    assert rv.status_code == 200
    html = rv.data.decode('utf-8')
    assert '对邵阳华登' in html
    assert '对兴信' in html


def test_party_page_shows_4_direction_tabs(client):
    _login(client, 'hd')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    assert '发→邵阳华登' in html
    assert '收自邵阳华登' in html
    assert '发→兴信' in html
    assert '收自兴信' in html


def test_party_page_empty_state(client):
    _login(client, 'hd')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    # 4 张表都应是空的
    assert html.count('暂无记录') >= 4


def test_filter_form_preserves_active_tab(client):
    """筛选表单提交时保留当前 tab,过滤后不跳回默认 tab。"""
    _login(client, 'hd')
    rv = client.get('/party/hd')
    html = rv.data.decode('utf-8')
    # 筛选表单有 id,供 JS 拦截提交
    assert 'id="filterForm"' in html
    # 提交拦截器:把当前 tab 锚点带上
    assert 'preserveTabOnFilter' in html
    # switchTab 把当前 tab 写进 URL hash
    assert 'history.replaceState' in html
