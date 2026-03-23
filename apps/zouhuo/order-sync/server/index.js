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

// Simple API key auth for internal endpoints (this runs on the LAN only)
const API_KEY = process.env.API_KEY;
function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // no key configured = open (dev mode)
  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (provided !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — provide X-Api-Key header' });
  }
  next();
}

app.use('/api/scan', requireApiKey, scanRoutes);
app.use('/api/kingsoft', requireApiKey, kingsoftRoutes);

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
