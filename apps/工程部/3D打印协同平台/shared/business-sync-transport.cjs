const http = require('node:http');
const {Transform} = require('node:stream');
const {StringDecoder} = require('node:string_decoder');

const MAX_BYTES = 128 * 1024 * 1024;
const error = (status, message) => Object.assign(new Error(message), {status});

function replyJSON(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  try {
    const text = JSON.stringify(data);
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      ...(status >= 400 ? {Connection: 'close'} : {})});
    res.end(text);
  } catch {
    res.destroy();
  }
}

// Decode incrementally so incoming Buffers do not remain retained alongside the
// parsed document. StringDecoder preserves UTF-8 split across network chunks.
function readJSON(req, {maxBytes = MAX_BYTES} = {}) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let parts = [], size = 0, done = false;
    const finish = (failure, value) => {
      if (done) return;
      done = true;
      parts.length = 0;
      req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAbort); req.off('error', onError);
      // A reset may emit error after aborted; it must never become an unhandled event.
      req.on('error', () => {});
      if (failure) { req.resume(); reject(failure); } else resolve(value);
    };
    const onAbort = () => finish(error(400, '同步上传已中断'));
    const onError = () => finish(error(400, '同步上传读取失败'));
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBytes) return finish(error(413, '同步资料超过大小限制'));
      parts.push(decoder.write(chunk));
    };
    const onEnd = () => {
      try {
        parts.push(decoder.end());
        let text = parts.join('');
        parts.length = 0;
        const value = JSON.parse(text);
        text = '';
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
        finish(null, value);
      } catch { finish(error(400, '无效同步数据')); }
    };
    req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAbort); req.on('error', onError);
    if (Number(req.headers['content-length']) > maxBytes) finish(error(413, '同步资料超过大小限制'));
    else if (req.aborted || req.destroyed) onAbort();
  });
}

// The internal collector route does not accept caller-selected operations or a
// caller-selected station. Only the authenticated cloud proxy supplies station.
function collectorInput(input, station) {
  if(input.authority===1)return {action:'authority-exchange',protocol:1,station,clientId:input.clientId,remote:input.remote,receipts:input.receipts};
  return input.probe
    ? {action: 'probe', station, clientId: input.clientId, baseHash: input.baseHash, remoteHash: input.remoteHash}
    : {action: 'exchange', station, clientId: input.clientId, base: input.base, remote: input.remote};
}

function createCollectorProxy({port, token, maxBytes = MAX_BYTES, timeoutMs = 120000}) {
  let busy = false;
  return async function forward(req, res, station) {
    req.on('error', () => {});
    res.on('error', () => res.destroy());
    if (busy) { req.resume(); replyJSON(res, 503, {error: '同步正在进行，请稍后重试'}); return; }
    if (Number(req.headers['content-length']) > maxBytes) {
      req.resume(); replyJSON(res, 413, {error: '同步资料超过大小限制'}); return;
    }
    busy = true;
    try {
      await new Promise(resolve => {
        let finished = false, response, timer, size = 0;
        const upstream = http.request({hostname: '127.0.0.1', port, path: '/bridge/collector-business-sync', method: 'POST',
          headers: {'Content-Type': 'application/json', 'X-Internal-Token': token, 'X-Printlink-Sync-Station': station}});
        const limit = new Transform({transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(size > maxBytes ? error(413, '同步资料超过大小限制') : null,
            size > maxBytes ? undefined : chunk);
        }});
        const finish = (failure) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          req.unpipe(limit); limit.unpipe(upstream);
          limit.destroy();
          if (!req.complete) req.resume();
          if (failure || !upstream.writableFinished || !response?.complete) {
            upstream.destroy(); response?.destroy();
          }
          if (failure) {
            if (!res.headersSent) replyJSON(res, failure.status || 502, {error: failure.message});
            else if (!res.writableEnded) res.destroy();
          }
          resolve();
        };
        req.once('aborted', () => finish(error(400, '同步上传已中断')));
        req.on('error', () => finish(error(400, '同步上传读取失败')));
        res.once('close', () => {
          if (!res.writableFinished) finish(error(400, '同步连接已关闭'));
        });
        res.once('error', () => finish(error(400, '同步连接已关闭')));
        res.once('finish', () => finish());
        limit.once('error', failure => finish(failure));
        upstream.once('error', () => finish(error(502, '生产同步服务暂时不可用')));
        // Preserve the existing 120s processing budget after the body is sent.
        upstream.once('finish', () => {
          if (!finished) timer = setTimeout(() => finish(error(504, '生产同步处理超时')), timeoutMs);
        });
        upstream.once('response', reply => {
          response = reply;
          reply.once('error', () => finish(error(502, '生产同步响应已中断')));
          reply.once('aborted', () => finish(error(502, '生产同步响应已中断')));
          if (finished) { reply.destroy(); return; }
          res.writeHead(reply.statusCode || 502, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
          reply.pipe(res);
        });
        // pipe propagates backpressure; the cloud process never parses or
        // serializes the large collector document or production response.
        req.pipe(limit).pipe(upstream);
      });
    } finally { busy = false; }
  };
}

module.exports = {MAX_BYTES, readJSON, replyJSON, collectorInput, createCollectorProxy};
