const crypto = require('node:crypto');

// The reverse proxy's Basic authentication remains in place. This key is only
// shared by the two servers; browser sessions use a domain-separated HMAC.
const key = () => process.env.ERP_RECEIPT_RETURN_TOKEN || '';
function equalSecret(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signSession(workshop) {
  if (!key()) return null;
  const payload = Buffer.from(JSON.stringify({ workshop, expires: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', key()).update('paiji-session:' + payload).digest('base64url');
  return `v2.${payload}.${signature}`;
}
function readSession(token) {
  if (!key() || typeof token !== 'string') return null;
  const [version, payload, signature, extra] = token.split('.');
  if (version !== 'v2' || !payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', key()).update('paiji-session:' + payload).digest('base64url');
  if (!equalSecret(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return ['A', 'AT', 'B', 'C', 'W'].includes(parsed.workshop) && Number.isFinite(parsed.expires) && parsed.expires > Date.now()
      ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
function requireIntegration(req, res, next) {
  if (!key()) return res.status(503).json({ message: 'ERP打回接口未配置服务端密钥' });
  if (!equalSecret(req.get('X-ERP-Token'), key())) return res.status(401).json({ message: 'ERP服务端凭据无效' });
  next();
}
function requireWorkshop(req, res, workshop) {
  const session = readSession(req.get('X-Paiji-Session'));
  if (!session) {
    res.status(401).json({ message: '请重新登录当前车间后处理ERP打回单' });
    return false;
  }
  if (session.workshop !== workshop) {
    res.status(403).json({ message: '只能处理当前登录车间的ERP打回单' });
    return false;
  }
  return true;
}
module.exports = { signSession, readSession, requireIntegration, requireWorkshop };
