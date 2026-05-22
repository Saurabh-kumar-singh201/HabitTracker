import express from 'express';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const preferredPort = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const mongoUri = process.env.MONGODB_URI || '';
const mongoDatabaseName = process.env.MONGODB_DATABASE || 'habit_tracker';
const mongoCollectionName = process.env.MONGODB_COLLECTION || 'app_state';
const singletonId = 'habit-tracker-state';

function isOriginAllowed(requestOrigin) {
  if (!requestOrigin) return false;

  return allowedOrigins.some(allowedOrigin => {
    if (allowedOrigin === requestOrigin) return true;

    // Support simple wildcard patterns such as https://*.vercel.app
    if (allowedOrigin.includes('*')) {
      const pattern = '^' + allowedOrigin
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') + '$';
      return new RegExp(pattern).test(requestOrigin);
    }

    return false;
  });
}

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (isOriginAllowed(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

let pool;
let databaseReady;

async function getDatabase() {
  if (!mongoUri) return null;
  if (!pool) {
    const client = new MongoClient(mongoUri);
    await client.connect();
    pool = client.db(mongoDatabaseName);
  }
  return pool;
}

async function getDatabaseReady() {
  if (!databaseReady) {
    databaseReady = ensureDatabase().catch(error => {
      databaseReady = null;
      throw error;
    });
  }
  return databaseReady;
}

async function readState() {
  const collection = await getDatabaseReady();
  if (!collection) return null;
  try {
    const row = await collection.findOne(
      { state_id: singletonId },
      { projection: { _id: 0, habits: 1, records: 1, theme: 1 } }
    );
    if (!row) return null;
    return {
      habits: safeParseJson(row.habits, []),
      records: safeParseJson(row.records, {}),
      theme: row.theme || 'dark',
    };
  } catch (error) {
    console.error('[readState] Error:', error.message);
    return null;
  }
}

function safeParseJson(value, fallback) {
  try {
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

async function ensureDatabase() {
  const db = await getDatabase();
  if (!db) return null;
  try {
    const collection = db.collection(mongoCollectionName);
    await collection.createIndex({ state_id: 1 }, { unique: true });
    return collection;
  } catch (error) {
    console.error('[ensureDatabase] Error:', error.message);
    throw error;
  }
}

async function upsertState({ habits, records, theme }) {
  const collection = await getDatabaseReady();
  if (!collection) return null;
  try {
    const themeVal = theme === 'light' ? 'light' : 'dark';
    await collection.updateOne(
      { state_id: singletonId },
      {
        $set: {
          habits: Array.isArray(habits) ? habits : [],
          records: records && typeof records === 'object' ? records : {},
          theme: themeVal,
          updated_at: new Date(),
        },
      },
      { upsert: true }
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
    res.status(503).json({ error: 'MongoDB is not available', details: error.message });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'MongoDB is not configured' });
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
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'MongoDB is not configured' });
    await patchState(req.body || {});
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to patch state', details: error.message });
  }
});

app.delete('/api/state', async (_req, res) => {
  try {
    const collection = await getDatabaseReady();
    if (!collection) return res.status(503).json({ error: 'MongoDB is not configured' });
    await collection.deleteOne({ state_id: singletonId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset state', details: error.message });
  }
});

app.get('/health', async (_req, res) => {
  try {
    const db = await getDatabase();
    if (!db) {
      return res.json({ ok: true, database: 'not-configured' });
    }
    await db.command({ ping: 1 });
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'error', details: error.message });
  }
});

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'habit-tracker-api' });
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Habit Tracker API listening on http://localhost:${port}`);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT) {
      console.warn(`Port ${port} is already in use. Trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    console.error(`[server] Failed to start: ${error.message}`);
    process.exit(1);
  });
}

startServer(preferredPort);

getDatabaseReady()
  .then(() => {
    console.log('Database connection is ready');
  })
  .catch(error => {
    console.error('[startup] Failed to initialize database connection:', error.message);
  });
