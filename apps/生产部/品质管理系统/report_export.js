/* ══════════════════════════════════════════════════════
   东莞兴信塑胶制品有限公司品质管理系统
   report_export.js  ·  PDF 自动生成模块
   ──────────────────────────────────────────────────────
   依赖：jsPDF 2.x  +  html2canvas 1.x
   调用：exportReportPDF('daily' | 'weekly')
   输出：A4 横向  297mm × 210mm
         品质日报_YYYY-MM-DD.pdf
         品质周报_YYYY-MM-DD.pdf
══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────
   工具：检查依赖是否加载
───────────────────────────────────────── */
function _rptCheckDeps() {
  const missing = [];
  if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') missing.push('jsPDF');
  if (typeof html2canvas === 'undefined') missing.push('html2canvas');
  return missing;
}

/* ─────────────────────────────────────────
   进度遮罩
───────────────────────────────────────── */
function _rptShowOverlay(msg, sub) {
  let ov = document.getElementById('rptExportOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'rptExportOverlay';
    ov.innerHTML = `
      <div class="rpt-spinner"></div>
      <div class="rpt-exp-msg" id="rptExpMsg"></div>
      <div class="rpt-exp-sub" id="rptExpSub"></div>`;
    document.body.appendChild(ov);
  }
  document.getElementById('rptExpMsg').textContent = msg || '正在生成 PDF…';
  document.getElementById('rptExpSub').textContent = sub || '请稍候，勿关闭页面';
  ov.classList.add('show');
}
function _rptHideOverlay() {
  const ov = document.getElementById('rptExportOverlay');
  if (ov) ov.classList.remove('show');
}
function _rptUpdateOverlay(msg, sub) {
  const m = document.getElementById('rptExpMsg');
  const s = document.getElementById('rptExpSub');
  if (m) m.textContent = msg;
  if (s) s.textContent = sub || '';
}

/* ─────────────────────────────────────────
   主入口
───────────────────────────────────────── */
async function exportReportPDF(type) {
  /* 检查依赖 */
  const missing = _rptCheckDeps();
  if (missing.length) {
    showToast('PDF 库未加载：' + missing.join('、') + '，请检查网络后刷新', 'error');
    return;
  }

  /* 供应商报告需要先选择供应商 */
  if (type === 'supplier') {
    const sel = document.getElementById('supplierSelect');
    if (!sel || !sel.value) {
      showToast('请先选择一家供应商再导出报告', 'error');
      return;
    }
  }

  _rptShowOverlay('正在构建报告…', '正在读取数据');

  /* 更新按钮状态 */
  const btnId = type === 'daily' ? 'btnExportDaily'
              : type === 'weekly' ? 'btnExportWeekly'
              : 'btnExportSupplier';
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }

  try {
    await new Promise(r => requestAnimationFrame(r));

    _rptUpdateOverlay('正在渲染报告…', '构建 A4 版面');

    /* 生成 HTML 画布 */
    let canvas;
    if (type === 'daily') {
      canvas = _buildDailyCanvas();
    } else if (type === 'weekly') {
      const withAppendix = document.getElementById('weeklyAppendix')?.checked === true;
      canvas = _buildWeeklyCanvas(withAppendix);

      /* ── 周报：哨兵分页导出（解决硬切割问题）── */
      document.body.appendChild(canvas);
      await new Promise(r => setTimeout(r, 140));

      const sentinel = document.getElementById('rpt-weekly-p2-start');
      const p2TopPx  = sentinel ? sentinel.offsetTop : null;

      const jspdfCls2 = window.jspdf ? window.jspdf.jsPDF : jsPDF;
      const pdf2 = new jspdfCls2({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pw2  = pdf2.internal.pageSize.getWidth();   /* 297 mm */
      const ph2  = pdf2.internal.pageSize.getHeight();  /* 210 mm */
      const mg   = 6;

      _rptUpdateOverlay('正在截图渲染…', '转换为图像');

      /* 截 PAGE 1（从顶部到哨兵位置，或全部） */
      const p1H = p2TopPx != null ? p2TopPx : canvas.scrollHeight;
      const cvs1 = document.createElement('canvas');
      cvs1.style.cssText = canvas.style.cssText;
      cvs1.style.height = p1H + 'px';
      const img1 = await html2canvas(canvas, {
        scale:2, useCORS:true, allowTaint:true,
        backgroundColor:'#ffffff', logging:false,
        windowWidth: canvas.scrollWidth, windowHeight: p1H,
        scrollX:0, scrollY:0, x:0, y:0,
        height: p1H,
      });
      const r1 = pw2 / img1.width;
      pdf2.addImage(img1.toDataURL('image/jpeg', 0.95), 'JPEG', mg, mg,
        pw2 - mg * 2, Math.min(img1.height * r1, ph2 - mg * 2));

      /* 截 PAGE 2（从哨兵位置到底部）
         只有哨兵后有实际内容（高度 > 80px）才添加第2页
         无 REJ/高风险时，哨兵后内容几乎为空，跳过第2页 */
      if (p2TopPx != null && p2TopPx < canvas.scrollHeight) {
        const p2H = canvas.scrollHeight - p2TopPx;
        if (p2H > 80) {   /* < 80px 视为空白，跳过第2页 */
          const img2 = await html2canvas(canvas, {
            scale:2, useCORS:true, allowTaint:true,
            backgroundColor:'#ffffff', logging:false,
            windowWidth: canvas.scrollWidth, windowHeight: p2H,
            scrollX:0, scrollY: -p2TopPx, x:0, y: p2TopPx,
            height: p2H,
          });
          pdf2.addPage('a4', 'landscape');
          const r2 = pw2 / img2.width;
          pdf2.addImage(img2.toDataURL('image/jpeg', 0.95), 'JPEG', mg, mg,
            pw2 - mg * 2, Math.min(img2.height * r2, ph2 - mg * 2));
        }
      }

      document.body.removeChild(canvas);

      const dateStr2 = document.getElementById('weeklyDate')?.value || _todayStr();
      pdf2.save(`品质周报_${dateStr2}.pdf`);
      _rptHideOverlay();
      showToast(`✓ 品质周报_${dateStr2}.pdf 已生成`, 'success');
      if (btn) { btn.disabled = false; btn.textContent = '⬇ 导出 PDF'; }
      return;   /* ← 周报独立处理完，提前返回 */

    } else {
      /* supplier */
      const supplierName  = document.getElementById('supplierSelect')?.value || '';
      const withAppendix  = document.getElementById('supplierAppendix')?.checked === true;
      canvas = _buildSupplierCanvas(supplierName, withAppendix);
    }
    document.body.appendChild(canvas);

    await new Promise(r => setTimeout(r, 120));

    _rptUpdateOverlay('正在截图渲染…', '转换为图像（可能需要5-10秒）');

    const imgCanvas = await html2canvas(canvas, {
      scale:           2,
      useCORS:         true,
      allowTaint:      true,
      backgroundColor: '#ffffff',
      logging:         false,
      windowWidth:     canvas.offsetWidth,
      windowHeight:    canvas.offsetHeight,
      scrollX: 0, scrollY: 0, x: 0, y: 0,
    });

    document.body.removeChild(canvas);

    _rptUpdateOverlay('正在生成 PDF…', '写入文件');

    const jspdfClass = window.jspdf ? window.jspdf.jsPDF : jsPDF;
    const pdf = new jspdfClass({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageW   = pdf.internal.pageSize.getWidth();
    const pageH   = pdf.internal.pageSize.getHeight();
    const imgW    = imgCanvas.width;
    const imgH    = imgCanvas.height;
    const ratio   = pageW / imgW;
    const scaledH = imgH * ratio;
    const imgData = imgCanvas.toDataURL('image/jpeg', 0.95);

    if (scaledH <= pageH) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, scaledH);
    } else {
      let yOffset = 0;
      while (yOffset < imgH) {
        const sliceH = Math.min(imgH - yOffset, pageH / ratio);
        const sc = document.createElement('canvas');
        sc.width = imgW; sc.height = sliceH;
        sc.getContext('2d').drawImage(imgCanvas, 0, yOffset, imgW, sliceH, 0, 0, imgW, sliceH);
        const sd = sc.toDataURL('image/jpeg', 0.95);
        if (yOffset > 0) pdf.addPage('a4', 'landscape');
        pdf.addImage(sd, 'JPEG', 0, 0, pageW, sliceH * ratio);
        yOffset += sliceH;
      }
    }

    /* 文件名 */
    let prefix, dateStr;
    if (type === 'daily') {
      prefix  = '品质日报';
      dateStr = document.getElementById('dailyDate')?.value || _todayStr();
    } else if (type === 'weekly') {
      prefix  = '品质周报';
      dateStr = document.getElementById('weeklyDate')?.value || _todayStr();
    } else {
      const sName = document.getElementById('supplierSelect')?.value || '供应商';
      prefix  = `供应商质量报告_${sName}`;
      dateStr = _todayStr();
    }
    pdf.save(`${prefix}_${dateStr}.pdf`);

    _rptHideOverlay();
    showToast(`✓ ${prefix}_${dateStr}.pdf 已生成`, 'success');

  } catch (err) {
    console.error('[exportReportPDF]', err);
    _rptHideOverlay();
    showToast('PDF 生成失败：' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = type === 'supplier' ? '⬇ 导出 PDF' : '⬇ 导出 PDF';
    }
    const old = document.getElementById('rpt-canvas');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
}

/* ─────────────────────────────────────────
   工具函数
───────────────────────────────────────── */
function _todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function _weekEndStr(ws) {
  const d = new Date(ws);
  d.setDate(d.getDate() + 6);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

/* 获取当前系统数据（调用主 app.js 里的 recs()） */
function _getData()     { return typeof recs === 'function' ? recs() : []; }
function _isFail(r)     { return typeof isFail === 'function' ? isFail(r) : false; }
function _isPass(r)     { return typeof isPass === 'function' ? isPass(r) : false; }
function _groupBy(a,k)  { return typeof groupBy === 'function' ? groupBy(a,k) : {}; }
function _defRateAvg(a) { return typeof _defectRateAvg === 'function' ? _defectRateAvg(a) : {avg:null,counted:0,total:0}; }
function _getRisk(rt)   { return typeof getRisk === 'function' ? getRisk(rt) : (rt>=0.15?'high':rt>=0.05?'mid':'low'); }

/* badge HTML */
function _badge(result) {
  const v = String(result||'').toUpperCase();
  const cls = v==='PASS'?'pass':v==='REJ'||v==='FAIL'?'rej':v==='COND'?'cond':'hold';
  const label = v==='PASS'?'PASS':v==='REJ'||v==='FAIL'?'REJ':v==='COND'?'有条件':'待定';
  return `<span class="rpt-badge ${cls}">${label}</span>`;
}

/* 风险 badge */
function _riskBadge(rt) {
  const rk = _getRisk(rt);
  const [cls,lbl] = rk==='high'?['high','高风险']:rk==='mid'?['mid','风险']:['low','正常'];
  return `<span class="rpt-badge ${cls}">${lbl}</span>`;
}

/* 不良现象统计 */
function _defectMap(data) {
  /* 与 app.js 中 _isValidDefect / _splitDefect 保持一致的清洗规则 */
  const INVALID = new Set([
    '-','—','——','--','－','n/a','na',
    '无','无不良','暂无','无不良现象','无问题','无异常',
    '正常','合格','良好','pass','ok','/',
    '0','0.0','0.00',
  ]);
  function isValid(s) {
    if (!s || s.length > 30) return false;
    if (INVALID.has(s.toLowerCase())) return false;
    if (/^[\d,]+(\.\d+)?%?$/.test(s)) return false;
    return true;
  }

  const dm = {};
  data.forEach(r => {
    if (!r.defect) return;
    String(r.defect)
      .split(/[，,、；;\s]+/)
      .map(d => d.trim())
      .filter(d => isValid(d))
      .forEach(d => { dm[d] = (dm[d] || 0) + 1; });
  });
  return Object.entries(dm).sort((a, b) => b[1] - a[1]);
}

/* 客户占比 */
const _PIE_COLORS = ['#1a5f8a','#2c9ed4','#12a068','#d4870b','#d93025','#7c3aed','#ec4899'];

/* 简单饼图 SVG */
function _svgPie(data, size=100) {
  const total = data.reduce((s,d)=>s+d.value,0);
  if (!total) return '<svg></svg>';
  let cumAngle = -Math.PI/2;
  const cx=size/2, cy=size/2, r=size*0.42;
  const paths = data.map((d,i) => {
    const angle = (d.value/total)*2*Math.PI;
    const x1=cx+r*Math.cos(cumAngle), y1=cy+r*Math.sin(cumAngle);
    cumAngle += angle;
    const x2=cx+r*Math.cos(cumAngle), y2=cy+r*Math.sin(cumAngle);
    const large = angle>Math.PI?1:0;
    return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${_PIE_COLORS[i%_PIE_COLORS.length]}" stroke="#fff" stroke-width="1.5"/>`;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${paths.join('')}</svg>`;
}

/* 简单折线 SVG */
function _svgLine(values, w=280, h=60, color='#1a5f8a') {
  const pts = values.filter(v=>v!=null);
  if (pts.length < 2) {
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <text x="${w/2}" y="${h/2}" text-anchor="middle" font-size="10" fill="#999">数据不足</text></svg>`;
  }
  const min=Math.min(...pts), max=Math.max(...pts);
  const range=max-min || 1;
  const padY=6, padX=8;
  const usableW=w-padX*2, usableH=h-padY*2;
  const coords = values.map((v,i) => {
    if (v==null) return null;
    const x=padX+i*(usableW/(values.length-1));
    const y=padY+usableH-(v-min)/range*usableH;
    return [x.toFixed(1), y.toFixed(1)];
  }).filter(Boolean);

  const polyline = `<polyline points="${coords.map(c=>c.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const dots = coords.map(([x,y]) =>
    `<circle cx="${x}" cy="${y}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`
  ).join('');

  /* Y 轴标注 */
  const yLabels = [min, (min+max)/2, max].map((v,i) => {
    const y = padY + usableH - (i*0.5)*usableH;
    return `<text x="${padX-2}" y="${y.toFixed(1)}" text-anchor="end" font-size="8" fill="#999">${v.toFixed(1)}%</text>`;
  }).join('');

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#f7fafd" rx="3"/>
    ${yLabels}
    ${polyline}
    ${dots}
  </svg>`;
}

/* ─────────────────────────────────────────
   §A  品质日报 HTML 画布构建
───────────────────────────────────────── */
function _buildDailyCanvas() {
  const date    = document.getElementById('dailyDate')?.value || _todayStr();
  const allData = _getData();
  const data    = allData.filter(r => r.date === date || r.inspDate === date);

  /* ── 统计 ── */
  const total   = data.length;
  const passCnt = data.filter(r => _isPass(r)).length;
  const failCnt = data.filter(r => _isFail(r)).length;
  const passRate = total ? (passCnt/total*100).toFixed(1) : '0.0';
  const totalQty = data.reduce((s,r)=>s+(r.qty||0), 0);
  const { avg: avgDefRate, counted: withRate } = _defRateAvg(data);

  /* 高风险供应商（全历史，>= 15% FAIL 率，>= 2 批） */
  const byS = _groupBy(allData, 'supplier');
  const hiRiskSuppliers = Object.entries(byS)
    .filter(([,list]) => list.length>=2 && list.filter(r=>_isFail(r)).length/list.length>=0.15)
    .map(([name,list]) => name);

  /* TOP 不良 */
  const defects = _defectMap(data);
  const maxDef  = defects[0]?.[1] || 1;

  /* 客户占比 */
  const byClient = _groupBy(data, 'client');
  const clientList = Object.entries(byClient)
    .map(([name,list],i)=>({name,value:list.length,color:_PIE_COLORS[i%_PIE_COLORS.length]}))
    .sort((a,b)=>b.value-a.value);

  /* 本日供应商汇总 */
  const supplierSummary = Object.entries(_groupBy(data,'supplier'))
    .map(([s,list]) => {
      const f  = list.filter(r=>_isFail(r)).length;
      const rt = list.length ? f/list.length : 0;
      const {avg} = _defRateAvg(list);
      return {s, total:list.length, pass:list.length-f, fail:f, rt, avg};
    }).sort((a,b)=>b.rt-a.rt);

  /* 近7天 PASS 率趋势 */
  const days7 = [];
  for (let i=6;i>=0;i--) {
    const d=new Date(date); d.setDate(d.getDate()-i);
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dr=allData.filter(r=>r.date===ds);
    const p=dr.length?((dr.length-dr.filter(r=>_isFail(r)).length)/dr.length*100):null;
    days7.push({date:ds.slice(5),val:p});
  }

  /* ── 整改建议 ── */
  const SUGGEST = {
    '大小眼':'加强对称性检验，增加作业员培训',
    '眼贴歪':'检查眼睛定位辅助工具',
    '止口偏大':'检查车缝工序尺寸管控标准',
    '大小脚':'模具/版型全面检查，加强首件确认',
    '斜眼':'严格控制眼睛粘贴工序',
    '爆口':'检查缝线张力及针距设定',
    '线头':'增加裁线工序巡检频次',
    '色差':'加强来料色卡比对确认',
    '形状不良':'模具及版型全面检查',
    '咪咪眼':'调整眼睛粘贴治具并重新培训',
    '缝线不匀':'检查设备状态及作业员技能',
  };

  /* ── 构建 HTML ── */
  const div = document.createElement('div');
  div.id = 'rpt-canvas';

  div.innerHTML = `
    <!-- 报告头 -->
    <div class="rpt-header">
      <div>
        <div class="rpt-co-name">东莞兴信塑胶制品有限公司</div>
        <div class="rpt-doc-type">品 质 日 报 · 东 莞 兴 信</div>
      </div>
      <div class="rpt-doc-no">
        <div><strong>报告日期：</strong>${date}</div>
        <div><strong>编制部门：</strong>品质管理部</div>
        <div><strong>文件编号：</strong>QC-DR-${date.replace(/-/g,'')}</div>
      </div>
    </div>

    <!-- KPI 卡片 -->
    <div class="rpt-kpi-row cols-5" style="margin-bottom:14px">
      <div class="rpt-kpi ${+passRate>=80?'green':+passRate>=60?'yellow':'red'}">
        <div class="rpt-kpi-label">今日 PASS 率</div>
        <div class="rpt-kpi-value ${+passRate>=80?'green':+passRate>=60?'yellow':'red'}">${passRate}%</div>
        <div class="rpt-kpi-sub">${passCnt} / ${total} 批次通过</div>
      </div>
      <div class="rpt-kpi ${failCnt>0?'red':'green'}">
        <div class="rpt-kpi-label">FAIL 批次</div>
        <div class="rpt-kpi-value ${failCnt>0?'red':'green'}">${failCnt}</div>
        <div class="rpt-kpi-sub">占比 ${total?(failCnt/total*100).toFixed(1):0}%</div>
      </div>
      <div class="rpt-kpi blue">
        <div class="rpt-kpi-label">验货批次</div>
        <div class="rpt-kpi-value blue">${total}</div>
        <div class="rpt-kpi-sub">来料 ${totalQty.toLocaleString()} 件</div>
      </div>
      <div class="rpt-kpi ${avgDefRate!=null?(avgDefRate>=15?'red':avgDefRate>=5?'yellow':'green'):'grey'}">
        <div class="rpt-kpi-label">平均不良率</div>
        <div class="rpt-kpi-value ${avgDefRate!=null?(avgDefRate>=15?'red':avgDefRate>=5?'yellow':'green'):''}">
          ${avgDefRate!=null?avgDefRate.toFixed(1)+'%':'—'}
        </div>
        <div class="rpt-kpi-sub">${withRate>0?`${withRate}批有抽查数据`:'无抽查数据'}</div>
      </div>
      <div class="rpt-kpi ${hiRiskSuppliers.length>0?'red':'green'}">
        <div class="rpt-kpi-label">高风险供应商</div>
        <div class="rpt-kpi-value ${hiRiskSuppliers.length>0?'red':'green'}">${hiRiskSuppliers.length}</div>
        <div class="rpt-kpi-sub">${hiRiskSuppliers.length?hiRiskSuppliers.slice(0,3).join('、'):'暂无高风险'}</div>
      </div>
    </div>

    <!-- 两栏布局：明细表 + 分析 -->
    <div class="rpt-two-col" style="margin-bottom:14px">

      <!-- 左：验货明细 -->
      <div class="rpt-section" style="grid-column:1/2">
        <div class="rpt-section-title">验货明细</div>
        ${total===0
          ? '<div style="padding:20px;text-align:center;color:#999;font-size:12px">该日期暂无验货记录</div>'
          : `<table class="rpt-table">
              <thead><tr>
                <th>供应商</th><th>货号</th><th>款式</th>
                <th>来料数</th><th>抽查数</th><th>不良率</th><th>不良现象</th><th>判定</th>
              </tr></thead>
              <tbody>
                ${data.map(r=>`<tr>
                  <td><strong>${r.supplier}</strong></td>
                  <td>${r.productNo||'-'}</td>
                  <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis">${r.productName||'-'}</td>
                  <td style="text-align:right">${(r.qty||0).toLocaleString()}</td>
                  <td style="text-align:right">${r.sampleQty!=null?r.sampleQty:'—'}</td>
                  <td style="text-align:right;font-weight:600;color:${
                    r.sampleQty==null?'#999':
                    (parseFloat((r.defectRate||'0').replace('%',''))>=15?'#d93025':
                    parseFloat((r.defectRate||'0').replace('%',''))>=5?'#d4870b':'#12a068')}">${
                    r.sampleQty!=null?(r.defectRate||'-'):'—'}</td>
                  <td style="max-width:80px;overflow:hidden;text-overflow:ellipsis;font-size:10px">${r.defect||'-'}</td>
                  <td>${_badge(r.result)}</td>
                </tr>`).join('')}
              </tbody>
            </table>`
        }
      </div>

      <!-- 右：分析区 -->
      <div style="display:flex;flex-direction:column;gap:12px">

        <!-- TOP 不良 -->
        <div class="rpt-section">
          <div class="rpt-section-title">不良类型 TOP</div>
          ${defects.length===0
            ? '<div style="color:#999;font-size:11px;padding:6px 0">本日无不良记录</div>'
            : defects.slice(0,6).map(([name,cnt])=>{
                const pct=Math.round(cnt/maxDef*100);
                const isRisk=['大小眼','斜眼','大小脚','形状不良','爆口'].includes(name);
                return `<div class="rpt-defect-item">
                  <div class="rpt-defect-name">${name}</div>
                  <div class="rpt-defect-bar-wrap">
                    <div class="rpt-defect-bar${isRisk?' risk':''}" style="width:${pct}%"></div>
                  </div>
                  <div class="rpt-defect-cnt">${cnt}次</div>
                </div>`;
              }).join('')
          }
        </div>

        <!-- 客户占比 -->
        <div class="rpt-section">
          <div class="rpt-section-title">客户占比</div>
          <div style="display:flex;align-items:center;gap:12px">
            ${_svgPie(clientList, 80)}
            <div class="rpt-pie-legend">
              ${clientList.map((c,i)=>`
                <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#444">
                  <span class="rpt-pie-dot" style="background:${c.color}"></span>
                  ${c.name} ${(c.value/total*100).toFixed(0)}%
                </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- 近7天趋势 -->
        <div class="rpt-section">
          <div class="rpt-section-title">近7日 PASS 率趋势</div>
          <div class="rpt-trend-wrap" style="padding:8px">
            ${_svgLine(days7.map(d=>d.val), 260, 52, '#1a5f8a')}
            <div style="display:flex;justify-content:space-between;margin-top:2px;padding:0 8px">
              ${days7.map(d=>`<span style="font-size:8px;color:#bbb">${d.date}</span>`).join('')}
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- 供应商汇总（今日） -->
    ${supplierSummary.length > 0 ? `
    <div class="rpt-section" style="margin-bottom:12px">
      <div class="rpt-section-title">今日供应商汇总</div>
      <table class="rpt-table">
        <thead><tr>
          <th>供应商</th><th>验货批次</th><th>PASS</th><th>FAIL</th>
          <th>批次退货率</th><th>平均不良率</th><th>风险等级</th>
        </tr></thead>
        <tbody>
          ${supplierSummary.map(s=>`<tr>
            <td><strong>${s.s}</strong></td>
            <td style="text-align:center">${s.total}</td>
            <td style="text-align:center;color:#12a068;font-weight:600">${s.pass}</td>
            <td style="text-align:center;color:${s.fail>0?'#d93025':'#999'};font-weight:600">${s.fail}</td>
            <td style="text-align:right;font-weight:600;color:${s.rt>=0.15?'#d93025':s.rt>=0.05?'#d4870b':'#12a068'}">${(s.rt*100).toFixed(1)}%</td>
            <td style="text-align:right;color:${s.avg==null?'#999':s.avg>=15?'#d93025':s.avg>=5?'#d4870b':'#12a068'}">${s.avg!=null?s.avg.toFixed(1)+'%':'—'}</td>
            <td>${_riskBadge(s.rt)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <!-- 结论与措施 -->
    ${failCnt>0&&defects.length>0 ? `
    <div class="rpt-conclusion" style="margin-bottom:12px">
      <div class="rpt-conclusion-title">⚠ 重点问题 &amp; 整改措施</div>
      <ul>
        ${defects.slice(0,5).map(([d])=>`
          <li>${d}：${SUGGEST[d]||'持续监控，加强巡检频次'}</li>`).join('')}
      </ul>
    </div>` : ''}

    <!-- 页脚 -->
    <div class="rpt-footer">
      <div class="rpt-sigs">
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>制表人</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>品质主管审核</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>部门经理批准</div></div>
      </div>
      <div style="text-align:right">
        <div>东莞兴信塑胶制品有限公司 · 品质管理部</div>
        <div style="margin-top:2px">生成时间：${new Date().toLocaleString('zh-CN')}</div>
      </div>
    </div>`;

  return div;
}

/* ─────────────────────────────────────────
   §B  品质周报 HTML 画布构建
   ──────────────────────────────────────
   管理版（默认）：KPI + 供应商排名 + TOP不良 +
                   REJ明细 + 结论 ≈ 2~3页
   附录版（勾选）：追加全部验货明细分页
───────────────────────────────────────── */
function _buildWeeklyCanvas(withAppendix) {
  const ws      = document.getElementById('weeklyDate')?.value || _todayStr();
  const we      = _weekEndStr(ws);
  const allData = _getData();
  const data    = allData.filter(r => r.date >= ws && r.date <= we);

  /* ── 统计 ── */
  const total    = data.length;
  const passCnt  = data.filter(r => _isPass(r)).length;
  const failCnt  = data.filter(r => _isFail(r)).length;
  const passRate = total ? (passCnt / total * 100).toFixed(1) : '0.0';
  const totalQty = data.reduce((s, r) => s + (r.qty || 0), 0);
  const { avg: avgDefRate, counted: withRate } = _defRateAvg(data);

  /* REJ 批次（主报告只展示这些） */
  const rejData = data.filter(r => _isFail(r)).sort((a, b) => a.date.localeCompare(b.date));

  /* 高风险供应商 */
  const bySW    = _groupBy(data, 'supplier');
  const hiRisk  = Object.entries(bySW)
    .filter(([, list]) => list.filter(r => _isFail(r)).length / list.length >= 0.15)
    .map(([s, list]) => {
      const f  = list.filter(r => _isFail(r)).length;
      const rt = (f / list.length * 100).toFixed(1);
      const { avg } = _defRateAvg(list);
      return { s, total: list.length, fail: f, rt, avg };
    }).sort((a, b) => parseFloat(b.rt) - parseFloat(a.rt));

  /* 供应商汇总排名（按平均不良率，无则按 REJ 率） */
  const supplierRank = Object.entries(bySW).map(([s, list]) => {
    const f   = list.filter(r => _isFail(r)).length;
    const rt  = list.length ? f / list.length : 0;
    const { avg, counted } = _defRateAvg(list);
    return { s, total: list.length, pass: list.length - f, fail: f, rt, avg, counted };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  /* 不良现象 TOP */
  const defects = _defectMap(data);
  const maxDef  = defects[0]?.[1] || 1;

  /* 客户占比 */
  const byClient   = _groupBy(data, 'client');
  const clientList = Object.entries(byClient)
    .map(([name, list], i) => ({ name, value: list.length, color: _PIE_COLORS[i % _PIE_COLORS.length] }))
    .sort((a, b) => b.value - a.value);

  /* 本周每日 PASS 率趋势 */
  const days7 = [];
  const dCur  = new Date(ws);
  const dEnd  = new Date(we);
  while (dCur <= dEnd) {
    const ds = `${dCur.getFullYear()}-${String(dCur.getMonth() + 1).padStart(2, '0')}-${String(dCur.getDate()).padStart(2, '0')}`;
    const dr = allData.filter(r => r.date === ds);
    const p  = dr.length ? ((dr.length - dr.filter(r => _isFail(r)).length) / dr.length * 100) : null;
    days7.push({ date: ds.slice(5), val: p });
    dCur.setDate(dCur.getDate() + 1);
  }

  /* 整改建议 */
  const SUGGEST = {
    '大小眼': '加强对称性检验，增加培训',    '眼贴歪': '检查眼睛定位辅助工具',
    '止口偏大': '加强车缝尺寸管控',          '大小脚': '模具/版型全面检查',
    '斜眼': '严控眼睛粘贴工序',              '爆口': '检查缝线张力及针距',
    '线头': '增加裁线工序巡检',              '色差': '加强来料色卡比对',
    '形状不良': '模具及版型全面检查',         '咪咪眼': '调整粘贴治具并重新培训',
    '缝线不匀': '检查设备状态及作业员技能',
  };

  /* ── 不良率显示辅助（供应商报告专用）──
     有效条件：sampleQty 为正整数 且 defectRate 非空字符串
     否则显示 "—"（无抽查数据），不显示 0.00%
  */
  const _hasValidRate = r =>
    r.sampleQty != null && r.sampleQty > 0 &&
    r.defectRate != null && r.defectRate !== '';

  const rateColor = r => {
    if (!_hasValidRate(r)) return '#999';
    const n = parseFloat((r.defectRate || '0').replace('%', ''));
    return n >= 15 ? '#d93025' : n >= 5 ? '#d4870b' : '#12a068';
  };
  const rateText = r => {
    if (!_hasValidRate(r)) return '<span style="color:#999">—</span>';
    return r.defectRate;
  };

  /* ── REJ 明细行 HTML ── */
  const rejRow = r => `<tr>
    <td style="font-size:10px;color:#666;white-space:nowrap">${r.date}</td>
    <td><strong>${r.supplier}</strong></td>
    <td style="font-size:10px">${r.productNo || '-'}</td>
    <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;font-size:10px">${r.productName || '-'}</td>
    <td style="font-size:10px">${r.client || '-'}</td>
    <td style="text-align:right">${(r.qty || 0).toLocaleString()}</td>
    <td style="text-align:right">${r.sampleQty != null ? r.sampleQty : '—'}</td>
    <td style="text-align:right;font-weight:600;color:${rateColor(r)}">${rateText(r)}</td>
    <td style="font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis"
        title="${r.defect || ''}">${r.defect || '-'}</td>
    <td>${_badge(r.result)}</td>
  </tr>`;

  /* ── 全部明细行（仅附录用） ── */
  const allRow = r => `<tr>
    <td style="font-size:10px;color:#666;white-space:nowrap">${r.date}</td>
    <td><strong>${r.supplier}</strong></td>
    <td style="font-size:10px">${r.productNo || '-'}</td>
    <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis;font-size:10px">${r.productName || '-'}</td>
    <td style="font-size:10px">${r.client || '-'}</td>
    <td style="text-align:right">${(r.qty || 0).toLocaleString()}</td>
    <td style="text-align:right">${r.sampleQty != null ? r.sampleQty : '—'}</td>
    <td style="text-align:right;font-weight:600;color:${rateColor(r)}">${rateText(r)}</td>
    <td style="font-size:10px;max-width:90px;overflow:hidden;text-overflow:ellipsis"
        title="${r.defect || ''}">${r.defect || '-'}</td>
    <td>${_badge(r.result)}</td>
  </tr>`;

  /* ── 公共表头 ── */
  const detailThead = `<thead><tr>
    <th>日期</th><th>供应商</th><th>货号</th><th>款式</th><th>客户</th>
    <th>来料数</th><th>抽查数</th><th>不良率</th><th>不良现象</th><th>判定</th>
  </tr></thead>`;

  /* ══════════════════════════════════════
     构建主报告画布
  ══════════════════════════════════════ */
  const div = document.createElement('div');
  div.id = 'rpt-canvas';

  div.innerHTML = `

    <!-- ▌PAGE 1  报告头 + KPI + 分析三栏 ▌-->
    <div class="rpt-header">
      <div>
        <div class="rpt-co-name">东莞兴信塑胶制品有限公司</div>
        <div class="rpt-doc-type">品 质 周 报 · 东 莞 兴 信</div>
      </div>
      <div class="rpt-doc-no">
        <div><strong>统计周期：</strong>${ws} ～ ${we}</div>
        <div><strong>编制部门：</strong>品质管理部</div>
        <div><strong>文件编号：</strong>QC-WR-${ws.replace(/-/g, '')}</div>
        ${withAppendix ? '<div style="color:#d4870b;font-weight:600;font-size:10px">★ 含附录：全部验货明细</div>' : ''}
      </div>
    </div>

    <!-- KPI 6格 -->
    <div class="rpt-kpi-row cols-6" style="margin-bottom:12px">
      <div class="rpt-kpi ${+passRate >= 80 ? 'green' : +passRate >= 60 ? 'yellow' : 'red'}">
        <div class="rpt-kpi-label">本周 PASS 率</div>
        <div class="rpt-kpi-value ${+passRate >= 80 ? 'green' : +passRate >= 60 ? 'yellow' : 'red'}">${passRate}%</div>
        <div class="rpt-kpi-sub">${passCnt} / ${total} 批次通过</div>
      </div>
      <div class="rpt-kpi ${failCnt > 0 ? 'red' : 'green'}">
        <div class="rpt-kpi-label">本周 REJ 批次</div>
        <div class="rpt-kpi-value ${failCnt > 0 ? 'red' : 'green'}">${failCnt}</div>
        <div class="rpt-kpi-sub">占比 ${total ? (failCnt / total * 100).toFixed(1) : 0}%</div>
      </div>
      <div class="rpt-kpi blue">
        <div class="rpt-kpi-label">验货批次 / 来料量</div>
        <div class="rpt-kpi-value blue">${total}</div>
        <div class="rpt-kpi-sub">${totalQty.toLocaleString()} 件</div>
      </div>
      <div class="rpt-kpi ${avgDefRate != null ? (avgDefRate >= 15 ? 'red' : avgDefRate >= 5 ? 'yellow' : 'green') : 'grey'}">
        <div class="rpt-kpi-label">本周平均不良率</div>
        <div class="rpt-kpi-value ${avgDefRate != null ? (avgDefRate >= 15 ? 'red' : avgDefRate >= 5 ? 'yellow' : 'green') : ''}">
          ${avgDefRate != null ? avgDefRate.toFixed(1) + '%' : '—'}
        </div>
        <div class="rpt-kpi-sub">${withRate > 0 ? `${withRate} 批有抽查数据` : '无抽查数据'}</div>
      </div>
      <div class="rpt-kpi ${hiRisk.length > 0 ? 'red' : 'green'}">
        <div class="rpt-kpi-label">高风险供应商</div>
        <div class="rpt-kpi-value ${hiRisk.length > 0 ? 'red' : 'green'}">${hiRisk.length}</div>
        <div class="rpt-kpi-sub">${hiRisk.length ? hiRisk.map(h => h.s).slice(0, 2).join('、') : '暂无高风险'}</div>
      </div>
      <div class="rpt-kpi ${defects.length > 0 ? 'yellow' : 'green'}">
        <div class="rpt-kpi-label">不良类型数</div>
        <div class="rpt-kpi-value">${defects.length}</div>
        <div class="rpt-kpi-sub">${defects[0] ? 'TOP：' + defects[0][0] : '无不良记录'}</div>
      </div>
    </div>

    <!-- 三栏分析 -->
    <div class="rpt-three-col" style="margin-bottom:16px">

      <!-- 供应商排名 -->
      <div class="rpt-section" style="min-height:280px">
        <div class="rpt-section-title">供应商平均不良率排名</div>
        <table class="rpt-table">
          <thead><tr>
            <th>供应商</th><th style="text-align:center">批次</th>
            <th style="text-align:center">REJ</th><th style="text-align:right">平均不良率</th><th>风险</th>
          </tr></thead>
          <tbody>
            ${supplierRank.slice(0, 8).map((s, i) => `<tr>
              <td><span style="color:#1a5f8a;font-weight:700;margin-right:3px">${i + 1}</span>${s.s}</td>
              <td style="text-align:center">${s.total}</td>
              <td style="text-align:center;color:${s.fail > 0 ? '#d93025' : '#aaa'};font-weight:600">${s.fail || '—'}</td>
              <td style="text-align:right;font-weight:600;color:${s.avg == null ? '#aaa' : s.avg >= 15 ? '#d93025' : s.avg >= 5 ? '#d4870b' : '#12a068'}">
                ${s.avg != null ? s.avg.toFixed(1) + '%' : '—'}</td>
              <td>${_riskBadge(s.rt)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <!-- TOP 不良 -->
      <div class="rpt-section" style="min-height:280px">
        <div class="rpt-section-title">不良类型 TOP</div>
        ${defects.length === 0
          ? '<div style="color:#999;font-size:11px;padding:12px 0;text-align:center">本周无不良记录</div>'
          : defects.slice(0, 8).map(([name, cnt]) => {
              const pct    = Math.round(cnt / maxDef * 100);
              const isRisk = ['大小眼','斜眼','大小脚','形状不良','爆口'].includes(name);
                return `<div class="rpt-defect-item">
                <div class="rpt-defect-name">${name}</div>
                <div class="rpt-defect-bar-wrap">
                  <div class="rpt-defect-bar${isRisk ? ' risk' : ''}" style="width:${pct}%"></div>
                </div>
                <div class="rpt-defect-cnt">${cnt} 次</div>
              </div>`;
            }).join('')
        }
        ${defects.length > 0
          ? `<div style="font-size:9px;color:#bbb;margin-top:4px;text-align:right">
               合计 ${defects.reduce((s, [, c]) => s + c, 0)} 次不良 · ${defects.length} 类型
             </div>` : ''}
      </div>

      <!-- 客户占比 + 趋势 -->
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="rpt-section">
          <div class="rpt-section-title">客户占比</div>
          <div style="display:flex;align-items:center;gap:10px">
            ${_svgPie(clientList, 72)}
            <div class="rpt-pie-legend">
              ${clientList.map(c => `
                <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#444">
                  <span class="rpt-pie-dot" style="background:${c.color}"></span>
                  ${c.name} ${(c.value / total * 100).toFixed(0)}%
                </div>`).join('')}
            </div>
          </div>
        </div>
        <div class="rpt-section">
          <div class="rpt-section-title">本周每日 PASS 率趋势</div>
          <div class="rpt-trend-wrap" style="padding:6px">
            ${_svgLine(days7.map(d => d.val), 262, 90, '#12a068')}
            <div style="display:flex;justify-content:space-between;padding:0 6px">
              ${days7.map(d => `<span style="font-size:8px;color:#bbb">${d.date}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ▌PAGE 1 底部：无REJ时直接在第1页显示 ▌-->

    <!-- 无REJ时：绿色提示 + 结论提前到第1页底部 -->
    ${rejData.length === 0 && hiRisk.length === 0 ? `
    <div class="rpt-section" style="margin-bottom:10px">
      <div style="background:#f0faf5;border:1px solid #a7e6cc;border-radius:4px;padding:12px 16px;
                  font-size:12px;color:#0a7a4e;font-weight:600">
        ✓ 本周无 REJ 批次，所有验货结果均 PASS
      </div>
    </div>
    ${defects.length > 0 ? `
    <div class="rpt-section" style="margin-bottom:10px">
      <div class="rpt-conclusion" style="border-left-color:#12a068;background:#f0faf5">
        <div class="rpt-conclusion-title" style="color:#0a7a4e">✓ 本周供应商质量评价</div>
        <ul>
          ${supplierRank.slice(0, 4).map(s =>
            '<li>' + s.s + '：' + (s.fail === 0 ? '全部 PASS，质量稳定' : s.fail + ' 批 REJ，需持续关注') + '</li>'
          ).join('')}
        </ul>
      </div>
    </div>` : ''}` : ''}

    <!-- 页脚（无REJ时也在第1页） -->
    ${rejData.length === 0 && hiRisk.length === 0 ? `
    <div class="rpt-footer">
      <div class="rpt-sigs">
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>制表人</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>品质主管审核</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>部门经理批准</div></div>
      </div>
      <div style="text-align:right">
        <div>东莞兴信塑胶制品有限公司 · 品质管理部</div>
        <div style="margin-top:2px">生成时间：${new Date().toLocaleString('zh-CN')}</div>
      </div>
    </div>` : ''}

    <!-- ▌哨兵：有REJ/高风险时才生成 PAGE 2 ▌-->
    <div id="rpt-weekly-p2-start" style="height:0;overflow:hidden"></div>

    <!-- 高风险供应商（PAGE2，仅有高风险时显示） -->
    ${hiRisk.length > 0 ? `
    <div class="rpt-section" style="margin-bottom:14px">
      <div class="rpt-section-title">⚠ 高风险供应商详情</div>
      <table class="rpt-table">
        <thead><tr>
          <th>供应商</th><th style="text-align:center">本周批次</th>
          <th style="text-align:center">REJ批次</th><th style="text-align:right">批次退货率</th>
          <th style="text-align:right">平均不良率</th><th>整改建议</th>
        </tr></thead>
        <tbody>
          ${hiRisk.map(h => `<tr>
            <td><strong style="color:#d93025">${h.s}</strong></td>
            <td style="text-align:center">${h.total}</td>
            <td style="text-align:center;font-weight:700;color:#d93025">${h.fail}</td>
            <td style="text-align:right;font-weight:700;color:#d93025">${h.rt}%</td>
            <td style="text-align:right;color:${h.avg == null ? '#999' : '#d93025'};font-weight:600">
              ${h.avg != null ? h.avg.toFixed(1) + '%' : '—'}</td>
            <td style="font-size:10px;color:#666">建议启动供应商整改，要求提交8D报告</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <!-- REJ 批次明细（PAGE2，仅有REJ时显示）-->
    ${rejData.length > 0 ? `
    <div class="rpt-section" style="margin-bottom:10px">
      <div class="rpt-section-title">本周 REJ 批次明细（共 ${rejData.length} 批）</div>
      <table class="rpt-table">
        ${detailThead}
        <tbody>${rejData.map(rejRow).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- 结论与整改措施（PAGE2，仅有REJ时显示）-->
    ${failCnt > 0 && defects.length > 0 ? `
    <div class="rpt-two-col" style="margin-bottom:12px">
      <div class="rpt-conclusion">
        <div class="rpt-conclusion-title">⚠ 本周重点问题 &amp; 整改措施</div>
        <ul>
          ${defects.slice(0, 5).map(([d]) => `
            <li>${d}：${SUGGEST[d] || '持续监控，加强巡检频次'}</li>`).join('')}
        </ul>
      </div>
      ${hiRisk.length > 0 ? `
      <div class="rpt-conclusion" style="border-left-color:#d93025;background:#fff8f8">
        <div class="rpt-conclusion-title" style="color:#b91c1c">⚠ 高风险供应商关注清单</div>
        <ul>
          ${hiRisk.map(h => `
            <li>${h.s}：退货率 ${h.rt}%${h.avg != null ? ' / 不良率 ' + h.avg.toFixed(1) + '%' : ''}，共 ${h.fail} 批 REJ</li>`).join('')}
        </ul>
      </div>` : `
      <div class="rpt-conclusion" style="border-left-color:#12a068;background:#f0faf5">
        <div class="rpt-conclusion-title" style="color:#0a7a4e">✓ 本周供应商质量评价</div>
        <ul>
          ${supplierRank.slice(0, 4).map(s => `
            <li>${s.s}：${s.fail === 0 ? '全部 PASS，质量稳定' : `${s.fail} 批 REJ，需持续关注`}</li>`).join('')}
        </ul>
      </div>`}
    </div>` : ''}

    <!-- 页脚（有REJ/高风险时在PAGE2底部） -->
    ${rejData.length > 0 || hiRisk.length > 0 ? `
    <div class="rpt-footer">
      <div class="rpt-sigs">
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>制表人</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>品质主管审核</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>部门经理批准</div></div>
      </div>
      <div style="text-align:right">
        <div>东莞兴信塑胶制品有限公司 · 品质管理部</div>
        <div style="margin-top:2px">生成时间：${new Date().toLocaleString('zh-CN')}</div>
        ${withAppendix ? `<div style="color:#d4870b;font-size:10px;margin-top:2px">附录见下页</div>` : ''}
      </div>
    </div>` : ''}

    <!-- ▌附录（可选）：全部验货明细 ▌-->
    ${withAppendix && total > 0 ? `
    <div style="margin-top:28px;padding-top:16px;border-top:2px dashed #d0e3f0">
      <div class="rpt-header" style="margin-bottom:10px">
        <div>
          <div class="rpt-co-name" style="font-size:14px">东莞兴信塑胶制品有限公司</div>
          <div class="rpt-doc-type" style="font-size:11px">附录：全部验货明细 · ${ws} ～ ${we}</div>
        </div>
        <div class="rpt-doc-no" style="font-size:10px">
          <div>共 <strong>${total}</strong> 批次</div>
          <div>PASS <span style="color:#12a068;font-weight:700">${passCnt}</span> 批 ·
               REJ <span style="color:#d93025;font-weight:700">${failCnt}</span> 批</div>
        </div>
      </div>
      <table class="rpt-table">
        ${detailThead}
        <tbody>
          ${data.sort((a, b) => a.date.localeCompare(b.date)).map(allRow).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f0f7ff">
            <td colspan="5" style="font-weight:700;color:#1a3a5c;font-size:10px">
              合计 ${total} 批 · PASS ${passCnt} · REJ ${failCnt}
            </td>
            <td style="text-align:right;font-weight:700">${totalQty.toLocaleString()}</td>
            <td colspan="4" style="font-size:10px;color:#666">
              平均不良率：${avgDefRate != null ? avgDefRate.toFixed(1) + '%' : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
      <div class="rpt-footer" style="margin-top:10px">
        <div style="font-size:10px;color:#999">附录由系统自动生成 · 东莞兴信塑胶制品有限公司 · 品质管理部</div>
        <div style="font-size:10px;color:#999">生成时间：${new Date().toLocaleString('zh-CN')}</div>
      </div>
    </div>` : ''}`;

  return div;
}

/* ═══════════════════════════════════════════════════
   §C  供应商质量报告 HTML 画布构建
   ──────────────────────────────────────────────────
   A4 横向白底 · KPI + 趋势 + TOP不良 + 批次明细
   主体控制在 1-3 页，超出自动分割
═══════════════════════════════════════════════════ */
function _buildSupplierCanvas(supplierName, withAppendix) {
  const allData = _getData();
  const data    = allData.filter(r => r.supplier === supplierName);

  /* ── 基础统计 ── */
  const total    = data.length;
  const passCnt  = data.filter(r => _isPass(r)).length;
  const failCnt  = data.filter(r => _isFail(r)).length;
  const passRate = total ? (passCnt / total * 100).toFixed(1) : '0.0';
  const failRate = total ? (failCnt / total * 100).toFixed(1) : '0.0';
  const totalQty = data.reduce((s, r) => s + (r.qty || 0), 0);
  const { avg: avgDefRate, counted: withRate } = _defRateAvg(data);

  /* 统计周期 */
  const dates    = data.map(r => r.date).filter(Boolean).sort();
  const firstDate = dates[0]  || _todayStr();
  const lastDate  = dates[dates.length - 1] || _todayStr();

  /* 文件编号 */
  const docNo = `SQR-${supplierName.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}-${_todayStr().replace(/-/g, '')}`;

  /* 高风险批次（不良率 >= 15%） */
  const hiRiskBatch = data.filter(r => {
    const n = parseFloat((r.defectRate || '0').replace('%', ''));
    return n >= 15 && r.sampleQty != null;
  });

  /* REJ 批次 */
  const rejData = data.filter(r => _isFail(r)).sort((a, b) => a.date.localeCompare(b.date));

  /* TOP 不良（使用清洗函数） */
  const defects = _defectMap(data);
  const maxDef  = defects[0]?.[1] || 1;

  /* 客户分布 */
  const byClient   = _groupBy(data, 'client');
  const clientList = Object.entries(byClient)
    .map(([name, list], i) => ({ name, value: list.length, color: _PIE_COLORS[i % _PIE_COLORS.length] }))
    .sort((a, b) => b.value - a.value);

  /* 周趋势（每周 REJ 批次 + 平均不良率） */
  const byWeek = {};
  data.forEach(r => {
    /* 简易 weekStart：取周一 */
    const d   = new Date(r.date);
    if (isNaN(d)) return;
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    const ws  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!byWeek[ws]) byWeek[ws] = { total:0, fail:0, recs:[] };
    byWeek[ws].total++;
    if (_isFail(r)) byWeek[ws].fail++;
    byWeek[ws].recs.push(r);
  });
  const weeks    = Object.keys(byWeek).sort();
  const weekFail = weeks.map(w => byWeek[w].fail);
  const weekRate = weeks.map(w => {
    const { avg } = _defRateAvg(byWeek[w].recs);
    return avg;
  });

  /* 整改建议 */
  const SUGGEST = {
    '大小眼':'加强对称性检验，增加培训',    '眼贴歪':'检查眼睛定位辅助工具',
    '止口偏大':'加强车缝尺寸管控',          '大小脚':'模具/版型全面检查',
    '斜眼':'严控眼睛粘贴工序',              '爆口':'检查缝线张力及针距',
    '线头':'增加裁线工序巡检',              '色差':'加强来料色卡比对',
    '形状不良':'模具及版型全面检查',         '咪咪眼':'调整粘贴治具并重新培训',
    '缝线不匀':'检查设备状态及作业员技能',   '轻微色差':'加强色卡管控',
  };

  /* ── 自动结论 ── */
  function _autoConclusion() {
    const lines = [];
    if (failCnt === 0) {
      lines.push(`供应商 ${supplierName} 本统计周期内整体质量表现稳定，所有批次均通过检验，建议继续保持现有管控水平。`);
    } else {
      lines.push(`供应商 ${supplierName} 本统计周期内共 ${total} 批次来料，${failCnt} 批判定 REJ，批次退货率 ${failRate}%，建议针对 TOP 不良现象进行原因分析并提交改善措施。`);
    }
    if (avgDefRate != null && avgDefRate >= 15) {
      lines.push(`平均不良率 ${avgDefRate.toFixed(1)}% 偏高（基准线 15%），建议加强来料前自检、重点工序确认及出货前全检。`);
    } else if (avgDefRate != null && avgDefRate >= 5) {
      lines.push(`平均不良率 ${avgDefRate.toFixed(1)}%，处于黄色警戒区间，建议持续关注并优化生产工序。`);
    } else if (avgDefRate != null) {
      lines.push(`平均不良率 ${avgDefRate.toFixed(1)}%，处于正常范围，请持续保持质量稳定性。`);
    }
    if (defects.length > 0) {
      const topDef = defects.slice(0, 3).map(([d]) => d).join('、');
      lines.push(`主要不良类型为：${topDef}，建议优先针对以上问题制定改善方案。`);
    }
    return lines;
  }

  /* ── 单元格颜色辅助（附录全部明细，与 REJ 明细共用规则） ── */
  const rateColor = r => {
    if (r.sampleQty == null || r.sampleQty === 0 || !r.defectRate) return '#999';
    const n = parseFloat((r.defectRate || '0').replace('%', ''));
    return n >= 15 ? '#d93025' : n >= 5 ? '#d4870b' : '#12a068';
  };
  const rateText = r => {
    if (r.sampleQty == null || r.sampleQty === 0 || !r.defectRate) {
      return '<span style="color:#999">—</span>';
    }
    return r.defectRate;
  };

  /* ── 公共表头 ── */
  const detailThead = `<thead><tr>
    <th>日期</th><th>客户</th><th>货号</th><th>款式</th>
    <th>来料数</th><th>抽查数</th><th>FAIL数</th><th>不良率</th><th>不良现象</th><th>判定</th>
  </tr></thead>`;

  const allRow = r => `<tr>
    <td style="font-size:10px;color:#666;white-space:nowrap">${r.date}</td>
    <td style="font-size:10px">${r.client || '-'}</td>
    <td style="font-size:10px">${r.productNo || '-'}</td>
    <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis;font-size:10px">${r.productName || '-'}</td>
    <td style="text-align:right">${(r.qty || 0).toLocaleString()}</td>
    <td style="text-align:right">${r.sampleQty != null ? r.sampleQty : '—'}</td>
    <td style="text-align:right;color:${(r.fail||0)>0?'#d93025':'#aaa'};font-weight:${(r.fail||0)>0?'700':'400'}">${r.fail || 0}</td>
    <td style="text-align:right;font-weight:600;color:${rateColor(r)}">${rateText(r)}</td>
    <td style="font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis" title="${r.defect||''}">${r.defect || '-'}</td>
    <td>${_badge(r.result)}</td>
  </tr>`;

  /* ── 风险等级 ── */
  const riskLevel = parseFloat(failRate) >= 15 ? 'high' : parseFloat(failRate) >= 5 ? 'mid' : 'low';
  const riskLabel = { high:'高风险', mid:'风险', low:'正常' }[riskLevel];
  const riskColor = { high:'#d93025', mid:'#d4870b', low:'#12a068' }[riskLevel];

  /* ══════════════════════════════════════
     构建 HTML 画布
  ══════════════════════════════════════ */
  const div = document.createElement('div');
  div.id = 'rpt-canvas';

  div.innerHTML = `

    <!-- ▌PAGE 1  报告头 + KPI + 三栏分析 ▌-->
    <div class="rpt-header">
      <div>
        <div class="rpt-co-name">东莞兴信塑胶制品有限公司</div>
        <div class="rpt-doc-type">供 应 商 质 量 报 告</div>
        <div style="font-size:12px;color:#2c6ca3;margin-top:4px;font-weight:600">
          供应商：${supplierName}
        </div>
      </div>
      <div class="rpt-doc-no">
        <div><strong>统计周期：</strong>${firstDate} ～ ${lastDate}</div>
        <div><strong>文件编号：</strong>${docNo}</div>
        <div><strong>编制部门：</strong>品质管理部</div>
        <div><strong>导出日期：</strong>${_todayStr()}</div>
      </div>
    </div>

    <!-- KPI 7格 -->
    <div class="rpt-kpi-row cols-4" style="margin-bottom:12px">
      <div class="rpt-kpi blue">
        <div class="rpt-kpi-label">验货批次</div>
        <div class="rpt-kpi-value blue">${total}</div>
        <div class="rpt-kpi-sub">来料 ${totalQty.toLocaleString()} 件</div>
      </div>
      <div class="rpt-kpi green">
        <div class="rpt-kpi-label">PASS 批次</div>
        <div class="rpt-kpi-value green">${passCnt}</div>
        <div class="rpt-kpi-sub">占比 ${passRate}%</div>
      </div>
      <div class="rpt-kpi ${failCnt > 0 ? 'red' : 'green'}">
        <div class="rpt-kpi-label">REJ / FAIL 批次</div>
        <div class="rpt-kpi-value ${failCnt > 0 ? 'red' : 'green'}">${failCnt}</div>
        <div class="rpt-kpi-sub">批次退货率 ${failRate}%</div>
      </div>
      <div class="rpt-kpi ${avgDefRate != null ? (avgDefRate >= 15 ? 'red' : avgDefRate >= 5 ? 'yellow' : 'green') : 'grey'}">
        <div class="rpt-kpi-label">平均不良率</div>
        <div class="rpt-kpi-value ${avgDefRate != null ? (avgDefRate >= 15 ? 'red' : avgDefRate >= 5 ? 'yellow' : 'green') : ''}">
          ${avgDefRate != null ? avgDefRate.toFixed(1) + '%' : '—'}
        </div>
        <div class="rpt-kpi-sub">${withRate > 0 ? `${withRate}批有抽查` : '无抽查数据'}</div>
      </div>
    </div>
    <div class="rpt-kpi-row cols-4" style="margin-bottom:14px">
      <div class="rpt-kpi ${hiRiskBatch.length > 0 ? 'red' : 'green'}">
        <div class="rpt-kpi-label">高风险批次（≥15%）</div>
        <div class="rpt-kpi-value ${hiRiskBatch.length > 0 ? 'red' : 'green'}">${hiRiskBatch.length}</div>
        <div class="rpt-kpi-sub">${hiRiskBatch.length ? '需重点改善' : '无高风险批次'}</div>
      </div>
      <div class="rpt-kpi ${riskLevel === 'high' ? 'red' : riskLevel === 'mid' ? 'yellow' : 'green'}">
        <div class="rpt-kpi-label">综合风险等级</div>
        <div class="rpt-kpi-value" style="color:${riskColor};font-size:18px;font-weight:700">${riskLabel}</div>
        <div class="rpt-kpi-sub">基于批次退货率</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">不良类型数</div>
        <div class="rpt-kpi-value">${defects.length}</div>
        <div class="rpt-kpi-sub">${defects[0] ? 'TOP：' + defects[0][0] : '无不良记录'}</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">客户数量</div>
        <div class="rpt-kpi-value">${clientList.length}</div>
        <div class="rpt-kpi-sub">${clientList.slice(0,2).map(c=>c.name).join('、') || '—'}</div>
      </div>
    </div>

    <!-- 三栏：趋势 + TOP不良 + 客户/PASS分布 -->
    <!-- 说明：平均不良率仅统计 sampleQty 有效的批次 -->
    <div style="font-size:9.5px;color:#888;margin-bottom:6px;padding:4px 8px;background:#f7fafd;border:1px solid #d0e3f0;border-radius:3px">
      ℹ 平均不良率仅统计有有效抽查数量的批次（sampleQty ≠ null）；无抽查数量的批次不参与平均不良率计算。
      ${withAppendix ? '' : '<span style="margin-left:12px;color:#d4870b">★ 管理版（未含全部明细附录）</span>'}
    </div>
    <div class="rpt-three-col" style="margin-bottom:14px">

      <!-- 趋势图 -->
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="rpt-section">
          <div class="rpt-section-title">每周 REJ 批次趋势</div>
          <div class="rpt-trend-wrap" style="padding:6px">
            ${_svgLine(weekFail.map(Number), 266, 50, '#d93025')}
            <div style="display:flex;justify-content:space-between;padding:0 6px">
              ${weeks.map((_,i) => `<span style="font-size:8px;color:#bbb">W${i+1}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="rpt-section">
          <div class="rpt-section-title">每周平均不良率趋势</div>
          <div class="rpt-trend-wrap" style="padding:6px">
            ${_svgLine(weekRate, 266, 50, '#d4870b')}
            <div style="display:flex;justify-content:space-between;padding:0 6px">
              ${weeks.map((_,i) => `<span style="font-size:8px;color:#bbb">W${i+1}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- TOP 不良 -->
      <div class="rpt-section">
        <div class="rpt-section-title">不良类型 TOP</div>
        ${defects.length === 0
          ? '<div style="color:#999;font-size:11px;padding:12px 0;text-align:center">本期无不良记录</div>'
          : defects.slice(0, 8).map(([name, cnt]) => {
              const pct    = Math.round(cnt / maxDef * 100);
              const isRisk = ['大小眼','斜眼','大小脚','形状不良','爆口'].includes(name);
              return `<div class="rpt-defect-item">
                <div class="rpt-defect-name">${name}</div>
                <div class="rpt-defect-bar-wrap">
                  <div class="rpt-defect-bar${isRisk ? ' risk' : ''}" style="width:${pct}%"></div>
                </div>
                <div class="rpt-defect-cnt">${cnt}次</div>
              </div>`;
            }).join('')
        }
        ${defects.length > 0
          ? `<div style="font-size:9px;color:#bbb;margin-top:4px;text-align:right">
               合计 ${defects.reduce((s,[,c])=>s+c, 0)} 次 · ${defects.length} 类型
             </div>` : ''}
      </div>

      <!-- PASS/REJ 分布 + 客户占比 -->
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="rpt-section">
          <div class="rpt-section-title">PASS / REJ 分布</div>
          <div style="display:flex;align-items:center;gap:12px">
            ${_svgPie([
                { value: passCnt, name: 'PASS',  itemStyle: { color: '#12a068' } },
                { value: failCnt, name: 'REJ',   itemStyle: { color: '#d93025' } },
              ].filter(d => d.value > 0), 72)}
            <div style="font-size:10px;color:#444;line-height:2">
              <div><span style="display:inline-block;width:8px;height:8px;background:#12a068;border-radius:50%;margin-right:4px;vertical-align:middle"></span>PASS ${passCnt} 批 (${passRate}%)</div>
              <div><span style="display:inline-block;width:8px;height:8px;background:#d93025;border-radius:50%;margin-right:4px;vertical-align:middle"></span>REJ ${failCnt} 批 (${failRate}%)</div>
            </div>
          </div>
        </div>
        <div class="rpt-section">
          <div class="rpt-section-title">客户分布</div>
          <div style="display:flex;align-items:center;gap:10px">
            ${_svgPie(clientList, 60)}
            <div class="rpt-pie-legend">
              ${clientList.map(c => `
                <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#444">
                  <span class="rpt-pie-dot" style="background:${c.color}"></span>
                  ${c.name} ${(c.value / total * 100).toFixed(0)}%
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ▌PAGE 2  REJ明细 + 整改建议 + 结论 ▌-->

    <!-- REJ 批次明细 -->
    ${rejData.length > 0 ? `
    <div class="rpt-section" style="margin-bottom:12px">
      <div class="rpt-section-title">REJ 批次明细（共 ${rejData.length} 批）</div>
      <table class="rpt-table">
        ${detailThead}
        <tbody>${rejData.map(allRow).join('')}</tbody>
      </table>
    </div>` : `
    <div class="rpt-section" style="margin-bottom:12px">
      <div style="background:#f0faf5;border:1px solid #a7e6cc;border-radius:4px;padding:12px 16px;font-size:12px;color:#0a7a4e;font-weight:600">
        ✓ 本统计周期内无 REJ 批次，所有来料均通过检验
      </div>
    </div>`}

    <!-- 整改建议 -->
    ${defects.length > 0 ? `
    <div class="rpt-section" style="margin-bottom:12px">
      <div class="rpt-section-title">主要问题 &amp; 建议改善方向</div>
      <table class="rpt-table">
        <thead><tr><th>不良类型</th><th style="text-align:center">出现次数</th><th style="text-align:right">频率</th><th>建议改善方向</th></tr></thead>
        <tbody>
          ${defects.slice(0, 6).map(([d, cnt]) => `<tr>
            <td><strong>${d}</strong></td>
            <td style="text-align:center">${cnt}</td>
            <td style="text-align:right;color:#666">${(cnt/total*100).toFixed(1)}%</td>
            <td style="font-size:10px;color:#555">${SUGGEST[d] || '持续监控，加强巡检频次'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <!-- 结论与建议 -->
    <div class="rpt-conclusion" style="margin-bottom:14px">
      <div class="rpt-conclusion-title">结论与建议</div>
      <ul>
        ${_autoConclusion().map(line => `<li>${line}</li>`).join('')}
        ${failCnt > 0 && defects.length > 0 ? `<li>建议供应商针对 TOP 不良现象提交 8D 报告，并在下次交货前完成改善验证。</li>` : ''}
      </ul>
    </div>

    <!-- 页脚 -->
    <div class="rpt-footer">
      <div class="rpt-sigs">
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>制表人</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>品质主管审核</div></div>
        <div class="rpt-sig-item"><div class="rpt-sig-line"></div><div>部门经理批准</div></div>
      </div>
      <div style="text-align:right">
        <div>东莞兴信塑胶制品有限公司 · 品质管理部</div>
        <div style="margin-top:2px">生成时间：${new Date().toLocaleString('zh-CN')}</div>
      </div>
    </div>

    <!-- ▌附录（仅勾选"包含全部明细附录"时追加）▌-->
    ${withAppendix && total > 0 ? `
    <div style="margin-top:28px;padding-top:16px;border-top:2px dashed #d0e3f0">
      <div class="rpt-header" style="margin-bottom:10px">
        <div>
          <div class="rpt-co-name" style="font-size:14px">东莞兴信塑胶制品有限公司</div>
          <div class="rpt-doc-type" style="font-size:11px">附录：供应商验货全部明细 · ${supplierName}</div>
        </div>
        <div class="rpt-doc-no" style="font-size:10px">
          <div>共 <strong>${total}</strong> 批次 · PASS <span style="color:#12a068;font-weight:700">${passCnt}</span> · REJ <span style="color:#d93025;font-weight:700">${failCnt}</span></div>
        </div>
      </div>
      <table class="rpt-table">
        ${detailThead}
        <tbody>${data.sort((a,b) => a.date.localeCompare(b.date)).map(allRow).join('')}</tbody>
        <tfoot>
          <tr style="background:#f0f7ff">
            <td colspan="4" style="font-weight:700;color:#1a3a5c;font-size:10px">合计 ${total} 批</td>
            <td style="text-align:right;font-weight:700">${totalQty.toLocaleString()}</td>
            <td colspan="5" style="font-size:10px;color:#666">
              PASS ${passCnt} · REJ ${failCnt} · 平均不良率 ${avgDefRate != null ? avgDefRate.toFixed(1)+'%' : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
      <div class="rpt-footer" style="margin-top:10px">
        <div style="font-size:10px;color:#999">附录由系统自动生成</div>
        <div style="font-size:10px;color:#999">生成时间：${new Date().toLocaleString('zh-CN')}</div>
      </div>
    </div>` : ''}`;
  return div;
}

/* ═══════════════════════════════════════════════════
   §D  单批次 IQC 检验报告 PDF 导出
   ───────────────────────────────────────────────────
   exportIQCReport(recordId)  — 入口，按 id 查找记录
   _buildIQCCanvas(record)    — 构建 A4 纵向白底画布
═══════════════════════════════════════════════════ */

/* AQL 抽样表配置 */
const IQC_AQL_TABLE = [
  { range:'1–50',        rangeMax:50,     sample:20,  cr:0, maj065:0, maj10:1, min25:1, func_sample:20,  m065:0 },
  { range:'51–280',      rangeMax:280,    sample:32,  cr:0, maj065:0, maj10:2, min25:3, func_sample:32,  m065:1 },
  { range:'281–500',     rangeMax:500,    sample:50,  cr:0, maj065:1, maj10:2, min25:5, func_sample:50,  m065:1 },
  { range:'501–1200',    rangeMax:1200,   sample:80,  cr:0, maj065:1, maj10:3, min25:7, func_sample:80,  m065:2 },
  { range:'1201–3200',   rangeMax:3200,   sample:125, cr:0, maj065:2, maj10:5, min25:10,func_sample:125, m065:3 },
  { range:'3201–10000',  rangeMax:10000,  sample:200, cr:0, maj065:3, maj10:7, min25:14,func_sample:200, m065:5 },
  { range:'10001–35000', rangeMax:35000,  sample:315, cr:0, maj065:5, maj10:10,min25:21,func_sample:315, m065:7 },
  { range:'35001–150000',rangeMax:999999, sample:500, cr:0, maj065:7, maj10:14,min25:21,func_sample:500, m065:10},
];

function _iqcGetRow(qty) {
  for (const row of IQC_AQL_TABLE) {
    if ((qty||0) <= row.rangeMax) return row;
  }
  return IQC_AQL_TABLE[IQC_AQL_TABLE.length - 1];
}

/* ── 入口 ── */
async function exportIQCReport(recordId) {
  const missing = _rptCheckDeps();
  if (missing.length) {
    showToast('PDF 库未加载：' + missing.join('、') + '，请检查网络后刷新', 'error');
    return;
  }

  const allData = _getData();
  const record  = allData.find(r => r.id === recordId);
  if (!record) {
    showToast('找不到该记录（id=' + recordId + '）', 'error');
    return;
  }

  _rptShowOverlay('正在生成 IQC 检验报告…', '构建版面');

  try {
    await new Promise(r => requestAnimationFrame(r));

    const canvas = _buildIQCCanvas(record);
    document.body.appendChild(canvas);
    await new Promise(r => setTimeout(r, 100));

    _rptUpdateOverlay('正在截图渲染…', '转换为图像');

    const imgCanvas = await html2canvas(canvas, {
      scale:           2,
      useCORS:         true,
      allowTaint:      true,
      backgroundColor: '#ffffff',
      logging:         false,
      windowWidth:     canvas.offsetWidth,
      windowHeight:    canvas.offsetHeight,
      scrollX: 0, scrollY: 0, x: 0, y: 0,
    });

    document.body.removeChild(canvas);
    _rptUpdateOverlay('正在生成 PDF…', '写入文件');

    /* A4 纵向 */
    const jspdfClass = window.jspdf ? window.jspdf.jsPDF : jsPDF;
    const pdf = new jspdfClass({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageW   = pdf.internal.pageSize.getWidth();   /* 210 mm */
    const pageH   = pdf.internal.pageSize.getHeight();  /* 297 mm */
    const imgW    = imgCanvas.width;
    const imgH    = imgCanvas.height;
    const ratio   = pageW / imgW;
    const scaledH = imgH * ratio;
    const imgData = imgCanvas.toDataURL('image/jpeg', 0.96);

    /* IQC 强制单页：内容刚好放下时正常放置；
       若略超（浮点误差或内容小幅溢出），按比例等比缩放整图到一页内，
       彻底杜绝空白第二页或残页 */
    if (scaledH <= pageH) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, scaledH);
    } else {
      /* 等比缩放：按高度匹配 pageH，宽度居中 */
      const fitRatio = pageH / scaledH;
      const fitW     = pageW * fitRatio;
      const fitH     = pageH;
      const offsetX  = (pageW - fitW) / 2;
      pdf.addImage(imgData, 'JPEG', offsetX, 0, fitW, fitH);
    }

    /* 文件名 */
    const supplier  = (record.supplier  || '供应商').replace(/[/\\:*?"<>|]/g, '');
    const productNo = (record.productNo || '').replace(/[/\\:*?"<>|]/g, '');
    const dateStr   = (record.date || _todayStr()).replace(/-/g, '');
    pdf.save(`IQC检验报告_${supplier}_${productNo}_${dateStr}.pdf`);

    _rptHideOverlay();
    showToast(`✓ IQC检验报告_${supplier}_${dateStr}.pdf 已生成`, 'success');

  } catch (err) {
    console.error('[exportIQCReport]', err);
    _rptHideOverlay();
    showToast('IQC报告生成失败：' + err.message, 'error');
  } finally {
    const old = document.getElementById('iqc-canvas');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
}

/* ── 构建 IQC 画布 ── */
function _buildIQCCanvas(r) {

  /* ── 空值降级 ── */
  const supplier    = r.supplier    || '—';
  const productNo   = r.productNo   || '—';
  const productName = r.productName || '—';
  const date        = r.date        || '—';
  const inspDate    = r.inspDate    || r.date || '—';
  const qty         = r.qty         != null ? r.qty    : '—';
  const sampleQty   = r.sampleQty   != null ? r.sampleQty : '—';
  const deliveryNo  = r.deliveryNo  || '—';
  const qc          = r.qc || r.inspector || r.checker || '—';

  /* ── 解析不良现象：支持 "描述N个/PCS" 格式 ── */
  function parseDefectItems(text) {
    const raw = String(text || '').trim();
    if (!raw || raw === '-' || raw === '—') return [];
    const INV = new Set(['-','—','——','无','无不良','暂无','正常','合格','pass','ok','0']);
    const items = [];
    const parts = raw.replace(/[，；;]/g, ',').split(',').map(s => s.trim()).filter(Boolean);
    const re = /^(.+?)(\d+)\s*(个|pcs|PCS|pc|PC|件|只)?$/;
    for (const p of parts) {
      if (INV.has(p.toLowerCase())) continue;
      if (/^[\d.]+%?$/.test(p)) continue;
      const m = p.match(re);
      if (m) {
        items.push({ desc: m[1].trim(), qty: Number(m[2]), level:'MAJ065', raw: p });
      } else {
        /* 无数字：desc 放全文，qty=0 表示数量未知 */
        items.push({ desc: p, qty: 0, level:'MAJ065', raw: p });
      }
    }
    return items;
  }

  /* ── 判定（measurements 有 FAIL 时强制 REJ）── */
  const resultRaw   = (r.result || '').toUpperCase();
  const hasMeasFail = Array.isArray(r.measurements) &&
    r.measurements.some(m => String(m.result || '').toUpperCase() === 'FAIL');
  const _isP = !hasMeasFail && (resultRaw === 'PASS' || resultRaw === 'OK');
  const _isR = hasMeasFail || resultRaw === 'REJ' || resultRaw === 'FAIL' || resultRaw === 'NG';
  const _isC = !hasMeasFail && resultRaw === 'COND';

  /* ── 解析不良 ── */
  const defectItems = _isP ? [] : parseDefectItems(r.defect);
  /* fail 数：优先用结构化 defects，其次用解析文本，最后用 record.fail */
  const defectsFail = Array.isArray(r.defects) && r.defects.length > 0
    ? r.defects.reduce((s,d) => s+(Number(d.qty)||0), 0)
    : 0;
  const parsedFail  = defectItems.reduce((s,d) => s + (d.qty||0), 0);
  const fail        = defectsFail > 0 ? defectsFail
                      : parsedFail > 0 ? parsedFail
                      : (r.fail || 0);
  const pass        = r.pass != null ? r.pass
                      : (r.sampleQty != null ? Math.max(0, r.sampleQty - fail) : '—');

  /* ── Report No. ── */
  const dateDigits = (r.date || _todayStr()).replace(/-/g, '');
  const suffix     = r.deliveryNo || String(r.id).padStart(7, '0');
  const reportNo   = `IQC-${dateDigits}-${suffix}`;

  /* ── AQL 行 ── */
  const aqlRow = _iqcGetRow(r.qty);

  /* ── 固定 9 行检验状况 ── */
  const MAX_ROWS = 9;
  let defRows;

  /* 兼容等级字符串 → 标准 key（report_export 内部版）*/
  function _nl(lv) {
    if (!lv) return '';
    const s = String(lv).toUpperCase().replace(/\s/g, '');
    if (s === 'CR') return 'CR';
    if (s.includes('0.65') || s.includes('065')) return 'MAJ065';
    if (s.includes('1.0')  || s === 'MAJ10')     return 'MAJ10';
    if (s.includes('2.5')  || s === 'MIN25' || s === 'MIN') return 'MIN25';
    return '';
  }

  /* ★ 最优先：有结构化 defects 明细时，不论 result，都展示明细
     只有真正无任何不良时才显示"未发现不良" */
  if (Array.isArray(r.defects) && r.defects.length > 0) {
    const validDefs = r.defects.filter(d => d.desc || d.qty > 0);
    const toDef = d => {
      const nk  = _nl(d.level);
      const qty = Number(d.qty) || 0;
      return {
        desc:     d.desc || '',
        category: d.category || '外观/质量',
        cr:    nk === 'CR'     ? qty : 0,
        maj:   nk === 'MAJ065' ? qty : 0,
        maj10: nk === 'MAJ10'  ? qty : 0,
        min:   nk === 'MIN25'  ? qty : 0,
        remark: d.remark || '',
      };
    };
    if (validDefs.length === 0) {
      defRows = [{ desc:'未发现不良', category:'', cr:0, maj:0, maj10:0, min:0, remark:'' }];
    } else if (validDefs.length <= MAX_ROWS) {
      defRows = validDefs.map(toDef);
    } else {
      defRows = validDefs.slice(0, MAX_ROWS - 1).map(toDef);
      defRows.push({ desc:'其余不良明细请见系统记录', category:'', cr:0, maj:0, maj10:0, min:0, remark:'' });
    }

  } else if (_isP) {
    /* PASS 且无 defects：显示未发现不良 */
    defRows = [{ desc:'未发现不良', category:'', cr:0, maj:0, maj10:0, min:0, remark:'' }];

  } else if (defectItems.length > 0) {
    /* 兼容：旧文本解析（parseDefectItems）*/
    const toDef = d => ({
      desc:     d.desc,
      category: '',
      cr:     d.level==='CR'     ? d.qty : 0,
      maj:    d.level==='MAJ065' ? d.qty : 0,
      maj10:  d.level==='MAJ10'  ? d.qty : 0,
      min:    d.level==='MIN25'  ? d.qty : 0,
      remark: d.raw,
    });
    if (defectItems.length <= MAX_ROWS) {
      defRows = defectItems.map(toDef);
    } else {
      defRows = defectItems.slice(0, MAX_ROWS - 1).map(toDef);
      defRows.push({ desc:'其余不良见备注', category:'', cr:0, maj:0, maj10:0, min:0, remark:'请参阅检验员备注' });
    }

  } else {
    /* 没有任何不良数据：一行显示 defect 文本或破折号 */
    const rawDesc = r.defect || '—';
    defRows = [{ desc: rawDesc, category:'', cr:0, maj: fail, min:0, remark: rawDesc }];
  }

  /* 补足空行 */
  while (defRows.length < MAX_ROWS) {
    defRows.push({ desc:'', category:'', cr:0, maj:0, maj10:0, min:0, remark:'' });
  }

  const sumCR    = defRows.reduce((s,d) => s+(d.cr||0), 0);
  const sumMAJ   = defRows.reduce((s,d) => s+(d.maj||0), 0);
  const sumMAJ10 = defRows.reduce((s,d) => s+(d.maj10||0), 0);
  const sumMIN   = defRows.reduce((s,d) => s+(d.min||0), 0);
  const sumFail  = sumCR + sumMAJ + sumMAJ10 + sumMIN || fail;

  /* ── 抽查数量（用于备注栏百分比） ── */
  const sampleQtyNum = Number(r.sampleQty != null ? r.sampleQty : 0);

  /* ── 每行备注：只显示百分比 ── */
  function itemPct(qty) {
    if (!qty || !sampleQtyNum) return '';
    return `${(qty / sampleQtyNum * 100).toFixed(2)}%`;
  }
  /* ── 合计备注 ── */
  const totalRemark = (() => {
    const f = sumFail || fail;
    if (!f) return _isP ? '全部合格' : '';
    const pctStr = sampleQtyNum > 0
      ? `，占比${(f/sampleQtyNum*100).toFixed(2)}%`
      : '';
    return `不合格，不良共${f}PCS${pctStr}`;
  })();

  /* ── 勾选辅助 ── */
  const ck  = (on) => `<span class="ck${on?' on':''}">${on?'✓':''}</span>`;
  const box = ()   => `<span class="ck"></span>`;   /* 始终空框 */

  /* ── 构建 HTML ── */
  const div = document.createElement('div');
  div.id = 'iqc-canvas';

  div.innerHTML = `

    <!-- ① 标题区 -->
    <div class="iqc-title-wrap">
      <div class="iqc-report-no">
        Report No.&nbsp;${reportNo}
      </div>
      <div class="iqc-co-name">东莞兴信塑胶制品有限公司</div>
      <div class="iqc-doc-title">IQC 检 验 报 告</div>
    </div>

    <!-- ② 基础资料 -->
    <table class="iqc-info">
      <colgroup>
        <col class="c-lbl"/><col class="c-val"/>
        <col class="c-lbl"/><col class="c-val"/>
        <col class="c-lbl"/><col class="c-val"/>
      </colgroup>
      <tr>
        <td class="lbl">供&ensp;应&ensp;商</td>
        <td><b>${supplier}</b></td>
        <td class="lbl">货&ensp;号&ensp;/&ensp;名称</td>
        <td>${productNo}</td>
        <td class="lbl">来&ensp;货&ensp;日&ensp;期</td>
        <td>${date}</td>
      </tr>
      <tr>
        <td class="lbl">物&ensp;料&ensp;名&ensp;称</td>
        <td colspan="3">${productName}</td>
        <td class="lbl">来&ensp;货&ensp;数&ensp;量</td>
        <td>${typeof qty==='number'?qty.toLocaleString():qty}</td>
      </tr>
      <tr>
        <td class="lbl">送&ensp;货&ensp;单&ensp;号</td>
        <td>${deliveryNo}</td>
        <td class="lbl">抽&ensp;查&ensp;数&ensp;量</td>
        <td>${sampleQty}</td>
        <td class="lbl">检&ensp;验&ensp;日&ensp;期</td>
        <td>${inspDate}</td>
      </tr>
      <tr>
        <td class="lbl">检&ensp;验&ensp;员</td>
        <td>${qc}</td>
        <td class="lbl">PASS&ensp;/&ensp;FAIL</td>
        <td colspan="3">
          PASS:&nbsp;<b>${pass}</b>&nbsp;&nbsp;/&nbsp;&nbsp;FAIL:&nbsp;<b>${fail}</b>
        </td>
      </tr>
    </table>

    <!-- ③ 检验标准 + AQL + 检验结果（单表，colgroup 精确列宽）-->
    <table class="iqc-aql-main" style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;border-left:1px solid #222;border-top:1px solid #222;font-size:9px;margin-bottom:3px">
      <colgroup>
        <col style="width:130px"/><!-- LOT SIZE -->
        <col style="width:40px"/> <!-- SAMPLE SIZE -->
        <col style="width:30px"/> <!-- CR -->
        <col style="width:36px"/> <!-- MAJ 0.65 -->
        <col style="width:36px"/> <!-- MAJ 1.0 -->
        <col style="width:36px"/> <!-- MIN 2.5 -->
        <col style="width:40px"/> <!-- FUNC SAMPLE -->
        <col style="width:36px"/> <!-- FUNC MAJ -->
        <col style="width:30px"/> <!-- FUNC RE -->
        <col style="width:120px"/><!-- 检验结果 -->
      </colgroup>
      <!-- 行0：检验标准（colspan=10）-->
      <tr>
        <td colspan="10" style="background:#c8d4e0;font-weight:700;text-align:left;padding:3px 8px;font-size:10px;letter-spacing:.3px;border-right:1px solid #222;border-bottom:1px solid #222">
          检验标准：&ensp;<b>MIL-STD-105E</b>&ensp;AQL&nbsp;LEVEL(II)
          &emsp;&emsp;${ck(true)}&nbsp;正常&ensp;${ck(false)}&nbsp;加严&ensp;${ck(false)}&nbsp;减量
        </td>
      </tr>
      <!-- 行1：AQL大标题 colspan=9 | 检验结果标题（独立td，与AQL标题行对齐）-->
      <tr>
        <td colspan="9" style="background:#c8d4e0;font-weight:700;text-align:center;padding:2px 4px;font-size:10px;letter-spacing:-0.2px;border-right:1px solid #222;border-bottom:1px solid #222">
          AQL 抽样方案（MIL-STD-105E · NORMAL&nbsp;INSPECTION · LEVEL&nbsp;II）
        </td>
        <td style="background:#c8d4e0;font-weight:700;text-align:center;padding:3px 4px;font-size:10.5px;letter-spacing:.5px;vertical-align:middle;border-right:1px solid #222;border-bottom:1px solid #222">
          检&ensp;验&ensp;结&ensp;果
        </td>
      </tr>
      <!-- 行2：LOT SIZE rowspan=2 | SAMPLE SIZE rowspan=2 | 分组 | 检验结果内容 rowspan=9 -->
      <tr>
        <td rowspan="2" style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 3px;vertical-align:middle;border-right:1px solid #222;border-bottom:1px solid #222">LOT&nbsp;SIZE</td>
        <td rowspan="2" style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 3px;vertical-align:middle;border-right:1px solid #222;border-bottom:1px solid #222">SAMPLE<br/>SIZE</td>
        <td colspan="4" style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 3px;font-size:8.5px;border-right:1px solid #222;border-bottom:1px solid #222">外观 AESTHETIC（AC）</td>
        <td colspan="3" style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 3px;font-size:8.5px;border-right:1px solid #222;border-bottom:1px solid #222">FUNC / 功能</td>
        <td rowspan="10" style="vertical-align:middle;border-right:1px solid #222;border-bottom:1px solid #222;padding:8px 6px">
          <div style="display:flex;flex-direction:column;justify-content:center;gap:8px">
            <div style="text-align:center;font-size:11px;white-space:nowrap;font-weight:${_isP?'900':'600'};${_isP?'background:#000;color:#fff;padding:5px 4px':'color:#4b5563;padding:5px 4px'}">合格</div>
            <div style="text-align:center;font-size:11px;white-space:nowrap;font-weight:${_isR?'900':'600'};${_isR?'background:#000;color:#fff;padding:5px 4px':'color:#4b5563;padding:5px 4px'}">不合格</div>
            <div style="text-align:center;font-size:11px;white-space:nowrap;font-weight:${_isC?'900':'600'};${_isC?'background:#000;color:#fff;padding:5px 4px':'color:#4b5563;padding:5px 4px'}">AOD</div>
          </div>
        </td>
      </tr>
      <!-- 行3：列头 CR/MAJ/MIN -->
      <tr>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">CR</td>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">MAJ<br/>0.65</td>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">MAJ<br/>1.0</td>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">MIN<br/>2.5</td>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">SMPL</td>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">MAJ</td>
        <td style="background:#ebebeb;font-weight:700;text-align:center;padding:2px 2px;font-size:8px;border-right:1px solid #222;border-bottom:1px solid #222">RE</td>
      </tr>
      <!-- 行4-11：数据行 -->
      ${IQC_AQL_TABLE.map(row => {
        const active = row.range === aqlRow.range;
        const base   = 'padding:2px 2px;text-align:center;vertical-align:middle;height:20px;line-height:1.2;font-size:8px;font-weight:400;border-right:1px solid #222;border-bottom:1px solid #222';
        const lotStyle = active
          ? 'padding:2px 5px;text-align:left;vertical-align:middle;height:20px;line-height:1.2;font-size:8.5px;font-weight:700;border-right:1px solid #222;border-bottom:1px solid #222;background:#000;color:#ffffff;white-space:nowrap;letter-spacing:0;word-spacing:0;font-family:Arial,sans-serif'
          : 'padding:2px 5px;text-align:left;vertical-align:middle;height:20px;line-height:1.2;font-size:8.5px;font-weight:400;border-right:1px solid #222;border-bottom:1px solid #222;background:#fff;color:#000;white-space:nowrap;letter-spacing:0;word-spacing:0';
        const lotContent = active
          ? `<span style="color:#ffffff;font-weight:700;opacity:1;filter:none;mix-blend-mode:normal;white-space:nowrap">✓ ${row.range}</span>`
          : row.range;
        const dB = active ? 'background:#fff;font-weight:600' : 'background:#fff;font-weight:400';
        return `<tr>
          <td style="${lotStyle}">${lotContent}</td>
          <td style="${base};${dB}">${row.sample}</td>
          <td style="${base};${dB}">${row.cr}</td>
          <td style="${base};${dB}">${row.maj065}</td>
          <td style="${base};${dB}">${row.maj10}</td>
          <td style="${base};${dB}">${row.min25}</td>
          <td style="${base};${dB}">${row.func_sample}</td>
          <td style="${base};${dB}">${row.m065}</td>
          <td style="${base};${dB}">${row.m065+1}</td>
        </tr>`;
      }).join('')}
    </table>

        <!-- ④ 检验状况（固定 9 行 + 合计行） -->
    <table class="iqc-defect">
      <tr class="sec-hd"><td colspan="7">检&ensp;验&ensp;状&ensp;况</td></tr>
      <tr>
        <th style="width:62px">检验项目</th>
        <th>次品描述</th>
        <th class="num-h">CR</th>
        <th class="num-h">MAJ<br/>0.65</th>
        <th class="num-h">MAJ<br/>1.0</th>
        <th class="num-h">MIN<br/>2.5</th>
        <th>简介 / 备注</th>
      </tr>
      ${defRows.map((d,i) => `<tr class="def-row">
        <td style="text-align:center;font-size:8.5px">${d.category||(i===0&&d.desc?'外观/质量':'')}</td>
        <td>${d.desc}</td>
        <td class="num">${d.cr||''}</td>
        <td class="num">${d.maj||''}</td>
        <td class="num">${d.maj10||''}</td>
        <td class="num">${d.min||''}</td>
        <td style="font-size:8.5px">${(() => {
          const pctStr = sampleQtyNum > 0 && (d.cr||d.maj||d.maj10||d.min) > 0
            ? ((d.cr||d.maj||d.maj10||d.min) / sampleQtyNum * 100).toFixed(2) + '%'
            : '';
          if (pctStr && d.remark) return pctStr + ' / ' + d.remark;
          return pctStr || d.remark || '';
        })()}</td>
      </tr>`).join('')}
      <tr class="total-row">
        <td colspan="2" style="text-align:right;padding-right:6px">合&emsp;计</td>
        <td class="num">${sumCR}</td>
        <td class="num">${sumMAJ||0}</td>
        <td class="num">${sumMAJ10||0}</td>
        <td class="num">${sumMIN||0}</td>
        <td style="font-size:8.5px">${totalRemark}</td>
      </tr>
    </table>

    <!-- ⑤ 测量项目（优先读取 r.measurements，否则空白行）-->
    <table class="iqc-meas" style="table-layout:fixed;width:758px;border-collapse:separate;border-spacing:0;border-left:1px solid #222;border-top:1px solid #222">
      <colgroup>
        <col style="width:55px"/> <!-- 测量项目 -->
        <col style="width:88px"/> <!-- 标准值 -->
        <col style="width:60px"/><col style="width:60px"/> <!-- 1-2 -->
        <col style="width:60px"/><col style="width:60px"/> <!-- 3-4 -->
        <col style="width:60px"/><col style="width:60px"/> <!-- 5-6 -->
        <col style="width:60px"/><col style="width:60px"/> <!-- 7-8 -->
        <col style="width:88px"/> <!-- 平均值 -->
        <col style="width:47px"/> <!-- 判定 -->
      </colgroup>
      <tr class="sec-hd">
        <td colspan="12" style="font-size:9px;border-right:1px solid #222;border-bottom:1px solid #222">尺寸 / 测量项目</td>
      </tr>
      <tr>
        <th style="font-size:7px;text-align:center;vertical-align:middle;line-height:1.2;border-right:1px solid #222;border-bottom:1px solid #222">测量项目</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">标准值</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">1</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">2</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">3</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">4</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">5</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">6</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">7</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">8</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">平均值</th>
        <th style="font-size:7px;border-right:1px solid #222;border-bottom:1px solid #222">判定</th>
      </tr>
      ${(() => {
        /* 格式化：整数不留小数，小数最多1位 */
        function _fmt(v) {
          const n=parseFloat(v); if(isNaN(n)) return v||'';
          return Number.isInteger(n)?String(n):n.toFixed(1);
        }
        function _ra(arr) {
          const f=(arr||[]).filter(v=>v!=='');
          const n=f.map(Number).filter(x=>!isNaN(x));
          return (n.length>0&&n.length===f.length)
            ?(n.reduce((a,b)=>a+b,0)/n.length).toFixed(1):null;
        }
        function _stdTol(std,tol) {
          const s=(std||'').trim(),t=(tol||'').trim();
          return s&&t?`${_fmt(s)}±${_fmt(t)}`:_fmt(s)||'';
        }
        /* 竖排多行 div 显示 */
        function _lines(...vals) {
          const items = vals.filter(v=>v!==null&&v!==undefined&&v!=='');
          if (!items.length) return '&nbsp;';
          return items.map(v=>`<div style="line-height:7.8px;font-size:6.0px">${v}</div>`).join('');
        }
        /* 通用 td 样式：padding 0，自然高度，white-space:normal */
        const BR  = 'border-right:1px solid #222;border-bottom:1px solid #222;';
        const TDB = 'vertical-align:middle;box-sizing:border-box;padding:2px 3px;text-align:center;'+BR;
        const TDBL= 'vertical-align:middle;box-sizing:border-box;padding:2px 3px;text-align:center;line-height:1.2;'+BR;
        /* 空白行 td（固定高度 26px，&nbsp; 保持撑开）*/
        const E_H = 'height:27px;line-height:27px;'+TDB;
        const emptyTd  = `<td style="${E_H}">&nbsp;</td>`;
        const emptyRow = `<tr class="meas-row empty">${Array(12).fill(emptyTd).join('')}</tr>`;

        function _dvLines(m) {
          const mt=m.measureType||'single';
          /* 每格返回 { stdLines, valLines[8], avgLines } */
          if (mt==='PF') {
            const vs=[...(m.values||[]),...Array(8).fill('')].slice(0,8);
            return {
              stdLines: _lines(m.standard||'P/F'),
              valLines: vs.map(v=>v?`<div style="line-height:7.8px;font-size:6.0px">${v}</div>`:'&nbsp;'),
              avgLines: _lines('—'),
            };
          }
          if (mt==='LW') {
            const L=m.lValues||[],W=m.wValues||[];
            return {
              stdLines: _lines(_stdTol(m.standardL,m.toleranceL),_stdTol(m.standardW,m.toleranceW)),
              valLines: Array.from({length:8},(_,j)=>_lines(_fmt(L[j]||''),_fmt(W[j]||''))),
              avgLines: _lines(_ra(L)||'—', _ra(W)||'—'),
            };
          }
          if (mt==='LWH') {
            const L=m.lValues||[],W=m.wValues||[],H=m.hValues||[];
            return {
              stdLines: _lines(_stdTol(m.standardL,m.toleranceL),_stdTol(m.standardW,m.toleranceW),_stdTol(m.standardH,m.toleranceH)),
              valLines: Array.from({length:8},(_,j)=>_lines(_fmt(L[j]||''),_fmt(W[j]||''),_fmt(H[j]||''))),
              avgLines: _lines(_ra(L)||'—', _ra(W)||'—', _ra(H)||'—'),
            };
          }
          /* single */
          const vs=[...(m.values||[]),...Array(8).fill('')].slice(0,8).map(v=>v?_fmt(v):'');
          const rawAvg=m.avg||_ra(m.values||[])||'—';
          return {
            stdLines: _lines(_stdTol(m.standard,m.tolerance)||m.standard||''),
            valLines: vs.map(v=>v?`<div style="line-height:7.8px;font-size:6.0px">${v}</div>`:'&nbsp;'),
            avgLines: _lines(rawAvg==='—'?'—':_fmt(rawAvg)),
          };
        }

        const meas=Array.isArray(r.measurements)
          ?r.measurements.filter(m=>m.item||(m.lValues||m.values)?.some(v=>v!==''))
          :[];
        const rd=meas.slice(0,2).map(m=>{
          const {stdLines,valLines,avgLines}=_dvLines(m);
          const rc=m.result==='FAIL'?'#dc2626':m.result==='PASS'?'#059669':'#000';
          return `<tr class="meas-row">
            <td style="${TDBL}font-size:5.8px">${m.item||'&nbsp;'}</td>
            <td style="${TDB}">${stdLines}</td>
            ${valLines.map(v=>`<td style="${TDB}">${v}</td>`).join('')}
            <td style="${TDB}">${avgLines}</td>
            <td style="${TDB}font-size:6.5px;font-weight:700;color:${rc}">${m.result||'&nbsp;'}</td>
          </tr>`;
        });
        while(rd.length<2) rd.push(emptyRow);
        return rd.join('');
      })()}
    </table>    </table>

    <!-- ⑥ 来料不合格处理意见（全空框） -->
    <table class="iqc-dispose">
      <tr class="sec-hd"><td colspan="2">来&ensp;料&ensp;不&ensp;合&ensp;格&ensp;处&ensp;理&ensp;意&ensp;见</td></tr>
      <tr>
        <td class="lbl" style="width:68px">处&ensp;理&ensp;方&ensp;式</td>
        <td style="padding:3px 10px;white-space:nowrap">
          <span style="display:inline-flex;align-items:center;margin-right:24px;white-space:nowrap">${box()}<span style="margin-left:5px">退货</span></span>
          <span style="display:inline-flex;align-items:center;margin-right:24px;white-space:nowrap">${box()}<span style="margin-left:5px">让步接收（特采）</span></span>
          <span style="display:inline-flex;align-items:center;margin-right:24px;white-space:nowrap">${box()}<span style="margin-left:5px">挑选使用</span></span>
          <span style="display:inline-flex;align-items:center;white-space:nowrap">${box()}<span style="margin-left:5px">正常使用</span></span>
        </td>
      </tr>
      <tr>
        <td class="lbl">处&ensp;理&ensp;说&ensp;明</td>
        <td style="height:18px;font-size:8.5px;color:#888;padding:2px 8px">&nbsp;</td>
      </tr>
    </table>

    <!-- ⑦ 签核区 -->
    <table class="iqc-sign-tbl">
      <tr class="sec-hd"><td colspan="6">签&emsp;&emsp;核</td></tr>
      <tr>
        <td class="sign-cell">
          <div class="sign-lbl">检验员 / IQC</div>
          <div class="sign-line">${qc!=='—'?qc:''}</div>
        </td>
        <td class="sign-cell">
          <div class="sign-lbl">品质部</div>
          <div class="sign-line"></div>
        </td>
        <td class="sign-cell">
          <div class="sign-lbl">业务部</div>
          <div class="sign-line"></div>
        </td>
        <td class="sign-cell">
          <div class="sign-lbl">工程部</div>
          <div class="sign-line"></div>
        </td>
        <td class="sign-cell">
          <div class="sign-lbl">生产部</div>
          <div class="sign-line"></div>
        </td>
        <td class="sign-cell">
          <div class="sign-lbl">副 / 总经理批准</div>
          <div class="sign-line"></div>
        </td>
      </tr>
    </table>

`;

  return div;
}




