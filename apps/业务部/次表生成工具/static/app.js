/**
 * 单价表次表生成工具 - 前端交互（多Sheet多组版）
 */

// ==================== 通用fetch封装（超时+错误处理） ====================
function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
        .then(r => { clearTimeout(timer); return r.json(); })
        .catch(err => {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                return { success: false, error: '请求超时，请重试' };
            }
            return { success: false, error: '网络错误: ' + err.message };
        });
}

let uploadedFile = { filepath: '', filename: '', sheets: [] };
let scanResult = {};
let lastCalcResult = {};
let customMaterialCount = 0;

// ==================== 多Sheet管理 ====================
let sheetEntries = [];   // 每个勾选Sheet的完整状态
let activeSheetIdx = 0;  // 当前激活的Sheet索引

function createSheetEntry(sheetName) {
    return {
        sheet_name: sheetName,
        scanResult: {},
        groups: [createEmptyGroup(1)],
        activeGroupId: 1,
        groupIdCounter: 1,
    };
}

function saveCurrentSheetState() {
    const entry = sheetEntries[activeSheetIdx];
    if (!entry) return;
    // 同步全局状态回entry
    entry.activeGroupId = activeGroupId;
    entry.groupIdCounter = groupIdCounter;
    entry.groups = groups;
    // 保存当前组的表单数据
    const currentGroup = groups.find(g => g.id === activeGroupId);
    if (currentGroup) saveGroupFromForm(currentGroup);
    entry.scanResult = scanResult;
}

function restoreSheetState(idx) {
    const entry = sheetEntries[idx];
    if (!entry) return;
    activeSheetIdx = idx;
    scanResult = entry.scanResult || {};
    groups = entry.groups;
    activeGroupId = entry.activeGroupId;
    groupIdCounter = entry.groupIdCounter;
    // 恢复表单
    const currentGroup = groups.find(g => g.id === activeGroupId);
    if (currentGroup) restoreFormFromGroup(currentGroup);
    // 恢复扫描结果显示
    if (scanResult.row_details) displayScanResult(scanResult);
    if (scanResult.auto_values) {
        applyAutoValues(scanResult.auto_values);
    } else {
        document.getElementById('autoValuesBar').classList.add('hidden');
    }
    // 渲染前半段行跳过checkbox
    renderMidRowCheckboxes(scanResult.mid_rows || []);
    // 刷新物料位置下拉（基于扫描结果）
    updateMaterialPositionSelects();
    renderGroupTabs();
    // 更新表头行
    if (scanResult.header_rows) renderHeaderRows(scanResult.header_rows);
    onOutputModeChange();
}

function switchSheet(idx) {
    if (idx === activeSheetIdx) return;
    saveCurrentSheetState();
    restoreSheetState(idx);
    renderSheetTabs();
}

function renderSheetTabs() {
    const bar = document.getElementById('sheetTabBar');
    if (!bar) return;
    if (sheetEntries.length <= 1) {
        document.getElementById('sheetTabContainer').classList.add('hidden');
        return;
    }
    document.getElementById('sheetTabContainer').classList.remove('hidden');
    bar.innerHTML = '';
    sheetEntries.forEach((entry, i) => {
        const isActive = i === activeSheetIdx;
        const tab = document.createElement('button');
        tab.className = `px-3 py-1.5 rounded-t-lg text-sm font-medium border border-b-0 ${
            isActive ? 'bg-white text-green-700 border-green-400' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
        }`;
        tab.textContent = entry.sheet_name;
        tab.onclick = () => switchSheet(i);
        bar.appendChild(tab);
    });
    // 复制参数按钮
    if (sheetEntries.length > 1) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 font-medium';
        copyBtn.textContent = '复制到其他Sheet';
        copyBtn.onclick = showCopyDialog;
        bar.appendChild(copyBtn);
    }
}

// ==================== 复制参数到其他Sheet ====================

function showCopyDialog() {
    saveCurrentSheetState();
    const srcName = sheetEntries[activeSheetIdx].sheet_name;
    const targets = sheetEntries.filter((_, i) => i !== activeSheetIdx);
    if (!targets.length) return;

    const checkboxes = targets.map((e, i) =>
        `<label class="flex items-center gap-2"><input type="checkbox" class="copy-target-cb" value="${i < activeSheetIdx ? i : i + 1}" checked>${escapeHtml(e.sheet_name)}</label>`
    ).join('');

    const dialog = document.getElementById('copyDialog');
    document.getElementById('copyDialogSrc').textContent = srcName;
    document.getElementById('copyDialogTargets').innerHTML = checkboxes;
    dialog.classList.remove('hidden');
}

function hideCopyDialog() {
    document.getElementById('copyDialog').classList.add('hidden');
}

function executeCopy() {
    const src = sheetEntries[activeSheetIdx];
    const targetIdxs = Array.from(document.querySelectorAll('.copy-target-cb:checked')).map(cb => parseInt(cb.value));
    if (!targetIdxs.length) { hideCopyDialog(); return; }

    targetIdxs.forEach(idx => {
        const target = sheetEntries[idx];
        if (!target) return;
        // 深拷贝源groups
        target.groupIdCounter = src.groupIdCounter;
        target.activeGroupId = src.activeGroupId;
        target.groups = src.groups.map(g => {
            const clone = JSON.parse(JSON.stringify(g));
            clone.calcResult = {}; // 目标Sheet需重新计算
            clone.lastMaterials = [];
            return clone;
        });
    });

    hideCopyDialog();
    alert(`已复制到 ${targetIdxs.length} 个Sheet。切换过去后请重新计算纸箱价格。`);
}

// ==================== 多组管理 ====================
let groups = [];
let activeGroupId = 1;
let groupIdCounter = 1;

function createEmptyGroup(id) {
    return {
        id: id,
        item_name: '', pcs_per_carton: '',
        boxTypes: ['normal'],
        boxLength: '', boxWidth: '', boxHeight: '',
        paperName: '', paperPrice: '',
        tapePrice: '0.045', laborCost: '', cartonDesc: '',
        calcResult: {}, lastMaterials: [],
        // 固定物料
        mailboxEnabled: false, mailboxL: '', mailboxW: '', mailboxH: '',
        mailboxPaperPrice: '', mailboxQty: '1', mailboxName: 'MAILBOX(1pcs)', mailboxRemark: '',
        cardEnabled: false, cardL: '', cardW: '', cardPaperPrice: '', cardQty: '1',
        cardName: 'Protection Card', cardRemark: '',
        cornerEnabled: false, cornerL: '', cornerW: '', cornerPaperPrice: '',
        cornerName: 'Corner Protector', cornerRemark: '',
        strappingEnabled: false, strappingMeters: '', strappingPrice: '0.13',
        strappingName: 'Strapping', strappingRemark: '',
        palletEnabled: false, palletL: '', palletW: '', palletMargin: '', palletPrice: '7.2',
        palletName: 'Slip Sheet', palletRemark: '',
        customMaterials: [],
    };
}

groups.push(createEmptyGroup(1));

// 表单字段映射：domId:groupKey（boxType改为多选，单独处理）
const FORM_FIELDS = [
    'itemName:item_name', 'pcsPerCarton:pcs_per_carton',
    'boxLength:boxLength', 'boxWidth:boxWidth', 'boxHeight:boxHeight',
    'paperName:paperName', 'paperPrice:paperPrice',
    'tapePrice:tapePrice', 'laborCost:laborCost', 'cartonDesc:cartonDesc',
];
const SKIP_ROW_FIELDS = ['skipTape', 'skipLabor', 'skipFob40f', 'skipShipping40f', 'skipFob20f', 'skipShipping20f', 'skipLcl'];
const MATERIAL_FIELDS = [
    { enabledId: 'mailboxEnabled', prefix: 'mailbox', fields: ['L','W','H','PaperPrice','Qty','Name','Remark','Position'] },
    { enabledId: 'cardEnabled', prefix: 'card', fields: ['L','W','PaperPrice','Qty','Name','Remark','Position'] },
    { enabledId: 'cornerEnabled', prefix: 'corner', fields: ['L','W','PaperPrice','Name','Remark','Position'] },
    { enabledId: 'strappingEnabled', prefix: 'strapping', fields: ['Meters','Price','Name','Remark','Position'] },
    { enabledId: 'palletEnabled', prefix: 'pallet', fields: ['L','W','Margin','Price','Name','Remark','Position'] },
];

function saveGroupFromForm(group) {
    FORM_FIELDS.forEach(mapping => {
        const [domId, key] = mapping.split(':');
        const el = document.getElementById(domId);
        group[key] = el.type === 'checkbox' ? el.checked : el.value;
    });
    // 多箱型保存
    group.boxTypes = getSelectedBoxTypes();
    SKIP_ROW_FIELDS.forEach(id => {
        group[id] = document.getElementById(id).checked;
    });
    // 保存前半段行跳过状态
    group.skipMidRows = {};
    document.querySelectorAll('.skip-mid-row-cb').forEach(cb => {
        group.skipMidRows[cb.dataset.row] = cb.checked;
    });
    MATERIAL_FIELDS.forEach(mat => {
        group[mat.enabledId] = document.getElementById(mat.enabledId).checked;
        mat.fields.forEach(f => {
            const id = mat.prefix + f;
            group[id] = document.getElementById(id).value;
        });
    });
    group.customMaterials = [];
    document.querySelectorAll('.custom-material-row').forEach(row => {
        group.customMaterials.push({
            enabled: row.querySelector('.cm-enabled').checked,
            name: row.querySelector('.cm-name').value,
            price: row.querySelector('.cm-price').value,
            qty: row.querySelector('.cm-qty').value,
            position: row.querySelector('.cm-position').value || 'carton',
            remark: row.querySelector('.cm-remark').value,
        });
    });
    group.calcResult = JSON.parse(JSON.stringify(lastCalcResult));
    group.lastMaterials = window._lastMaterials ? JSON.parse(JSON.stringify(window._lastMaterials)) : [];
}

function restoreFormFromGroup(group) {
    FORM_FIELDS.forEach(mapping => {
        const [domId, key] = mapping.split(':');
        const el = document.getElementById(domId);
        if (el.type === 'checkbox') el.checked = !!group[key];
        else el.value = group[key] || '';
    });
    // 多箱型恢复
    const savedTypes = group.boxTypes || (group.boxType ? [group.boxType] : ['normal']);
    document.querySelectorAll('.box-type-cb').forEach(cb => {
        cb.checked = savedTypes.includes(cb.value);
    });
    SKIP_ROW_FIELDS.forEach(id => {
        document.getElementById(id).checked = !!group[id];
    });
    // 恢复前半段行跳过状态
    if (group.skipMidRows) {
        document.querySelectorAll('.skip-mid-row-cb').forEach(cb => {
            cb.checked = !!group.skipMidRows[cb.dataset.row];
        });
    }
    MATERIAL_FIELDS.forEach(mat => {
        document.getElementById(mat.enabledId).checked = !!group[mat.enabledId];
        mat.fields.forEach(f => {
            const id = mat.prefix + f;
            document.getElementById(id).value = group[id] || '';
        });
    });
    // 自定义物料
    const container = document.getElementById('customMaterialList');
    container.innerHTML = '';
    customMaterialCount = 0;
    (group.customMaterials || []).forEach(cm => {
        addCustomMaterial();
        const row = container.lastElementChild;
        row.querySelector('.cm-enabled').checked = cm.enabled;
        row.querySelector('.cm-name').value = cm.name || '';
        row.querySelector('.cm-price').value = cm.price || '';
        row.querySelector('.cm-qty').value = cm.qty || '1';
        row.querySelector('.cm-position').value = cm.position || 'carton';
        row.querySelector('.cm-remark').value = cm.remark || '';
    });
    // 恢复计算结果
    lastCalcResult = group.calcResult || {};
    window._lastMaterials = group.lastMaterials || [];
    if (lastCalcResult.box_price_rmb) {
        document.getElementById('resBox').textContent = '¥' + lastCalcResult.box_price_rmb.toFixed(4);
        document.getElementById('resTape').textContent = '¥' + lastCalcResult.tape_price_rmb.toFixed(4);
        document.getElementById('resCbm').textContent = lastCalcResult.cbm.toFixed(6);
    } else {
        document.getElementById('resBox').textContent = '--';
        document.getElementById('resTape').textContent = '--';
        document.getElementById('resCbm').textContent = '--';
    }
    ['resMailbox','resCard','resCorner','resStrapping','resPallet'].forEach(id => {
        document.getElementById(id).textContent = '--';
    });
    if (lastCalcResult.materials) updateMaterialResults(lastCalcResult.materials);
}

function switchGroup(id) {
    const current = groups.find(g => g.id === activeGroupId);
    if (current) saveGroupFromForm(current);
    activeGroupId = id;
    const target = groups.find(g => g.id === id);
    if (target) restoreFormFromGroup(target);
    renderGroupTabs();
}

function addGroup() {
    const current = groups.find(g => g.id === activeGroupId);
    if (current) saveGroupFromForm(current);
    groupIdCounter++;
    const newGroup = createEmptyGroup(groupIdCounter);
    groups.push(newGroup);
    activeGroupId = groupIdCounter;
    restoreFormFromGroup(newGroup);
    renderGroupTabs();
}

function removeGroup(id) {
    if (groups.length <= 1) { alert('至少保留一组'); return; }
    if (!confirm(`确认删除组 ${groups.findIndex(g => g.id === id) + 1}？`)) return;
    groups = groups.filter(g => g.id !== id);
    if (activeGroupId === id) {
        activeGroupId = groups[0].id;
        restoreFormFromGroup(groups[0]);
    }
    // 同步新数组引用到sheetEntry
    if (sheetEntries[activeSheetIdx]) sheetEntries[activeSheetIdx].groups = groups;
    renderGroupTabs();
}

function renderGroupTabs() {
    const bar = document.getElementById('groupTabBar');
    if (!bar) return;
    bar.innerHTML = '';
    groups.forEach((g, i) => {
        const isActive = g.id === activeGroupId;
        const hasCalc = g.calcResult && g.calcResult.box_price_rmb;
        const tab = document.createElement('button');
        tab.className = `px-3 py-1 rounded-t-lg text-sm font-medium border border-b-0 ${
            isActive ? 'bg-white text-blue-600 border-blue-300' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
        }`;
        tab.innerHTML = `组${i + 1}${hasCalc ? ' ✓' : ''}`;
        tab.onclick = () => switchGroup(g.id);
        if (groups.length > 1) {
            const del = document.createElement('span');
            del.className = 'ml-1 text-red-400 hover:text-red-600 cursor-pointer';
            del.textContent = '×';
            del.onclick = (e) => { e.stopPropagation(); removeGroup(g.id); };
            tab.appendChild(del);
        }
        bar.appendChild(tab);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'px-3 py-1 text-sm text-blue-500 hover:text-blue-700 font-medium';
    addBtn.textContent = '+ 添加';
    addBtn.onclick = addGroup;
    bar.appendChild(addBtn);
}

// ==================== 公式计算 ====================

function getSelectedBoxTypes() {
    return Array.from(document.querySelectorAll('.box-type-cb:checked')).map(cb => cb.value);
}

function calculate() {
    const pcs = parseInt(document.getElementById('pcsPerCarton').value) || 1;
    const boxTypes = getSelectedBoxTypes();
    const params = {
        box_types: boxTypes,
        box_type: boxTypes[0] || 'normal',  // 向下兼容
        length: parseFloat(document.getElementById('boxLength').value) || 0,
        width: parseFloat(document.getElementById('boxWidth').value) || 0,
        height: parseFloat(document.getElementById('boxHeight').value) || 0,
        paper_price: parseFloat(document.getElementById('paperPrice').value) || 0,
        tape_unit_price: parseFloat(document.getElementById('tapePrice').value) || 0.045,
        pcs_per_carton: pcs,
        exchange_rate: 7.08,
        materials: collectMaterials(),
    };

    if (!params.length || !params.width || !params.paper_price) return;

    fetchWithTimeout('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    }, 30000)
    .then(data => {
        if (data.success) {
            lastCalcResult = data.data;
            // 多箱型显示明细
            const boxDetails = data.data.box_details || [];
            const boxTypeNames = {normal:'普通箱', tiandi:'天地盖', banyi:'半亦箱', weiboard:'围板', mailbox_lr:'邮包盒'};
            if (boxDetails.length > 1) {
                const detail = boxDetails.map(d => `${boxTypeNames[d.type]||d.type}¥${d.price_rmb.toFixed(2)}`).join('+');
                document.getElementById('resBox').textContent = `¥${data.data.box_price_rmb.toFixed(4)} (${detail})`;
            } else {
                document.getElementById('resBox').textContent = '¥' + data.data.box_price_rmb.toFixed(4);
            }
            document.getElementById('resTape').textContent = '¥' + data.data.tape_price_rmb.toFixed(4);
            document.getElementById('resCbm').textContent = data.data.cbm.toFixed(6);

            // 更新各物料结果
            updateMaterialResults(data.data.materials);

            // 保存物料列表
            window._lastMaterials = buildMaterialsForGenerate(data.data.materials);
        }
    });
}

// 判断各固定物料是否有效（checkbox勾选 + 参数完整），三个函数共用
function isMaterialActive(type) {
    if (type === 'mailbox') {
        return document.getElementById('mailboxEnabled').checked
            && (parseFloat(document.getElementById('mailboxL').value) || 0) > 0
            && (parseFloat(document.getElementById('mailboxW').value) || 0) > 0
            && (parseFloat(document.getElementById('mailboxH').value) || 0) > 0
            && (parseFloat(document.getElementById('mailboxPaperPrice').value) || 0) > 0;
    }
    if (type === 'card') {
        return document.getElementById('cardEnabled').checked
            && (parseFloat(document.getElementById('cardL').value) || 0) > 0
            && (parseFloat(document.getElementById('cardW').value) || 0) > 0
            && (parseFloat(document.getElementById('cardPaperPrice').value) || 0) > 0;
    }
    if (type === 'corner') {
        return document.getElementById('cornerEnabled').checked
            && (parseFloat(document.getElementById('cornerL').value) || 0) > 0
            && (parseFloat(document.getElementById('cornerW').value) || 0) > 0
            && (parseFloat(document.getElementById('cornerPaperPrice').value) || 0) > 0;
    }
    if (type === 'strapping') {
        return document.getElementById('strappingEnabled').checked
            && (parseFloat(document.getElementById('strappingMeters').value) || 0) > 0;
    }
    if (type === 'pallet') {
        return document.getElementById('palletEnabled').checked
            && (parseFloat(document.getElementById('palletL').value) || 0) > 0
            && (parseFloat(document.getElementById('palletW').value) || 0) > 0;
    }
    return false;
}

function isCustomRowActive(row) {
    return row.querySelector('.cm-enabled').checked
        && (parseFloat(row.querySelector('.cm-price').value) || 0) > 0;
}

function collectMaterials() {
    const materials = [];

    if (isMaterialActive('mailbox')) {
        materials.push({
            type: 'mailbox',
            length: parseFloat(document.getElementById('mailboxL').value),
            width: parseFloat(document.getElementById('mailboxW').value),
            height: parseFloat(document.getElementById('mailboxH').value),
            qty: parseInt(document.getElementById('mailboxQty').value) || 1,
            paper_price: parseFloat(document.getElementById('mailboxPaperPrice').value),
        });
    }

    if (isMaterialActive('card')) {
        materials.push({
            type: 'card',
            length: parseFloat(document.getElementById('cardL').value),
            width: parseFloat(document.getElementById('cardW').value),
            paper_price: parseFloat(document.getElementById('cardPaperPrice').value),
            qty: parseInt(document.getElementById('cardQty').value) || 1,
        });
    }

    if (isMaterialActive('corner')) {
        materials.push({
            type: 'corner',
            length: parseFloat(document.getElementById('cornerL').value),
            width: parseFloat(document.getElementById('cornerW').value),
            paper_price: parseFloat(document.getElementById('cornerPaperPrice').value),
        });
    }

    if (isMaterialActive('strapping')) {
        materials.push({
            type: 'strapping',
            meters: parseFloat(document.getElementById('strappingMeters').value),
            unit_price: parseFloat(document.getElementById('strappingPrice').value) || 0.13,
        });
    }

    if (isMaterialActive('pallet')) {
        materials.push({
            type: 'pallet',
            length: parseFloat(document.getElementById('palletL').value),
            width: parseFloat(document.getElementById('palletW').value),
            margin: parseFloat(document.getElementById('palletMargin').value) || 0,
            unit_price: parseFloat(document.getElementById('palletPrice').value) || 7.2,
        });
    }

    document.querySelectorAll('.custom-material-row').forEach(row => {
        if (!isCustomRowActive(row)) return;
        materials.push({
            type: 'custom',
            name: row.querySelector('.cm-name').value || '自定义物料',
            unit_price: parseFloat(row.querySelector('.cm-price').value),
            qty: parseInt(row.querySelector('.cm-qty').value) || 1,
        });
    });

    return materials;
}

function updateMaterialResults(calcMaterials) {
    let idx = 0;
    const types = ['mailbox', 'card', 'corner', 'strapping', 'pallet'];
    const resIds = ['resMailbox', 'resCard', 'resCorner', 'resStrapping', 'resPallet'];

    types.forEach((type, i) => {
        if (isMaterialActive(type) && idx < calcMaterials.length) {
            document.getElementById(resIds[i]).textContent = '¥' + calcMaterials[idx].price_rmb.toFixed(4);
            idx++;
        } else {
            document.getElementById(resIds[i]).textContent = '--';
        }
    });

    document.querySelectorAll('.custom-material-row').forEach(row => {
        const resEl = row.querySelector('.cm-result');
        if (isCustomRowActive(row) && idx < calcMaterials.length) {
            resEl.textContent = '¥' + calcMaterials[idx].price_rmb.toFixed(4);
            idx++;
        } else {
            resEl.textContent = '--';
        }
    });
}

function buildMaterialsForGenerate(calcResults) {
    const result = [];
    let idx = 0;

    const configs = [
        { type: 'mailbox', nameId: 'mailboxName', remarkId: 'mailboxRemark', posId: 'mailboxPosition', defaultName: 'MAILBOX' },
        { type: 'card', nameId: 'cardName', remarkId: 'cardRemark', posId: 'cardPosition', defaultName: 'Protection Card' },
        { type: 'corner', nameId: 'cornerName', remarkId: 'cornerRemark', posId: 'cornerPosition', defaultName: 'Corner Protector' },
        { type: 'strapping', nameId: 'strappingName', remarkId: 'strappingRemark', posId: 'strappingPosition', defaultName: 'Strapping' },
        { type: 'pallet', nameId: 'palletName', remarkId: 'palletRemark', posId: 'palletPosition', defaultName: 'Slip Sheet' },
    ];

    configs.forEach(cfg => {
        if (isMaterialActive(cfg.type) && idx < calcResults.length) {
            result.push({
                type: cfg.type,
                desc: document.getElementById(cfg.nameId).value || cfg.defaultName,
                price_rmb: calcResults[idx].price_rmb,
                remark: document.getElementById(cfg.remarkId).value || '',
                position: document.getElementById(cfg.posId).value || 'carton',
            });
            idx++;
        }
    });

    document.querySelectorAll('.custom-material-row').forEach(row => {
        if (isCustomRowActive(row) && idx < calcResults.length) {
            const noMarkup = row.querySelector('.cm-no-markup');
            const noRate = row.querySelector('.cm-no-rate');
            result.push({
                type: 'custom',
                desc: row.querySelector('.cm-name').value || '自定义物料',
                price_rmb: calcResults[idx].price_rmb,
                remark: row.querySelector('.cm-remark').value || '',
                position: row.querySelector('.cm-position').value || 'carton',
                no_markup: noMarkup ? noMarkup.checked : false,
                no_rate: noRate ? noRate.checked : false,
            });
            idx++;
        }
    });

    return result;
}

// ==================== 通用自定义物料 ====================

function addCustomMaterial() {
    customMaterialCount++;
    const id = customMaterialCount;
    const container = document.getElementById('customMaterialList');
    const div = document.createElement('div');
    div.className = 'custom-material-row flex items-center gap-2 mb-2 flex-wrap';
    div.innerHTML = `
        <input type="checkbox" class="cm-enabled" checked onchange="calculate()">
        <input type="text" class="cm-name border rounded px-2 py-1 text-xs w-28" placeholder="名称 如：胶袋" oninput="calculate()">
        <input type="number" class="cm-price border rounded px-2 py-1 text-xs w-20" step="0.01" placeholder="单价¥" oninput="calculate()">
        <span class="text-xs text-gray-400">x</span>
        <input type="number" class="cm-qty border rounded px-2 py-1 text-xs w-14" value="1" min="1" step="1" oninput="calculate()">
        <select class="cm-position material-position-sel border rounded px-1 py-1 text-xs"></select>
        <label class="text-xs text-gray-500 flex items-center gap-0.5"><input type="checkbox" class="cm-no-markup" onchange="calculate()">免加成</label>
        <label class="text-xs text-gray-500 flex items-center gap-0.5"><input type="checkbox" class="cm-no-rate" onchange="calculate()">免汇率</label>
        <input type="text" class="cm-remark border rounded px-2 py-1 text-xs flex-1" placeholder="备注">
        <span class="cm-result text-xs font-bold text-blue-600">--</span>
        <button onclick="this.parentElement.remove(); calculate();" class="text-red-400 hover:text-red-600 text-xs">x</button>
    `;
    container.appendChild(div);
    // 为新添加的select填充位置选项
    updateMaterialPositionSelects();
}

// ==================== 上传 + 扫描 ====================

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) { document.getElementById('fileInput').files = e.dataTransfer.files; uploadFile(document.getElementById('fileInput')); }
});

function uploadFile(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('uploadText').textContent = `上传解析中: ${file.name}...`;
    document.getElementById('uploadStatus').textContent = '大文件可能需要几秒，请稍候';
    const formData = new FormData();
    formData.append('file', file);

    fetchWithTimeout('/api/upload', { method: 'POST', body: formData }, 180000)
    .then(data => {
        if (data.success) {
            uploadedFile = data;
            document.getElementById('uploadText').textContent = `✓ ${data.filename}`;
            document.getElementById('uploadStatus').textContent = data.converted ? '已从.xls转为.xlsx' : '';
            const listEl = document.getElementById('sheetCheckboxList');
            listEl.innerHTML = '';
            data.sheets.forEach((s, i) => {
                const label = document.createElement('label');
                label.className = 'flex items-center gap-2 py-1';
                label.innerHTML = `<input type="checkbox" class="sheet-cb" value="${escapeHtml(s.name)}" ${i === 0 ? 'checked' : ''} onchange="onSheetSelectionChange()">
                    <span class="text-sm">${escapeHtml(s.name)} <span class="text-gray-400">(${s.rows}行)</span></span>`;
                listEl.appendChild(label);
            });
            document.getElementById('sheetArea').classList.remove('hidden');
            onSheetSelectionChange();
        } else {
            document.getElementById('uploadText').textContent = '上传失败';
            document.getElementById('uploadStatus').textContent = '错误: ' + data.error;
        }
    });
}

function getSelectedSheetNames() {
    return Array.from(document.querySelectorAll('.sheet-cb:checked')).map(cb => cb.value);
}

function toggleAllSheets(selectAll) {
    document.querySelectorAll('.sheet-cb').forEach(cb => cb.checked = selectAll);
    onSheetSelectionChange();
}

function onSheetSelectionChange() {
    const selected = getSelectedSheetNames();
    if (!selected.length) {
        // 隐藏所有表单区域
        ['sec2','sec3','sec4','sec5'].forEach(id => document.getElementById(id).classList.add('hidden'));
        document.getElementById('groupTabContainer').classList.add('hidden');
        document.getElementById('sheetTabContainer').classList.add('hidden');
        sheetEntries = [];
        return;
    }

    // 保存当前Sheet状态
    if (sheetEntries.length > 0) saveCurrentSheetState();

    // 同步 sheetEntries 与勾选状态
    const oldEntries = sheetEntries;
    sheetEntries = selected.map(name => {
        const existing = oldEntries.find(e => e.sheet_name === name);
        return existing || createSheetEntry(name);
    });

    // 确定当前激活Sheet
    const oldActiveName = oldEntries[activeSheetIdx] ? oldEntries[activeSheetIdx].sheet_name : '';
    activeSheetIdx = sheetEntries.findIndex(e => e.sheet_name === oldActiveName);
    if (activeSheetIdx < 0) activeSheetIdx = 0;

    // 扫描所有未扫描的Sheet
    const scanPromises = sheetEntries.map(entry => {
        if (entry.scanResult && entry.scanResult.found) return Promise.resolve();
        return fetchWithTimeout('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath: uploadedFile.filepath, sheet_name: entry.sheet_name }),
        }, 60000)
        .then(data => {
            if (data.success) entry.scanResult = data;
            else console.warn(`扫描Sheet "${entry.sheet_name}" 失败: ${data.error}`);
        });
    });

    Promise.all(scanPromises).then(() => {
        // 恢复当前Sheet状态到表单
        restoreSheetState(activeSheetIdx);
        ['sec2','sec3','sec4','sec5'].forEach(id => document.getElementById(id).classList.remove('hidden'));
        document.getElementById('groupTabContainer').classList.remove('hidden');
        renderSheetTabs();
        renderGroupTabs();
        // 渲染表头行选择
        const curEntry = sheetEntries[activeSheetIdx];
        if (curEntry && curEntry.scanResult && curEntry.scanResult.header_rows) {
            renderHeaderRows(curEntry.scanResult.header_rows);
        }
        onOutputModeChange();
        // 多Sheet时禁用new_file（行为不明确）
        const newFileOpt = document.querySelector('#outputMode option[value="new_file"]');
        if (newFileOpt) newFileOpt.disabled = sheetEntries.length > 1;
        if (sheetEntries.length > 1 && document.getElementById('outputMode').value === 'new_file') {
            document.getElementById('outputMode').value = 'new_sheet';
        }
    });
}

// 中文物料名 → 英文翻译（关键词匹配）
const MATERIAL_TRANSLATIONS = [
    ['毛绒', 'Plush'],
    ['塑胶件', 'Plastic Parts'],
    ['喷油', 'Spray Paint'],
    ['电子IC', 'Electronics IC'],
    ['PCBA', 'PCBA Board'],
    ['五金件', 'Hardware'],
    ['五金', 'Hardware'],
    ['电池', 'Battery'],
    ['辅料', 'Accessories'],
    ['尼龙扎带', 'Nylon Cable Ties'],
    ['绝缘片', 'Insulation Sheet'],
    ['说明书', 'Manual'],
    ['飞机盒', 'Mailer Box'],
    ['圆形贴纸', 'Round Sticker'],
    ['贴纸', 'Sticker'],
    ['吊牌', 'Hang Tag'],
    ['胶针', 'Tag Pin'],
    ['胶钉', 'Plastic Rivet'],
    ['胶袋', 'Plastic Bag'],
    ['彩盒', 'Color Box'],
    ['挂卡', 'Blister Card'],
    ['光膜', 'Glossy Film'],
    ['牛皮纸', 'Kraft Paper'],
    ['纸袋', 'Paper Bag'],
    ['手链', 'Bracelet'],
    ['珠子', 'Beads'],
    ['铃铛', 'Bell'],
    ['子母扣', 'Snap Button'],
    ['太空沙', 'Space Sand'],
    ['猫窝', 'Cat House'],
    ['底座', 'Base'],
    ['吊卡', 'Header Card'],
    ['收养卡', 'Adoption Card'],
    ['收藏指南', 'Collector Guide'],
    ['金属扣', 'Metal Buckle'],
    ['展示架', 'Display Stand'],
    ['头卡', 'Header Card'],
    ['保护卡', 'Protection Card'],
    ['护角', 'Corner Protector'],
    ['邮包盒', 'Mailer Box'],
    ['打包带', 'Strapping'],
    ['纸滑板', 'Slip Sheet'],
    ['围板', 'Pallet Collar'],
    ['罐头', 'Can'],
    ['肚皮', 'Belly'],
    ['配件绳', 'Accessory Cord'],
    ['串绳', 'String Cord'],
    ['装配', 'Assembly'],
    ['包裝人工', 'Packing Labor'],
    ['纸箱', 'Carton'],
    ['胶纸', 'Tape'],
];

function translateMaterialName(text) {
    if (!text || /^[A-Za-z0-9\s%_.:()#\-/*+]+$/.test(text)) return text; // 纯英文不翻译
    const matches = [];
    for (const [cn, en] of MATERIAL_TRANSLATIONS) {
        if (text.includes(cn)) matches.push(en);
    }
    if (matches.length === 0) return text;
    // 去重保持顺序
    const unique = [...new Set(matches)];
    return text + ' (' + unique.slice(0, 3).join('+') + ')';
}

function updateMaterialPositionSelects() {
    // 从header_rows生成全部行选项，value="after_row_N"，支持任意行插入
    const headerRows = (scanResult && scanResult.header_rows) || [];
    const rd = scanResult ? (scanResult.row_details || {}) : {};
    const ccRow = rd.carton_cost ? rd.carton_cost.row : 0;
    const options = [];
    headerRows.forEach(hr => {
        const rawText = (hr.a || hr.b || '(空)').substring(0, 25);
        const text = translateMaterialName(rawText);
        options.push({ value: `after_row_${hr.row}`, label: `Row ${hr.row}: ${text} 下方` });
    });
    // fallback: 没有header_rows时用旧5锚点
    if (options.length === 0) {
        const mappings = [
            { key: 'product_price', value: 'after_row_0', suffix: '上方' },
            { key: 'carton_cost', value: 'after_row_0', suffix: '下方' },
        ];
        mappings.forEach(m => {
            const info = rd[m.key];
            if (info) {
                options.push({ value: `after_row_${info.row}`, label: `Row ${info.row}: ${(info.text||'').substring(0,30)} ${m.suffix}` });
            }
        });
        if (options.length === 0) {
            options.push({ value: 'after_row_0', label: '默认位置' });
        }
    }
    // 默认值: carton_cost行
    const defaultVal = ccRow ? `after_row_${ccRow}` : (options.length > 0 ? options[0].value : '');
    // 填充所有 .material-position-sel
    document.querySelectorAll('.material-position-sel').forEach(sel => {
        const oldVal = sel.value;
        sel.innerHTML = '';
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            sel.appendChild(o);
        });
        // 恢复之前选中的值（如果仍存在）
        if (oldVal && options.some(o => o.value === oldVal)) {
            sel.value = oldVal;
        } else {
            sel.value = defaultVal;
        }
    });
}

function renderMidRowCheckboxes(midRows) {
    const container = document.getElementById('midRowSkips');
    const divider = document.getElementById('midRowDivider');
    container.innerHTML = '';
    if (!midRows || midRows.length === 0) {
        container.classList.add('hidden');
        divider.classList.add('hidden');
        return;
    }
    midRows.forEach(mr => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-1';
        label.innerHTML = `<input type="checkbox" id="skipMidRow_${mr.row}" class="skip-mid-row-cb" data-row="${mr.row}"> <span>跳过 ${mr.text}</span>`;
        container.appendChild(label);
    });
    container.classList.remove('hidden');
    divider.classList.remove('hidden');
}

function applyAutoValues(av) {
    // 显示主表信息条
    const bar = document.getElementById('autoValuesBar');
    const info = document.getElementById('avInfo');
    const parts = [];
    if (av.exchange_rate) parts.push(`汇率 ${av.exchange_rate}`);
    if (av.original_exchange_rate) parts.push(`旧汇率 ${av.original_exchange_rate}`);
    if (av.waste_pct) parts.push(`Waste ${(av.waste_pct * 100).toFixed(0)}%`);
    if (av.markup_pct) parts.push(`Markup ${(av.markup_pct * 100).toFixed(0)}%`);
    if (av.main_pcs) parts.push(`主表 ${av.main_pcs}pcs/ctn`);
    if (parts.length) {
        info.textContent = parts.join(' | ');
        bar.classList.remove('hidden');
    }
    // 自动解析纸箱尺寸：从 carton_desc 提取 长*宽*高 和纸种
    if (av.carton_desc) {
        const desc = av.carton_desc;
        const dimMatch = desc.match(/(\d+\.?\d*)\s*[*xX×]\s*(\d+\.?\d*)\s*[*xX×]\s*(\d+\.?\d*)/);
        if (dimMatch) {
            if (!document.getElementById('boxLength').value) document.getElementById('boxLength').value = dimMatch[1];
            if (!document.getElementById('boxWidth').value) document.getElementById('boxWidth').value = dimMatch[2];
            if (!document.getElementById('boxHeight').value) document.getElementById('boxHeight').value = dimMatch[3];
            // 提取纸种提示：去掉尺寸部分、单位、标点，剩余文本如"双坑"
            const remainder = desc.replace(dimMatch[0], '').replace(/[纸箱尺寸：:，,\s]/g, '').replace(/CM/gi, '').trim();
            if (remainder && !document.getElementById('cartonDesc').value) {
                document.getElementById('cartonDesc').value = remainder;
            }
        } else if (!document.getElementById('cartonDesc').value) {
            document.getElementById('cartonDesc').value = desc;
        }
    }
    // 自动预填货号名称（基于主表产品号）
    if (av.product_item && !document.getElementById('itemName').value) {
        document.getElementById('itemName').value = av.product_item;
    }
}

function toggleScan() {
    document.getElementById('scanResult').classList.toggle('hidden');
}

function displayScanResult(data) {
    const container = document.getElementById('scanRows');
    container.innerHTML = '';
    const labels = {
        product_price: 'Product Price', carton_cost: 'Carton Cost', tape_cost: 'Tape Cost',
        packing_labor: 'Packing Labor', ex_factory: 'Ex-Factory', fob_40f: '40F FOB',
        shipping_40f: 'Shipping 40F', fob_20f: '20F FOB', shipping_20f: 'Shipping 20F',
        shipping_lcl: 'LCL', exchange_rate: 'Exchange Rate', waste_pct: 'Waste %', markup_pct: 'Markup %',
    };
    for (const [key, label] of Object.entries(labels)) {
        const info = data.row_details[key];
        if (!info) continue;
        const div = document.createElement('div');
        div.className = 'scan-row';
        div.innerHTML = `<label>${label}</label><span class="row-num">Row ${info.row}</span><span class="text-gray-400 text-xs truncate" style="max-width:250px">${info.text}</span>`;
        container.appendChild(div);
    }
}

// ==================== 预览 & 生成 ====================

function generateSubtable() {
    // 保存当前Sheet+组状态
    saveCurrentSheetState();

    const outputMode = document.getElementById('outputMode').value;

    // extract_columns模式：直接发送，不需要纸箱参数校验
    if (outputMode === 'extract_columns') {
        const config = collectExtractConfig();
        if (!config.length) {
            alert('请至少选择一个产品列'); return;
        }
        // 检查是否有未选中的列（全选=没意义）
        const allSelected = config.every(c => c.keep_cols.length === c.all_product_cols.length);
        if (allSelected) {
            alert('已全选所有列，无需提取。请取消勾选不需要的产品列。'); return;
        }
        // 直接进入生成（跳过预览）
        const btn = document.getElementById('generateBtn');
        btn.textContent = '生成中...'; btn.disabled = true;
        fetchWithTimeout('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filepath: uploadedFile.filepath,
                output_mode: 'extract_columns',
                extract_config: config,
                extract_item_name: (document.getElementById('extractItemName') || {}).value || '',
                extract_formula_overrides: collectFormulaOverrides(),
            }),
        }, 180000)
        .then(data => {
            btn.textContent = '生成次表'; btn.disabled = false;
            if (data.success) {
                document.getElementById('downloadLink').href = data.download_url;
                document.getElementById('successArea').classList.remove('hidden');
            } else {
                alert('提取失败: ' + data.error);
            }
        });
        return;
    }

    // 校验所有Sheet的所有组
    const errors = [];
    sheetEntries.forEach(entry => {
        entry.groups.forEach((g, i) => {
            const prefix = sheetEntries.length > 1 ? `[${entry.sheet_name}] 组${i+1}` : `组${i+1}`;
            if (!g.item_name) errors.push(`${prefix}: 请填写货号名称`);
            if (!parseInt(g.pcs_per_carton)) errors.push(`${prefix}: 请填写PCS数`);
            if (!g.calcResult || !g.calcResult.box_price_rmb) errors.push(`${prefix}: 请先计算纸箱价格`);
        });
    });
    if (errors.length) { alert(errors.join('\n')); return; }

    showPreview();
}

function buildGroupRow(g, idx) {
    const materialNames = (g.lastMaterials || []).map(m => m.desc).join(', ') || '--';
    return `
        <td class="border px-2 py-1">${idx}</td>
        <td class="border px-2 py-1">${escapeHtml(g.item_name)}</td>
        <td class="border px-2 py-1 text-right">${g.pcs_per_carton}</td>
        <td class="border px-2 py-1 text-right">${g.calcResult.box_price_rmb ? g.calcResult.box_price_rmb.toFixed(4) : '--'}</td>
        <td class="border px-2 py-1 text-right">${g.calcResult.tape_price_rmb ? g.calcResult.tape_price_rmb.toFixed(4) : '--'}</td>
        <td class="border px-2 py-1 text-right">${parseFloat(g.laborCost) ? parseFloat(g.laborCost).toFixed(3) : '--'}</td>
        <td class="border px-2 py-1 text-xs">${escapeHtml(materialNames)}</td>
        <td class="border px-2 py-1 text-right">${g.calcResult.cbm ? g.calcResult.cbm.toFixed(4) : '--'}</td>
    `;
}

function showPreview() {
    const tbody = document.getElementById('previewTableBody');
    tbody.innerHTML = '';
    let totalGroups = 0;

    sheetEntries.forEach(entry => {
        // 多Sheet时显示Sheet名称分隔行
        if (sheetEntries.length > 1) {
            const headerTr = document.createElement('tr');
            headerTr.innerHTML = `<td colspan="8" class="border px-2 py-1 bg-green-50 font-bold text-green-700 text-xs">Sheet: ${escapeHtml(entry.sheet_name)}</td>`;
            tbody.appendChild(headerTr);
        }
        entry.groups.forEach((g, i) => {
            totalGroups++;
            const tr = document.createElement('tr');
            tr.innerHTML = buildGroupRow(g, i + 1);
            tbody.appendChild(tr);
        });
    });

    const modeLabels = { new_sheet: '新增Sheet', new_file: '生成独立新文件', clone_sheet: '克隆表（替换参数）', extract_columns: '提取选中列' };
    document.getElementById('previewOutputMode').textContent =
        `输出方式：${modeLabels[document.getElementById('outputMode').value]}，${sheetEntries.length} 个Sheet，共 ${totalGroups} 个次表`;
    document.getElementById('previewArea').classList.remove('hidden');
}

function hidePreview() {
    document.getElementById('previewArea').classList.add('hidden');
}

function _syncMaterialPositions(group) {
    // 将保存的表单position同步回lastMaterials（因为改position不触发calculate）
    if (!group.lastMaterials || !group.lastMaterials.length) return;
    let idx = 0;
    const posConfigs = [
        { enabledId: 'mailboxEnabled', posKey: 'mailboxPosition' },
        { enabledId: 'cardEnabled', posKey: 'cardPosition' },
        { enabledId: 'cornerEnabled', posKey: 'cornerPosition' },
        { enabledId: 'strappingEnabled', posKey: 'strappingPosition' },
        { enabledId: 'palletEnabled', posKey: 'palletPosition' },
    ];
    posConfigs.forEach(cfg => {
        if (group[cfg.enabledId] && idx < group.lastMaterials.length) {
            group.lastMaterials[idx].position = group[cfg.posKey] || 'after_row_0';
            idx++;
        }
    });
    (group.customMaterials || []).forEach(cm => {
        if (cm.enabled && idx < group.lastMaterials.length) {
            group.lastMaterials[idx].position = cm.position || 'after_row_0';
            idx++;
        }
    });
}

function confirmGenerate() {
    const btn = document.getElementById('confirmBtn');
    btn.textContent = '生成中...'; btn.disabled = true;

    const outputMode = document.getElementById('outputMode').value;

    // 生成前同步所有组的物料position（用户可能在calculate之后改了位置下拉）
    sheetEntries.forEach(entry => {
        entry.groups.forEach(g => _syncMaterialPositions(g));
    });

    // 构建多Sheet请求
    const sheetsPayload = sheetEntries.map(entry => ({
        sheet_name: entry.sheet_name,
        params: entry.groups.map(g => ({
            item_name: g.item_name,
            pcs_per_carton: parseInt(g.pcs_per_carton) || 0,
            carton_desc: g.cartonDesc,
            carton_cost_rmb: g.calcResult.box_price_rmb || 0,
            tape_cost_rmb: g.calcResult.tape_price_rmb || 0,
            packing_labor_rmb: parseFloat(g.laborCost) || 0,
            cbm: g.calcResult.cbm || 0,
            length_cm: parseFloat(g.boxLength) || 0,
            width_cm: parseFloat(g.boxWidth) || 0,
            height_cm: parseFloat(g.boxHeight) || 0,
            materials: g.lastMaterials || [],
            skip_rows: {
                tape: !!g.skipTape,
                labor: !!g.skipLabor,
                fob_40f: !!g.skipFob40f,
                shipping_40f: !!g.skipShipping40f,
                fob_20f: !!g.skipFob20f,
                shipping_20f: !!g.skipShipping20f,
                shipping_lcl: !!g.skipLcl,
                mid_row_indices: Object.entries(g.skipMidRows || {}).filter(([_, v]) => v).map(([k]) => parseInt(k)),
            },
        })),
    }));

    // new_sheet模式下传递用户选择的表头行
    const includeHeaderRows = outputMode === 'new_sheet' ? getSelectedHeaderRows() : [];

    fetchWithTimeout('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filepath: uploadedFile.filepath,
            output_mode: outputMode,
            sheets: sheetsPayload,
            include_header_rows: includeHeaderRows,
            formula_overrides: outputMode === 'clone_sheet' ? collectFormulaOverrides() : {},
            clone_rows: outputMode === 'clone_sheet' ? collectCloneRows() : [],
            name_overrides: outputMode === 'clone_sheet' ? collectNameOverrides() : {},
        }),
    }, 180000)
    .then(data => {
        btn.textContent = '确认生成'; btn.disabled = false;
        if (data.success) {
            document.getElementById('previewArea').classList.add('hidden');
            document.getElementById('downloadLink').href = data.download_url;
            document.getElementById('successArea').classList.remove('hidden');
            saveToHistory();
        } else {
            alert('生成失败: ' + data.error);
        }
    });
}

// ==================== 历史记录 ====================

const HISTORY_KEY = 'subtable_history';
const HISTORY_MAX = 20;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function snapshotGroups(groupList) {
    return groupList.map(g => {
        const snapshot = {};
        FORM_FIELDS.forEach(mapping => {
            const key = mapping.split(':')[1];
            snapshot[key] = g[key] || '';
        });
        MATERIAL_FIELDS.forEach(mat => {
            snapshot[mat.enabledId] = !!g[mat.enabledId];
            mat.fields.forEach(f => {
                const id = mat.prefix + f;
                snapshot[id] = g[id] || '';
            });
        });
        snapshot.customMaterials = g.customMaterials || [];
        snapshot.boxTypes = g.boxTypes || ['normal'];
        return snapshot;
    });
}

function saveToHistory() {
    // 保存当前状态先
    saveCurrentSheetState();

    const record = {
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
        filename: uploadedFile.filename || '未知文件',
        // 保存所有Sheet的参数
        sheetGroups: sheetEntries.map(entry => ({
            sheet_name: entry.sheet_name,
            groups: snapshotGroups(entry.groups),
        })),
        // 向下兼容：也保存扁平groups（第一个Sheet的）
        groups: snapshotGroups(sheetEntries[0] ? sheetEntries[0].groups : groups),
    };

    let history = loadHistoryData();
    history.unshift(record);
    if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
}

function loadHistoryData() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch { return []; }
}

function renderHistory() {
    const container = document.getElementById('historyList');
    const toggle = document.getElementById('historyToggle');
    if (!container || !toggle) return;

    const history = loadHistoryData();
    toggle.textContent = `历史记录 (${history.length}条)`;

    if (!history.length) {
        container.innerHTML = '<p class="text-xs text-gray-400 py-2">暂无记录</p>';
        return;
    }

    container.innerHTML = history.map((rec, idx) => {
        const itemNames = rec.groups.map(g => g.item_name || '?').join(', ');
        return `
            <div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div class="flex-1 min-w-0">
                    <div class="text-xs text-gray-500">${escapeHtml(rec.timestamp)}  ${escapeHtml(rec.filename)}</div>
                    <div class="text-sm truncate">${escapeHtml(itemNames)}</div>
                </div>
                <div class="flex gap-2 ml-2 shrink-0">
                    <button onclick="loadFromHistory(${idx})" class="text-xs text-blue-500 hover:underline">加载</button>
                    <button onclick="deleteHistory(${idx})" class="text-xs text-red-400 hover:text-red-600">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

function loadFromHistory(idx) {
    const history = loadHistoryData();
    const rec = history[idx];
    if (!rec) return;

    // 重建 groups
    groups = [];
    groupIdCounter = 0;
    rec.groups.forEach(snapshot => {
        groupIdCounter++;
        const g = createEmptyGroup(groupIdCounter);
        // 还原表单字段
        FORM_FIELDS.forEach(mapping => {
            const key = mapping.split(':')[1];
            g[key] = snapshot[key] || '';
        });
        // 还原物料字段
        MATERIAL_FIELDS.forEach(mat => {
            g[mat.enabledId] = !!snapshot[mat.enabledId];
            mat.fields.forEach(f => {
                const id = mat.prefix + f;
                g[id] = snapshot[id] || '';
            });
        });
        g.customMaterials = snapshot.customMaterials || [];
        g.boxTypes = snapshot.boxTypes || ['normal'];
        g.calcResult = {}; // 需重新计算
        g.lastMaterials = [];
        groups.push(g);
    });

    if (!groups.length) {
        groupIdCounter = 1;
        groups.push(createEmptyGroup(1));
    }

    activeGroupId = groups[0].id;
    restoreFormFromGroup(groups[0]);

    // 同步到当前sheetEntry（如果有）
    if (sheetEntries[activeSheetIdx]) {
        sheetEntries[activeSheetIdx].groups = groups;
        sheetEntries[activeSheetIdx].activeGroupId = activeGroupId;
        sheetEntries[activeSheetIdx].groupIdCounter = groupIdCounter;
    }

    renderGroupTabs();

    // 自动触发计算
    calculate();

    alert(`已加载历史记录，共 ${groups.length} 组参数。\n请先上传对应主表文件，然后检查参数是否正确。`);
}

function deleteHistory(idx) {
    if (!confirm('确认删除这条历史记录？')) return;
    const history = loadHistoryData();
    history.splice(idx, 1);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
}

function toggleHistory() {
    document.getElementById('historyPanel').classList.toggle('hidden');
}

// 页面加载时渲染历史
renderHistory();

// ==================== 纸价快选 ====================

const PAPER_PRESETS_KEY = 'subtable_paper_presets';

function loadCustomPaperPresets() {
    try { return JSON.parse(localStorage.getItem(PAPER_PRESETS_KEY)) || []; }
    catch { return []; }
}

function saveCustomPaperPresets(presets) {
    localStorage.setItem(PAPER_PRESETS_KEY, JSON.stringify(presets));
}

// 过滤掉不常用的纸种 + 追加常用纸种
const PAPER_PRICE_EXCLUDE = ['K4A', 'A3A'];
const PAPER_PRICE_EXTRA = [
    { name: 'K=B优惠价', price: 2.2 },
    { name: 'B3B', price: 1.55 },
];

function loadPaperPrices() {
    fetchWithTimeout('/api/paper_prices', {}, 15000)
    .then(data => {
        // 收集所有需要填充的纸价下拉：主纸箱 + 附加物料
        const allSels = [document.getElementById('paperPriceSelect'),
                         ...document.querySelectorAll('.paper-price-sel')];
        allSels.forEach(sel => {
            if (!sel) return;
            while (sel.options.length > 1) sel.remove(1);
            if (data.success) {
                data.prices.forEach(p => {
                    if (PAPER_PRICE_EXCLUDE.includes(p.name)) return;
                    const price = p.no_tax_price || p.tax_price;
                    if (!price) return;
                    const opt = document.createElement('option');
                    opt.value = price;
                    opt.textContent = `${p.name} ¥${price}`;
                    sel.appendChild(opt);
                });
            }
            PAPER_PRICE_EXTRA.forEach(ep => {
                const opt = document.createElement('option');
                opt.value = ep.price;
                opt.textContent = `${ep.name} ¥${ep.price}`;
                sel.appendChild(opt);
            });
        });
        renderPaperPresetTags();
    })
    .catch(() => {});
}

// 通用纸价下拉选择：选中后填入对应的input并触发计算
function applyPaperSel(sel, inputId) {
    if (sel.value) {
        document.getElementById(inputId).value = sel.value;
        calculate();
    }
    sel.value = '';
}

function saveCustomPaperPreset() {
    const val = document.getElementById('paperPrice').value;
    const name = document.getElementById('paperName').value;
    if (!val || parseFloat(val) <= 0) { alert('请先填入纸价'); return; }
    const presets = loadCustomPaperPresets();
    const label = name ? `${name} ¥${val}` : `¥${val}`;
    if (presets.some(p => p.value === val)) { return; } // 已存在静默跳过
    presets.push({ value: val, label: label });
    saveCustomPaperPresets(presets);
    renderPaperPresetTags();
}

function applyPaperPreset(idx) {
    const presets = loadCustomPaperPresets();
    if (presets[idx]) {
        document.getElementById('paperPrice').value = presets[idx].value;
        // 尝试从label提取纸种名
        const parts = presets[idx].label.split(' ¥');
        if (parts[0] && parts[0] !== `¥${presets[idx].value}`) {
            document.getElementById('paperName').value = parts[0];
        }
        calculate();
    }
}

function deletePaperPreset(idx) {
    const presets = loadCustomPaperPresets();
    presets.splice(idx, 1);
    saveCustomPaperPresets(presets);
    renderPaperPresetTags();
}

function renderPaperPresetTags() {
    const container = document.getElementById('paperPresetTags');
    if (!container) return;
    const presets = loadCustomPaperPresets();
    container.innerHTML = '';
    presets.forEach((p, i) => {
        const tag = document.createElement('span');
        tag.className = 'inline-flex items-center gap-0.5 px-2 py-0.5 bg-green-50 text-green-600 rounded-full text-xs cursor-pointer hover:bg-green-100 transition';
        tag.innerHTML = `<span onclick="applyPaperPreset(${i})">${escapeHtml(p.label)}</span><span onclick="deletePaperPreset(${i})" class="text-green-300 hover:text-red-500 ml-0.5 font-bold">&times;</span>`;
        container.appendChild(tag);
    });
}

function selectPaperPrice() {
    const sel = document.getElementById('paperPriceSelect');
    if (sel.value) {
        document.getElementById('paperPrice').value = sel.value;
        // 尝试把纸种名填入
        const opt = sel.options[sel.selectedIndex];
        const name = opt.textContent.split(' ')[0];
        if (name && !document.getElementById('paperName').value) {
            document.getElementById('paperName').value = name;
        }
        calculate();
    }
    sel.value = ''; // 重置下拉
}

// 页面加载时请求纸价 + 每5分钟自动刷新
loadPaperPrices();
setInterval(loadPaperPrices, 5 * 60 * 1000);

// ==================== 装箱人工快选（下拉模式） ====================

const LABOR_PRESETS_KEY = 'subtable_labor_presets';

function loadLaborPresets() {
    try { return JSON.parse(localStorage.getItem(LABOR_PRESETS_KEY)) || []; }
    catch { return []; }
}

function _saveLaborPresets(presets) {
    localStorage.setItem(LABOR_PRESETS_KEY, JSON.stringify(presets));
}

function renderLaborPresets() {
    const sel = document.getElementById('laborPresetSelect');
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    const presets = loadLaborPresets();
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = `¥${p.value}`;
        sel.appendChild(opt);
    });
    sel.value = '';
}

function saveLaborPreset() {
    const val = document.getElementById('laborCost').value;
    if (!val || parseFloat(val) <= 0) { alert('请先填入人工价'); return; }
    const presets = loadLaborPresets();
    if (presets.some(p => p.value === val)) { return; }
    presets.push({ value: val });
    _saveLaborPresets(presets);
    renderLaborPresets();
}

function selectLaborPreset() {
    const sel = document.getElementById('laborPresetSelect');
    if (sel.value) {
        document.getElementById('laborCost').value = sel.value;
        calculate();
    }
}

function deleteSelectedLaborPreset() {
    const sel = document.getElementById('laborPresetSelect');
    if (!sel.value) { alert('请先从快选下拉中选择要删除的项'); return; }
    const presets = loadLaborPresets();
    const idx = presets.findIndex(p => p.value === sel.value);
    if (idx >= 0) {
        presets.splice(idx, 1);
        _saveLaborPresets(presets);
        renderLaborPresets();
    }
}

renderLaborPresets();

// ==================== 新Sheet表头行选择 ====================

let availableHeaderRows = [];  // 从scan返回的主表表头行

function renderHeaderRows(rows) {
    availableHeaderRows = rows || [];
    const container = document.getElementById('headerRowList');
    if (!container) return;
    container.innerHTML = '';
    if (!rows || !rows.length) return;

    // carton_cost行号：该行及之后的行默认不勾选（会由次表生成）
    const rd = scanResult ? (scanResult.row_details || {}) : {};
    const ccRow = rd.carton_cost ? rd.carton_cost.row : Infinity;

    rows.forEach(hr => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-xs py-0.5';
        const display = hr.a ? `${hr.a}${hr.b ? '  →  ' + hr.b : ''}` : hr.b || `(Row ${hr.row})`;
        const checked = hr.row < ccRow ? 'checked' : '';
        label.innerHTML = `<input type="checkbox" class="header-row-cb" value="${hr.row}" ${checked}>
            <span class="text-gray-400">Row ${hr.row}</span>
            <span class="truncate">${escapeHtml(display)}</span>`;
        container.appendChild(label);
    });
}

function getSelectedHeaderRows() {
    return Array.from(document.querySelectorAll('.header-row-cb:checked')).map(cb => parseInt(cb.value));
}

function toggleHeaderRows(selectAll) {
    document.querySelectorAll('.header-row-cb').forEach(cb => cb.checked = selectAll);
}

function onOutputModeChange() {
    const mode = document.getElementById('outputMode').value;
    const panel = document.getElementById('headerRowPanel');
    if (panel) {
        if (mode === 'new_sheet' && availableHeaderRows.length > 0) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    }
    // 克隆表行选择面板
    const crPanel = document.getElementById('cloneRowPanel');
    if (crPanel) {
        if (mode === 'clone_sheet') {
            renderCloneRows();
            crPanel.classList.remove('hidden');
        } else {
            crPanel.classList.add('hidden');
        }
    }
    // 公式编辑器（clone_sheet 和 extract_columns 共用）
    const fePanel = document.getElementById('formulaEditorPanel');
    if (fePanel) {
        if (mode === 'clone_sheet' || mode === 'extract_columns') {
            renderFormulaEditor();
            fePanel.classList.remove('hidden');
        } else {
            fePanel.classList.add('hidden');
        }
    }
    // 产品列选择面板
    const pcPanel = document.getElementById('productColPanel');
    if (pcPanel) {
        if (mode === 'extract_columns') {
            renderProductColumns();
            pcPanel.classList.remove('hidden');
        } else {
            pcPanel.classList.add('hidden');
        }
    }

    // extract_columns模式下隐藏不需要的参数区（2~4区），保留sec5（输出方式+生成按钮）
    const paramSections = ['sec2', 'sec3', 'sec4'];
    const groupTabC = document.getElementById('groupTabContainer');
    if (mode === 'extract_columns') {
        paramSections.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        if (groupTabC) groupTabC.classList.add('hidden');
    } else if (uploadedFile.filepath) {
        paramSections.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        if (groupTabC) groupTabC.classList.remove('hidden');
    }

    // 多Sheet时禁用clone_sheet（一次只克隆一个主表）
    const cloneOpt = document.querySelector('#outputMode option[value="clone_sheet"]');
    if (cloneOpt && typeof sheetEntries !== 'undefined') {
        cloneOpt.disabled = sheetEntries.length > 1;
        if (sheetEntries.length > 1 && mode === 'clone_sheet') {
            document.getElementById('outputMode').value = 'new_file';
        }
    }

    // extract_columns仅在有多列sheet时可用
    const extractOpt = document.querySelector('#outputMode option[value="extract_columns"]');
    if (extractOpt) {
        const hasMultiCol = sheetEntries.some(e => e.scanResult && e.scanResult.product_columns && e.scanResult.product_columns.length >= 2);
        extractOpt.disabled = !hasMultiCol;
        if (!hasMultiCol && mode === 'extract_columns') {
            document.getElementById('outputMode').value = 'new_file';
        }
    }
}

// ==================== 产品列选择（extract_columns模式） ====================

function renderProductColumns() {
    const container = document.getElementById('productColList');
    if (!container) return;
    container.innerHTML = '';

    sheetEntries.forEach((entry, si) => {
        const pc = (entry.scanResult && entry.scanResult.product_columns) || [];
        if (pc.length < 2) return;

        // 多Sheet时显示Sheet名
        if (sheetEntries.length > 1) {
            const header = document.createElement('div');
            header.className = 'text-xs font-bold text-teal-800 mt-1 mb-0.5';
            header.textContent = entry.sheet_name;
            container.appendChild(header);
        }

        pc.forEach(p => {
            const div = document.createElement('div');
            div.className = 'flex items-center gap-2';
            div.innerHTML = `
                <label class="flex items-center gap-1 text-sm cursor-pointer">
                    <input type="checkbox" checked
                        data-sheet-idx="${si}" data-col="${p.col}"
                        class="product-col-cb accent-teal-600">
                    <span class="text-teal-700">${escapeHtml(p.name)}</span>
                    <span class="text-gray-400 text-xs">(列${p.col})</span>
                </label>
            `;
            container.appendChild(div);
        });
    });
}

function productColSelectAll(checked) {
    document.querySelectorAll('.product-col-cb').forEach(cb => cb.checked = checked);
}

function collectExtractConfig() {
    // 收集每个Sheet的保留列和全部产品列
    const configMap = {};  // sheetIdx -> {keep: Set, all: []}
    sheetEntries.forEach((entry, si) => {
        const pc = (entry.scanResult && entry.scanResult.product_columns) || [];
        if (pc.length < 2) return;
        configMap[si] = {
            sheet_name: entry.sheet_name,
            keep_cols: [],
            all_product_cols: pc.map(p => p.col),
        };
    });

    document.querySelectorAll('.product-col-cb').forEach(cb => {
        const si = parseInt(cb.dataset.sheetIdx);
        const col = parseInt(cb.dataset.col);
        if (cb.checked && configMap[si]) {
            configMap[si].keep_cols.push(col);
        }
    });

    return Object.values(configMap).filter(c => c.keep_cols.length > 0);
}

// ==================== 克隆表公式编辑器 ====================

function renderFormulaEditor() {
    const entry = sheetEntries[activeSheetIdx];
    if (!entry || !entry.scanResult || !entry.scanResult.formulas) return;
    const formulas = entry.scanResult.formulas;
    const container = document.getElementById('formulaEditorList');
    if (!formulas.length) {
        container.innerHTML = '<div class="text-xs text-gray-400">该表没有可编辑的公式数字</div>';
        return;
    }
    container.innerHTML = formulas.map(f => {
        const formula = f.formula;
        const nums = f.numbers;
        // 把公式拆成：文本段 + 数字input 交替排列
        let parts = [];
        let lastEnd = 0;
        nums.forEach((n, idx) => {
            if (n.start > lastEnd) {
                parts.push('<span class="text-gray-500">' + escapeHtml(formula.substring(lastEnd, n.start)) + '</span>');
            }
            const w = Math.max(n.value.length * 9 + 20, 45);
            parts.push(
                '<input type="text" class="fe-num border border-purple-300 rounded px-1 py-0.5 text-center text-xs font-mono focus:ring-1 focus:ring-purple-400" ' +
                'style="width:' + w + 'px" ' +
                'data-row="' + f.row + '" data-idx="' + idx + '" data-orig="' + escapeHtml(n.value) + '" ' +
                'value="' + escapeHtml(n.value) + '" ' +
                'oninput="updateFormulaPreview(' + f.row + ')">'
            );
            lastEnd = n.end;
        });
        if (lastEnd < formula.length) {
            parts.push('<span class="text-gray-500">' + escapeHtml(formula.substring(lastEnd)) + '</span>');
        }
        return '<div class="bg-white rounded p-2 border border-purple-100" data-fe-row="' + f.row + '">' +
            '<div class="flex items-center gap-2 mb-1">' +
                '<span class="text-xs font-bold text-purple-600">Row ' + f.row + '</span>' +
                '<span class="text-xs text-gray-400 truncate" style="max-width:350px">' + escapeHtml(f.label) + '</span>' +
            '</div>' +
            '<div class="text-xs mb-1">' +
                '<span class="text-gray-400">原始：</span>' +
                '<code class="bg-gray-100 px-1 rounded font-mono text-gray-600">' + escapeHtml(formula) + '</code>' +
            '</div>' +
            '<div class="flex flex-wrap items-center gap-0.5 text-xs font-mono mb-1">' +
                parts.join('') +
            '</div>' +
            '<div class="text-xs">' +
                '<span class="text-gray-400">预览：</span>' +
                '<code id="fePreview_' + f.row + '" class="px-1 rounded font-mono bg-gray-50">' + escapeHtml(formula) + '</code>' +
                '<span id="feStatus_' + f.row + '" class="ml-1 text-green-500">✓ 未修改</span>' +
            '</div>' +
        '</div>';
    }).join('');
}

function updateFormulaPreview(row) {
    const entry = sheetEntries[activeSheetIdx];
    if (!entry || !entry.scanResult) return;
    const fData = entry.scanResult.formulas.find(f => f.row === row);
    if (!fData) return;
    const inputs = document.querySelectorAll('input.fe-num[data-row="' + row + '"]');
    const formula = fData.formula;
    const nums = fData.numbers;
    // 从后往前替换（避免位置偏移）
    let newFormula = formula;
    let changed = false;
    for (let i = nums.length - 1; i >= 0; i--) {
        const newVal = inputs[i] ? inputs[i].value.trim() : '';
        const origVal = nums[i].value;
        if (newVal && newVal !== origVal) {
            newFormula = newFormula.substring(0, nums[i].start) + newVal + newFormula.substring(nums[i].end);
            changed = true;
            inputs[i].style.backgroundColor = '#FEF3C7';
        } else {
            if (inputs[i]) inputs[i].style.backgroundColor = '';
        }
    }
    const preview = document.getElementById('fePreview_' + row);
    const status = document.getElementById('feStatus_' + row);
    if (preview) {
        preview.textContent = newFormula;
        preview.className = changed ? 'px-1 rounded font-mono bg-yellow-100' : 'px-1 rounded font-mono bg-gray-50';
    }
    if (status) {
        status.textContent = changed ? '← 已修改' : '✓ 未修改';
        status.className = changed ? 'ml-1 text-orange-500 font-bold' : 'ml-1 text-green-500';
    }
}

function collectFormulaOverrides() {
    const entry = sheetEntries[activeSheetIdx];
    if (!entry || !entry.scanResult || !entry.scanResult.formulas) return {};
    const overrides = {};
    entry.scanResult.formulas.forEach(fData => {
        const inputs = document.querySelectorAll('input.fe-num[data-row="' + fData.row + '"]');
        if (!inputs.length) return;
        let newFormula = fData.formula;
        let changed = false;
        const nums = fData.numbers;
        for (let i = nums.length - 1; i >= 0; i--) {
            const newVal = inputs[i] ? inputs[i].value.trim() : '';
            if (newVal && newVal !== nums[i].value) {
                newFormula = newFormula.substring(0, nums[i].start) + newVal + newFormula.substring(nums[i].end);
                changed = true;
            }
        }
        if (changed) overrides[fData.row] = newFormula;
    });
    return overrides;
}

function resetFormulaEditor() {
    document.querySelectorAll('input.fe-num').forEach(input => {
        input.value = input.dataset.orig;
        input.style.backgroundColor = '';
    });
    const entry = sheetEntries[activeSheetIdx];
    if (entry && entry.scanResult && entry.scanResult.formulas) {
        entry.scanResult.formulas.forEach(f => updateFormulaPreview(f.row));
    }
}

// ==================== 克隆表行选择+名称编辑 ====================

function renderCloneRows() {
    const entry = sheetEntries[activeSheetIdx];
    if (!entry || !entry.scanResult) return;
    const rows = entry.scanResult.header_rows || [];
    const rd = entry.scanResult.row_details || {};
    const ccRow = rd.carton_cost ? rd.carton_cost.row : Infinity;
    const container = document.getElementById('cloneRowList');
    if (!rows.length) {
        container.innerHTML = '<div class="text-xs text-gray-400">无可选行</div>';
        return;
    }
    container.innerHTML = rows.map(hr => {
        const checked = hr.row < ccRow ? 'checked' : '';
        const origName = hr.a || '';
        const display = origName || hr.b || '(空行)';
        return `<label class="flex items-center gap-1 text-xs hover:bg-blue-100 rounded px-1 py-0.5">
            <input type="checkbox" class="clone-row-cb" value="${hr.row}" ${checked}>
            <span class="text-gray-400 w-10 flex-shrink-0">R${hr.row}</span>
            <input type="text" class="clone-row-name border rounded px-1 py-0.5 text-xs flex-1"
                data-row="${hr.row}" data-orig="${escapeHtml(origName)}"
                value="${escapeHtml(origName)}" placeholder="${escapeHtml(display)}"
                title="原名: ${escapeHtml(display)}">
        </label>`;
    }).join('');
}

function cloneRowSelectAll(selectAll) {
    document.querySelectorAll('.clone-row-cb').forEach(cb => cb.checked = selectAll);
}

function collectCloneRows() {
    const rows = [];
    document.querySelectorAll('.clone-row-cb:checked').forEach(cb => {
        rows.push(parseInt(cb.value));
    });
    return rows;
}

function collectNameOverrides() {
    const overrides = {};
    document.querySelectorAll('.clone-row-name').forEach(input => {
        const row = parseInt(input.dataset.row);
        const orig = input.dataset.orig || '';
        const current = input.value;
        if (current !== orig) {
            overrides[row] = current;
        }
    });
    return overrides;
}
