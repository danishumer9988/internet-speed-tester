// database.js — Data layer for SQLite (local) and Neon PostgreSQL (production).
//
// Automatically picks the backend based on DATABASE_URL:
//   - Empty / missing              → SQLite (speedtest.db in project root)
//   - postgres:// or postgresql:// → Neon PostgreSQL
//
// Uses Node's built-in `node:sqlite` module (Node 22.5+). No native
// compilation, no install scripts, no better-sqlite3 dependency.

import 'dotenv/config';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const usePostgres =
  process.env.DATABASE_URL &&
  (process.env.DATABASE_URL.startsWith('postgres://') ||
   process.env.DATABASE_URL.startsWith('postgresql://'));

let db;        // SQLite handle
let pgPool;    // PostgreSQL pool

// Fields stored for every test — used by every SQL statement below.
const FIELDS = [
  'download_speed', 'upload_speed', 'ping', 'jitter', 'packet_loss', 'test_duration',
  'public_ip', 'country', 'region', 'city', 'latitude', 'longitude', 'location_accuracy',
  'isp', 'asn', 'connection_type', 'device_type', 'operating_system', 'browser',
  'browser_language', 'timezone', 'screen_width', 'screen_height', 'test_server'
];

// ----------------------------------------------------------------------------
// Initialization
// ----------------------------------------------------------------------------

export async function init() {
  if (usePostgres) {
    await initPostgres();
  } else {
    initSQLite();
  }
}

async function initPostgres() {
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,

    // Keep well below Neon free-tier connection limits.
    max: 5,

    // Release idle connections after 30s so Neon can auto-suspend.
    idleTimeoutMillis: 30_000,

    // Allow enough time for Neon's cold-start wakeup (typically 0.5–2s).
    connectionTimeoutMillis: 10_000,

    // Neon uses real certificates — verify them.
    // If your connection string uses sslmode=require instead of verify-full,
    // change this to `false` to avoid certificate errors.
    ssl: { rejectUnauthorized: true }
  });

  // Without this handler, a dropped Neon connection prints an
  // "unhandled error event" and can crash the process.
  pgPool.on('error', (err) => {
    console.error('Unexpected Postgres pool error:', err.message);
  });

  // Verify the connection and ensure the schema exists.
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS speed_tests (
        id SERIAL PRIMARY KEY,
        download_speed REAL,
        upload_speed REAL,
        ping REAL,
        jitter REAL,
        packet_loss REAL,
        test_duration REAL,
        public_ip TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        latitude REAL,
        longitude REAL,
        location_accuracy REAL,
        isp TEXT,
        asn TEXT,
        connection_type TEXT,
        device_type TEXT,
        operating_system TEXT,
        browser TEXT,
        browser_language TEXT,
        timezone TEXT,
        screen_width INTEGER,
        screen_height INTEGER,
        test_server TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Speeds up "latest tests first" queries once the table grows.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_speed_tests_created_at
      ON speed_tests (created_at DESC)
    `);
  } finally {
    client.release();
  }

  console.log('PostgreSQL (Neon) connected and table ready.');
}

function initSQLite() {
  const dbPath = path.join(__dirname, 'speedtest.db');
  db = new DatabaseSync(dbPath);

  // WAL mode is a pragma; node:sqlite supports it via exec.
  try { db.exec('PRAGMA journal_mode = WAL'); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS speed_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      download_speed REAL,
      upload_speed REAL,
      ping REAL,
      jitter REAL,
      packet_loss REAL,
      test_duration REAL,
      public_ip TEXT,
      country TEXT,
      region TEXT,
      city TEXT,
      latitude REAL,
      longitude REAL,
      location_accuracy REAL,
      isp TEXT,
      asn TEXT,
      connection_type TEXT,
      device_type TEXT,
      operating_system TEXT,
      browser TEXT,
      browser_language TEXT,
      timezone TEXT,
      screen_width INTEGER,
      screen_height INTEGER,
      test_server TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_speed_tests_created_at
    ON speed_tests (created_at DESC)
  `);

  console.log('SQLite connected and table ready at', dbPath);
}

// ----------------------------------------------------------------------------
// Write
// ----------------------------------------------------------------------------

export async function saveTest(data) {
  const values = FIELDS.map((f) => data[f] ?? null);

  if (usePostgres) {
    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(', ');
    const query = `INSERT INTO speed_tests (${FIELDS.join(', ')}) VALUES (${placeholders}) RETURNING *`;

    const t0 = Date.now();
    const res = await pgPool.query(query, values);
    const dt = Date.now() - t0;

    if (dt > 500) {
      console.warn(`Slow Postgres insert: ${dt}ms (likely Neon cold start)`);
    }

    return res.rows[0];
  }

  const placeholders = FIELDS.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO speed_tests (${FIELDS.join(', ')}) VALUES (${placeholders})`
  );
  const info = stmt.run(...values);
  return { id: Number(info.lastInsertRowid), ...data };
}

// ----------------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------------

export async function getTests(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

  if (usePostgres) {
    const res = await pgPool.query(
      'SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT $1',
      [safeLimit]
    );
    return res.rows;
  }

  return db
    .prepare('SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT ?')
    .all(safeLimit);
}

export async function getTestById(id) {
  if (usePostgres) {
    const res = await pgPool.query('SELECT * FROM speed_tests WHERE id = $1', [id]);
    return res.rows[0];
  }
  return db.prepare('SELECT * FROM speed_tests WHERE id = ?').get(id);
}

// ----------------------------------------------------------------------------
// Aggregates
// ----------------------------------------------------------------------------

export async function getStatistics() {
  if (usePostgres) {
    const res = await pgPool.query(`
      SELECT
        COUNT(*)::int        AS total_tests,
        AVG(download_speed)  AS avg_download,
        AVG(upload_speed)    AS avg_upload,
        AVG(ping)            AS avg_ping,
        AVG(jitter)          AS avg_jitter,
        AVG(packet_loss)     AS avg_packet_loss
      FROM speed_tests
    `);
    return res.rows[0];
  }

  return db.prepare(`
    SELECT
      COUNT(*)            AS total_tests,
      AVG(download_speed) AS avg_download,
      AVG(upload_speed)   AS avg_upload,
      AVG(ping)           AS avg_ping,
      AVG(jitter)         AS avg_jitter,
      AVG(packet_loss)    AS avg_packet_loss
    FROM speed_tests
  `).get();
}

// ----------------------------------------------------------------------------
// Clean shutdown (used by server.js on SIGINT/SIGTERM)
// ----------------------------------------------------------------------------

export async function close() {
  if (usePostgres && pgPool) {
    await pgPool.end();
  }
  if (db) {
    try { db.close(); } catch {}
  }
}