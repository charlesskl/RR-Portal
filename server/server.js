const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDb();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// API routes
app.use('/api/products', require('./routes/products'));
app.use('/api/versions', require('./routes/versions'));
app.use('/api/import', require('./routes/import'));
app.use('/api/export', require('./routes/export'));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
