import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { init, saveTest, getTests, getTestById, getStatistics, close } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Serve static files
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Speed test endpoints
app.get('/api/speedtest/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send('pong');
});

app.get('/api/speedtest/download', (req, res) => {
  const size = Math.min(parseInt(req.query.size) || 1048576, 20 * 1024 * 1024);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Length', size);
  const chunk = Buffer.alloc(65536, 'x');
  let sent = 0;
  while (sent < size) {
    const remaining = size - sent;
    const toSend = Math.min(remaining, chunk.length);
    res.write(chunk.slice(0, toSend));
    sent += toSend;
  }
  res.end();
});

app.post('/api/speedtest/upload', (req, res) => {
  const size = req.headers['content-length'] || 0;
  res.json({ received: parseInt(size) });
});

// Network info endpoint (proxy to ipapi.co)
app.get('/api/network-info', async (req, res) => {
  try {
    const response = await fetch('https://ipapi.co/json/');
    if (!response.ok) throw new Error('Failed to fetch network info');
    const data = await response.json();
    res.json({
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name,
      country_code: data.country_code,
      isp: data.org,
      asn: data.asn,
      timezone: data.timezone,
      latitude: data.latitude,
      longitude: data.longitude
    });
  } catch (err) {
    console.error('Network info error:', err);
    res.status(500).json({ error: 'Unable to fetch network information' });
  }
});

// Test results endpoints
app.post('/api/tests', async (req, res) => {
  try {
    const required = ['download_speed', 'upload_speed', 'ping'];
    for (const field of required) {
      if (req.body[field] == null || isNaN(req.body[field])) {
        return res.status(400).json({ error: `Missing or invalid field: ${field}` });
      }
    }
    const saved = await saveTest(req.body);
    res.status(201).json(saved);
  } catch (err) {
    console.error('Save test error:', err);
    res.status(500).json({ error: 'Unable to save test result' });
  }
});

app.get('/api/tests', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const tests = await getTests(limit);
    res.json(tests);
  } catch (err) {
    console.error('Get tests error:', err);
    res.status(500).json({ error: 'Unable to retrieve tests' });
  }
});

app.get('/api/tests/:id', async (req, res) => {
  try {
    const test = await getTestById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.json(test);
  } catch (err) {
    console.error('Get test error:', err);
    res.status(500).json({ error: 'Unable to retrieve test' });
  }
});

app.get('/api/statistics', async (req, res) => {
  try {
    const stats = await getStatistics();
    res.json(stats);
  } catch (err) {
    console.error('Statistics error:', err);
    res.status(500).json({ error: 'Unable to retrieve statistics' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
let httpServer;

init()
  .then(() => {
    httpServer = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Database: ${process.env.DATABASE_URL ? 'Neon PostgreSQL' : 'SQLite (local)'}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Graceful shutdown: release DB connections on exit
async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  try {
    const { close } = await import('./database.js');
    await close();
  } catch (err) {
    console.error('Error during DB shutdown:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));