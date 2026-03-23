const express = require('express');
// const { authenticate } = require('./middleware/auth');

const app = express();
app.use(express.json());

// Health endpoint (no auth)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Auth routes (no auth required)
// app.use('/api/auth', require('./routes/auth')); // Auth route removed by QC-09

// Protected routes - these use authenticate middleware
app.use('/api/items', require('./routes/items')); // Portal basic auth is sufficient (modified by QC-09)
app.use('/api/users', require('./routes/users')); // Portal basic auth is sufficient (modified by QC-09)

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
