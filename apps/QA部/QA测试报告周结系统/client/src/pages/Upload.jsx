import { useState, useRef, useEffect } from 'react';
import { uploadFile, listCustomers, createCustomer } from '../api.js';
import SheetImages from '../SheetImages.jsx';

export default function Upload() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef();

  async function refreshCustomers(autoSelectName) {
    const r = await listCustomers();
    setCustomers(r.list || []);
    if (autoSelectName) {
      const m = (r.list || []).find(c => c.name === autoSelectName);
      if (m) setCustomerId(m.id);
    }
  }
  useEffect(() => { refreshCustomers(); }, []);

  async function onCreateCustomer() {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await createCustomer(name);
      await refreshCustomers(r.customer.name);
      setNewName(''); setShowCreate(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function onUpload() {
    if (!file) return;
    if (!customerId) { setError('请先选择客户（或新增一个）'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await uploadFile(file, customerId);
      setResult(r.report);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null); setFile(null); setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="page">
      <h2>上传测试报告</h2>
      <p className="hint">
        支持 <code>.xlsx</code> / <code>.xls</code> / <code>.xlsm</code>。系统会自动识别
        <b style={{ color: '#dc2626' }}> 红色字体 </b>（含红色填充）作为不合格项，按客户和 ISO 周自动归档。
      </p>

      <div className="form-row">
        <label>客户：</label>
        <select value={customerId} onChange={e => setCustomerId(e.target.value)}>
          <option value="">-- 请选择客户 --</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {!showCreate && (
          <button className="btn-ghost" onClick={() => setShowCreate(true)}>+ 新增客户</button>
        )}
        {showCreate && (
          <span className="inline-create">
            <input
              type="text"
              placeholder="客户名称"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onCreateCustomer(); }}
              maxLength={60}
              autoFocus
            />
            <button onClick={onCreateCustomer} disabled={!newName.trim()}>保存</button>
            <button className="btn-ghost" onClick={() => { setShowCreate(false); setNewName(''); }}>取消</button>
          </span>
        )}
      </div>

      <div className="uploader">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm"
          onChange={e => setFile(e.target.files[0])}
        />
        <button onClick={onUpload} disabled={!file || busy}>{busy ? '解析中…' : '上传并解析'}</button>
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result">
          <h3>解析结果</h3>
          <div className="summary">
            <span>客户：<b>{result.customerName}</b></span>
            <span>文件：<b>{result.originalName}</b></span>
            <span>归属周：<b>{result.weekKey}</b></span>
            <span>有效行数：{result.totalRows}</span>
            <span>不合格行数：<b style={{ color: '#dc2626' }}>{result.failCount}</b></span>
            {result.totalImages > 0 && <span>附图：<b>{result.totalImages}</b> 张</span>}
          </div>
          {result.sheets.map(sh => (
            <div key={sh.sheetId} className="sheet-block">
              <h4>Sheet: {sh.name}（{sh.totalRows} 行 / 不合格 {sh.failCount} 行）</h4>
              {sh.failRows.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>行号</th>
                        {sh.headers.map((h, i) => <th key={i}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {sh.failRows.map(row => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          {sh.headers.map((_, i) => {
                            const c = row.cells[i];
                            return (
                              <td key={i} className={c && c.isRed ? 'red-cell' : ''}>
                                {c ? c.value : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="hint">本 Sheet 无不合格行</p>}
              <SheetImages sheet={sh} />
            </div>
          ))}
          <button onClick={reset}>继续上传</button>
        </div>
      )}
    </div>
  );
}
