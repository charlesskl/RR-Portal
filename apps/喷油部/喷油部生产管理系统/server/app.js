const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db');
const { requireWorkshop } = require('./middleware/require-workshop');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/workshops', require('./routes/workshops'));
app.use('/api/products',         requireWorkshop, require('./routes/products'));
app.use('/api/lines',            requireWorkshop, require('./routes/lines'));
app.use('/api/dispatches',                        require('./routes/dispatches')); // 弃用,不挂
app.use('/api/ledger',           requireWorkshop, require('./routes/ledger'));
app.use('/api/wage-standards',   requireWorkshop, require('./routes/wage-standards'));
app.use('/api/line-defaults',    requireWorkshop, require('./routes/line-defaults'));
app.use('/api/orders',           requireWorkshop, require('./routes/orders'));
app.use('/api/daily-records',    requireWorkshop, require('./routes/daily-records'));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const PORT = process.env.PORT || 3100;
app.listen(PORT, '0.0.0.0', () => console.log(`penyou-server on http://0.0.0.0:${PORT}`));
