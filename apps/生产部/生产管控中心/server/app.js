const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('./db/init');
const authRouter = require('./routes/auth');

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));

initDatabase();

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'production-control' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'production-control' }));

app.use('/api/auth', authRouter);

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get(/^\/(?!api|health).*/, (_req, res, next) => {
  const index = path.join(publicDir, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  next();
});

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ message: '服务器内部错误', error: err.message });
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[production-control] 生产管控中心已启动: http://localhost:${PORT}`);
});
