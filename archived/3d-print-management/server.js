const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const tls = require('tls');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
// Docker 部署时数据/配置放 DATA_PATH（bind mount），本地运行默认当前目录
const DATA_DIR = process.env.DATA_PATH || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const HTML_FILE = path.join(__dirname, 'index.html');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SYNC_STATE_FILE = path.join(DATA_DIR, 'sync-state.json');
let dataVersion = Date.now();

// 首次启动：用示例数据初始化 data.json（幂等，不覆盖已有数据）
if (!fs.existsSync(DATA_FILE)) {
  try {
    fs.copyFileSync(path.join(__dirname, 'data.example.json'), DATA_FILE);
    console.log('[初始化] 已从 data.example.json 生成初始 data.json');
  } catch (e) {
    console.warn('[初始化] 无 data.example.json 可复制，将从空数据开始');
  }
}

// 生成唯一ID
function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// 为所有记录 item 分配 _id 和 _updatedAt（数据迁移）
function ensureItemIds() {
  const data = _cachedData ? _cachedData : loadData();
  let changed = false;
  if (data.records) {
    for (const dateStr of Object.keys(data.records)) {
      const day = data.records[dateStr];
      if (!day.items) continue;
      for (const item of day.items) {
        if (!item._id) {
          item._id = generateId();
          changed = true;
        }
        if (!item._updatedAt) {
          item._updatedAt = Date.now();
          changed = true;
        }
      }
    }
  }
  if (changed) {
    console.log('[迁移] 已为现有记录分配 _id 和 _updatedAt');
    saveData(data);
  }
}

// 加载打印机配置（凭据从 config.json 读取，不再硬编码在源代码中）
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    // 首次运行：生成默认配置（空打印机列表 + 随机管理员密码），然后提示用户
    const defaultConfig = {
      auth: { username: 'admin', password: crypto.randomBytes(9).toString('base64url') },
      bambuPrinters: [],
      flashForgePrinters: [],
      sync: {
        enabled: false,
        serverId: 'server-A',
        peer: { host: '', port: 3000 },
        intervalMs: 30000
      }
    };
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.warn('[安全] 未找到 config.json，已生成默认配置。随机管理员密码: ' + defaultConfig.auth.password);
      console.warn('[安全] 请记录密码并编辑 config.json 填入真实的打印机凭据。');
    } catch (writeErr) {
      console.error('[错误] 无法写入默认配置文件:', writeErr.message);
    }
    return defaultConfig;
  }
}
const _config = loadConfig();
const _role = _config.role || 'master'; // 'master' 或 'slave'

// 将当前内存中的打印机 IP 持久化到 config.json（IP 变更后调用）
function saveDiscoveredIPs() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    (cfg.bambuPrinters || []).forEach(p => {
      const live = (BAMBU_PRINTERS || []).find(x => x.id === p.id);
      if (live && live.host !== p.host) p.host = live.host;
    });
    (cfg.flashForgePrinters || []).forEach(p => {
      const live = (FLASHFORGE_PRINTERS || []).find(x => x.id === p.id);
      if (live && live.host !== p.host) p.host = live.host;
    });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('[配置] 已将新发现的打印机IP保存到 config.json');
  } catch (e) {
    console.error('[配置] 保存IP失败:', e.message);
  }
}

// Basic Auth 凭据（从 config.json 读取）
const _authUser = (_config.auth && _config.auth.username) || 'admin';
const _authPass = (_config.auth && _config.auth.password) || 'changeme';

function requireAuth(req, res) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx < 0) return false;
    const user = decoded.substring(0, colonIdx);
    const pass = decoded.substring(colonIdx + 1);
    if (user === _authUser && pass === _authPass) return true;
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="3D Print Manager"',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('Authentication required');
  return false;
}

// 内存数据缓存，避免每次都同步读写磁盘
let _cachedData = null;
// 写队列：串行化所有磁盘写操作，防止并发写同一临时文件
let _writeQueue = Promise.resolve();

function loadData() {
  // 优先使用内存缓存，避免频繁同步读磁盘
  if (_cachedData) return JSON.parse(JSON.stringify(_cachedData));
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data._snapshotUpdatedAt) {
      try { data._snapshotUpdatedAt = fs.statSync(DATA_FILE).mtimeMs; }
      catch(e) { data._snapshotUpdatedAt = Date.now(); }
    }
    _cachedData = data;
    return JSON.parse(JSON.stringify(data));
  }
  catch { const def = { settings: null, materials: null, products: null, records: {} }; _cachedData = def; return JSON.parse(JSON.stringify(def)); }
}

// 尝试用去掉乱码后的残余文字匹配已知名称列表
function _fuzzyMatchCorrupted(corrupted, knownNames) {
  const cleaned = corrupted.replace(/\uFFFD/g, '');
  if (cleaned.length < 2) return null;
  // 1. 精确子串：清理后文字是某个已知名的子串
  let best = null, bestLen = 0;
  for (const n of knownNames) {
    if (n.includes(cleaned) && n.length > bestLen) { best = n; bestLen = n.length; }
  }
  if (best) return best;
  // 2. 逐字符匹配：已知名去掉部分字符后等于清理版
  for (const n of knownNames) {
    let ci = 0;
    for (let ni = 0; ni < n.length && ci < cleaned.length; ni++) {
      if (n[ni] === cleaned[ci]) ci++;
    }
    if (ci === cleaned.length && cleaned.length >= n.length * 0.5) return n;
  }
  return null;
}

// 修复因 UTF-8 分包导致的乱码字段（启动时调用一次）
function repairCorruptedData(data) {
  if (!data || !data.records) return;
  const matNames = (data.materials || []).map(m => m.name);
  const prodNames = (data.products || []).map(p => p.name);
  const prodSet = new Set(prodNames);
  const matSet = new Set(matNames);
  let fixed = 0;
  for (const [date, day] of Object.entries(data.records)) {
    if (!day.items) continue;
    for (const it of day.items) {
      // 修复 material：含 FFFD 或不在已知材料列表中
      if (it.material && (it.material.includes('\uFFFD') || (!matSet.has(it.material) && it.material.length > 1))) {
        const match = _fuzzyMatchCorrupted(it.material, matNames);
        if (match && match !== it.material) {
          console.log(`[数据修复] ${date} #${it.machine} 材料 "${it.material}" → "${match}"`);
          it.material = match;
          fixed++;
        } else if (it.material.includes('\uFFFD')) {
          it.material = it.material.replace(/\uFFFD/g, '');
          fixed++;
        }
      }
      // 修复 productName：含 FFFD 或不在已知产品列表中（仅对自动记录）
      if (it.productName && it.autoRecord && (it.productName.includes('\uFFFD') || !prodSet.has(it.productName))) {
        const match = _fuzzyMatchCorrupted(it.productName, prodNames);
        if (match && match !== it.productName) {
          console.log(`[数据修复] ${date} #${it.machine} 产品 "${it.productName}" → "${match}"`);
          it.productName = match;
          // 同时用产品库数据修复关联字段
          const prod = (data.products || []).find(p => p.name === match);
          if (prod) {
            if (prod.material) it.material = prod.material;
            if (prod.weight) it.weight = prod.weight;
            if (prod.price) it.price = prod.price;
          }
          fixed++;
        } else if (it.productName.includes('\uFFFD')) {
          it.productName = it.productName.replace(/\uFFFD/g, '');
          fixed++;
        }
      }
    }
  }
  if (fixed > 0) {
    console.log(`[数据修复] 共修复 ${fixed} 处乱码`);
    saveData(data);
  }
}

function saveData(data) {
  dataVersion = Date.now();
  // 序列化 JSON 并清理乱码
  let json = JSON.stringify(data, null, 2);
  json = json.replace(/[\uFFFD\uD800-\uDFFF]/g, '');
  // 用清理后的 JSON 重建缓存，确保内存中也没有乱码
  _cachedData = JSON.parse(json);
  // 通过写队列串行化磁盘写操作
  _writeQueue = _writeQueue.then(() => new Promise((resolve) => {
    // 自动备份：写入前先备份当前 data.json
    const backupStep = new Promise((bkResolve) => {
      fs.access(DATA_FILE, fs.constants.F_OK, (err) => {
        if (err) { bkResolve(); return; } // 文件不存在，无需备份
        const bakFile = DATA_FILE + '.bak.' + Date.now();
        fs.copyFile(DATA_FILE, bakFile, (cpErr) => {
          if (cpErr) console.error('备份失败:', cpErr);
          // 清理旧备份，只保留最近 5 个
          const dir = path.dirname(DATA_FILE);
          const base = path.basename(DATA_FILE);
          fs.readdir(dir, (rdErr, files) => {
            if (rdErr) { bkResolve(); return; }
            const baks = files.filter(f => f.startsWith(base + '.bak.')).sort();
            if (baks.length > 5) {
              const toDelete = baks.slice(0, baks.length - 5);
              for (const f of toDelete) {
                fs.unlink(path.join(dir, f), () => {});
              }
            }
            bkResolve();
          });
        });
      });
    });
    backupStep.then(() => {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFile(tmp, json, 'utf8', (err) => {
        if (err) { console.error('写入数据失败:', err); resolve(); return; }
        fs.rename(tmp, DATA_FILE, (err2) => {
          if (err2) console.error('重命名数据文件失败:', err2);
          resolve();
        });
      });
    });
  }));
}

// ═══════════════════════════════════════════════════════
// Bambu Lab P1S MQTT 连接
// ═══════════════════════════════════════════════════════
// 云端/降级部署：跳过未配置真实凭据的打印机（占位符或缺失），避免无意义的局域网扫描
function isPlaceholder(v) { return !v || String(v).startsWith('YOUR_'); }
const BAMBU_PRINTERS = (_config.bambuPrinters || []).filter(p =>
  p && p.host && !isPlaceholder(p.serial) && !isPlaceholder(p.accessCode)
);

// 打印机实时状态存储
const printerStatus = {};

// 打印机上一次状态（用于检测状态转换，自动录入记录）
const printerPrevState = {};

// 打印机是否已完成首次状态初始化（防止服务器重启时产生重复记录）
const printerInitialized = new Set();

// 手动触发重新扫描 IP 的函数注册表 { printerId: triggerFn }（Bambu + FlashForge 共用）
const scanTriggers = {};

// 从 gcode 文件名匹配产品库
function matchProductFromGcode(gcodeFile, products) {
  if (!gcodeFile || !products || !products.length) return null;
  let name = gcodeFile.replace(/^.*[\/\\]/, '')
    .replace(/\.gcode\.3mf$/i, '')
    .replace(/\.(3mf|gcode)$/i, '')
    .replace(/_\d+$/, '');
  if (!name) return null;
  // 优先精确匹配
  for (const p of products) {
    if (name === p.name) return p;
  }
  // 模糊匹配：产品名至少3个字符才允许包含匹配，防止短名误匹配
  for (const p of products) {
    if (p.name.length >= 3 && (name.includes(p.name) || p.name.includes(name))) return p;
  }
  return null;
}

// 服务端库存扣减（自动记录时调用）
function deductInventory(data, materialName, weightG) {
  if (!materialName || !weightG || weightG <= 0) return;
  if (!data.inventory) data.inventory = {};
  if (!data.inventory[materialName]) data.inventory[materialName] = { stockG: 0, minStockG: 3000 };
  data.inventory[materialName].stockG = Math.max(0, data.inventory[materialName].stockG - weightG);
}

// 检查打印机状态转换，自动创建/完成每日记录
function checkPrinterTransitions() {
  const now = new Date();
  const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  // 直接操作最新缓存数据，避免旧快照覆盖用户新提交的数据
  const data = _cachedData ? _cachedData : loadData();
  let changed = false;

  for (const [id, status] of Object.entries(printerStatus)) {
    if (!status.connected) continue;
    const curr = { gcodeState: status.gcodeState, gcodeFile: status.gcodeFile };

    // 首次获取状态时只记录当前状态，不触发自动记录（防止服务器重启产生重复记录）
    if (!printerInitialized.has(id)) {
      printerInitialized.add(id);
      printerPrevState[id] = { ...curr, startTime: curr.gcodeState === 'RUNNING' ? Date.now() : null };
      console.log(`[初始化] #${id} 当前状态: ${curr.gcodeState}`);

      if (curr.gcodeState !== 'RUNNING') {
        // 打印机已停止：结算最近3天内所有未完成的自动记录
        let lastClosedGcode = null; // 记录最后一条被结算的 gcodeFile，用于判断是否有新任务
        for (let daysAgo = 0; daysAgo <= 3; daysAgo++) {
          const d = new Date(now); d.setDate(d.getDate() - daysAgo);
          const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          if (!data.records[dateStr]) continue;
          for (const it of data.records[dateStr].items) {
            if (it.machine == id && it.autoRecord && !it.printEndTime) {
              it.printEndTime = now.toISOString();
              it.remark = (it.remark ? it.remark + ' ' : '') + '(服务器重启后自动结算)';
              it._updatedAt = Date.now();
              changed = true;
              lastClosedGcode = it._gcodeFile || '';
              console.log(`[初始化] #${id} 结算 ${dateStr} 未完成记录: ${it.productName}`);
            }
          }
        }

        // 补录：如果当前 gcodeFile 与刚结算的记录不同，说明打印机在离线期间完成了新任务
        if (curr.gcodeState === 'FINISH' && curr.gcodeFile) {
          const currentFile = curr.gcodeFile;
          // 检查最近3天是否已有同机台、同文件的记录（避免重复）
          let alreadyRecorded = false;
          for (let daysAgo = 0; daysAgo <= 3 && !alreadyRecorded; daysAgo++) {
            const d = new Date(now); d.setDate(d.getDate() - daysAgo);
            const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            if (!data.records[dateStr]) continue;
            for (const it of data.records[dateStr].items) {
              if (it.machine == id && it._gcodeFile === currentFile && !it._deleted) {
                alreadyRecorded = true;
                break;
              }
            }
          }
          if (!alreadyRecorded) {
            if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
            const matched = matchProductFromGcode(currentFile, data.products || []);
            const cleanName = sanitizeString((currentFile || '').replace(/^.*[\/\\]/, '')
              .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));
            data.records[todayStr].items.push({
              machine: parseInt(id),
              status: 'done',
              productName: matched ? matched.name : (cleanName || '未知产品'),
              material: matched ? matched.material : (status.liveMaterial || ''),
              weight: matched ? matched.weight : 0,
              qty: matched ? (matched.qty || 1) : 1,
              time: matched ? (matched.time || 0) : 0,
              price: matched ? matched.price : 0,
              remark: '(重连后自动补录)',
              autoRecord: true,
              printStartTime: null,
              printEndTime: now.toISOString(),
              _gcodeFile: currentFile,
              _id: generateId(),
              _updatedAt: Date.now(),
              createdAt: now.toISOString()
            });
            changed = true;
            const _wInit = matched ? matched.weight : 0, _qInit = matched ? (matched.qty || 1) : 1;
            if (_wInit > 0) deductInventory(data, matched ? matched.material : (status.liveMaterial || ''), _wInit * _qInit);
            console.log(`[初始化补录] #${id} 发现已完成的新任务: ${cleanName || currentFile}`);
          }
        }
      } else {
        // 打印机正在运行：检查是否有未完成记录且 gcodeFile 已变（说明旧任务完成、新任务开始）
        let openRec = null;
        for (let daysAgo = 0; daysAgo <= 3 && !openRec; daysAgo++) {
          const d = new Date(now); d.setDate(d.getDate() - daysAgo);
          const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          if (!data.records[dateStr]) continue;
          openRec = data.records[dateStr].items.find(it =>
            it.machine == id && it.autoRecord && !it.printEndTime
          );
        }
        if (openRec && openRec._gcodeFile && openRec._gcodeFile !== curr.gcodeFile) {
          // 旧任务已完成（文件名变了），结算旧记录
          openRec.printEndTime = now.toISOString();
          openRec.remark = (openRec.remark ? openRec.remark + ' ' : '') + '(重连后自动结算)';
          openRec._updatedAt = Date.now();
          changed = true;
          console.log(`[初始化] #${id} 文件已变，结算旧记录: ${openRec.productName}`);
          // 为当前正在运行的新任务创建记录
          if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
          const matched = matchProductFromGcode(curr.gcodeFile, data.products || []);
          const cleanName = sanitizeString((curr.gcodeFile || '').replace(/^.*[\/\\]/, '')
            .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));
          data.records[todayStr].items.push({
            machine: parseInt(id),
            status: 'running',
            productName: matched ? matched.name : (cleanName || '未知产品'),
            material: matched ? matched.material : (status.liveMaterial || ''),
            weight: matched ? matched.weight : 0,
            qty: matched ? (matched.qty || 1) : 1,
            time: matched ? (matched.time || 0) : 0,
            price: matched ? matched.price : 0,
            remark: '',
            autoRecord: true,
            printStartTime: now.toISOString(),
            printEndTime: null,
            _gcodeFile: curr.gcodeFile,
            _id: generateId(),
            _updatedAt: Date.now(),
            createdAt: now.toISOString()
          });
          changed = true;
          const _wRun = matched ? matched.weight : 0, _qRun = matched ? (matched.qty || 1) : 1;
          if (_wRun > 0) deductInventory(data, matched ? matched.material : (status.liveMaterial || ''), _wRun * _qRun);
          console.log(`[初始化补录] #${id} 为当前运行的新任务创建记录: ${cleanName || curr.gcodeFile}`);
        } else if (!openRec) {
          // 没有未完成记录但打印机正在运行
          // 检查同文件+有进度：最近3天已有该文件记录说明是同一任务，跳过
          // 仅匹配未完成的或最近10分钟内结算的记录（避免阻止同文件重印）
          let gcodeAlreadyRecorded = false;
          if (curr.gcodeFile && status.printProgress > 0) {
            const _nowInit = Date.now();
            for (let da = 0; da <= 3 && !gcodeAlreadyRecorded; da++) {
              const dd = new Date(now); dd.setDate(dd.getDate() - da);
              const ds = dd.getFullYear() + '-' + String(dd.getMonth()+1).padStart(2,'0') + '-' + String(dd.getDate()).padStart(2,'0');
              if (data.records[ds]) {
                gcodeAlreadyRecorded = data.records[ds].items.some(it =>
                  it.machine == id && it._gcodeFile === curr.gcodeFile && !it._deleted &&
                  (!it.printEndTime || (_nowInit - new Date(it.printEndTime).getTime() < 10 * 60 * 1000))
                );
              }
            }
          }
          if (!gcodeAlreadyRecorded) {
            if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
            const matched = matchProductFromGcode(curr.gcodeFile, data.products || []);
            const cleanName = sanitizeString((curr.gcodeFile || '').replace(/^.*[\/\\]/, '')
              .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));
            data.records[todayStr].items.push({
              machine: parseInt(id),
              status: 'running',
              productName: matched ? matched.name : (cleanName || '未知产品'),
              material: matched ? matched.material : (status.liveMaterial || ''),
              weight: matched ? matched.weight : 0,
              qty: matched ? (matched.qty || 1) : 1,
              time: matched ? (matched.time || 0) : 0,
              price: matched ? matched.price : 0,
              remark: '',
              autoRecord: true,
              printStartTime: now.toISOString(),
              printEndTime: null,
              _gcodeFile: curr.gcodeFile,
              _id: generateId(),
              _updatedAt: Date.now(),
              createdAt: now.toISOString()
            });
            changed = true;
            const _wNew = matched ? matched.weight : 0, _qNew = matched ? (matched.qty || 1) : 1;
            if (_wNew > 0) deductInventory(data, matched ? matched.material : (status.liveMaterial || ''), _wNew * _qNew);
            console.log(`[初始化补录] #${id} 正在打印但无记录，创建: ${cleanName || curr.gcodeFile}`);
          } else {
            console.log(`[初始化] #${id} 同文件已有记录且进度 ${status.printProgress}%，跳过重复创建`);
          }
        } else {
          console.log(`[初始化] #${id} 正在打印中，已有匹配记录，等待状态转换`);
        }
      }
      continue;
    }

    const prev = printerPrevState[id] || { gcodeState: 'UNKNOWN', gcodeFile: '' };

    // 非RUNNING → RUNNING：开始打印，自动创建记录
    if (curr.gcodeState === 'RUNNING' && prev.gcodeState !== 'RUNNING') {
      if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
      const day = data.records[todayStr];

      // 避免重复：同一机台只要有未完成的自动记录就不再创建
      let exists = day.items.find(it =>
        it.machine == id && it.autoRecord && !it.printEndTime
      );
      // 同文件+有进度：说明是同一任务继续运行（如重启后状态跳变），不重复创建
      // 仅匹配未完成的或最近10分钟内结算的记录（避免阻止同文件重印）
      if (!exists && curr.gcodeFile && status.printProgress > 0) {
        const _now = Date.now();
        exists = day.items.find(it =>
          it.machine == id && it._gcodeFile === curr.gcodeFile && !it._deleted &&
          (!it.printEndTime || (_now - new Date(it.printEndTime).getTime() < 10 * 60 * 1000))
        );
        if (exists) console.log(`[自动记录] #${id} 跳过：同文件已有记录且进度 ${status.printProgress}%`);
      }
      if (!exists) {
        const matched = matchProductFromGcode(curr.gcodeFile, data.products || []);
        const cleanName = sanitizeString((curr.gcodeFile || '').replace(/^.*[\/\\]/, '')
          .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));

        day.items.push({
          machine: parseInt(id),
          status: 'running',
          productName: matched ? matched.name : (cleanName || '未知产品'),
          material: matched ? matched.material : (status.liveMaterial || ''),
          weight: matched ? matched.weight : 0,
          qty: matched ? (matched.qty || 1) : 1,
          time: matched ? (matched.time || 0) : 0,
          price: matched ? matched.price : 0,
          remark: (!matched && !status.liveMaterial) ? '更换材料' : '',
          autoRecord: true,
          printStartTime: now.toISOString(),
          printEndTime: null,
          _gcodeFile: curr.gcodeFile,
          _id: generateId(),
          _updatedAt: Date.now(),
          createdAt: now.toISOString()
        });
        changed = true;
        const _w2 = matched ? matched.weight : 0, _q2 = matched ? (matched.qty || 1) : 1;
        if (_w2 > 0) deductInventory(data, matched ? matched.material : (status.liveMaterial || ''), _w2 * _q2);
        console.log(`[自动记录] #${id} 开始打印: ${cleanName || curr.gcodeFile}`);
      }
      printerPrevState[id] = { ...curr, startTime: Date.now() };
    }
    // RUNNING → FINISH/IDLE/FAILED：打印结束，填入耗时
    else if (prev.gcodeState === 'RUNNING' &&
             (curr.gcodeState === 'FINISH' || curr.gcodeState === 'IDLE' || curr.gcodeState === 'FAILED')) {
      if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
      const day = data.records[todayStr];

      // 查找该机台未完成的自动记录（先查今天，找不到则向前搜索最近3天，解决跨午夜问题）
      let rec = day.items.find(it =>
        it.machine == id && it.autoRecord && !it.printEndTime
      );
      if (!rec) {
        for (let daysAgo = 1; daysAgo <= 3 && !rec; daysAgo++) {
          const d = new Date(now); d.setDate(d.getDate() - daysAgo);
          const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          if (data.records[dateStr]) {
            rec = data.records[dateStr].items.find(it =>
              it.machine == id && it.autoRecord && !it.printEndTime
            );
          }
        }
      }
      if (rec) {
        rec.printEndTime = now.toISOString();
        if (curr.gcodeState === 'FAILED') rec.remark = '打印失败';
        rec._updatedAt = Date.now();
        changed = true;
        console.log(`[自动记录] #${id} 完成打印`);
      }
      printerPrevState[id] = { ...curr, startTime: null };
    }
    else {
      printerPrevState[id] = { ...prev, gcodeState: curr.gcodeState, gcodeFile: curr.gcodeFile };

      // 若打印机持续运行但今日无未完成记录（可能因客户端推送竞争导致记录丢失），自动补录
      if (curr.gcodeState === 'RUNNING') {
        if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
        const openRec = data.records[todayStr].items.find(it =>
          it.machine == id && !it.printEndTime
        );
        // 已有记录但材料为空：尝试从设备实时数据回填
        if (openRec && !openRec.material && status.liveMaterial) {
          openRec.material = status.liveMaterial;
          openRec._updatedAt = Date.now();
          changed = true;
          console.log(`[材料回填] #${id} 从设备获取材料: ${status.liveMaterial}`);
        }
        // 已有记录但产品名是"未知产品"：尝试从设备gcodeFile回填产品名
        if (openRec && openRec.productName === '未知产品' && curr.gcodeFile) {
          const matched = matchProductFromGcode(curr.gcodeFile, data.products || []);
          const cleanName = sanitizeString((curr.gcodeFile || '').replace(/^.*[\/\\]/, '')
            .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));
          const newName = matched ? matched.name : (cleanName || '');
          if (newName && newName !== '未知产品') {
            openRec.productName = newName;
            openRec._gcodeFile = curr.gcodeFile;
            if (matched) {
              if (!openRec.material && matched.material) openRec.material = matched.material;
              if (!openRec.weight && matched.weight) openRec.weight = matched.weight;
              if (!openRec.price && matched.price) openRec.price = matched.price;
              if (matched.time) openRec.time = matched.time;
              if (matched.qty) openRec.qty = matched.qty;
            }
            openRec._updatedAt = Date.now();
            changed = true;
            console.log(`[产品回填] #${id} 从设备获取产品名: ${newName}`);
          }
        }
        if (!openRec) {
          // 检查最近3天是否已有该机台的未完成自动记录（跨夜任务），有则不补录
          let crossDayRec = false;
          for (let daysAgo = 1; daysAgo <= 3; daysAgo++) {
            const d2 = new Date(now); d2.setDate(d2.getDate() - daysAgo);
            const dateStr2 = d2.getFullYear() + '-' + String(d2.getMonth()+1).padStart(2,'0') + '-' + String(d2.getDate()).padStart(2,'0');
            if (data.records[dateStr2]) {
              const oldRec = data.records[dateStr2].items.find(it =>
                it.machine == id && it.autoRecord && !it.printEndTime
              );
              if (oldRec) { crossDayRec = true; break; }
            }
          }
          if (!crossDayRec) {
            // 检查同文件+有进度：避免重复补录已结算的同一任务
            // 仅匹配未完成的或最近10分钟内结算的记录（避免阻止同文件重印）
            let gcodeAlreadyRecorded2 = false;
            if (curr.gcodeFile && status.printProgress > 0) {
              const _nowBulu = Date.now();
              for (let da2 = 0; da2 <= 3 && !gcodeAlreadyRecorded2; da2++) {
                const dd2 = new Date(now); dd2.setDate(dd2.getDate() - da2);
                const ds2 = dd2.getFullYear() + '-' + String(dd2.getMonth()+1).padStart(2,'0') + '-' + String(dd2.getDate()).padStart(2,'0');
                if (data.records[ds2]) {
                  gcodeAlreadyRecorded2 = data.records[ds2].items.some(it =>
                    it.machine == id && it._gcodeFile === curr.gcodeFile && !it._deleted &&
                    (!it.printEndTime || (_nowBulu - new Date(it.printEndTime).getTime() < 10 * 60 * 1000))
                  );
                }
              }
            }
            if (!gcodeAlreadyRecorded2) {
              const matched = matchProductFromGcode(curr.gcodeFile, data.products || []);
              const cleanName = sanitizeString((curr.gcodeFile || '').replace(/^.*[\/\\]/, '')
                .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));
              const startTime = prev.startTime ? new Date(prev.startTime).toISOString() : now.toISOString();
              data.records[todayStr].items.push({
                machine: parseInt(id),
                status: 'running',
                productName: matched ? matched.name : (cleanName || '未知产品'),
                material: matched ? matched.material : (status.liveMaterial || ''),
                weight: matched ? matched.weight : 0,
                qty: matched ? (matched.qty || 1) : 1,
                time: matched ? (matched.time || 0) : 0,
                price: matched ? matched.price : 0,
                remark: (!matched && !status.liveMaterial) ? '更换材料' : '',
                autoRecord: true,
                printStartTime: startTime,
                printEndTime: null,
                _gcodeFile: curr.gcodeFile,
                _id: generateId(),
                _updatedAt: Date.now(),
                createdAt: now.toISOString()
              });
              changed = true;
              const _w3 = matched ? matched.weight : 0, _q3 = matched ? (matched.qty || 1) : 1;
              if (_w3 > 0) deductInventory(data, matched ? matched.material : (status.liveMaterial || ''), _w3 * _q3);
              console.log(`[补录] #${id} 持续运行但无未完成记录，补创建: ${cleanName || curr.gcodeFile}`);
            } else {
              console.log(`[跳过补录] #${id} 同文件已有记录且进度 ${status.printProgress}%，跳过重复创建`);
            }
          } else {
            console.log(`[跳过补录] #${id} 跨夜任务，记录保留在原始日期`);
          }
        }
      }
    }
  }

  // 兜底扫描：检查最近3天内有无"机台已不在RUNNING但记录未关闭"的情况
  const finishedStates = new Set(['FINISH', 'IDLE', 'FAILED', 'ERROR']);
  for (let daysAgo = 0; daysAgo <= 3; daysAgo++) {
    const d = new Date(now); d.setDate(d.getDate() - daysAgo);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if (!data.records[dateStr]) continue;
    for (const it of data.records[dateStr].items) {
      if (!it.autoRecord || it.printEndTime) continue;
      const ps = printerStatus[it.machine];
      // 运行中记录材料为空：从设备数据回填
      if (ps && ps.connected && ps.gcodeState === 'RUNNING' && !it.material && ps.liveMaterial) {
        it.material = ps.liveMaterial;
        it._updatedAt = Date.now();
        changed = true;
        console.log(`[材料回填] #${it.machine} ${dateStr} 材料从设备获取: ${ps.liveMaterial}`);
      }
      if (ps && ps.connected && finishedStates.has(ps.gcodeState)) {
        it.printEndTime = now.toISOString();
        it.remark = (it.remark ? it.remark + ' ' : '') + '(兜底结算)';
        it._updatedAt = Date.now();
        changed = true;
        console.log(`[兜底] #${it.machine} ${dateStr} 记录未关闭，当前状态 ${ps.gcodeState}，自动结算`);
      }
    }
  }

  if (changed) saveData(data);
}

function encodeMqttRemainingLength(len) {
  const bytes = [];
  do {
    let b = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) b |= 128;
    bytes.push(b);
  } while (len > 0);
  return Buffer.from(bytes);
}

function buildMqttConnect(clientId, username, password) {
  const protocolName = Buffer.from([0x00, 0x04, 0x4D, 0x51, 0x54, 0x54]);
  const protocolLevel = Buffer.from([0x04]);
  const flags = Buffer.from([0xC2]);
  const keepAlive = Buffer.from([0x00, 0x3C]);

  const cBuf = Buffer.from(clientId, 'utf8');
  const uBuf = Buffer.from(username, 'utf8');
  const pBuf = Buffer.from(password, 'utf8');

  const payload = Buffer.concat([
    Buffer.from([cBuf.length >> 8, cBuf.length & 0xFF]), cBuf,
    Buffer.from([uBuf.length >> 8, uBuf.length & 0xFF]), uBuf,
    Buffer.from([pBuf.length >> 8, pBuf.length & 0xFF]), pBuf,
  ]);

  const varHeader = Buffer.concat([protocolName, protocolLevel, flags, keepAlive]);
  const remaining = varHeader.length + payload.length;
  return Buffer.concat([Buffer.from([0x10]), encodeMqttRemainingLength(remaining), varHeader, payload]);
}

function buildMqttSubscribe(packetId, topic) {
  const topicBuf = Buffer.from(topic, 'utf8');
  const payload = Buffer.concat([
    Buffer.from([packetId >> 8, packetId & 0xFF]),
    Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xFF]), topicBuf,
    Buffer.from([0x00])
  ]);
  return Buffer.concat([Buffer.from([0x82]), encodeMqttRemainingLength(payload.length), payload]);
}

function buildMqttPublish(topic, message) {
  const topicBuf = Buffer.from(topic, 'utf8');
  const msgBuf = Buffer.from(message, 'utf8');
  const payload = Buffer.concat([
    Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xFF]), topicBuf,
    msgBuf
  ]);
  return Buffer.concat([Buffer.from([0x30]), encodeMqttRemainingLength(payload.length), payload]);
}

function parseMqttPackets(buf) {
  const packets = [];
  let i = 0;
  while (i < buf.length) {
    const firstByte = buf[i];
    const type = firstByte & 0xF0;
    let mult = 1, len = 0, j = i + 1, byteCount = 0;
    if (j >= buf.length) break;
    let malformed = false;
    do {
      if (j >= buf.length) return packets; // 数据不完整，等待更多数据
      if (byteCount++ >= 4) { malformed = true; break; } // remaining length 超过 4 字节，畸形包
      const b = buf[j++];
      len += (b & 127) * mult;
      mult *= 128;
    } while (buf[j - 1] & 128);
    if (malformed) {
      // 跳过畸形包的第一个字节，继续尝试后续数据
      i++;
      continue;
    }
    if (j + len > buf.length) break;
    packets.push({ type, firstByte, data: buf.slice(j, j + len), offset: i, end: j + len });
    i = j + len;
  }
  return packets;
}

// 清理字符串中的乱码字符（替换字符 U+FFFD、孤立代理项、C0/C1控制字符）
function sanitizeString(str) {
  if (!str) return str;
  return str.replace(/[\uFFFD\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

// Bambu IP 自动发现：扫描局域网 8883 端口，通过 MQTT 认证确认打印机身份
function discoverBambuIP(printer, callback) {
  const nets = os.networkInterfaces();
  const subnets = new Set();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        subnets.add(parts[0] + '.' + parts[1] + '.' + parts[2]);
      }
    }
  }
  subnets.add('192.168.2');
  subnets.add('192.168.3');
  subnets.add('192.168.4');
  subnets.add('192.168.5');

  let found = false;
  let callbackCalled = false;

  function done(result) {
    if (callbackCalled) return;
    callbackCalled = true;
    callback(result);
  }

  // 构建待扫描 IP 列表（跳过当前已配置的 IP，因为已经知道不通）
  const ips = [];
  for (const subnet of subnets) {
    for (let i = 1; i <= 254; i++) {
      const ip = subnet + '.' + i;
      if (ip !== printer.host) ips.push(ip);
    }
  }

  const MAX_CONCURRENT = 20;  // TLS 比 HTTP 更重，并发略低
  let active = 0;
  let idx = 0;
  const pendingSocks = [];

  function tryIP(ip) {
    const sock = tls.connect({
      host: ip,
      port: 8883,
      rejectUnauthorized: false,
      timeout: 3000
    });
    pendingSocks.push(sock);

    sock.on('secureConnect', () => {
      if (found) { sock.destroy(); return; }
      // 发送 MQTT CONNECT，用 accessCode 认证
      const clientId = 'scan_' + printer.id + '_' + Date.now();
      sock.write(buildMqttConnect(clientId, 'bblp', printer.accessCode));
    });

    sock.on('data', (data) => {
      if (found) { sock.destroy(); return; }
      const packets = parseMqttPackets(data);
      for (const pkt of packets) {
        if (pkt.type === 0x20) { // CONNACK
          const rc = pkt.data[1];
          if (rc === 0) {
            // 认证成功 — 找到目标打印机
            found = true;
            console.log(`[${printer.name}] 发现新IP: ${ip} (原: ${printer.host})`);
            printer.host = ip;
            sock.destroy();
            // 中止所有剩余连接
            for (const s of pendingSocks) { try { s.destroy(); } catch(e) {} }
            done(true);
          } else {
            // 认证失败 — 这台打印机不是目标（accessCode 不匹配）
            sock.destroy();
          }
        }
      }
    });

    sock.on('error', () => {
      active--;
      if (!found) scanNext();
    });
    sock.on('close', () => {
      active--;
      if (!found) {
        if (active === 0 && idx >= ips.length) done(false);
        else scanNext();
      }
    });
    sock.on('timeout', () => { sock.destroy(); });
  }

  function scanNext() {
    while (active < MAX_CONCURRENT && idx < ips.length && !found) {
      active++;
      tryIP(ips[idx++]);
    }
  }

  // 设置整体超时（2分钟），防止扫描永不结束
  const overallTimeout = setTimeout(() => {
    if (!found) {
      for (const s of pendingSocks) { try { s.destroy(); } catch(e) {} }
      done(false);
    }
  }, 120000);

  // done 后清除整体超时
  const origDone = done;
  done = (result) => {
    clearTimeout(overallTimeout);
    origDone(result);
  };

  scanNext();
}

function connectBambuPrinter(printer) {
  const status = {
    id: printer.id,
    name: printer.name,
    connected: false,
    gcodeState: 'UNKNOWN',
    gcodeFile: '',
    printProgress: 0,
    remainingTime: 0,
    nozzleTemp: 0,
    nozzleTarget: 0,
    bedTemp: 0,
    bedTarget: 0,
    fanSpeed: 0,
    layerNum: 0,
    totalLayers: 0,
    lastUpdate: 0,
    error: '',
    liveMaterial: '',
    amsTrays: [],
    activeTrayRemain: -1,
    printError: 0
  };
  printerStatus[printer.id] = status;

  let sock = null;
  let buf = Buffer.alloc(0);
  let reconnectTimer = null;
  let pingTimer = null;
  let connected = false;
  let failCount = 0;
  let discovering = false;

  function triggerScan() {
    if (discovering) return;
    discovering = true;
    status.error = '正在搜索新IP...';
    console.log(`[${printer.name}] 开始扫描新IP...`);
    discoverBambuIP(printer, (found) => {
      discovering = false;
      if (found) {
        failCount = 0;
        console.log(`[${printer.name}] IP已更新为 ${printer.host}，正在重新连接...`);
        saveDiscoveredIPs();
        connect();
      } else {
        status.error = '打印机离线，等待重试';
        console.log(`[${printer.name}] 未找到，将继续重试`);
        // 扫描失败后等 30s 再重连
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          console.log(`[${printer.name}] 重新连接...`);
          connect();
        }, 30000);
      }
    });
  }

  // 注册手动扫描入口（与 FlashForge 共用 scanTriggers）
  scanTriggers[printer.id] = () => {
    failCount = 0;
    triggerScan();
  };

  function connect() {
    // 清除旧的重连定时器，防止 sock.destroy() 触发 close 事件后再次调度 connect()
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (sock) { try { sock.destroy(); } catch (e) {} }
    buf = Buffer.alloc(0);
    sock = tls.connect({
      host: printer.host,
      port: 8883,
      rejectUnauthorized: false,
      timeout: 10000
    });

    sock.on('secureConnect', () => {
      const clientId = 'bblp_' + printer.id + '_' + Date.now();
      sock.write(buildMqttConnect(clientId, 'bblp', printer.accessCode));
    });

    sock.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      // 防止缓冲区无限增长导致 OOM（不完整包导致 buf 永不截断的场景）
      if (buf.length > 1024 * 1024) {
        console.error(`[${printer.name}] MQTT 缓冲区超过 1MB，重置连接`);
        buf = Buffer.alloc(0);
        sock.destroy();
        return;
      }
      const packets = parseMqttPackets(buf);
      if (packets.length > 0) {
        const lastEnd = packets[packets.length - 1].end;
        buf = buf.slice(lastEnd);
      }

      for (const pkt of packets) {
        if (pkt.type === 0x20) { // CONNACK
          const rc = pkt.data[1];
          if (rc === 0) {
            connected = true;
            status.connected = true;
            status.error = '';
            failCount = 0;  // 连接成功，重置失败计数
            console.log(`[${printer.name}] MQTT 已连接`);

            // Subscribe to report topic
            const topic = `device/${printer.serial}/report`;
            sock.write(buildMqttSubscribe(1, topic));

            // Request full status
            setTimeout(() => {
              const reqTopic = `device/${printer.serial}/request`;
              const msg = JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } });
              sock.write(buildMqttPublish(reqTopic, msg));
            }, 500);

            // Periodic pushall every 30s
            clearInterval(pingTimer);
            pingTimer = setInterval(() => {
              if (connected) {
                try {
                  // MQTT PINGREQ
                  sock.write(Buffer.from([0xC0, 0x00]));
                  // Request status update
                  const reqTopic = `device/${printer.serial}/request`;
                  const msg = JSON.stringify({ pushing: { sequence_id: String(Date.now()), command: 'pushall' } });
                  sock.write(buildMqttPublish(reqTopic, msg));
                } catch (e) {}
              }
            }, 30000);
          } else {
            status.error = '认证失败(rc=' + rc + ')';
            console.log(`[${printer.name}] 认证失败 rc=${rc}`);
          }
        }
        else if (pkt.type === 0x30) { // PUBLISH
          try {
            const topicLen = (pkt.data[0] << 8) | pkt.data[1];
            // QoS > 0 时，topic 后有2字节 Packet Identifier
            const qos = (pkt.firstByte >> 1) & 0x03;
            const payloadOffset = 2 + topicLen + (qos > 0 ? 2 : 0);
            const msgStr = pkt.data.slice(payloadOffset).toString('utf8');
            const json = JSON.parse(msgStr);
            if (json.print) {
              const p = json.print;
              if (p.gcode_state !== undefined) status.gcodeState = p.gcode_state;
              // 优先使用 subtask_name（中文显示名），其次 gcode_file
              if (p.subtask_name !== undefined) status.gcodeFile = sanitizeString(p.subtask_name);
              else if (p.gcode_file !== undefined) status.gcodeFile = sanitizeString(p.gcode_file);
              if (p.mc_percent !== undefined) status.printProgress = p.mc_percent;
              if (p.mc_remaining_time !== undefined) status.remainingTime = p.mc_remaining_time;
              if (p.nozzle_temper !== undefined) status.nozzleTemp = p.nozzle_temper;
              if (p.nozzle_target_temper !== undefined) status.nozzleTarget = p.nozzle_target_temper;
              if (p.bed_temper !== undefined) status.bedTemp = p.bed_temper;
              if (p.bed_target_temper !== undefined) status.bedTarget = p.bed_target_temper;
              if (p.big_fan1_speed !== undefined) status.fanSpeed = parseInt(p.big_fan1_speed) || 0;
              if (p.layer_num !== undefined) status.layerNum = p.layer_num;
              if (p.total_layer_num !== undefined) status.totalLayers = p.total_layer_num;
              // 从AMS/外部料盘获取当前耗材类型及余量
              if (p.ams) {
                const trayNow = p.ams.tray_now;
                // 构建所有AMS槽位信息（id, material, remain%）
                const trays = [];
                if (p.ams.ams) {
                  for (const amsUnit of p.ams.ams) {
                    if (!amsUnit.tray) continue;
                    for (const tray of amsUnit.tray) {
                      const globalIdx = parseInt(amsUnit.id) * 4 + parseInt(tray.id);
                      trays.push({
                        id: globalIdx,
                        material: tray.tray_type || '',
                        remain: tray.remain !== undefined ? parseInt(tray.remain) : -1
                      });
                    }
                  }
                }
                if (trays.length > 0) status.amsTrays = trays;
                // 确定当前活跃槽位及其余量
                if (trayNow === 255 || trayNow === '255') {
                  // 外部料盘
                  if (p.vt_tray && p.vt_tray.tray_type) status.liveMaterial = p.vt_tray.tray_type;
                  status.activeTrayRemain = -1;
                } else if (trayNow !== undefined && trayNow !== null && trayNow !== '') {
                  const idx = parseInt(trayNow);
                  if (!isNaN(idx) && p.ams.ams) {
                    const amsUnit = p.ams.ams.find(a => parseInt(a.id) === Math.floor(idx / 4));
                    if (amsUnit && amsUnit.tray) {
                      const tray = amsUnit.tray.find(t => parseInt(t.id) === (idx % 4));
                      if (tray) {
                        if (tray.tray_type) status.liveMaterial = tray.tray_type;
                        if (tray.remain !== undefined) status.activeTrayRemain = parseInt(tray.remain);
                      }
                    }
                  }
                }
              }
              if (p.vt_tray && p.vt_tray.tray_type && !status.liveMaterial) {
                status.liveMaterial = p.vt_tray.tray_type;
              }
              // 打印错误码
              if (p.print_error !== undefined) status.printError = p.print_error;
              status.lastUpdate = Date.now();
            }
          } catch (e) {}
        }
        else if (pkt.type === 0xD0) { // PINGRESP
          // OK
        }
      }
    });

    sock.on('error', (e) => {
      status.connected = false;
      status.error = e.code || e.message;
      connected = false;
    });

    sock.on('close', () => {
      status.connected = false;
      connected = false;
      clearInterval(pingTimer);
      failCount++;
      // 连续失败3次触发 IP 扫描，之后每10次重试扫描一次
      const shouldScan = (failCount === 3) || (failCount > 3 && failCount % 10 === 0);
      if (shouldScan && !discovering) {
        triggerScan();
      } else if (!discovering) {
        // 普通重连
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          console.log(`[${printer.name}] 重新连接...`);
          connect();
        }, 10000);
      }
    });

    sock.on('timeout', () => {
      status.error = '连接超时';
      sock.destroy();
    });
  }

  connect();
}

// 启动所有Bambu打印机连接
function startBambuConnections() {
  console.log('正在连接 Bambu 打印机...');
  for (const p of BAMBU_PRINTERS) {
    connectBambuPrinter(p);
  }
}

// ═══════════════════════════════════════════════════════
// FlashForge Adventurer 5M HTTP API 连接
// ═══════════════════════════════════════════════════════
const FLASHFORGE_PRINTERS = (_config.flashForgePrinters || []).filter(p =>
  p && p.host && !isPlaceholder(p.serial) && !isPlaceholder(p.checkCode)
);

// FlashForge IP 自动发现：扫描局域网找到打印机真实 IP
function discoverFlashForgeIP(printer, callback) {
  const nets = os.networkInterfaces();
  const subnets = new Set();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        subnets.add(parts[0] + '.' + parts[1] + '.' + parts[2]);
      }
    }
  }
  // 额外添加已知打印机子网（路由可达但本机无网卡的子网）
  subnets.add('192.168.2');
  subnets.add('192.168.3');
  subnets.add('192.168.4');
  subnets.add('192.168.5');

  const body = JSON.stringify({ serialNumber: printer.serial, checkCode: printer.checkCode });
  let found = false;
  let callbackCalled = false;

  function done(result) {
    if (callbackCalled) return;
    callbackCalled = true;
    callback(result);
  }

  // 构建所有待扫描 IP 列表
  const ips = [];
  for (const subnet of subnets) {
    for (let i = 1; i <= 254; i++) {
      ips.push(subnet + '.' + i);
    }
  }

  const MAX_CONCURRENT = 30;
  let active = 0;
  let idx = 0;
  const pendingReqs = [];

  function scanNext() {
    while (active < MAX_CONCURRENT && idx < ips.length && !found) {
      const ip = ips[idx++];
      active++;
      const req = http.request({
        hostname: ip, port: 8898, path: '/detail', method: 'POST', timeout: 3000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          active--;
          if (found) { if (active === 0) done(true); return; }
          try {
            const j = JSON.parse(data);
            if (j.code === 0 && j.detail) {
              found = true;
              console.log(`[${printer.name}] 发现新IP: ${ip} (原: ${printer.host})`);
              printer.host = ip;
              saveDiscoveredIPs();
              // 中止所有剩余请求
              for (const r of pendingReqs) { try { r.destroy(); } catch(e) {} }
              done(true);
              return;
            }
          } catch (e) {}
          if (active === 0 && idx >= ips.length && !found) done(false);
          else scanNext();
        });
      });
      req.on('error', () => {
        active--;
        if (found) return;
        if (active === 0 && idx >= ips.length && !found) done(false);
        else scanNext();
      });
      req.on('timeout', () => { req.destroy(); });
      pendingReqs.push(req);
      req.write(body);
      req.end();
    }
  }

  scanNext();
}

// FlashForge 发送暂停指令
function pauseFlashForgePrinter(printer, reason) {
  const body = JSON.stringify({ serialNumber: printer.serial, checkCode: printer.checkCode, action: 'pause' });
  const req = http.request({
    hostname: printer.host,
    port: 8898,
    path: '/control',
    method: 'POST',
    timeout: 10000,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log(`[${printer.name}] 暂停指令已发送 (${reason})，响应: ${data}`);
    });
  });
  req.on('error', e => console.log(`[${printer.name}] 暂停指令失败: ${e.message}`));
  req.on('timeout', () => { req.destroy(); console.log(`[${printer.name}] 暂停指令超时`); });
  req.write(body);
  req.end();
}

function pollFlashForgePrinter(printer) {
  const status = {
    id: printer.id,
    name: printer.name,
    connected: false,
    gcodeState: 'UNKNOWN',
    gcodeFile: '',
    printProgress: 0,
    remainingTime: 0,
    nozzleTemp: 0,
    nozzleTarget: 0,
    bedTemp: 0,
    bedTarget: 0,
    fanSpeed: 0,
    layerNum: 0,
    totalLayers: 0,
    lastUpdate: 0,
    error: '',
    liveMaterial: '',
    filamentOut: false
  };
  printerStatus[printer.id] = status;

  let failCount = 0;
  let discovering = false;
  let pollTimer = null;
  let firstPoll = true;       // 首次成功轮询时记录完整响应
  let autoPauseSent = false;   // 防止重复发送暂停指令

  function poll() {
    const body = JSON.stringify({ serialNumber: printer.serial, checkCode: printer.checkCode });
    const req = http.request({
      hostname: printer.host,
      port: 8898,
      path: '/detail',
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.code === 0 && j.detail) {
            const d = j.detail;
            // 首次成功轮询时输出完整响应，便于诊断可用字段
            if (firstPoll) {
              firstPoll = false;
              console.log(`[${printer.name}] 首次API响应字段: ${JSON.stringify(d, null, 2)}`);
            }
            failCount = 0;
            status.connected = true;
            status.error = '';
            const stateMap = { ready: 'IDLE', printing: 'RUNNING', paused: 'PAUSE', completed: 'FINISH', cancel: 'IDLE', error: 'ERROR', heating: 'RUNNING', busy: 'RUNNING', calibrate_doing: 'RUNNING' };
            status.gcodeState = stateMap[d.status] || d.status || 'UNKNOWN';
            status.gcodeFile = sanitizeString(d.printFileName || d.fileName || '');
            status.printProgress = Math.round((d.printProgress || 0) * 100);
            status.remainingTime = Math.round((d.estimatedTime || 0) / 60);
            status.nozzleTemp = d.rightTemp || d.nozzleTemp || 0;
            status.nozzleTarget = d.rightTargetTemp || d.targetNozzleTemp || 0;
            status.bedTemp = d.platTemp || 0;
            status.bedTarget = d.platTargetTemp || d.targetPlatTemp || 0;
            status.fanSpeed = d.coolingFanSpeed || 0;
            status.layerNum = d.printLayer || d.layer || 0;
            status.totalLayers = d.targetPrintLayer || d.totalLayer || 0;
            // 尝试从API获取耗材类型
            const rawMat = d.material || d.filamentType || d.rightFilamentType || d.extruderMaterial || '';
            if (rawMat) status.liveMaterial = sanitizeString(String(rawMat));

            // ── FlashForge 断料检测 ──────────────────────────
            // 检测 API 返回的断料相关字段（不同固件版本字段名可能不同）
            const filamentDetected =
              d.outOfFilament === true || d.outOfFilament === 1 ||
              d.filamentDetect === 0 || d.rightFilamentDetect === 0 ||
              d.filamentState === 'empty' || d.filamentState === 'out' ||
              d.filamentStatus === 'empty' || d.filamentStatus === 'out' ||
              d.noFilament === true || d.noFilament === 1;

            if (filamentDetected && status.gcodeState === 'RUNNING') {
              status.filamentOut = true;
              status.error = '耗材用完，已自动暂停';
              console.log(`[${printer.name}] ⚠ 检测到断料！正在发送暂停指令...`);
              if (!autoPauseSent) {
                autoPauseSent = true;
                pauseFlashForgePrinter(printer, '断料自动暂停');
              }
            } else if (!filamentDetected) {
              status.filamentOut = false;
              // 恢复后允许下次自动暂停
              if (status.gcodeState !== 'RUNNING') autoPauseSent = false;
            }

            status.lastUpdate = Date.now();
          } else {
            onFail(j.message || '未知错误');
          }
        } catch (e) {
          onFail('解析失败');
        }
      });
    });
    req.on('error', (e) => onFail(e.code || e.message));
    req.on('timeout', () => { req.destroy(); onFail('连接超时'); });
    req.write(body);
    req.end();
  }

  function onFail(msg) {
    failCount++;
    status.connected = false;
    status.error = msg;
    // 首次连续失败3次触发扫描，之后每10次重试扫描一次（约2.5分钟）
    const shouldScan = (failCount === 3) || (failCount > 3 && failCount % 10 === 0);
    if (shouldScan && !discovering) {
      triggerScan();
    }
  }

  function triggerScan() {
    if (discovering) return;
    discovering = true;
    status.error = '正在搜索新IP...';
    console.log(`[${printer.name}] 开始扫描新IP...`);
    discoverFlashForgeIP(printer, (found) => {
      discovering = false;
      if (found) {
        failCount = 0;
        poll();
      } else {
        status.error = '打印机离线，等待重试';
        console.log(`[${printer.name}] 未找到，将继续重试`);
      }
    });
  }

  // 注册手动触发入口
  scanTriggers[printer.id] = () => {
    failCount = 0;
    triggerScan();
  };

  poll();
  pollTimer = setInterval(poll, 15000);
}

function startFlashForgeConnections() {
  console.log('正在连接 FlashForge 打印机...');
  for (const p of FLASHFORGE_PRINTERS) {
    pollFlashForgePrinter(p);
  }
}

// 启动所有打印机连接
function startPrinterConnections() {
  if (_role === 'slave') {
    console.log('[角色] 从机模式，跳过打印机轮询，等待主机同步状态');
    return;
  }
  startBambuConnections();
  startFlashForgeConnections();
}

// ═══════════════════════════════════════════════════════
// 服务器间双向同步
// ═══════════════════════════════════════════════════════
let _remotePrinterStatus = null; // 从机：从主机同步来的打印机状态
const _syncConfig = _config.sync || {};
const _syncEnabled = _syncConfig.enabled === true;
const _syncServerId = _syncConfig.serverId || 'server-' + crypto.randomBytes(4).toString('hex');
const _syncPeer = _syncConfig.peer || {};
const _syncIntervalMs = _syncConfig.intervalMs || 30000;
let _syncLastTime = 0;
let _syncConsecutiveFailures = 0;
let _syncCurrentInterval = _syncIntervalMs;
let _syncTimer = null;

// 加载同步状态
function loadSyncState() {
  try {
    const state = JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
    _syncLastTime = state.lastSyncTime || 0;
  } catch(e) { /* 首次运行 */ }
}

// 保存同步状态
function saveSyncState() {
  try {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify({ lastSyncTime: _syncLastTime, serverId: _syncServerId }, null, 2), 'utf8');
  } catch(e) { console.error('[同步] 保存状态失败:', e.message); }
}

// 获取自 since 以来变更的记录
function getChangesSince(since) {
  const data = _cachedData ? _cachedData : loadData();
  const changes = {};
  let count = 0;
  if (data.records) {
    for (const dateStr of Object.keys(data.records)) {
      const day = data.records[dateStr];
      if (!day || !day.items) continue;
      const changedItems = day.items.filter(it => it._updatedAt && it._updatedAt > since);
      if (changedItems.length > 0) {
        changes[dateStr] = { off: day.off, items: changedItems };
        count += changedItems.length;
      }
    }
  }
  const result = { serverId: _syncServerId, timestamp: Date.now(), changes, count };
  const snapshotVer = data._snapshotUpdatedAt || 0;
  if (snapshotVer > since) {
    result.snapshot = {
      version:     snapshotVer,
      inventory:   data.inventory   || {},
      stockInLogs: data.stockInLogs || [],
      products:    data.products    || [],
      schedules:   data.schedules   || [],
      materials:   data.materials   || [],
      maintenance: data.maintenance || []
    };
  }
  return result;
}

// 应用远端快照（inventory/stockInLogs/products/schedules/materials）
function applyRemoteSnapshot(snap) {
  if (!snap || !snap.version) return;
  const data = _cachedData ? _cachedData : loadData();
  const localVer = data._snapshotUpdatedAt || 0;
  if (snap.version <= localVer) return; // 本地更新，跳过
  if (snap.inventory   !== undefined) data.inventory   = snap.inventory;
  if (snap.stockInLogs !== undefined) {
    // 合并而非覆盖：保留本地新增的条目，合并远端条目
    const localById = {};
    for (const l of (data.stockInLogs || [])) { localById[l.id] = l; }
    for (const rl of snap.stockInLogs) {
      rl._syncedAt = Date.now();
      localById[rl.id] = rl;
    }
    data.stockInLogs = Object.values(localById).sort((a, b) => b.id - a.id);
  }
  if (snap.products    !== undefined) data.products    = snap.products;
  if (snap.schedules   !== undefined) {
    // 合并而非覆盖：保留本地新增的排期，合并远端排期
    const localById = {};
    for (const s of (data.schedules || [])) { localById[s.id] = s; }
    for (const rs of snap.schedules) {
      rs._syncedAt = Date.now();
      localById[rs.id] = rs;
    }
    data.schedules = Object.values(localById).sort((a, b) => a.id - b.id);
  }
  if (snap.materials   !== undefined) data.materials   = snap.materials;
  if (snap.maintenance !== undefined) {
    // 合并而非覆盖：保留本地新增的维修记录，合并远端记录
    const localById = {};
    for (const m of (data.maintenance || [])) { localById[m.id] = m; }
    for (const rm of snap.maintenance) {
      rm._syncedAt = Date.now();
      localById[rm.id] = rm;
    }
    data.maintenance = Object.values(localById).sort((a, b) => b.id - a.id);
  }
  data._snapshotUpdatedAt = snap.version;
  saveData(data);
  console.log(`[同步] 快照已更新 v${snap.version} (${new Date(snap.version).toLocaleTimeString()})`);
}

// 合并远程变更到本地
function mergeRemoteChanges(remoteChanges, remoteServerId) {
  const data = _cachedData ? _cachedData : loadData();
  let merged = 0, skipped = 0;

  for (const dateStr of Object.keys(remoteChanges)) {
    const remoteDayData = remoteChanges[dateStr];
    if (!remoteDayData || !remoteDayData.items) continue;

    if (!data.records[dateStr]) {
      data.records[dateStr] = { off: remoteDayData.off || false, items: [] };
    }
    const localDay = data.records[dateStr];
    if (!localDay.items) localDay.items = [];
    // 合并 off 字段（如有变化取远程值）
    if (remoteDayData.off !== undefined && remoteDayData.off !== localDay.off) {
      localDay.off = remoteDayData.off;
    }

    // 构建本地 _id 索引
    const localById = {};
    for (let i = 0; i < localDay.items.length; i++) {
      if (localDay.items[i]._id) localById[localDay.items[i]._id] = i;
    }

    for (const remoteItem of remoteDayData.items) {
      if (!remoteItem._id) continue;

      const localIdx = localById[remoteItem._id];

      if (localIdx === undefined) {
        // 本地不存在：去重检查（同一 machine + 相似任务，包括已删除的记录）
        const dup = localDay.items.find(li => {
          if (li.machine != remoteItem.machine) return false;
          // 用 _gcodeFile 匹配（同一天同一机器同一文件视为同一任务）
          if (li._gcodeFile && remoteItem._gcodeFile && li._gcodeFile === remoteItem._gcodeFile) {
            // 但已完成记录不匹配在其之后开始的新任务（同文件重印）
            if (li.printEndTime && remoteItem.printStartTime &&
                new Date(remoteItem.printStartTime).getTime() > new Date(li.printEndTime).getTime()) return false;
            return true;
          }
          // printStartTime 精确匹配
          if (li.printStartTime && remoteItem.printStartTime && li.printStartTime === remoteItem.printStartTime) return true;
          // printStartTime 在 15 分钟内且产品名相同
          if (li.printStartTime && remoteItem.printStartTime) {
            const localStart = new Date(li.printStartTime).getTime();
            const remoteStart = new Date(remoteItem.printStartTime).getTime();
            const diff = Math.abs(remoteStart - localStart);
            if (diff < 15 * 60 * 1000 && li.productName && remoteItem.productName &&
                li.productName.replace(/\.$/, '') === remoteItem.productName.replace(/\.$/, '')) return true;
          }
          // 同产品+同耗时+同报价+开始时间在耗时范围内：大概率是同一任务的重复记录
          if (li.productName && remoteItem.productName &&
              li.productName === remoteItem.productName &&
              li.time != null && remoteItem.time != null &&
              li.time === remoteItem.time &&
              li.price != null && remoteItem.price != null &&
              li.price === remoteItem.price) {
            // 如果两条记录的开始时间间隔大于耗时，说明是二次打印，不是重复
            if (li.printStartTime && remoteItem.printStartTime && li.time > 0) {
              const diff = Math.abs(new Date(li.printStartTime).getTime() - new Date(remoteItem.printStartTime).getTime());
              if (diff >= li.time * 3600 * 1000) return false;
            }
            return true;
          }
          // 有一方没有 printStartTime（补录记录）且产品名一致且创建时间接近，视为同一任务
          if ((!li.printStartTime || !remoteItem.printStartTime) &&
              li.productName && remoteItem.productName &&
              li.productName === remoteItem.productName &&
              li.createdAt && remoteItem.createdAt &&
              Math.abs(new Date(li.createdAt).getTime() - new Date(remoteItem.createdAt).getTime()) < 60000) return true;
          return false;
        });
        if (dup) {
          // 本地已删除：远程同一任务不再恢复，跳过
          if (dup._deleted) {
            skipped++;
            continue;
          }
          // 有重复：保留更新时间更晚的
          if (remoteItem._updatedAt > (dup._updatedAt || 0)) {
            // 远程更新但如果远程也被删了就标记删除
            const oldId = dup._id;
            Object.assign(dup, remoteItem);
            // 保留本地 _id（避免下次同步又识别不到）
            dup._id = oldId;
            dup._mergedAt = Date.now();
            merged++;
          } else {
            skipped++;
          }
          continue;
        }
        // 检查是否匹配本地已删除的记录（防止删了又被推回来）
        const deletedMatch = localDay.items.find(li => {
          if (!li._deleted || li.machine != remoteItem.machine) return false;
          if (li._gcodeFile && remoteItem._gcodeFile && li._gcodeFile === remoteItem._gcodeFile) return true;
          if (li.productName && remoteItem.productName && li.productName === remoteItem.productName) return true;
          return false;
        });
        if (deletedMatch) {
          skipped++;
          continue;
        }
        // 新记录，插入
        remoteItem._mergedAt = Date.now();
        localDay.items.push(remoteItem);
        merged++;
      } else {
        // 本地已有：比较 _updatedAt，取更新的
        const localItem = localDay.items[localIdx];
        if (remoteItem._updatedAt > (localItem._updatedAt || 0)) {
          remoteItem._mergedAt = Date.now();
          localDay.items[localIdx] = remoteItem;
          merged++;
        } else {
          skipped++;
        }
      }
    }
  }

  if (merged > 0) {
    // 更新快照版本，使本机下次向对方推送时包含最新数据（防止旧快照覆盖新增记录）
    data._snapshotUpdatedAt = Date.now();
    saveData(data);
  }
  return { merged, skipped };
}

// HTTP 请求工具（原生 http，零依赖）
function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch(e) {
          reject(new Error('响应解析失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('请求超时')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// 同步循环
async function doSync() {
  if (!_syncEnabled || !_syncPeer.host) return;

  const authStr = Buffer.from((_syncPeer.username || _authUser) + ':' + (_syncPeer.password || _authPass)).toString('base64');
  const baseHeaders = {
    'Authorization': 'Basic ' + authStr,
    'Content-Type': 'application/json'
  };

  try {
    // 记录本轮同步开始的本机时间（用于游标，避免跨服务器时钟差异）
    const syncStartTime = Date.now();

    // 1. PULL：从对方拉取变更
    const pullRes = await httpRequest({
      hostname: _syncPeer.host,
      port: _syncPeer.port || 3000,
      path: '/api/sync/changes?since=' + _syncLastTime,
      method: 'GET',
      headers: baseHeaders
    });

    if (pullRes.statusCode !== 200) {
      throw new Error('拉取失败: HTTP ' + pullRes.statusCode);
    }

    const remoteData = pullRes.body;

    // 2. PUSH：必须在合并远端数据之前采集，避免把对方刚推来的数据再回传
    const localChanges = getChangesSince(_syncLastTime);

    // 3. 应用远端变更和快照
    let pullMerged = 0;
    if (remoteData.changes && Object.keys(remoteData.changes).length > 0) {
      const result = mergeRemoteChanges(remoteData.changes, remoteData.serverId);
      pullMerged = result.merged;
      if (pullMerged > 0) {
        console.log(`[同步] 拉取并合并 ${pullMerged} 条变更`);
      }
    }
    if (remoteData.snapshot) {
      applyRemoteSnapshot(remoteData.snapshot);
    }
    if (localChanges.count > 0 || localChanges.snapshot) {
      const pushData = JSON.stringify(localChanges);
      const pushRes = await httpRequest({
        hostname: _syncPeer.host,
        port: _syncPeer.port || 3000,
        path: '/api/sync/merge',
        method: 'POST',
        headers: { ...baseHeaders, 'Content-Length': Buffer.byteLength(pushData) }
      }, pushData);

      if (pushRes.statusCode === 200) {
        console.log(`[同步] 推送 ${localChanges.count} 条变更，合并 ${pushRes.body.merged || 0} 条`);
      } else {
        console.warn(`[同步] 推送响应: HTTP ${pushRes.statusCode}`);
      }
    }

    // 3. 更新同步游标（使用本机时间，而非对方服务器时间）
    _syncLastTime = syncStartTime;
    saveSyncState();

    // 4. 推送打印机状态到从机（仅主机执行）
    if (_role === 'master') {
      const statusPayload = JSON.stringify({ printerStatus });
      httpRequest({
        hostname: _syncPeer.host,
        port: _syncPeer.port || 3000,
        path: '/api/printers/push',
        method: 'POST',
        headers: { ...baseHeaders, 'Content-Length': Buffer.byteLength(statusPayload) }
      }, statusPayload).catch(e => {
        console.warn('[同步] 推送打印机状态失败:', e.message);
      });
    }

    // 5. 从主机拉取打印机实时状态（仅从机执行，作为推送失败时的保底机制）
    if (_role === 'slave') {
      try {
        const statusRes = await httpRequest({
          hostname: _syncPeer.host,
          port: _syncPeer.port || 3000,
          path: '/api/printers',
          method: 'GET',
          headers: baseHeaders
        });
        if (statusRes.body && typeof statusRes.body === 'object') {
          _remotePrinterStatus = statusRes.body;
        }
      } catch(e) {
        console.warn('[同步] 拉取主机打印机状态失败:', e.message);
      }
    }

    // 重置失败计数和间隔
    if (_syncConsecutiveFailures > 0) {
      console.log('[同步] 连接恢复');
    }
    _syncConsecutiveFailures = 0;
    _syncCurrentInterval = _syncIntervalMs;

  } catch(e) {
    _syncConsecutiveFailures++;
    // 指数退避：30s → 60s → 120s → 最大 300s
    _syncCurrentInterval = Math.min(_syncIntervalMs * Math.pow(2, _syncConsecutiveFailures - 1), 300000);
    if (_syncConsecutiveFailures <= 3 || _syncConsecutiveFailures % 10 === 0) {
      console.error(`[同步] 失败(${_syncConsecutiveFailures}次): ${e.message}，下次重试 ${Math.round(_syncCurrentInterval/1000)}s 后`);
    }
  }

  // 调度下一次同步
  _syncTimer = setTimeout(doSync, _syncCurrentInterval);
}

// 启动同步
function startSyncLoop() {
  if (!_syncEnabled) {
    console.log('[同步] 未启用（在 config.json 中配置 sync.enabled: true 开启）');
    return;
  }
  if (!_syncPeer.host) {
    console.log('[同步] 未配置对方服务器地址（sync.peer.host）');
    return;
  }
  loadSyncState();
  console.log(`[同步] 已启用，对方服务器: ${_syncPeer.host}:${_syncPeer.port || 3000}，间隔: ${_syncIntervalMs/1000}s`);
  console.log(`[同步] 本机ID: ${_syncServerId}，上次同步: ${_syncLastTime ? new Date(_syncLastTime).toLocaleString() : '从未'}`);
  // 首次同步延迟5秒，等待打印机连接建立
  _syncTimer = setTimeout(doSync, 5000);
}

// ═══════════════════════════════════════════════════════
// HTTP 服务器
// ═══════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 健康检查（无需认证，供 nginx / 门户探测）
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok'}));
    return;
  }

  // 所有请求需要 Basic Auth
  if (!requireAuth(req, res)) return;

  if (req.url === '/api/data' && req.method === 'GET') {
    const data = loadData();
    data._version = dataVersion;
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  }
  else if (req.url === '/api/data' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 10 * 1024 * 1024) {
        if (!aborted) {
          aborted = true;
          res.writeHead(413);
          res.end(JSON.stringify({error: '数据过大'}));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const data = JSON.parse(body);
        // 输入校验：必须是对象且不能是数组
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: '数据格式错误，需要JSON对象'}));
          return;
        }
        // 乐观锁：检查客户端提交的 _version 是否匹配当前服务器版本
        if (data._version !== undefined && data._version !== dataVersion) {
          const latest = loadData();
          latest._version = dataVersion;
          res.writeHead(409, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '数据冲突，其他用户已更新数据', latestData: latest}));
          return;
        }
        // 结构校验
        if (data.settings && typeof data.settings !== 'object') {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'settings 格式无效'}));
          return;
        }
        if (data.materials && !Array.isArray(data.materials)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'materials 必须是数组'}));
          return;
        }
        if (data.products && !Array.isArray(data.products)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'products 必须是数组'}));
          return;
        }
        if (data.records && typeof data.records !== 'object') {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'records 格式无效'}));
          return;
        }
        if (data.maintenance && !Array.isArray(data.maintenance)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'maintenance 必须是数组'}));
          return;
        }
        if (data.inventory && (typeof data.inventory !== 'object' || Array.isArray(data.inventory))) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'inventory 格式无效'}));
          return;
        }
        if (data.stockInLogs && !Array.isArray(data.stockInLogs)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'stockInLogs 必须是数组'}));
          return;
        }
        if (data.schedules && !Array.isArray(data.schedules)) {
          res.writeHead(400);
          res.end(JSON.stringify({error: 'schedules 必须是数组'}));
          return;
        }
        delete data._version;
        // 处理记录的 _id、_updatedAt 和软删除
        if (data.records && _cachedData && _cachedData.records) {
          const oldRecords = _cachedData.records;
          for (const dateStr of Object.keys(data.records)) {
            const day = data.records[dateStr];
            if (!day || !day.items) continue;
            const oldDay = oldRecords[dateStr];
            const oldItems = (oldDay && oldDay.items) || [];
            // 构建旧记录的 _id 索引
            const oldById = {};
            for (const oi of oldItems) {
              if (oi._id) oldById[oi._id] = oi;
            }
            // 为新 item 分配 _id，检测变更并更新 _updatedAt
            for (const item of day.items) {
              if (!item._id) {
                item._id = generateId();
                item._updatedAt = Date.now();
              } else {
                const oldItem = oldById[item._id];
                if (oldItem) {
                  // 先保留旧的 _updatedAt（前端可能未传回此字段）
                  if (!item._updatedAt && oldItem._updatedAt) {
                    item._updatedAt = oldItem._updatedAt;
                  }
                  // 保护服务端自动记录字段：printEndTime/printStartTime/_gcodeFile/autoRecord
                  // 这些字段仅由服务端 checkPrinterTransitions 设置，前端推送的旧数据不应覆盖
                  if (oldItem.autoRecord) {
                    if (oldItem.printEndTime && !item.printEndTime) {
                      item.printEndTime = oldItem.printEndTime;
                    }
                    if (oldItem.printStartTime && !item.printStartTime) {
                      item.printStartTime = oldItem.printStartTime;
                    }
                    if (oldItem._gcodeFile && !item._gcodeFile) {
                      item._gcodeFile = oldItem._gcodeFile;
                    }
                    if (!item.autoRecord) {
                      item.autoRecord = true;
                    }
                  }
                  // 检查内容是否变化（忽略内部字段）
                  const changed = ['productName','material','weight','qty','time','price','remark','status','machine'].some(
                    k => JSON.stringify(item[k]) !== JSON.stringify(oldItem[k])
                  );
                  if (changed) item._updatedAt = Date.now();
                } else {
                  // item 有 _id 但不在旧数据中（可能从其他地方来）
                  if (!item._updatedAt) item._updatedAt = Date.now();
                }
              }
            }
            // 软删除：旧记录中有但新数据中没有的 item
            // 用 _version（时间戳）区分：前端加载之后新增的记录（来自同步/自动记录）应保留
            const newIds = new Set(day.items.map(it => it._id));
            const frontendLoadTime = data._version || 0;
            for (const oi of oldItems) {
              if (oi._id && !newIds.has(oi._id) && !oi._deleted) {
                const protectTime = Math.max(oi._updatedAt || 0, oi._mergedAt || 0);
                if (protectTime > frontendLoadTime) {
                  // 前端加载后由同步/自动记录新增的，保留
                  day.items.push(oi);
                } else {
                  // 前端加载时已存在但用户删除了，标记软删除
                  oi._deleted = true;
                  oi._updatedAt = Date.now();
                  day.items.push(oi);
                }
              }
            }
          }
        }
        // 保留前端未提交但缓存中存在的日期（由同步添加的）
        if (_cachedData && _cachedData.records) {
          for (const dateStr of Object.keys(_cachedData.records)) {
            if (!data.records[dateStr]) {
              data.records[dateStr] = _cachedData.records[dateStr];
            }
          }
        }
        // 保护快照数组（schedules/stockInLogs/products/materials）：
        // 前端加载后由同步新增的条目不应被前端旧数据覆盖
        const frontendLoadTime = data._version || 0;
        if (_cachedData && frontendLoadTime) {
          // schedules：保留前端加载后由同步新增的排期
          if (_cachedData.schedules && Array.isArray(data.schedules)) {
            const frontIds = new Set(data.schedules.map(s => s.id));
            for (const cs of _cachedData.schedules) {
              if (!frontIds.has(cs.id) && cs._syncedAt && cs._syncedAt > frontendLoadTime) {
                data.schedules.push(cs);
              }
            }
          }
          // stockInLogs：保留前端加载后由同步新增的入库记录
          if (_cachedData.stockInLogs && Array.isArray(data.stockInLogs)) {
            const frontLogIds = new Set(data.stockInLogs.map(l => l.id));
            for (const cl of _cachedData.stockInLogs) {
              if (!frontLogIds.has(cl.id) && cl._syncedAt && cl._syncedAt > frontendLoadTime) {
                data.stockInLogs.push(cl);
              }
            }
          }
          // maintenance：保留前端加载后由同步新增的维修记录
          if (_cachedData.maintenance && Array.isArray(data.maintenance)) {
            const frontMaintIds = new Set(data.maintenance.map(m => m.id));
            for (const cm of _cachedData.maintenance) {
              if (!frontMaintIds.has(cm.id) && cm._syncedAt && cm._syncedAt > frontendLoadTime) {
                data.maintenance.push(cm);
              }
            }
          }
        }
        // 仅当快照字段有变化时才更新版本号，避免每次保存都触发全量快照推送
        const prev = _cachedData || {};
        const snapChanged = JSON.stringify(data.inventory) !== JSON.stringify(prev.inventory) ||
          JSON.stringify(data.stockInLogs) !== JSON.stringify(prev.stockInLogs) ||
          JSON.stringify(data.products) !== JSON.stringify(prev.products) ||
          JSON.stringify(data.schedules) !== JSON.stringify(prev.schedules) ||
          JSON.stringify(data.materials) !== JSON.stringify(prev.materials) ||
          JSON.stringify(data.maintenance) !== JSON.stringify(prev.maintenance);
        if (snapChanged) data._snapshotUpdatedAt = Date.now();
        saveData(data);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true, version: dataVersion}));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({error: e.message}));
      }
    });
  }
  else if (req.url === '/api/version' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({version: dataVersion}));
  }
  else if (req.url === '/api/printers' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    const statusToReturn = (_role === 'slave') ? (_remotePrinterStatus || {}) : printerStatus;
    res.end(JSON.stringify(statusToReturn));
  }
  else if (req.url === '/api/printers/push' && req.method === 'POST') {
    // 从机专用：接收主机推送的打印机状态
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body && body.printerStatus) {
          _remotePrinterStatus = body.printerStatus;
        }
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }
  else if (req.url.startsWith('/api/printers/') && req.url.endsWith('/rescan') && req.method === 'POST') {
    const id = parseInt(req.url.split('/')[3]);
    if (scanTriggers[id]) {
      scanTriggers[id]();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: true, message: `#${id} 正在扫描新IP...`}));
    } else {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '该打印机不支持IP扫描'}));
    }
  }
  else if (req.url === '/api/printers/rescan-all' && req.method === 'POST') {
    const triggered = [];
    for (const [id, fn] of Object.entries(scanTriggers)) {
      if (!printerStatus[id] || !printerStatus[id].connected) { fn(); triggered.push(id); }
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: true, triggered}));
  }
  else if (req.url === '/api/printers/jobs' && req.method === 'GET') {
    const jobs = {};
    for (const [id, prev] of Object.entries(printerPrevState)) {
      if (prev.gcodeState === 'RUNNING' && prev.startTime) {
        jobs[id] = { startTime: prev.startTime, gcodeFile: prev.gcodeFile };
      }
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(jobs));
  }
  // 同步 API
  else if (req.url.startsWith('/api/sync/changes') && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const since = parseInt(url.searchParams.get('since') || '0') || 0;
    const result = getChangesSince(since);
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(result));
  }
  else if (req.url === '/api/sync/merge' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let aborted = false;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 20 * 1024 * 1024) {
        if (!aborted) { aborted = true; res.writeHead(413); res.end(JSON.stringify({error: '数据过大'})); req.destroy(); }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body.changes) {
          res.writeHead(400);
          res.end(JSON.stringify({error: '缺少 changes 字段'}));
          return;
        }
        const result = mergeRemoteChanges(body.changes, body.serverId);
        if (body.snapshot) {
          applyRemoteSnapshot(body.snapshot);
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ ok: true, merged: result.merged, skipped: result.skipped }));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({error: e.message}));
      }
    });
  }
  else if (req.url === '/api/reload' && req.method === 'POST') {
    _cachedData = null;
    loadData();
    dataVersion = Date.now();
    console.log('[重载] data.json 已重新加载');
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok: true, message: 'data.json 已重新加载' }));
  }
  else if (req.url === '/api/sync/status' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({
      enabled: _syncEnabled,
      serverId: _syncServerId,
      peer: _syncPeer.host ? (_syncPeer.host + ':' + (_syncPeer.port || 3000)) : null,
      lastSyncTime: _syncLastTime,
      consecutiveFailures: _syncConsecutiveFailures,
      currentInterval: _syncCurrentInterval
    }));
  }
  else {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end('File not found'); return; }
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
      res.end(data);
    });
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  console.log('');
  console.log('==============================================');
  console.log('  3D打印部门管理系统 - 多人协作版');
  console.log('==============================================');
  console.log('');
  console.log('  本机访问:');
  console.log(`    http://localhost:${PORT}`);
  console.log('');
  console.log('  局域网访问 (发给同事):');
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`    http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('');
  console.log('  数据文件: ' + DATA_FILE);
  console.log('  多人同时访问，数据自动同步');
  console.log('  按 Ctrl+C 停止服务');
  console.log('==============================================');
  console.log('');

  // 启动时修复已有乱码数据
  repairCorruptedData(loadData());

  // 为已有记录分配唯一ID（数据迁移）
  ensureItemIds();

  // 服务器启动后连接打印机
  startPrinterConnections();

  // 每10秒检查打印机状态转换，自动录入记录
  setInterval(checkPrinterTransitions, 10000);

  // 启动服务器间同步
  startSyncLoop();
});
