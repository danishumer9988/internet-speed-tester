// Vercel serverless function — API routes only.
// Static files (HTML/JS/CSS) are served by Vercel's CDN from /public.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { init, saveTest, getTests, getTestById, getStatistics } from '../database.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Lazy DB initialization — safe for serverless cold starts.
let dbReady = false;
let dbInitPromise = null;
async function ensureDb() {
  if (dbReady) return;
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = init().then(() => { dbReady = true; }).catch((err) => {
    dbInitPromise = null;
    throw err;
  });
  return dbInitPromise;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Network info (proxy to ipapi.co — cached briefly to reduce calls)
let networkCache = { at: 0, data: null };
app.get('/api/network-info', async (req, res) => {
  try {
    if (networkCache.data && Date.now() - networkCache.at < 60_000) {
      return res.json(networkCache.data);
    }
    const r = await fetch('https://ipapi.co/json/');
    if (!r.ok) throw new Error('ipapi failed');
    const d = await r.json();
    const payload = {
      ip: d.ip,
      city: d.city,
      region: d.region,
      country: d.country_name,
      country_code: d.country_code,
      isp: d.org,
      asn: d.asn,
      timezone: d.timezone,
      latitude: d.latitude,
      longitude: d.longitude
    };
    networkCache = { at: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    console.error('Network info error:', err.message);
    res.status(500).json({ error: 'Unable to fetch network information' });
  }
});

app.post('/api/tests', async (req, res) => {
  try {
    await ensureDb();
    const required = ['download_speed', 'upload_speed', 'ping'];
    for (const field of required) {
      if (req.body[field] == null || isNaN(req.body[field])) {
        return res.status(400).json({ error: `Missing or invalid field: ${field}` });
      }
    }
    const saved = await saveTest(req.body);
    res.status(201).json(saved);
  } catch (err) {
    console.error('Save test error:', err.message);
    res.status(500).json({ error: 'Unable to save test result' });
  }
});

app.get('/api/tests', async (req, res) => {
  try {
    await ensureDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json(await getTests(limit));
  } catch (err) {
    console.error('Get tests error:', err.message);
    res.status(500).json({ error: 'Unable to retrieve tests' });
  }
});

app.get('/api/tests/:id', async (req, res) => {
  try {
    await ensureDb();
    const t = await getTestById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Test not found' });
    res.json(t);
  } catch (err) {
    console.error('Get test error:', err.message);
    res.status(500).json({ error: 'Unable to retrieve test' });
  }
});

app.get('/api/statistics', async (req, res) => {
  try {
    await ensureDb();
    res.json(await getStatistics());
  } catch (err) {
    console.error('Statistics error:', err.message);
    res.status(500).json({ error: 'Unable to retrieve statistics' });
  }
});

export default app;