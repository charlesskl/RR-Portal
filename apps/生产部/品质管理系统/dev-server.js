/* Kimi Work 预览入口：转发 --port/--host 参数给 QC 后端（server/server.js 读取 process.env.PORT） */
'use strict';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' && args[i + 1]) process.env.PORT = args[i + 1];
  else if (a.startsWith('--port=')) process.env.PORT = a.slice('--port='.length);
  // server.js 固定监听 0.0.0.0，--host 无需处理
}
require('./server/server.js');
