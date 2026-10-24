import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { APP_ROOT, PORT } from './config.js';
import { pool } from './db.js';
import { errorHandler } from './errors.js';
import catalog from './routes/catalog.js';
import inventory from './routes/inventory.js';
import ops from './routes/ops.js';
import orders from './routes/orders.js';
import reports from './routes/reports.js';
import stress from './routes/stress.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api', catalog);
  app.use('/api/orders', orders);
  app.use('/api/inventory', inventory);
  app.use('/api/ops', ops);
  app.use('/api/stress-test', stress);
  app.use('/api/reports', reports);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the built React client is served from the same port.
  const clientBuild = path.join(APP_ROOT, 'client', 'dist');
  if (fs.existsSync(clientBuild)) {
    app.use(express.static(clientBuild));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => {
    console.log(`Quick Commerce API listening on http://localhost:${PORT}`);
  });
}
