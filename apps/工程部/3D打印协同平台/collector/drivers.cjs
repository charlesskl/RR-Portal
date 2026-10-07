const http=require('node:http'),tls=require('node:tls'),os=require('node:os'),crypto=require('node:crypto');
exports.start=function(_config){const _role='master',printerStatus={},scanTriggers={},BAMBU_PRINTERS=_config.bambuPrinters||[];function saveDiscoveredIPs(){}
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
function discoverBambuIP(printer,callback){callback(false);}
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
const FLASHFORGE_PRINTERS = _config.flashForgePrinters || [];

// FlashForge IP 自动发现：扫描局域网找到打印机真实 IP
function discoverFlashForgeIP(printer,callback){callback(false);}
function pauseFlashForgePrinter(){ /* Read-only collector never controls printers. */ }
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

startPrinterConnections();return printerStatus;};
