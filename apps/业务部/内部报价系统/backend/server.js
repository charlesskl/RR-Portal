const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

require('./db'); // ensure schema + seed

const app = express();
// 反代(Caddy/nginx)在前面终止 TLS，按 X-Forwarded-Proto 识别 https，secure cookie 才生效
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieSession({
  name: 'iq_sess',
  keys: [process.env.SESSION_SECRET || 'change-me-in-prod'],
  maxAge: 12 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',  // 生产(HTTPS)下仅经加密连接发送；本地 http 开发不受影响
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/quotes', require('./routes/export')); // GET /:id/export
app.use('/api/sections', require('./routes/sections'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/refs', require('./routes/refs'));
app.use('/api/admin', require('./routes/admin'));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 3210;
app.listen(PORT, () => console.log(`内部报价系统 listening on http://localhost:${PORT}`));
