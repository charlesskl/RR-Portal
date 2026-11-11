/* Excel transport for pending drafts. Recovery metadata stays with the workbook. */
(function (root) {
  'use strict';
  const dataSheet = '验货草稿';
  const metaSheet = '_QMS草稿恢复';
  const marker = 'QMS_PENDING_DRAFT_XLSX_V1';
  const columns = [
    ['id','记录编号'],['date','来料日期'],['inspDate','检验日期'],['supplier','供应商'],['client','客户'],
    ['processType','加工类型'],['productNo','货号'],['productName','款式名称'],['deliveryNo','送货单号'],
    ['orderNo','PO号'],['type','类型'],['qty','来料数量'],['sampleQty','抽查数量'],['pass','PASS数量'],
    ['fail','不良数量'],['defectRate','不良率'],['result','判定结果'],['result2','复验结果'],
    ['defect','不良描述'],['defects','不良明细JSON'],['measurements','测量明细JSON'],['qc','检验员'],
    ['confirmBy','确认人'],['remark','备注'],['orderQty','订单数量'],['updatedAt','修改时间'],
    ['status','审核状态'],['reviewBy','审核人'],['reviewAt','审核时间'],['rejectReason','退回原因'],
    ['rejectBy','退回人'],['rejectAt','退回时间'],['aqlLevel','AQL档位'],
  ];
  const numeric = new Set(['qty','sampleQty','pass','fail','orderQty']);
  function display(record, key) {
    const value = record[key];
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > 30000 ? '[完整内容保存在恢复信息中，共' + text.length + '字符]' : text;
  }
  function encode(data, excel) {
    if (!data || data.backupType !== 'pending-records' || !Array.isArray(data.records)) throw new Error('草稿格式无效');
    const workbook = excel.utils.book_new();
    const rows = [columns.map(column => column[1]), ...data.records.map(record => columns.map(([key]) => {
      const text = display(record, key);
      return numeric.has(key) && typeof record[key] === 'number' ? record[key] : text;
    }))];
    const sheet = excel.utils.aoa_to_sheet(rows);
    sheet['!cols'] = columns.map(([key]) => ({ wch: ['productName','remark','defect','defects','measurements'].includes(key) ? 32 : 20 }));
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    for (let row = 1; row < rows.length; row++) {
      const cell = sheet[excel.utils.encode_cell({ r: row, c: 0 })];
      cell.t = 's'; cell.v = String(data.records[row - 1].id); cell.z = '@';
    }
    excel.utils.book_append_sheet(workbook, sheet, dataSheet);
    const metadata = [[marker]];
    const text = JSON.stringify(data);
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 30000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      metadata.push([text.slice(start, end)]); start = end;
    }
    excel.utils.book_append_sheet(workbook, excel.utils.aoa_to_sheet(metadata), metaSheet);
    workbook.Workbook = { Sheets: [{ name: dataSheet, Hidden: 0 }, { name: metaSheet, Hidden: 1 }] };
    return workbook;
  }
  function decode(workbook, excel) {
    const metadata = workbook.Sheets[metaSheet];
    const sheet = workbook.Sheets[dataSheet];
    if (!metadata) {
      if (sheet && sheet.A1 && sheet.A1.v === columns[0][1]) throw new Error('Excel草稿缺少恢复信息，请使用原下载文件');
      return null;
    }
    if (!sheet) throw new Error('Excel草稿缺少验货明细工作表');
    const chunks = excel.utils.sheet_to_json(metadata, { header: 1, raw: true, defval: '' });
    if (!chunks[0] || chunks[0][0] !== marker) throw new Error('Excel草稿恢复信息版本无效');
    const data = JSON.parse(chunks.slice(1).map(row => row[0]).join(''));
    if (!data || data.backupType !== 'pending-records' || !Array.isArray(data.records) ||
        !data.draftRecovery || typeof data.draftRecovery.originalRaw !== 'string') throw new Error('Excel草稿恢复信息不完整');
    const draft = JSON.parse(data.draftRecovery.originalRaw);
    if (draft.company !== data.company || draft.owner !== data.owner || !draft.state ||
        JSON.stringify(draft.state.records) !== JSON.stringify(data.records)) throw new Error('Excel草稿内容与恢复信息不一致');
    const rows = excel.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    if (!rows[0] || columns.some((column, index) => rows[0][index] !== column[1])) throw new Error('Excel草稿表头已变化，请保留原表头');
    const originals = new Map(data.records.map(record => [String(record.id), record]));
    const seen = new Set(), changedIds = new Set(draft.changedIds || []);
    let edited = false;
    const records = [];
    rows.slice(1).forEach((values, index) => {
      if (values.every(value => value === '')) return;
      const idText = String(values[0]);
      const id = Number(idText);
      if (!/^\d+$/.test(idText) || !Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new Error('Excel草稿含无效或重复编号，第' + (index + 2) + '行');
      seen.add(id);
      const original = originals.get(idText);
      const record = original ? { ...original } : { id };
      let changed = !original;
      columns.forEach(([key], col) => {
        const cell = sheet[excel.utils.encode_cell({ r: index + 1, c: col })];
        if (cell && cell.f) throw new Error('Excel草稿明细需填写实际值，第' + (index + 2) + '行包含公式');
        if (key === 'id') return;
        let value = values[col] == null ? '' : values[col];
        if (original && String(value) === display(original, key)) return;
        if ((key === 'date' || key === 'inspDate') && typeof value === 'number') {
          const date = excel.SSF.parse_date_code(value);
          if (!date) throw new Error('Excel草稿日期无效，第' + (index + 2) + '行');
          value = String(date.y).padStart(4, '0') + '-' + String(date.m).padStart(2, '0') + '-' + String(date.d).padStart(2, '0');
        }
        if (numeric.has(key)) {
          if (value === '') value = null;
          else if (typeof value === 'boolean' || !Number.isFinite(Number(value))) throw new Error('Excel草稿数值无效，第' + (index + 2) + '行');
          else value = Number(value);
        } else if (key === 'defects' || key === 'measurements') {
          value = value === '' ? [] : JSON.parse(String(value));
          if (!Array.isArray(value)) throw new Error('Excel草稿明细JSON须为数组');
        } else value = String(value);
        record[key] = value; changed = true;
      });
      if (changed) {
        record.updatedAt = new Date().toISOString(); changedIds.add(id); edited = true;
      }
      records.push(record);
    });
    if (!records.length) throw new Error('Excel草稿没有可恢复的记录');
    if (!edited && records.length === data.records.length && records.every((row, i) => row.id === data.records[i].id)) return data;
    draft.state.records = records;
    draft.changedIds = [...changedIds].filter(id => seen.has(id));
    data.records = records; data.count = records.length;
    data.draftRecovery.originalRaw = JSON.stringify(draft);
    return data;
  }
  const api = { encode, decode };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__QC_DRAFT_EXCEL = api;
})(typeof window === 'undefined' ? globalThis : window);
