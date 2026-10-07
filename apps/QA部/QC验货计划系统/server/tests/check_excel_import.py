"""Run against an isolated database after building QcInspection.Api. No third-party packages."""
import io, json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error, zipfile
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parents[2]
HEADERS = ['日期', '客户名称', '合同编号', '客户PO', '货号', '产品名称', '数量', '箱数', '洋行结果', '第三方结果', 'HOLD/REJ原因', '备注']

def workbook(headers, rows, sheet='10月份'):
    cells = []
    for i, row in enumerate([headers] + rows, 1):
        columns = []
        for j, value in enumerate(row):
            name = ''; n = j + 1
            while n:
                n, r = divmod(n - 1, 26); name = chr(65 + r) + name
            columns.append(f'<c r="{name}{i}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        cells.append(f'<row r="{i}">{"".join(columns)}</row>')
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(cells) + '</sheetData></worksheet>')
    return stream.getvalue()

with tempfile.TemporaryDirectory(prefix='qc-import-check-') as tmp:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = dict(os.environ, QC_JWT_KEY='isolated-import-test-key-32-characters-long', QC_ADMIN_PASSWORD='Test-only-12345',
               QC_ADMIN_USERNAME='admin', ASPNETCORE_URLS=base, ConnectionStrings__Default=f'Data Source={tmp}/test.db')
    token = ''
    def request(path, data=None, content_type='application/json'):
        headers = {'Content-Type': content_type}
        if token: headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req) as response: return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b'{}')
    def upload(rows, site='兴信', headers=HEADERS, filename='daily.xlsx'):
        boundary = 'qc-import-test-boundary'
        sheet = '验货总结汇总表' if site == '湖南' else '10月份'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()
                + workbook(headers, rows, sheet) + f'\r\n--{boundary}--\r\n'.encode())
        return request('/api/legacy-inspections/import?site=' + urllib.parse.quote(site), body, 'multipart/form-data; boundary=' + boundary)
    def records(): return request('/api/legacy-inspections?site=' + urllib.parse.quote('兴信'))[1]['items']
    with open(tmp + '/api.log', 'w+') as log:
        proc = subprocess.Popen([shutil.which('dotnet'), str(ROOT / 'server/QcInspection.Api/bin/Debug/net8.0/QcInspection.Api.dll')], cwd=tmp, env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    status, login = request('/api/auth/login', json.dumps({'username':'admin','password':'Test-only-12345'}).encode())
                    if status == 200: token = login['accessToken']; break
                except (OSError, urllib.error.URLError): pass
                if proc.poll() is not None: raise AssertionError('Test API failed to start')
                time.sleep(.1)
            assert token, 'Test API not ready'
            row = ['2026-10-07','Customer','C1','PO1','ITEM1','Toy','100','10','HOLD','','reason','note']
            status, result = upload([row, row]); assert status == 200 and result['inserted'] == 1 and result['duplicatesSkipped'] == 1, result
            assert upload([row])[1]['inserted'] == 0
            changed = row.copy(); changed[8] = 'PASS'; changed[10] = ''; changed[11] = ''
            status, result = upload([changed]); assert status == 200 and result['resultChanged'] == 1, result
            current = records()[0]; assert current['internalResult'] == 'PASS' and current['holdRejectReason'] == '' and current['note'] == ''
            alerts = request('/api/inspection-alerts?site=' + urllib.parse.quote('兴信') + '&type=' + urllib.parse.quote('验货结果变更'))[1]
            assert len(alerts) == 1 and 'HOLD' in alerts[0]['summary'] and 'PASS' in alerts[0]['summary']
            assert upload([changed])[1]['resultChanged'] == 0
            # Identical order identifiers in another factory must create its own record.
            assert upload([row], '湖南')[1]['inserted'] == 1
            assert records()[0]['internalResult'] == 'PASS'
            # Missing columns preserve values, while present empty cells clear results.
            small_headers = HEADERS[:8]; small_row = changed[:8]
            assert upload([small_row], headers=small_headers)[0] == 200
            assert records()[0]['internalResult'] == 'PASS'
            empty = changed.copy(); empty[8] = ''
            assert upload([empty])[1]['resultChanged'] == 1
            assert records()[0]['internalResult'] == ''
            # Conflicting duplicates reject the entire file, including unrelated new rows.
            fresh = row.copy(); fresh[2] = 'C2'
            status, result = upload([fresh, row, changed]); assert status == 409, result
            assert len(records()) == 1
            # A full Excel table explicitly identifies separate dates/batches.
            later = changed.copy(); later[0] = '2026-10-08'; later[6] = '50'
            status, result = upload([changed, later]); assert status == 200 and result['inserted'] == 1, result
            assert len(records()) == 2
            later[8] = 'REJ'
            assert upload([later])[0] == 200
            assert next(r for r in records() if r['inspectionDate'].startswith('2026-10-07'))['internalResult'] == 'PASS'
            # A third unidentifiable batch cannot silently overwrite an existing one.
            unknown = later.copy(); unknown[0] = '2026-10-09'
            assert upload([unknown], filename='different.xlsx')[0] == 409
            assert len(records()) == 2
            invalid = fresh.copy(); invalid[6] = 'not-a-number'
            assert upload([invalid])[0] == 409
            assert len(records()) == 2
            # Report malformed cells and every conflicting duplicate in one response, with original locations.
            invalid2 = fresh.copy(); invalid2[2] = 'C4'; invalid2[7] = 'bad-cartons'
            status, result = upload([invalid, invalid2, row, changed, unknown], filename='all-issues.xlsx')
            assert status == 409, result
            assert {issue['row'] for issue in result['issues']} == {2, 3, 4, 5, 6}, result
            assert all(issue['sheet'] == '10月份' and issue['itemNumber'] == 'ITEM1' and issue['reason'] for issue in result['issues'])
            assert {issue['contractNumber'] for issue in result['issues']} >= {'C1', 'C2', 'C4'}, result
            assert len(records()) == 2
            # Import supersedes old approval; later review must fail.
            target = next(r for r in records() if r['inspectionDate'].startswith('2026-10-07'))
            payload = {'internalResult':'HOLD','thirdPartyResult':'','holdRejectReason':'requested','note':'','inspectedQuantity':100}
            req = urllib.request.Request(base + f"/api/inspections/{target['id']}/result", data=json.dumps(payload).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+token}, method='PUT')
            with urllib.request.urlopen(req): pass
            approvals = request('/api/inspection-approvals?site=' + urllib.parse.quote('兴信'))[1]
            assert len(approvals) == 1
            assert upload([changed])[0] == 200
            status, _ = request(f"/api/inspection-approvals/{approvals[0]['id']}/review", b'{"approved":true}')
            assert status == 404
            # A unique unfinished plan can change date without leaving a stale fingerprint.
            rescheduled = fresh.copy(); rescheduled[2] = 'C3'; rescheduled[8] = ''; rescheduled[10] = ''
            assert upload([rescheduled])[1]['inserted'] == 1
            rescheduled[0] = '2026-10-10'
            assert upload([rescheduled])[1]['updated'] == 1
            assert len(records()) == 3
            assert upload([rescheduled])[1]['inserted'] == 0
            # An account authorized for one factory cannot import another.
            status, _ = request('/api/users', json.dumps({'username':'qc-local','displayName':'QC','department':'QC','role':'QC文员','dataScope':'兴信','password':'Test-only-12345'}).encode()); assert status in (200, 201)
            token = request('/api/auth/login', b'{"username":"qc-local","password":"Test-only-12345"}')[1]['accessToken']
            assert upload([row], '湖南')[0] == 403
            print('PASS: repeated imports, authoritative values, blank/missing columns, result alerts, factory isolation, duplicate conflicts, batch separation, rollback, numeric validation, approval replacement and access control')
        except Exception:
            log.flush(); log.seek(0); print(log.read()[-5000:]); raise
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
