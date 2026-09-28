// Local development server. On Vercel, /api/* is handled by api/index.js
// and static files are served by the CDN from /public.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiApp from './api/index.js';
import { close } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;

const app = express();

// Serve static files from /public (mirrors Vercel's behavior)
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use(apiApp);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const httpServer = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'Neon PostgreSQL' : 'SQLite (local)'}`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`);
  httpServer.close(async () => {
    try { await close(); } catch {}
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));