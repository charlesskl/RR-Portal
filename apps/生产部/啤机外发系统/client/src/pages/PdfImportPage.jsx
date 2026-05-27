import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function PdfImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [lastFile, setLastFile] = useState(null);
  const [extra, setExtra] = useState({ workshop: '', supplier: '' });
  const [moldMap, setMoldMap] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [workshops, setWorkshops] = useState([]);
  const [pmcs, setPmcs] = useState([]);  // [{ name, workshop }]

  useEffect(() => {
    api.listMoldMappings().then(setMoldMap).catch(() => {});
    api.listSuppliers().then((arr) => setSuppliers(arr.map((s) => s.name).filter(Boolean))).catch(() => {});
    api.listWorkshops().then(setWorkshops).catch(() => {});
    api.listPmcs().then(setPmcs).catch(() => {});
  }, []);

  const applyMappings = (rows, map, headerPlacer) => rows.map((r) => {
    const m = r.mold_code ? map[r.mold_code] : null;
    const enriched = { ...r };
    // Default per-row PMC from PDF header (下单人) if row doesn't have its own
    if (!enriched.pmc_follow) enriched.pmc_follow = headerPlacer || '';
    if (m) {
      enriched.supplier   = enriched.supplier || m.supplier || '';
      enriched.target_qty = enriched.target_qty ?? m.target_qty ?? null;
      enriched.workshop   = enriched.workshop || m.workshop || '';
    }
    // Auto-fill workshop from PMC via known mapping
    if (!enriched.workshop && enriched.pmc_follow) {
      const hit = pmcs.find((p) => p.name === enriched.pmc_follow);
      if (hit && hit.workshop) enriched.workshop = hit.workshop;
    }
    return enriched;
  });

  const onPick = () => fileRef.current?.click();

  const handleParse = async (file, useAi = false) => {
    setError(''); setResult(null);
    if (useAi) setBusyAi(true); else setBusy(true);
    try {
      const parsed = useAi ? await api.parsePdfAi(file) : await api.parsePdf(file);
      // Apply mold→supplier/target mappings + default PMC from PDF header
      const enriched = { ...parsed, rows: applyMappings(parsed.rows || [], moldMap, parsed.header?.placer) };
      setResult(enriched);
      setLastFile(file);
      setExtra({ workshop: parsed.header?.supplier || '', supplier: '' });
    } catch (err) {
      setError(err.message || '解析失败');
    } finally {
      setBusy(false); setBusyAi(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reparseWithAi = async () => {
    if (!lastFile) return;
    if (!confirm('用 AI 智能解析重新提取（会调用百炼 API，可能需要 5-15 秒）？')) return;
    await handleParse(lastFile, true);
  };

  const onChangeFile = async (e) => {
    const f = e.target.files?.[0];
    if (f) await handleParse(f, false);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setError('只支持 PDF 文件'); return; }
    await handleParse(f, false);
  };

  const updateRow = (idx, key, value) => {
    setResult((r) => {
      const rows = [...r.rows];
      rows[idx] = { ...rows[idx], [key]: value };
      return { ...r, rows };
    });
  };
  const removeRow = (idx) => {
    setResult((r) => ({ ...r, rows: r.rows.filter((_, i) => i !== idx) }));
  };

  const downloadExcel = async () => {
    if (!result) return;
    const data = result.rows.map((r, i) => ({
      '序号': i + 1,
      '单号': result.header.bill_no || '',
      '出单日期': result.header.place_date || '',
      '客户': result.header.customer || '',
      '供应商': result.header.supplier || '',
      '款号/货号': r.order_no || '',
      '模具编号': r.mold_code || '',
      '工模名称/品名': r.mold_name || '',
      '总套数': r.total_sets ?? '',
      '啤数': r.shots ?? '',
      '颜色': r.color || '',
      '色粉号': r.color_powder || '',
      '用料名称': r.material || '',
      '整啤净重G': r.shot_weight_g ?? '',
      '总净重KG': r.total_weight_kg ?? '',
      '加工单价': r.unit_price ?? '',
      '加工金额': r.amount ?? '',
      '生产单号': r.production_no || '',
      '备注': r.row_note || '',
      '交货日期': r.delivery_date || result.header.delivery_date || '',
    }));
    const blob = await api.exportRows(
      data,
      `${result.header.bill_no || 'pdf导入'}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      '啤货明细'
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.header.bill_no || 'pdf导入'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importToSystem = async () => {
    if (!result) return;
    if (!confirm(`将导入 ${result.rows.length} 条记录到外发明细，继续？`)) return;
    try {
      const r = await api.importPdfRows({
        header: result.header,
        rows: result.rows,
        workshop: extra.workshop,
        default_supplier: extra.supplier,
      });
      // Refresh local mapping cache so subsequent imports auto-fill
      const fresh = await api.listMoldMappings();
      setMoldMap(fresh);
      setResult(null);
      // Jump to 外发明细 and ask it to scroll to the first newly-inserted row
      navigate('/orders', { state: { focusIds: r.inserted_ids || [] } });
    } catch (err) {
      alert('导入失败：' + err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">PDF 导入</div>
      </div>

      {!result && (
        <div
          className="dropzone"
          onClick={onPick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input ref={fileRef} type="file" accept=".pdf" hidden onChange={onChangeFile} />
          <div className="dropzone-icon">📄</div>
          <div className="dropzone-text">
            {busy ? '规则解析中…' : busyAi ? 'AI 智能解析中（5-15 秒）…' : '点击选择 PDF 文件，或将文件拖到此处'}
          </div>
          <div className="dropzone-hint">
            内置支持：兴信塑胶啤货表、华登塑胶啤货表、兴信委托加工合同采购单。
            <br />其它模板可在解析后用"AI 智能解析"按钮重新提取（调用阿里百炼）。
          </div>
        </div>
      )}

      {error && <div className="alert error">解析失败：{error}</div>}

      {result && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <KV label="文件" value={result.filename} />
            <KV label="生产单号" value={result.header.bill_no} />
            <KV label="出单日期" value={result.header.place_date} />
            <KV label="交货日期" value={result.header.delivery_date} />
            <KV label="客户" value={result.header.customer} />
            <KV label="车间/源供应商" value={result.header.supplier} />
            <KV label="下单人" value={result.header.placer} />
            <KV label="接单人" value={result.header.receiver} />
          </div>
          {result.header.note && (
            <div className="alert info" style={{ marginBottom: 12 }}>
              <b>备注：</b>{result.header.note}
            </div>
          )}

          <div className="section-title">
            解析到 {result.rows.length} 条明细
            {result.template && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 12 }}>（识别模板：{templateLabel(result.template)}）</span>}
          </div>
          <datalist id="supplier-options">
            {suppliers.map((s) => <option key={s} value={s} />)}
          </datalist>
          <datalist id="workshop-options">
            {workshops.map((w) => <option key={w} value={w} />)}
          </datalist>
          <div className="table-wrap" style={{ maxHeight: 'unset' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>款号/货号</th>
                  <th>模具编号</th>
                  <th>品名</th>
                  <th style={{ background: '#fef3c7' }}>PMC ★</th>
                  <th style={{ background: '#fef3c7' }}>车间 ★</th>
                  <th style={{ background: '#fef3c7' }}>加工厂 ★</th>
                  <th style={{ background: '#fef3c7' }} title="入库时同时写入 报价产能 + 实际产能">目标数 ★<br /><span style={{ fontSize: 10, fontWeight: 400, color: '#92400e' }}>= 日产能</span></th>
                  <th>总套数</th>
                  <th>啤数</th>
                  <th>颜色</th>
                  <th>色粉号</th>
                  <th>用料</th>
                  <th>整啤重G</th>
                  <th>总净重KG</th>
                  <th>单价</th>
                  <th>金额</th>
                  <th>备注</th>
                  <th>交货日期</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => {
                  const mapped = r.mold_code && moldMap[r.mold_code];
                  return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><input value={r.order_no || ''} onChange={(e) => updateRow(i, 'order_no', e.target.value)} style={{ width: 90 }} /></td>
                    <td><input value={r.mold_code || ''} onChange={(e) => updateRow(i, 'mold_code', e.target.value)} style={{ width: 130 }} /></td>
                    <td><input value={r.mold_name || ''} onChange={(e) => updateRow(i, 'mold_name', e.target.value)} style={{ width: 110 }} /></td>
                    <td style={{ background: r.pmc_follow ? '#ecfdf5' : '#fffbeb' }}>
                      <select
                        value={r.pmc_follow || ''}
                        onChange={(e) => {
                          const newPmc = e.target.value;
                          // When PMC changes, auto-fill workshop from PMC→workshop mapping
                          const hit = pmcs.find((p) => p.name === newPmc);
                          setResult((res) => {
                            const rows = [...res.rows];
                            rows[i] = {
                              ...rows[i],
                              pmc_follow: newPmc,
                              workshop: hit?.workshop || rows[i].workshop || '',
                            };
                            return { ...res, rows };
                          });
                        }}
                        style={{ width: 90 }}
                        title={r.pmc_follow ? `从 PDF 抓到：${r.pmc_follow}` : '选择 PMC（会自动带出车间）'}
                      >
                        <option value="">请选择</option>
                        {pmcs.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}{p.workshop ? `（${p.workshop}）` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ background: mapped?.workshop ? '#ecfdf5' : '#fffbeb' }}>
                      <select
                        value={r.workshop || ''}
                        onChange={(e) => updateRow(i, 'workshop', e.target.value)}
                        style={{ width: 90 }}
                        title={mapped?.workshop ? `已记忆映射：${mapped.workshop}` : '选择车间'}
                      >
                        <option value="">请选择</option>
                        {workshops.map((w) => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </td>
                    <td style={{ background: mapped?.supplier ? '#ecfdf5' : '#fffbeb' }}>
                      <input
                        list="supplier-options"
                        value={r.supplier || ''}
                        placeholder="选/输入加工厂"
                        onChange={(e) => updateRow(i, 'supplier', e.target.value)}
                        style={{ width: 110 }}
                        title={mapped?.supplier ? `已记忆映射：${mapped.supplier}` : ''}
                      />
                    </td>
                    <td style={{ background: mapped?.target_qty ? '#ecfdf5' : '#fffbeb' }}>
                      <input
                        type="number"
                        value={r.target_qty ?? ''}
                        placeholder="目标"
                        onChange={(e) => updateRow(i, 'target_qty', e.target.value === '' ? null : Number(e.target.value))}
                        style={{ width: 80 }}
                        title={mapped?.target_qty ? `已记忆映射：${mapped.target_qty}` : ''}
                      />
                    </td>
                    <td><input type="number" value={r.total_sets ?? ''} onChange={(e) => updateRow(i, 'total_sets', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} /></td>
                    <td><input type="number" value={r.shots ?? ''} onChange={(e) => updateRow(i, 'shots', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} /></td>
                    <td><input value={r.color || ''} onChange={(e) => updateRow(i, 'color', e.target.value)} style={{ width: 100 }} /></td>
                    <td><input value={r.color_powder || ''} onChange={(e) => updateRow(i, 'color_powder', e.target.value)} style={{ width: 70 }} /></td>
                    <td><input value={r.material || ''} onChange={(e) => updateRow(i, 'material', e.target.value)} style={{ width: 110 }} /></td>
                    <td><input type="number" step="0.01" value={r.shot_weight_g ?? ''} onChange={(e) => updateRow(i, 'shot_weight_g', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 70 }} /></td>
                    <td><input type="number" step="0.1" value={r.total_weight_kg ?? ''} onChange={(e) => updateRow(i, 'total_weight_kg', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} /></td>
                    <td><input type="number" step="0.0001" value={r.unit_price ?? ''} onChange={(e) => updateRow(i, 'unit_price', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 70 }} /></td>
                    <td><input type="number" step="0.01" value={r.amount ?? ''} onChange={(e) => updateRow(i, 'amount', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} /></td>
                    <td><input value={r.row_note || ''} onChange={(e) => updateRow(i, 'row_note', e.target.value)} style={{ width: 80 }} /></td>
                    <td><input type="date" value={r.delivery_date || ''} onChange={(e) => updateRow(i, 'delivery_date', e.target.value)} /></td>
                    <td><button className="ghost" onClick={() => removeRow(i)} style={{ color: '#b91c1c' }}>删除</button></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
            <span style={{ background: '#ecfdf5', padding: '2px 6px', borderRadius: 3 }}>绿色单元格</span> = 已记忆的映射自动填入；
            <span style={{ background: '#fffbeb', padding: '2px 6px', borderRadius: 3, marginLeft: 6 }}>黄色单元格</span> = 待填入。
            填入后导入系统时会自动记忆，下次该模具会自动填好。
          </div>

          <div className="section-title">导入到系统时</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label>默认车间（当某行车间为空时使用，可不填）</label>
              <input
                list="workshop-options"
                value={extra.workshop}
                onChange={(e) => setExtra({ ...extra, workshop: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label>默认加工厂（当某行加工厂为空时使用，可不填）</label>
              <input
                list="supplier-options"
                value={extra.supplier}
                onChange={(e) => setExtra({ ...extra, supplier: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => { setResult(null); setLastFile(null); }}>← 重新上传</button>
            <button onClick={reparseWithAi} disabled={busyAi || !lastFile}>
              {busyAi ? '🤖 AI 解析中…' : '🤖 AI 重新解析（百炼 Qwen）'}
            </button>
            <button onClick={downloadExcel}>📥 导出为 Excel</button>
            <button className="primary" onClick={importToSystem}>💾 导入到系统（{result.rows.length} 条）</button>
          </div>
        </>
      )}
    </div>
  );
}

function templateLabel(t) {
  return {
    A_xinxin: '兴信塑胶 · 啤机部生产啤货表',
    B_huadeng: '华登塑胶 · 啤机部生产啤货表',
    C_purchase: '兴信塑胶 · 委托加工合同 (采购单)',
    unknown: '未识别',
  }[t] || t;
}

function KV({ label, value }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 14, fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );
}
