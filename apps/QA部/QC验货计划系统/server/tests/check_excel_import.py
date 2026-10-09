"""Run against an isolated database after building QcInspection.Api. No third-party packages."""
import io, json, os, pathlib, shutil, socket, sqlite3, subprocess, tempfile, time, urllib.request, urllib.error, zipfile
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

def mixed_workbook(normal_headers, normal_rows, jaz_headers, jaz_rows):
    with zipfile.ZipFile(io.BytesIO(workbook(normal_headers, normal_rows, '8月'))) as z:
        files = {name: z.read(name) for name in z.namelist()}
    with zipfile.ZipFile(io.BytesIO(workbook(jaz_headers, jaz_rows, '8月DPI'))) as z:
        files['xl/worksheets/sheet2.xml'] = z.read('xl/worksheets/sheet1.xml')
    files['xl/workbook.xml'] = files['xl/workbook.xml'].replace(b'</sheets>', '<sheet name="8月DPI" sheetId="2" r:id="rId2"/></sheets>'.encode())
    files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace(b'</Relationships>', b'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace(b'</Types>', b'<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        for name, content in files.items(): z.writestr(name, content)
    return stream.getvalue()

with tempfile.TemporaryDirectory(prefix='qc-import-check-') as tmp:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = dict(os.environ, QC_JWT_KEY='isolated-import-test-key-32-characters-long', QC_ADMIN_PASSWORD='Test-only-12345',
               QC_ADMIN_USERNAME='admin', ASPNETCORE_URLS=base, ConnectionStrings__Default=f'Data Source={tmp}/test.db')
    token = ''
    def request(path, data=None, content_type='application/json', method=None):
        headers = {'Content-Type': content_type}
        if token: headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as response: return response.status, json.loads(response.read() or b'{}')
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b'{}')
    def upload(rows, site='兴信', headers=HEADERS, filename='daily.xlsx', template=None, contents=None):
        boundary = 'qc-import-test-boundary'
        sheet = '验货总结汇总表' if site == '湖南' else '10月份'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()
                + (contents if contents is not None else workbook(headers, rows, sheet)) + f'\r\n--{boundary}--\r\n'.encode())
        return request('/api/legacy-inspections/import?site=' + urllib.parse.quote(site) + ('&template=' + urllib.parse.quote(template) if template else ''), body, 'multipart/form-data; boundary=' + boundary)
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
            row = ['2026/1/7(三)','Customer','C1','PO1','ITEM1','Toy','1764','147','HOLD','','reason','note']
            second = row.copy(); second[6] = '1032'; second[7] = '86'
            status, result = upload([row, second, row]); assert status == 200 and result['inserted'] == 2 and result['duplicatesSkipped'] == 1, result
            status, result = upload([row, second]); assert status == 200 and result['unchanged'] == 2 and result['updated'] == 0, result
            changed = row.copy(); changed[8] = 'PASS'; changed[10] = ''; changed[11] = ''
            result = upload([changed, second])[1]; assert result['updated'] == 1 and result['resultChanged'] == 1, result
            saved = records(); assert len(saved) == 2 and next(r for r in saved if r['quantity'] == 1032)['internalResult'] == 'HOLD'
            assert next(r for r in saved if r['quantity'] == 1764)['holdRejectReason'] == ''
            # New dates/quantities are independent even without including old batches in the file.
            new_date = changed.copy(); new_date[0] = '2026/8/22（六）'
            assert upload([new_date])[1]['inserted'] == 1
            new_quantity = new_date.copy(); new_quantity[6] = '50'; new_quantity[7] = '5'
            assert upload([new_quantity])[1]['inserted'] == 1
            assert upload([new_date,new_quantity])[1]['unchanged'] == 2
            optional = changed.copy(); optional[0] = ''; optional[2] = 'OPTIONAL'; optional[3] = ''; optional[4] = ''; optional[6] = ''; optional[7] = ''
            assert upload([optional])[1]['inserted'] == 1
            assert upload([optional])[1]['unchanged'] == 1
            unidentified = optional.copy(); unidentified[2] = ''; unidentified[5] = 'Different product A'
            unidentified2 = unidentified.copy(); unidentified2[5] = 'Different product B'
            assert upload([unidentified, unidentified2])[1]['inserted'] == 2
            assert upload([unidentified, unidentified2])[1]['unchanged'] == 2
            # Healthy records import even when other rows conflict or have invalid numbers.
            new_order = row.copy(); new_order[2] = 'C2'
            invalid = row.copy(); invalid[2] = 'BAD'; invalid[6] = 'bad-number'
            conflict1 = row.copy(); conflict1[2] = 'CONFLICT'
            conflict2 = conflict1.copy(); conflict2[8] = 'PASS'
            status, result = upload([new_order,invalid,conflict1,conflict2])
            assert status == 200 and result['inserted'] == 3 and result['pendingReviewCount'] == 1 and result['duplicatesSkipped'] == 0, result
            assert {issue['row'] for issue in result['issues']} == {3}, result
            assert any(r['contractNumber'] == 'C2' for r in records())
            assert not any(r['contractNumber'] == 'BAD' for r in records())
            assert sum(r['contractNumber'] == 'CONFLICT' for r in records()) == 2
            assert upload([conflict2,conflict1])[1]['unchanged'] == 2
            # Seed duplicate historical rows to test skip versus ambiguous update.
            dup = row.copy(); dup[2] = 'DUP'
            assert upload([dup])[1]['inserted'] == 1
            with sqlite3.connect(tmp+'/test.db') as db:
                columns = [entry[1] for entry in db.execute('pragma table_info(InspectionRecords)') if entry[1] != 'Id']
                selection = ["'duplicate-plan'" if name == 'PlanId' else "'duplicate-fingerprint'" if name == 'Fingerprint' else '"'+name+'"' for name in columns]
                db.execute('INSERT INTO InspectionRecords ('+','.join('"'+name+'"' for name in columns)+') SELECT '+','.join(selection)+" FROM InspectionRecords WHERE ContractNumber='DUP'")
            assert upload([dup])[1]['unchanged'] == 1
            dup_changed = dup.copy(); dup_changed[8] = 'PASS'
            valid = row.copy(); valid[2] = 'C3'
            result = upload([dup_changed,valid])[1]
            assert result['inserted'] == 2 and result['pendingReviewCount'] == 0, result
            assert sum(r['internalResult'] == 'HOLD' for r in records() if r['contractNumber'] == 'DUP') == 2
            assert upload([dup_changed])[1]['unchanged'] == 1
            # Missing columns preserve data and current factory remains isolated.
            assert upload([changed[:8]],headers=HEADERS[:8])[1]['unchanged'] == 1
            assert upload([row],site='湖南')[1]['inserted'] == 1
            assert next(r for r in records() if r['quantity'] == 1764 and r['contractNumber'] == 'C1' and r['inspectionDate'].startswith('2026-01-07'))['internalResult'] == 'PASS'
            alerts = request('/api/inspection-alerts?site=' + urllib.parse.quote('兴信') + '&type=' + urllib.parse.quote('验货结果变更'))[1]
            assert len(alerts) == 1 and 'HOLD' in alerts[0]['summary'] and 'PASS' in alerts[0]['summary']
            # Finished inspections include JAZ customers; DPI production samples are skipped.
            dpi_headers = ['日期','洋行名称','工作单号','货号','名称','数量','箱数','验货结果']
            dpi_row = ['2026/1/7(三)','JAZWARES','DPI1','SAMPLE1','Production sample','14','14','PASS']
            finished_jaz = changed.copy(); finished_jaz[1] = 'JAZWARES'; finished_jaz[2] = 'FINISHED-JAZ'
            contents = mixed_workbook(HEADERS, [changed, finished_jaz], dpi_headers, [dpi_row])
            status, result = upload([],site='华登',template='普通验货',contents=contents)
            assert status == 200 and result['parsed'] == 2 and result['inserted'] == 2, result
            normal_url = '/api/legacy-inspections?site=' + urllib.parse.quote('华登')
            normal = request(normal_url)[1]['items']
            assert len(normal) == 2 and any(r['customer'] == 'JAZWARES' for r in normal)
            assert all(r['itemNumber'] != 'SAMPLE1' for r in normal)
            assert upload([],site='华登',contents=contents)[1]['unchanged'] == 2
            assert upload([],site='华登',template='JAZ专用',contents=contents)[0] == 400
            # Previously imported finished JAZ records remain visible, but old DPI data is excluded.
            with sqlite3.connect(tmp+'/test.db') as db:
                db.execute("UPDATE InspectionRecords SET InspectionTemplate='JAZ专用', ScheduleSource='JAZ/JWC' WHERE Site='华登' AND ContractNumber='FINISHED-JAZ'")
                columns = [entry[1] for entry in db.execute('pragma table_info(InspectionRecords)') if entry[1] != 'Id']
                overrides = {'PlanId': "'old-dpi-plan'", 'Fingerprint': "'old-dpi-fingerprint'", 'SourceSheet': "'8月DPI'", 'ItemNumber': "'SAMPLE1'", 'ProductName': "'Production sample'"}
                selection = [overrides.get(name, '"'+name+'"') for name in columns]
                db.execute('INSERT INTO InspectionRecords ('+','.join('"'+name+'"' for name in columns)+') SELECT '+','.join(selection)+" FROM InspectionRecords WHERE Site='华登' AND ContractNumber='FINISHED-JAZ'")
                db.commit()
            assert request(normal_url)[1]['total'] == 2
            assert request('/api/public/plans?site=' + urllib.parse.quote('华登'))[1]['total'] == 2
            assert upload([],site='华登',contents=contents)[1]['inserted'] == 0
            export_url = '/api/legacy-inspections/export?site=' + urllib.parse.quote('华登')
            req = urllib.request.Request(base+export_url,headers={'Authorization':'Bearer '+token})
            with urllib.request.urlopen(req) as response: exported = response.read()
            with zipfile.ZipFile(io.BytesIO(exported)) as z:
                all_xml = ''.join(z.read(name).decode() for name in z.namelist() if name.endswith('.xml'))
                assert 'JAZWARES' in all_xml and 'Production sample' not in all_xml
            assert upload([],site='华登',contents=exported)[1]['inserted'] == 0
            # Separate ordinary/third-party inspections and harmless name differences without blocking either row.
            ordinary = row.copy(); ordinary[2] = 'DUAL-LANE'; ordinary[8] = 'PASS'; ordinary[9] = 'NA'
            third_party = ordinary.copy(); third_party[8] = 'NA'; third_party[9] = 'PASS'
            result = upload([ordinary,third_party])[1]
            assert result['inserted'] == 2 and result['pendingReviewCount'] == 0, result
            assert upload([ordinary,third_party])[1]['unchanged'] == 2
            assert upload([third_party,ordinary])[1]['unchanged'] == 2
            name_one = ordinary.copy(); name_one[2] = 'NAME-VARIANTS'
            name_two = name_one.copy(); name_two[5] = 'Toy-NA'
            result = upload([name_one,name_two])[1]
            assert result['inserted'] == 2 and result['pendingReviewCount'] == 0, result
            assert upload([name_two,name_one])[1]['unchanged'] == 2
            for index, (text, quantity) in enumerate([('60个空PDQ',60),('80个空PDQ',80),('40个空展示架',40),('22套散件(共154pcs)',154)]):
                text_row = row.copy(); text_row[2] = f'TEXT-QTY-{index}'; text_row[6] = text
                assert upload([text_row])[1]['inserted'] == 1
                saved = next(r for r in records() if r['contractNumber'] == text_row[2])
                assert saved['quantity'] == quantity and saved['note'] == 'note；数量原文：' + text
                assert upload([text_row])[1]['unchanged'] == 1
            ambiguous = row.copy(); ambiguous[2] = 'AMBIGUOUS-QTY'; ambiguous[6] = '22套/154件'
            assert upload([ambiguous])[1]['pendingReviewCount'] == 1
            slash = row.copy(); slash[2] = 'SLASH-CARTONS'; slash[7] = '/'
            assert upload([slash])[1]['inserted'] == 1
            assert next(r for r in records() if r['contractNumber'] == 'SLASH-CARTONS')['cartons'] is None
            invalid_date = row.copy(); invalid_date[2] = 'BAD-DATE'; invalid_date[0] = '2026/7/43'
            result = upload([invalid_date])[1]
            assert result['inserted'] == 0 and result['pendingReviewCount'] == 1
            # REJ is a separate immutable attempt, including same-day/same-quantity Excel repeats.
            rejected = row.copy(); rejected[2] = 'REJ-HISTORY'; rejected[8] = 'REJ'
            passed = rejected.copy(); passed[8] = 'PASS'; passed[10] = ''
            result = upload([rejected, passed])[1]
            assert result['inserted'] == 2 and result['pendingReviewCount'] == 0, result
            attempts = [r for r in records() if r['contractNumber'] == 'REJ-HISTORY']
            assert len(attempts) == 2 and {r['internalResult'] for r in attempts} == {'REJ','PASS'}
            assert upload([rejected, passed])[1]['unchanged'] == 2
            lone = rejected.copy(); lone[2] = 'REJ-LONE'
            assert upload([lone])[1]['inserted'] == 1
            repass = lone.copy(); repass[8] = 'PASS'
            assert upload([repass])[1]['inserted'] == 1
            original = next(r for r in records() if r['contractNumber'] == 'REJ-LONE' and r['internalResult'] == 'REJ')
            result_body = json.dumps({'internalResult':'PASS','thirdPartyResult':'','holdRejectReason':'','note':'','inspectedQuantity':100}).encode()
            assert request(f"/api/inspections/{original['id']}/result", result_body, method='PUT')[0] == 409
            assert request(f"/api/inspections/{original['id']}", method='DELETE')[0] == 409
            status, child = request(f"/api/inspections/{original['id']}/reinspection", b'', method='POST')
            assert status == 201 and child['internalResult'] == '' and child['thirdPartyResult'] == '' and child['reinspectionOfId'] == original['id']
            assert request(f"/api/inspections/{original['id']}/reinspection", b'', method='POST')[1]['id'] == child['id']
            assert request(f"/api/inspections/{child['id']}/result", result_body, method='PUT')[0] == 200
            assert next(r for r in records() if r['id'] == original['id'])['internalResult'] == 'REJ'
            real_file = os.environ.get('QC_REAL_WORKBOOK')
            if real_file:
                contents = pathlib.Path(real_file).read_bytes()
                status, actual = upload([], contents=contents, filename=pathlib.Path(real_file).name)
                assert status == 200 and actual['pendingReviewCount'] <= 1, actual
                if actual['issues']: assert actual['issues'][0]['row'] == 277, actual['issues']
                status, again = upload([], contents=contents, filename=pathlib.Path(real_file).name)
                assert status == 200 and again['inserted'] == 0 and again['updated'] == 0 and again['pendingReviewCount'] == actual['pendingReviewCount'], again
                print('REAL WORKBOOK:', {key: again[key] for key in ('parsed','inserted','updated','unchanged','pendingReviewCount')}, again['issues'])
            status, _ = request('/api/users', json.dumps({'username':'qc-local','displayName':'QC','department':'QC','role':'QC文员','dataScope':'兴信','password':'Test-only-12345'}).encode()); assert status in (200,201)
            token = request('/api/auth/login', b'{"username":"qc-local","password":"Test-only-12345"}')[1]['accessToken']
            assert upload([row],site='湖南')[0] == 403
            print('PASS: partial imports, unchanged skips, separate dates/quantities, empty fields, weekday dates, result updates, conflict details with existing matches, duplicate history, factory isolation, JAZ finished inspections, DPI exclusion, immutable REJ history and reinspection result entry')
        except Exception:
            log.flush(); log.seek(0); print(log.read()[-5000:]); raise
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
