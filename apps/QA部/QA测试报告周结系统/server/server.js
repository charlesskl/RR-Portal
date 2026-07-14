import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import uploadRouter from './routes/upload.js';
import reportsRouter from './routes/reports.js';
import customersRouter from './routes/customers.js';
import productsRouter from './routes/products.js';
import { migrateReportMetadata } from './lib/report-migration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3210;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/upload', uploadRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/products', productsRouter);

// 上传的图片通过 /uploads/images/<reportId>/<file> 访问
app.use('/uploads/images', express.static(path.join(__dirname, 'uploads', 'images')));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const migration = await migrateReportMetadata();
if (migration.migrated || migration.skipped) {
  console.log(`[qa-weekly-report] metadata migration: ${migration.migrated} migrated, ${migration.skipped} skipped`);
}

app.listen(PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  const lanUrls = [];
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        lanUrls.push(`http://${info.address}:${PORT}`);
      }
    }
  }
  console.log(`[qa-weekly-report] server listening on:`);
  console.log(`  http://localhost:${PORT}`);
  lanUrls.forEach(u => console.log(`  ${u}  <-- 局域网访问`));
  if (lanUrls.length === 0) console.log('  (no LAN IPv4 address detected)');
});
