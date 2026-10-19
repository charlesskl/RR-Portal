import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep the check in the directly executed process. Its own deadline also covers
// a listener that accepts the connection and never sends response headers.
export function checkHealth({port = Number(process.env.PORT || 3100), timeoutMs = 2000} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2000) return Promise.resolve(false);
  return new Promise(resolve => {
    let request, response, finished = false;
    const finish = healthy => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      response?.destroy();
      request?.destroy();
      resolve(healthy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      request = http.get({hostname: '127.0.0.1', port, path: '/api/health', agent: false}, reply => {
        response = reply;
        response.once('error', () => finish(false));
        finish(response.statusCode >= 200 && response.statusCode < 300);
      });
      request.once('error', () => finish(false));
    } catch { finish(false); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await checkHealth() ? 0 : 1);
}
