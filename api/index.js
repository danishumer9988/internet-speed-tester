// Vercel serverless function — API routes only.
// Static files (HTML/JS/CSS) are served by Vercel's CDN from /public.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { init, saveTest, getTests, getTestById, getStatistics } from '../database.js';

const app = express();

app.set('trust proxy', true); // needed on Vercel to read X-Forwarded-For correctly
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Network info — resolves the USER's IP and geolocation via ipapi.co
// ---------------------------------------------------------------------------

// Cache responses per client IP for 5 minutes to avoid hammering ipapi.co.
const networkCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getClientIp(req) {
  // Vercel puts the real client IP first in X-Forwarded-For.
  const xff = req.headers['x-forwarded-for'];
  let ip = '';

  if (Array.isArray(xff)) {
    ip = xff[0];
  } else if (typeof xff === 'string') {
    ip = xff.split(',')[0].trim();
  }

  if (!ip) ip = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  // Strip the IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  ip = ip.replace(/^::ffff:/, '');
  return ip;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  // 10.x.x.x, 192.168.x.x, 172.16–31.x.x, 169.254.x.x
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^fc|^fd|^fe80/i.test(ip)) return true;
  return false;
}

app.get('/api/network-info', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const cacheKey = clientIp || 'unknown';

    // Serve from cache if fresh
    const cached = networkCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    // Ask ipapi.co about THIS specific client IP.
    // If the IP is private/local (dev environment), fall back to auto-detect.
    const lookupUrl = !isPrivateIp(clientIp)
      ? `https://ipapi.co/${encodeURIComponent(clientIp)}/json/`
      : 'https://ipapi.co/json/';

    let r = await fetch(lookupUrl, { headers: { 'User-Agent': 'speedtest-pwa/1.0' } });
    let d = await r.json();

    // ipapi.co returns { error: true, reason: "RateLimited" } with HTTP 429.
    // Fall back to auto-detect if the specific-IP lookup is rejected.
    if (!r.ok || d.error) {
      console.warn('ipapi.co specific lookup failed:', d.reason || r.statusText);
      r = await fetch('https://ipapi.co/json/', { headers: { 'User-Agent': 'speedtest-pwa/1.0' } });
      d = await r.json();
      if (!r.ok || d.error) throw new Error(d.reason || 'ipapi.co unavailable');
    }

    const payload = {
      ip: d.ip || clientIp || null,
      city: d.city || null,
      region: d.region || null,
      country: d.country_name || null,
      country_code: d.country_code || null,
      isp: d.org || null,
      asn: d.asn || null,
      timezone: d.timezone || null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
    };

    networkCache.set(cacheKey, { at: Date.now(), data: payload });

    // Simple cache-size guard
    if (networkCache.size > 500) {
      const oldest = networkCache.keys().next().value;
      networkCache.delete(oldest);
    }

    res.json(payload);
  } catch (err) {
    console.error('Network info error:', err.message);
    res.status(500).json({ error: 'Unable to fetch network information' });
  }
});

// ---------------------------------------------------------------------------
// Test results
// ---------------------------------------------------------------------------

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