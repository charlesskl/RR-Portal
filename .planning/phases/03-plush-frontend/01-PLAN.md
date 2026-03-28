---
phase: 3
plan: 1
title: "新增车缝明细和搪胶件 tab，适配 Raw Material 显示"
wave: 1
depends_on: []
requirements: [UI-01, UI-02, UI-03]
files_modified:
  - client/js/tabs/bd-sewing.js
  - client/js/tabs/bd-rotocast.js
  - client/index.html
  - client/js/app.js
autonomous: true
---

# Plan 01: 前端双格式展示

## Objective

新增 F. Sewing Detail 和 G. Rotocast Items 两个 tab 到 Body Cost Breakdown 下，支持可编辑表格。确保 Raw Material tab 两种格式都能正确显示。

## Tasks

<task id="1">
<title>创建 bd-sewing.js — 车缝明细 tab</title>
<read_first>
- client/js/tabs/bd-purchase.js
- client/js/tabs/bd-material.js
</read_first>
<action>
创建 client/js/tabs/bd-sewing.js，遵循 bd-purchase.js 的模式：

```javascript
/* Tab: bd-sewing — F. Sewing Detail (车缝明细) */
const tab_bd_sewing = {
  render(versionData) {
    const items = versionData.sewing_details || [];
    const subTotal = items.reduce((s, d) => s + (parseFloat(d.total_price_rmb) || 0), 0);

    const rows = items.map(d => `
      <tr>
        <td class="center"><input type="checkbox" class="row-check" data-id="${d.id}"></td>
        <td class="editable" data-id="${d.id}" data-field="fabric_name" data-type="text">${escapeHtml(d.fabric_name || '')}</td>
        <td class="editable" data-id="${d.id}" data-field="position" data-type="text">${escapeHtml(d.position || '')}</td>
        <td class="editable num" data-id="${d.id}" data-field="cut_pieces" data-type="number">${d.cut_pieces != null ? d.cut_pieces : ''}</td>
        <td class="editable num" data-id="${d.id}" data-field="usage_amount" data-type="number">${formatNumber(d.usage_amount, 6)}</td>
        <td class="editable num" data-id="${d.id}" data-field="material_price_rmb" data-type="number">${formatNumber(d.material_price_rmb, 2)}</td>
        <td class="editable num" data-id="${d.id}" data-field="price_rmb" data-type="number">${formatNumber(d.price_rmb, 4)}</td>
        <td class="editable num" data-id="${d.id}" data-field="markup_point" data-type="number">${formatNumber(d.markup_point, 2)}</td>
        <td class="num">${formatNumber(d.total_price_rmb, 4)}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">F. Sewing Detail (车缝明细)</span>
        <button class="btn btn-primary" id="bdSewAdd">+ 添加行</button>
        <button class="btn btn-danger" id="bdSewDel">删除选中</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">Total: <b>${formatNumber(subTotal, 2)} RMB</b></span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:30px"><input type="checkbox" id="bdSewAll"></th>
            <th>布料名称</th>
            <th>部位</th>
            <th>裁片数</th>
            <th>用量</th>
            <th>物料价(RMB)</th>
            <th>价钱(RMB)</th>
            <th>码点</th>
            <th>总价(RMB)</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>'}</tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const items = versionData.sewing_details || [];

    // Select all
    const allCb = container.querySelector('#bdSewAll');
    if (allCb) allCb.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(c => c.checked = e.target.checked);
    });

    // Add
    const addBtn = container.querySelector('#bdSewAdd');
    if (addBtn) addBtn.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'sewing-detail', { fabric_name: '', position: '', markup_point: 1.15 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    // Delete
    const delBtn = container.querySelector('#bdSewDel');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'sewing-detail', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    // Editable cells
    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = items.find(m => String(m.id) === id);
      if (!item) return;
      makeEditable(td, {
        type, value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
```
</action>
<acceptance_criteria>
- client/js/tabs/bd-sewing.js 存在
- 包含 `const tab_bd_sewing`
- render 方法输出表格含 fabric_name, position, cut_pieces, usage_amount, material_price_rmb, price_rmb, markup_point, total_price_rmb 列
- init 方法绑定添加/删除/编辑事件，section 名为 'sewing-detail'
</acceptance_criteria>
</task>

<task id="2">
<title>创建 bd-rotocast.js — 搪胶件 tab</title>
<read_first>
- client/js/tabs/bd-purchase.js
</read_first>
<action>
创建 client/js/tabs/bd-rotocast.js，同样遵循 bd-purchase.js 模式：

```javascript
/* Tab: bd-rotocast — G. Rotocast Items (搪胶件) */
const tab_bd_rotocast = {
  render(versionData) {
    const items = versionData.rotocast_items || [];
    const subTotal = items.reduce((s, r) => s + (parseFloat(r.total_hkd) || 0), 0);

    const rows = items.map(r => `
      <tr>
        <td class="center"><input type="checkbox" class="row-check" data-id="${r.id}"></td>
        <td class="editable" data-id="${r.id}" data-field="mold_no" data-type="text">${escapeHtml(r.mold_no || '')}</td>
        <td class="editable" data-id="${r.id}" data-field="name" data-type="text">${escapeHtml(r.name || '')}</td>
        <td class="editable num" data-id="${r.id}" data-field="output_qty" data-type="number">${r.output_qty != null ? r.output_qty : ''}</td>
        <td class="editable num" data-id="${r.id}" data-field="usage_pcs" data-type="number">${r.usage_pcs != null ? r.usage_pcs : ''}</td>
        <td class="editable num" data-id="${r.id}" data-field="unit_price_hkd" data-type="number">${formatNumber(r.unit_price_hkd, 2)}</td>
        <td class="num">${formatNumber(r.total_hkd, 2)}</td>
        <td class="editable" data-id="${r.id}" data-field="remark" data-type="text">${escapeHtml(r.remark || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">G. Rotocast Items (搪胶件)</span>
        <button class="btn btn-primary" id="bdRotoAdd">+ 添加行</button>
        <button class="btn btn-danger" id="bdRotoDel">删除选中</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">Total: <b>${formatNumber(subTotal, 2)} HK$</b></span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:30px"><input type="checkbox" id="bdRotoAll"></th>
            <th>模号</th>
            <th>名称</th>
            <th>出数</th>
            <th>用量(pcs)</th>
            <th>单价(HK$)</th>
            <th>合计(HK$)</th>
            <th>备注</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>'}</tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const items = versionData.rotocast_items || [];

    const allCb = container.querySelector('#bdRotoAll');
    if (allCb) allCb.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(c => c.checked = e.target.checked);
    });

    const addBtn = container.querySelector('#bdRotoAdd');
    if (addBtn) addBtn.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'rotocast', { mold_no: '', name: '', usage_pcs: 1 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    const delBtn = container.querySelector('#bdRotoDel');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'rotocast', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = items.find(m => String(m.id) === id);
      if (!item) return;
      makeEditable(td, {
        type, value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'rotocast', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
```
</action>
<acceptance_criteria>
- client/js/tabs/bd-rotocast.js 存在
- 包含 `const tab_bd_rotocast`
- 表格含 mold_no, name, output_qty, usage_pcs, unit_price_hkd, total_hkd, remark 列
- section 名为 'rotocast'
</acceptance_criteria>
</task>

<task id="3">
<title>注册新 tab 到 index.html 和 app.js</title>
<read_first>
- client/index.html
- client/js/app.js
</read_first>
<action>
1. **index.html** — 在 Body Cost Breakdown tab 按钮区域（E. Others 之后）添加：
```html
<button class="tab-sub" data-tab="bd-sewing">F. Sewing Detail</button>
<button class="tab-sub" data-tab="bd-rotocast">G. Rotocast</button>
```

2. **index.html** — 在 script 引用区域（bd-others.js 之后）添加：
```html
<script src="js/tabs/bd-sewing.js"></script>
<script src="js/tabs/bd-rotocast.js"></script>
```

3. **app.js** — 在 breakdownTabs 对象中（bd-others 之后）添加：
```javascript
'bd-sewing':   typeof tab_bd_sewing !== 'undefined' ? tab_bd_sewing : null,
'bd-rotocast': typeof tab_bd_rotocast !== 'undefined' ? tab_bd_rotocast : null,
```
</action>
<acceptance_criteria>
- index.html 包含 `data-tab="bd-sewing"` 和 `data-tab="bd-rotocast"` 按钮
- index.html 包含 `bd-sewing.js` 和 `bd-rotocast.js` script 引用
- app.js 包含 `'bd-sewing'` 和 `'bd-rotocast'` 在 tab 注册中
</acceptance_criteria>
</task>

## Verification

- 导入 L21014 后切换到 Body Cost Breakdown，F. Sewing Detail tab 显示 34 行车缝数据
- G. Rotocast tab 显示 2 行搪胶件（S01 搪胶脸 3.77、S02 搪胶脚 3.43）
- 导入 47712 后 F 和 G tab 显示"暂无数据"
- 编辑/添加/删除功能正常

## must_haves

- UI-01: Raw Material tab 两种格式正确显示
- UI-02: 车缝明细 tab 显示布料裁片数据
- UI-03: 搪胶件 tab 显示搪胶部件数据
