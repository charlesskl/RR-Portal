const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/items', (req, res) => res.json([]));
app.post('/api/items', (req, res) => res.status(201).json({ id: 1, ...req.body }));
app.get('/api/items/:id', (req, res) => res.json({ id: req.params.id, name: 'test' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
