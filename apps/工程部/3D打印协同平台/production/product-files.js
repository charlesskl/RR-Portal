'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const EXTENSIONS = Object.freeze([
  '.stl', '.3mf', '.obj', '.step', '.stp', '.iges', '.igs',
  '.amf', '.ply', '.off', '.gcode', '.bgcode', '.zip'
]);
const FILE_ID = /^[a-f0-9]{32}$/;

class FileRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 &&
    Buffer.byteLength(name, 'utf8') <= 255 &&
    !/[\\/\x00-\x1f\x7f\uFFFD]/.test(name) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(name) &&
    EXTENSIONS.includes(path.extname(name).toLowerCase());
}

function sendJson(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

// 请求流不放入 pipeline，超限时保留连接以便正常返回 413。
function receiveUpload(req, tempPath, maxFileSize) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > maxFileSize) {
          callback(new FileRequestError(413, '文件超过大小限制'));
        } else {
          callback(null, chunk);
        }
      }
    });
    const output = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    const onAborted = () => counter.destroy(new FileRequestError(400, '上传已中断'));
    const onError = error => counter.destroy(error);
    req.once('aborted', onAborted);
    req.once('error', onError);
    pipeline(counter, output, error => {
      req.unpipe(counter);
      req.removeListener('aborted', onAborted);
      req.removeListener('error', onError);
      if (error) {
        req.resume();
        reject(error);
      } else if (!size) {
        reject(new FileRequestError(400, '不能上传空文件'));
      } else {
        resolve(size);
      }
    });
    if (req.aborted || req.destroyed) onAborted();
    else req.pipe(counter);
  });
}

function createProductFileHandler({ storageDir, getProducts, maxFileSize = MAX_FILE_SIZE }) {
  if (typeof storageDir !== 'string' || !storageDir || typeof getProducts !== 'function') {
    throw new TypeError('storageDir and getProducts are required');
  }
  if (!Number.isSafeInteger(maxFileSize) || maxFileSize < 1 || maxFileSize > MAX_FILE_SIZE) {
    throw new TypeError('maxFileSize must be between 1 and 524288000 bytes');
  }
  const root = path.resolve(storageDir);
  const generations = new Map();
  const filePath = (id, suffix) => path.join(root, id + suffix);
  const products = () => {
    const value = getProducts();
    return Array.isArray(value) ? value : [];
  };
  const productExists = id => products().some(product => product && String(product.id) === id);
  const notFound = () => new FileRequestError(404, '文件不存在或已删除');

  function parseMetadata(raw, id) {
    const value = JSON.parse(raw);
    if (!value || value.id !== id || !FILE_ID.test(id) ||
        typeof value.productId !== 'string' || !validName(value.name) ||
        !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_FILE_SIZE ||
        typeof value.uploadedAt !== 'string' || !Number.isFinite(Date.parse(value.uploadedAt))) {
      throw new Error('Invalid product file metadata');
    }
    return { id, productId: value.productId, name: value.name, size: value.size, uploadedAt: value.uploadedAt };
  }

  async function readMetadata(id) {
    try {
      return parseMetadata(await fs.promises.readFile(filePath(id, '.json'), 'utf8'), id);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError || error.message === 'Invalid product file metadata') {
        throw notFound();
      }
      throw error;
    }
  }

  async function listFiles() {
    let entries;
    try { entries = await fs.promises.readdir(root); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const ids = new Set(products().filter(Boolean).map(product => String(product.id)));
    const files = [];
    for (const entry of entries) {
      if (!/^[a-f0-9]{32}\.json$/.test(entry)) continue;
      try {
        const file = await readMetadata(entry.slice(0, -5));
        if (!ids.has(file.productId)) continue;
        const stat = await fs.promises.stat(filePath(file.id, '.bin'));
        if (stat.isFile() && stat.size === file.size) files.push(file);
      } catch (error) {
        if (error.status !== 404 && error.code !== 'ENOENT') throw error;
      }
    }
    return files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id));
  }

  async function unlinkIfPresent(location) {
    try { await fs.promises.unlink(location); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function upload(req, productId, url) {
    const name = url.searchParams.get('name');
    if (!validName(name)) throw new FileRequestError(400, '文件名无效或不支持该文件格式');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/octet-stream') throw new FileRequestError(415, '请以二进制文件格式上传');
    const length = req.headers['content-length'];
    if (length !== undefined && Number(length) > maxFileSize) throw new FileRequestError(413, '文件超过大小限制');
    if (length !== undefined && Number(length) === 0) throw new FileRequestError(400, '不能上传空文件');
    const generation = generations.get(productId) || 0;
    const id = crypto.randomBytes(16).toString('hex');
    const temp = filePath(id, '.upload.tmp');
    const binary = filePath(id, '.bin');
    const metaTemp = filePath(id, '.json.tmp');
    const metadataPath = filePath(id, '.json');
    let published = false;
    try {
      await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
      const size = await receiveUpload(req, temp, maxFileSize);
      if (!productExists(productId) || (generations.get(productId) || 0) !== generation) {
        throw new FileRequestError(404, '产品不存在或已经删除');
      }
      const file = { id, productId, name, size, uploadedAt: new Date().toISOString() };
      await fs.promises.rename(temp, binary);
      await fs.promises.writeFile(metaTemp, JSON.stringify(file), { flag: 'wx', mode: 0o600 });
      // 磁盘写入后再次检查，避免发布期间产品已被删除或重建。
      if (!productExists(productId) || (generations.get(productId) || 0) !== generation) {
        throw new FileRequestError(404, '产品不存在或已经删除');
      }
      await fs.promises.rename(metaTemp, metadataPath);
      if (!productExists(productId) || (generations.get(productId) || 0) !== generation) {
        throw new FileRequestError(404, '产品不存在或已经删除');
      }
      published = true;
      return file;
    } finally {
      const cleanup = [temp, metaTemp];
      if (!published) cleanup.push(binary, metadataPath);
      for (const location of cleanup) {
        try { await unlinkIfPresent(location); }
        catch (error) { console.error('[3D文件] 清理未完成的上传失败:', error.code || 'IO_ERROR'); }
      }
    }
  }

  async function download(res, file) {
    let handle;
    try {
      try { handle = await fs.promises.open(filePath(file.id, '.bin'), 'r'); }
      catch (error) { if (error.code === 'ENOENT') throw notFound(); throw error; }
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== file.size) throw notFound();
      const asciiName = file.name.replace(/[^\x20-\x7e]|["\\;]/g, '_');
      const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': file.size,
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      await new Promise((resolve, reject) => {
        pipeline(fs.createReadStream(null, { fd: handle.fd, autoClose: false }), res, error => error ? reject(error) : resolve());
      });
    } finally {
      if (handle) await handle.close();
    }
  }

  const handler = async (req, res) => {
    const pathname = String(req.url || '').split('?')[0];
    const isList = pathname === '/api/products/files';
    const route = /^\/api\/products\/([^/]+)\/files(?:\/([^/]+))?$/.exec(pathname);
    const isFileRoute = /^\/api\/products\/(?:files(?:\/|$)|[^/]+\/files(?:\/|$))/.test(pathname);
    if (!isList && !isFileRoute) return false;
    try {
      if (isList) {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          throw new FileRequestError(405, '不支持此请求方法');
        }
        sendJson(res, 200, { ok: true, files: await listFiles(), maxFileSize, extensions: [...EXTENSIONS] });
        return true;
      }
      if (!route) throw notFound();
      let productId;
      try { productId = decodeURIComponent(route[1]); }
      catch (_) { throw new FileRequestError(400, '产品编号无效'); }
      if (!productId || productId.length > 200 || /[\\/\x00-\x1f\x7f]/.test(productId) || productId === '.' || productId === '..') {
        throw new FileRequestError(400, '产品编号无效');
      }
      if (!productExists(productId)) throw new FileRequestError(404, '产品不存在或已经删除');
      const id = route[2];
      if (!id) {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          throw new FileRequestError(405, '不支持此请求方法');
        }
        const url = new URL(req.url, 'http://localhost');
        const file = await upload(req, productId, url);
        sendJson(res, 201, { ok: true, file });
      } else {
        if (!FILE_ID.test(id)) throw new FileRequestError(400, '文件编号无效');
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          res.setHeader('Allow', 'GET, DELETE');
          throw new FileRequestError(405, '不支持此请求方法');
        }
        const file = await readMetadata(id);
        if (file.productId !== productId) throw notFound();
        if (req.method === 'GET') await download(res, file);
        else {
          // 二进制文件删除失败时保留元数据，便于重试。
          await unlinkIfPresent(filePath(id, '.bin'));
          await unlinkIfPresent(filePath(id, '.json'));
          sendJson(res, 200, { ok: true });
        }
      }
    } catch (error) {
      req.resume();
      const status = error instanceof FileRequestError ? error.status : 500;
      if (status === 500 && !res.destroyed) console.error('[3D文件] 请求失败:', error.code || 'IO_ERROR');
      sendJson(res, status, { ok: false, error: status === 500 ? '文件操作失败，请稍后重试' : error.message });
    }
    return true;
  };

  // 现有新增接口可能复用产品 ID，发布新产品前清理同 ID 的旧附件。
  // 此处同步清理，避免为新增产品的原子更新引入异步间隙。
  handler.removeProductFiles = productId => {
    const key = String(productId);
    generations.set(key, (generations.get(key) || 0) + 1);
    let entries;
    try { entries = fs.readdirSync(root); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (!/^[a-f0-9]{32}\.json$/.test(entry)) continue;
      const id = entry.slice(0, -5);
      let file;
      try { file = parseMetadata(fs.readFileSync(filePath(id, '.json'), 'utf8'), id); }
      catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError || error.message === 'Invalid product file metadata') continue;
        throw error;
      }
      if (file.productId !== key) continue;
      for (const suffix of ['.bin', '.json']) {
        try { fs.unlinkSync(filePath(id, suffix)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  };
  return handler;
}

module.exports = { createProductFileHandler };
