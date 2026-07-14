import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createCustomer, listCustomers, uploadFile } from '../api.js';
import SheetImages from '../SheetImages.jsx';

const STAGES = ['FS', 'EP', 'EP1', 'PE2', 'FEP', 'PP', 'PS'];

export default function Upload() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [stage, setStage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef();

  async function refreshCustomers(autoSelectName) {
    const response = await listCustomers();
    setCustomers(response.list || []);
    if (autoSelectName) {
      const match = (response.list || []).find(customer => customer.name === autoSelectName);
      if (match) setCustomerId(match.id);
    }
  }
  useEffect(() => { refreshCustomers(); }, []);

  async function onCreateCustomer() {
    const name = newName.trim();
    if (!name) return;
    try {
      const response = await createCustomer(name);
      await refreshCustomers(response.customer.name);
      setNewName('');
      setShowCreate(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function onUpload() {
    if (!file) return;
    if (!customerId) { setError('请先选择客户（或新增一个）'); return; }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await uploadFile(file, customerId, stage);
      setResult(response);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setFile(null);
    setError('');
    setStage('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const report = result?.report;
  const changes = result?.lifecycleChanges;

  return (
    <div className="page">
      <h2>上传测试报告</h2>
      <p className="hint">
        系统从报告中的<b>货号 / Product No</b>建立产品档案，自动识别红字 FAIL 与明确 PASS，
        并按 <b>FS → EP → EP1 → PE2 → FEP → PP → PS</b> 更新问题状态。
      </p>

      <div className="upload-config">
        <div className="field-group">
          <label>客户 <b>*</b></label>
          <div className="field-inline">
            <select value={customerId} onChange={event => setCustomerId(event.target.value)}>
              <option value="">-- 请选择客户 --</option>
              {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            {!showCreate && <button className="btn-ghost" onClick={() => setShowCreate(true)}>+ 新增客户</button>}
          </div>
          {showCreate && (
            <div className="inline-create">
              <input
                type="text"
                placeholder="客户名称"
                value={newName}
                onChange={event => setNewName(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') onCreateCustomer(); }}
                maxLength={60}
                autoFocus
              />
              <button onClick={onCreateCustomer} disabled={!newName.trim()}>保存</button>
              <button className="btn-ghost" onClick={() => { setShowCreate(false); setNewName(''); }}>取消</button>
            </div>
          )}
        </div>

        <div className="field-group">
          <label>测试阶段 <span>（报告可自动识别，也可手动覆盖）</span></label>
          <select value={stage} onChange={event => setStage(event.target.value)}>
            <option value="">自动识别</option>
            {STAGES.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>

      <div className="uploader">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm"
          onChange={event => setFile(event.target.files[0])}
        />
        <button onClick={onUpload} disabled={!file || busy}>{busy ? '解析并更新产品档案…' : '上传并更新生命周期'}</button>
      </div>

      {error && <div className="error">{error}</div>}

      {report && (
        <div className="result">
          <div className="upload-success-head">
            <div><span className="success-icon">✓</span><div><h3>报告已归档</h3><p>产品问题台账已按本次结果更新。</p></div></div>
            <Link className="btn-link" to={`/products/${encodeURIComponent(report.productNo)}`}>查看产品档案 →</Link>
          </div>

          <div className="summary">
            <span>货号：<b>{report.productNo}</b></span>
            <span>产品：<b>{report.productName || '—'}</b></span>
            <span>客户：<b>{report.customerName}</b></span>
            <span>阶段：<b>{report.stage}</b></span>
            <span>FAIL：<b className="danger-text">{report.failCount}</b></span>
            <span>明确 PASS：<b className="success-text">{report.passCount || 0}</b></span>
            {report.totalImages > 0 && <span>附图：<b>{report.totalImages}</b> 张</span>}
          </div>

          {changes && (
            <div className="change-grid">
              <ChangeCard label="新增问题" value={changes.newOpen.length} tone="red" issues={changes.newOpen} />
              <ChangeCard label="本次已解决" value={changes.resolved.length} tone="green" issues={changes.resolved} />
              <ChangeCard label="本次复发" value={changes.recurring.length} tone="purple" issues={changes.recurring} />
              <ChangeCard label="仍未解决" value={(result.product?.openCount || 0)} tone="amber" issues={changes.stillOpen} />
            </div>
          )}

          {report.sheets.map(sheet => (
            <div key={sheet.sheetId} className="sheet-block">
              <h4>Sheet: {sheet.name}（FAIL {sheet.failCount} / PASS {sheet.passCount || 0}）</h4>
              {sheet.failRows.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>行号</th>{sheet.headers.map((header, index) => <th key={index}>{header}</th>)}</tr></thead>
                    <tbody>
                      {sheet.failRows.map(row => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          {sheet.headers.map((_, index) => {
                            const cell = row.cells[index];
                            return <td key={index} className={cell?.isRed ? 'red-cell' : ''}>{cell?.value || ''}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="hint">本 Sheet 无不合格行</p>}
              <SheetImages sheet={sheet} />
            </div>
          ))}
          <button onClick={reset}>继续上传</button>
        </div>
      )}
    </div>
  );
}

function ChangeCard({ label, value, tone, issues }) {
  return (
    <div className={`change-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {issues?.length > 0 && <small>{issues.slice(0, 2).map(issue => issue.testItem).join('、')}{issues.length > 2 ? '…' : ''}</small>}
    </div>
  );
}
