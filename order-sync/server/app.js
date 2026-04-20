require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/init');

initDatabase();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/upload', require('./routes/upload'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/export', require('./routes/export'));
app.use('/api/summary', require('./routes/summary'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT }));

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Server running. Frontend not built yet.' });
  }
});

app.listen(PORT, () => {
  console.log(`生产计划管理系统运行在端口 ${PORT}`);
});
