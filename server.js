import express from 'express';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'habit_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};
const singletonId = 'habit-tracker-state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

let pool;

async function getPool() {
  if (!dbConfig.host || !dbConfig.user) return null;
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

async function readState() {
  const dbPool = await getPool();
  if (!dbPool) return null;
  try {
    const [rows] = await dbPool.query('SELECT habits_json, records_json, theme FROM app_state WHERE state_id = ? LIMIT 1', [singletonId]);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    return {
      habits: safeParseJson(row.habits_json, []),
      records: safeParseJson(row.records_json, {}),
      theme: row.theme || 'dark',
    };
  } catch (error) {
    console.error('[readState] Error:', error.message);
    return null;
  }
}

function safeParseJson(value, fallback) {
  try {
    // MySQL JSON columns return already-parsed objects, not strings
    if (typeof value === 'object' && value !== null) {
      return value;
    }
    if (typeof value === 'string' && value.length > 0) {
      return JSON.parse(value);
    }
    return fallback;
  } catch (error) {
    return fallback;
  }
}

async function ensureSchema() {
  const dbPool = await getPool();
  if (!dbPool) return null;
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        state_id VARCHAR(64) PRIMARY KEY,
        habits_json JSON NOT NULL,
        records_json JSON NOT NULL,
        theme VARCHAR(16) NOT NULL DEFAULT 'dark',
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    return dbPool;
  } catch (error) {
    console.error('[ensureSchema] Error:', error.message);
    throw error;
  }
}

async function upsertState({ habits, records, theme }) {
  const dbPool = await ensureSchema();
  if (!dbPool) return null;
  try {
    const habitJson = JSON.stringify(habits || []);
    const recordJson = JSON.stringify(records || {});
    const themeVal = theme === 'light' ? 'light' : 'dark';
    await dbPool.query(
      `
        INSERT INTO app_state (state_id, habits_json, records_json, theme, updated_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          habits_json = VALUES(habits_json),
          records_json = VALUES(records_json),
          theme = VALUES(theme),
          updated_at = NOW()
      `,
      [singletonId, habitJson, recordJson, themeVal]
    );
  } catch (error) {
    console.error('[upsertState] Error:', error.message);
    throw error;
  }
}

async function patchState(patch) {
  const current = (await readState()) || { habits: [], records: {}, theme: 'dark' };
  await upsertState({
    habits: Array.isArray(patch.habits) ? patch.habits : current.habits,
    records: patch.records && typeof patch.records === 'object' ? patch.records : current.records,
    theme: patch.theme === 'light' || patch.theme === 'dark' ? patch.theme : current.theme,
  });
}

app.get('/api/state', async (_req, res) => {
  try {
    const state = await readState();
    res.json(state ? { habits: state.habits || [], records: state.records || {}, theme: state.theme || 'dark' } : { habits: [], records: {}, theme: 'dark' });
  } catch (error) {
    res.status(503).json({ error: 'MySQL is not available', details: error.message });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const dbPool = await getPool();
    if (!dbPool) return res.status(503).json({ error: 'MySQL is not configured' });
    await upsertState({
      habits: Array.isArray(req.body?.habits) ? req.body.habits : [],
      records: req.body?.records && typeof req.body.records === 'object' ? req.body.records : {},
      theme: req.body?.theme === 'light' ? 'light' : 'dark',
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save state', details: error.message });
  }
});

app.patch('/api/state', async (req, res) => {
  try {
    const dbPool = await getPool();
    if (!dbPool) return res.status(503).json({ error: 'MySQL is not configured' });
    await patchState(req.body || {});
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to patch state', details: error.message });
  }
});

app.delete('/api/state', async (_req, res) => {
  try {
    const dbPool = await getPool();
    if (!dbPool) return res.status(503).json({ error: 'MySQL is not configured' });
    await ensureSchema();
    await dbPool.query('DELETE FROM app_state WHERE state_id = ?', [singletonId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset state', details: error.message });
  }
});

app.get('/health', async (_req, res) => {
  try {
    const dbPool = await getPool();
    if (!dbPool) {
      return res.json({ ok: true, database: 'not-configured' });
    }
    await dbPool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'error', details: error.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Habit Tracker listening on http://localhost:${port}`);
});
