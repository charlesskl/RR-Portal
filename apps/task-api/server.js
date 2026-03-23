const express = require('express');
const app = express();

// Health check endpoint (added by QC-02)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(express.json());

// Hardcoded config (messy — DevOps agent should fix these)
const DB_URL = process.env.MONGODB_URL;
const API_KEY = process.env.API_KEY;

let tasks = [];
let nextId = 1;

app.get('/tasks', (req, res) => {
  res.json(tasks);
});

app.post('/tasks', (req, res) => {
  const task = {
    id: nextId++,
    title: req.body.title || 'Untitled',
    done: false,
    createdAt: new Date().toISOString()
  };
  tasks.push(task);
  res.status(201).json(task);
});

app.put('/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  task.done = req.body.done !== undefined ? req.body.done : task.done;
  task.title = req.body.title || task.title;
  res.json(task);
});

app.delete('/tasks/:id', (req, res) => {
  tasks = tasks.filter(t => t.id !== parseInt(req.params.id));
  res.status(204).send();
});

// No health endpoint (DevOps agent should inject one)
// Hardcoded port in listen call (DevOps agent should extract to env var)
const server = app.listen(process.env.PORT || 8080, () => {
  console.log('Task API running on port 8080');
  console.log(`Connected to DB at ${DB_URL}`);
});

// Graceful shutdown (injected by DevOps onboarding)
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (typeof server !== 'undefined' && server.close) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (typeof server !== 'undefined' && server.close) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
