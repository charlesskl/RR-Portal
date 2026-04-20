require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const scanRoutes = require('./routes/scan');
const kingsoftRoutes = require('./routes/kingsoft');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/scan', scanRoutes);
app.use('/api/kingsoft', kingsoftRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT }));

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Order Sync Server running. Frontend not built yet.' });
  }
});

app.listen(PORT, () => {
  console.log(`Order Sync Server running on port ${PORT}`);
});
