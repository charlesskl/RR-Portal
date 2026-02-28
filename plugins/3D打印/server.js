const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const tls = require('tls');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_PATH || path.join(__dirname, 'data.json');
const HTML_FILE = path.join(__dirname, 'index.html');
let dataVersion = Date.now();

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { settings: null, materials: null, products: null, records: {} }; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  dataVersion = Date.now();
}

// ═══════════════════════════════════════════════════════
// Bambu Lab P1S MQTT 连接
// ═══════════════════════════════════════════════════════
// Bambu 打印机：支持环境变量覆盖（BAMBU_<N>_IP 等），未设置则用默认值
const BAMBU_DEFAULTS = [
  { id: 1, name: '#1 Bambu-P1S', host: '192.168.3.110', serial: '01P00C582902324', accessCode: 'afac48c7' },
  { id: 2, name: '#2 Bambu-P1S', host: '192.168.3.176', serial: '01P00C592700512', accessCode: '82d12653' },
  { id: 3, name: '#3 Bambu-P1S', host: '192.168.2.119', serial: '01P00C591702482', accessCode: 'a482660b' },
  { id: 4, name: '#4 Bambu-P1S', host: '192.168.3.157', serial: '01P00C5A2100903', accessCode: 'b312e989' },
  { id: 5, name: '#5 Bambu-P1S', host: '192.168.3.218', serial: '01P00C5A2100741', accessCode: '95447a1a' },
];
const BAMBU_PRINTERS = BAMBU_DEFAULTS.map(d => ({
  id: d.id,
  name: process.env[`BAMBU_${d.id}_NAME`] || d.name,
  host: process.env[`BAMBU_${d.id}_IP`] || d.host,
  serial: process.env[`BAMBU_${d.id}_SERIAL`] || d.serial,
  accessCode: process.env[`BAMBU_${d.id}_ACCESS_CODE`] || d.accessCode,
}));

// 打印机实时状态存储
const printerStatus = {};

// 打印机上一次状态（用于检测状态转换，自动录入记录）
const printerPrevState = {};

// 从 gcode 文件名匹配产品库
function matchProductFromGcode(gcodeFile, products) {
  if (!gcodeFile || !products || !products.length) return null;
  let name = gcodeFile.replace(/^.*[\/\\]/, '')
    .replace(/\.gcode\.3mf$/i, '')
    .replace(/\.(3mf|gcode)$/i, '')
    .replace(/_\d+$/, '');
  for (const p of products) {
    if (name.includes(p.name) || p.name.includes(name)) return p;
  }
  return null;
}

// 检查打印机状态转换，自动创建/完成每日记录
function checkPrinterTransitions() {
  const now = new Date();
  const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  const data = loadData();
  let changed = false;

  for (const [id, status] of Object.entries(printerStatus)) {
    if (!status.connected) continue;
    const prev = printerPrevState[id] || { gcodeState: 'UNKNOWN', gcodeFile: '' };
    const curr = { gcodeState: status.gcodeState, gcodeFile: status.gcodeFile };

    // 非RUNNING → RUNNING：开始打印，自动创建记录
    if (curr.gcodeState === 'RUNNING' && prev.gcodeState !== 'RUNNING') {
      if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
      const day = data.records[todayStr];

      // 避免重复：检查是否已有该机台+同一文件的未完成记录
      const exists = day.items.find(it =>
        it.machine == id && it.autoRecord && it._gcodeFile === curr.gcodeFile && !it.printEndTime
      );
      if (!exists) {
        const matched = matchProductFromGcode(curr.gcodeFile, data.products || []);
        const cleanName = sanitizeString(curr.gcodeFile.replace(/^.*[\/\\]/, '')
          .replace(/\.gcode\.3mf$/i, '').replace(/\.(3mf|gcode)$/i, ''));

        day.items.push({
          machine: parseInt(id),
          status: 'running',
          productName: matched ? matched.name : (cleanName || '未知产品'),
          material: matched ? matched.material : '',
          weight: matched ? matched.weight : 0,
          qty: 1,
          time: 0,
          price: matched ? matched.price : 0,
          remark: '',
          autoRecord: true,
          printStartTime: now.toISOString(),
          printEndTime: null,
          _gcodeFile: curr.gcodeFile
        });
        changed = true;
        console.log(`[自动记录] #${id} 开始打印: ${cleanName || curr.gcodeFile}`);
      }
      printerPrevState[id] = { ...curr, startTime: Date.now() };
    }
    // RUNNING → FINISH/IDLE/FAILED：打印结束，填入耗时
    else if (prev.gcodeState === 'RUNNING' &&
             (curr.gcodeState === 'FINISH' || curr.gcodeState === 'IDLE' || curr.gcodeState === 'FAILED')) {
      if (!data.records[todayStr]) data.records[todayStr] = { off: false, items: [] };
      const day = data.records[todayStr];

      // 查找该机台未完成的自动记录
      const rec = day.items.find(it =>
        it.machine == id && it.autoRecord && !it.printEndTime
      );
      if (rec) {
        rec.printEndTime = now.toISOString();
        const elapsed = (Date.now() - new Date(rec.printStartTime).getTime()) / 3600000;
        rec.time = Math.round(elapsed * 10) / 10;
        if (curr.gcodeState === 'FAILED') rec.remark = '打印失败';
        changed = true;
        console.log(`[自动记录] #${id} 完成打印, 耗时 ${rec.time}h`);
      }
      printerPrevState[id] = { ...curr, startTime: null };
    }
    else {
      printerPrevState[id] = { ...prev, gcodeState: curr.gcodeState, gcodeFile: curr.gcodeFile };
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
    let mult = 1, len = 0, j = i + 1;
    if (j >= buf.length) break;
    do {
      if (j >= buf.length) return packets;
      const b = buf[j++];
      len += (b & 127) * mult;
      mult *= 128;
    } while (buf[j - 1] & 128);
    if (j + len > buf.length) break;
    packets.push({ type, firstByte, data: buf.slice(j, j + len), offset: i, end: j + len });
    i = j + len;
  }
  return packets;
}

// 清理字符串中的乱码字符（替换字符 U+FFFD、孤立代理项）
function sanitizeString(str) {
  if (!str) return str;
  return str.replace(/[\uFFFD\uD800-\uDFFF]/g, '');
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
    error: ''
  };
  printerStatus[printer.id] = status;

  let sock = null;
  let buf = Buffer.alloc(0);
  let reconnectTimer = null;
  let pingTimer = null;
  let connected = false;

  function connect() {
    if (sock) { try { sock.destroy(); } catch (e) {} }
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
      // Reconnect after 10s
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        console.log(`[${printer.name}] 重新连接...`);
        connect();
      }, 10000);
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
// FlashForge 打印机：支持环境变量覆盖（FLASHFORGE_<N>_IP 等），未设置则用默认值
const FLASHFORGE_DEFAULTS = [
  { id: 6,  n: 1, name: '#6 3D001', host: '192.168.3.181', serial: 'SNMQLE9304144', checkCode: '9813175a' },
  { id: 7,  n: 2, name: '#7 3D002', host: '192.168.2.204', serial: 'SNMQLE9303444', checkCode: '1e33b1cf' },
  { id: 8,  n: 3, name: '#8 3D003', host: '192.168.3.117', serial: 'SNMQLE9303778', checkCode: 'bdf9dcc1' },
  { id: 9,  n: 4, name: '#9 3D004', host: '192.168.2.222', serial: 'SNMQLE9502392', checkCode: 'd7e6f9e7' },
  { id: 10, n: 5, name: '#10 3D005', host: '192.168.3.84',  serial: 'SNMQLE9500845', checkCode: '38fb5b2d' },
];
const FLASHFORGE_PRINTERS = FLASHFORGE_DEFAULTS.map(d => ({
  id: d.id,
  name: process.env[`FLASHFORGE_${d.n}_NAME`] || d.name,
  host: process.env[`FLASHFORGE_${d.n}_IP`] || d.host,
  serial: process.env[`FLASHFORGE_${d.n}_SERIAL`] || d.serial,
  checkCode: process.env[`FLASHFORGE_${d.n}_CHECK_CODE`] || d.checkCode,
}));

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

  const body = JSON.stringify({ serialNumber: printer.serial, checkCode: printer.checkCode });
  let found = false;
  let pending = 0;

  for (const subnet of subnets) {
    for (let i = 1; i <= 254; i++) {
      if (found) return;
      const ip = subnet + '.' + i;
      pending++;
      const req = http.request({
        hostname: ip, port: 8898, path: '/detail', method: 'POST', timeout: 3000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          pending--;
          if (found) return;
          try {
            const j = JSON.parse(data);
            if (j.code === 0 && j.detail) {
              found = true;
              console.log(`[${printer.name}] 发现新IP: ${ip} (原: ${printer.host})`);
              printer.host = ip;
              callback(true);
            }
          } catch (e) {}
          if (pending === 0 && !found) callback(false);
        });
      });
      req.on('error', () => { pending--; if (pending === 0 && !found) callback(false); });
      req.on('timeout', () => { req.destroy(); });
      req.write(body);
      req.end();
    }
  }
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
    error: ''
  };
  printerStatus[printer.id] = status;

  let failCount = 0;
  let discovering = false;

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
            failCount = 0;
            status.connected = true;
            status.error = '';
            const stateMap = { ready: 'IDLE', printing: 'RUNNING', paused: 'PAUSE', completed: 'FINISH', cancel: 'IDLE', error: 'ERROR', heating: 'RUNNING', busy: 'RUNNING', calibrate_doing: 'RUNNING' };
            status.gcodeState = stateMap[d.status] || d.status || 'UNKNOWN';
            status.gcodeFile = d.fileName || '';
            status.printProgress = d.progress || 0;
            status.remainingTime = Math.round((d.estimatedTime || 0) / 60);
            status.nozzleTemp = d.nozzleTemp || 0;
            status.nozzleTarget = d.targetNozzleTemp || 0;
            status.bedTemp = d.platTemp || 0;
            status.bedTarget = d.targetPlatTemp || 0;
            status.fanSpeed = d.coolingFanSpeed || 0;
            status.layerNum = d.layer || 0;
            status.totalLayers = d.totalLayer || 0;
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
    // 连续失败3次，自动扫描新IP
    if (failCount >= 3 && !discovering) {
      discovering = true;
      status.error = '正在搜索新IP...';
      console.log(`[${printer.name}] 连续失败${failCount}次，开始扫描新IP...`);
      discoverFlashForgeIP(printer, (found) => {
        discovering = false;
        if (found) {
          failCount = 0;
          poll();
        } else {
          status.error = '未找到打印机，等待下次重试';
          console.log(`[${printer.name}] 未找到，将继续重试`);
        }
      });
    }
  }

  poll();
  setInterval(poll, 15000);
}

function startFlashForgeConnections() {
  console.log('正在连接 FlashForge 打印机...');
  for (const p of FLASHFORGE_PRINTERS) {
    pollFlashForgePrinter(p);
  }
}

// 启动所有打印机连接
function startPrinterConnections() {
  startBambuConnections();
  startFlashForgeConnections();
}

// ═══════════════════════════════════════════════════════
// HTTP 服务器
// ═══════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/api/data' && req.method === 'GET') {
    const data = loadData();
    data._version = dataVersion;
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  }
  else if (req.url === '/api/data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        delete data._version;
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
    res.end(JSON.stringify(printerStatus));
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
  else {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end('File not found'); return; }
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
      res.end(data);
    });
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

  // 服务器启动后连接打印机
  startPrinterConnections();

  // 每10秒检查打印机状态转换，自动录入记录
  setInterval(checkPrinterTransitions, 10000);
});
