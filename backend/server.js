import crypto from 'crypto';
import express from 'express';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

const app = express();
const preferredPort = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const mongoUri = process.env.MONGODB_URI || '';
const mongoDatabaseName = process.env.MONGODB_DATABASE || 'habit_tracker';
const stateCollectionName = process.env.MONGODB_COLLECTION || 'app_state';
const userCollectionName = process.env.MONGODB_USERS_COLLECTION || 'users';
const authSecret = process.env.AUTH_SECRET || 'habit-tracker-dev-secret-change-me';
const tokenTtlDays = Number(process.env.AUTH_TOKEN_TTL_DAYS || 30);

function isOriginAllowed(requestOrigin) {
  if (!requestOrigin) return false;

  return allowedOrigins.some(allowedOrigin => {
    if (allowedOrigin === requestOrigin) return true;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

let database;
let databaseReady;

async function getDatabase() {
  if (!mongoUri) return null;
  if (!database) {
    const client = new MongoClient(mongoUri);
    await client.connect();
    database = client.db(mongoDatabaseName);
  }
  return database;
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

async function ensureDatabase() {
  const db = await getDatabase();
  if (!db) return null;

  const stateCollection = db.collection(stateCollectionName);
  const usersCollection = db.collection(userCollectionName);

  try {
    await Promise.all([
      stateCollection.createIndex({ user_id: 1 }, { unique: true }),
      usersCollection.createIndex({ email: 1 }, { unique: true }),
    ]);
    return { db, stateCollection, usersCollection };
  } catch (error) {
    console.error('[ensureDatabase] Error:', error.message);
    throw error;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function safeParseJson(value, fallback) {
  try {
    if (typeof value === 'object' && value !== null) return value;
    if (typeof value === 'string' && value.length > 0) return JSON.parse(value);
    return fallback;
  } catch {
    return fallback;
  }
}

function createToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = crypto.createHmac('sha256', authSecret).update(encoded).digest('base64url');
  const provided = Buffer.from(signature);
  const actual = Buffer.from(expected);
  if (provided.length !== actual.length || !crypto.timingSafeEqual(provided, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.userId || !payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSession(user) {
  const expiresAt = Date.now() + tokenTtlDays * 24 * 60 * 60 * 1000;
  const token = createToken({
    userId: String(user._id),
    email: user.email,
    name: user.name || '',
    exp: expiresAt,
  });

  return {
    token,
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name || '',
    },
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

  return `${salt}:${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

  const stored = Buffer.from(hash, 'hex');
  const current = Buffer.from(derivedKey);
  return stored.length === current.length && crypto.timingSafeEqual(stored, current);
}

async function readStateForUser(userId) {
  const ready = await getDatabaseReady();
  if (!ready) return null;

  try {
    const row = await ready.stateCollection.findOne(
      { user_id: userId },
      { projection: { _id: 0, habits: 1, records: 1, theme: 1 } }
    );

    if (!row) return null;

    return {
      habits: safeParseJson(row.habits, []),
      records: safeParseJson(row.records, {}),
      theme: row.theme === 'light' ? 'light' : 'dark',
    };
  } catch (error) {
    console.error('[readStateForUser] Error:', error.message);
    return null;
  }
}

async function upsertStateForUser(userId, { habits, records, theme }) {
  const ready = await getDatabaseReady();
  if (!ready) return null;

  await ready.stateCollection.updateOne(
    { user_id: userId },
    {
      $set: {
        user_id: userId,
        habits: Array.isArray(habits) ? habits : [],
        records: records && typeof records === 'object' ? records : {},
        theme: theme === 'light' ? 'light' : 'dark',
        updated_at: new Date(),
      },
    },
    { upsert: true }
  );
}

async function patchStateForUser(userId, patch) {
  const current = (await readStateForUser(userId)) || { habits: [], records: {}, theme: 'dark' };
  await upsertStateForUser(userId, {
    habits: Array.isArray(patch.habits) ? patch.habits : current.habits,
    records: patch.records && typeof patch.records === 'object' ? patch.records : current.records,
    theme: patch.theme === 'light' || patch.theme === 'dark' ? patch.theme : current.theme,
  });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const ready = await getDatabaseReady();
  if (!ready) {
    return res.status(503).json({ error: 'MongoDB is not configured' });
  }

  if (!ObjectId.isValid(payload.userId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const user = await ready.usersCollection.findOne(
    { _id: new ObjectId(payload.userId) },
    { projection: { _id: 1, email: 1, name: 1 } }
  ).catch(() => null);

  if (!user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  req.auth = {
    userId: String(user._id),
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name || '',
    },
  };

  next();
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const ready = await getDatabaseReady();
    if (!ready) return res.status(503).json({ error: 'MongoDB is not configured' });

    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await ready.usersCollection.findOne({ email }, { projection: { _id: 1 } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const result = await ready.usersCollection.insertOne({
      email,
      name,
      passwordHash,
      created_at: new Date(),
    });

    const user = { _id: result.insertedId, email, name };
    await upsertStateForUser(String(result.insertedId), { habits: [], records: {}, theme: 'dark' });

    res.status(201).json({
      ...createSession(user),
      state: { habits: [], records: {}, theme: 'dark' },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create account', details: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const ready = await getDatabaseReady();
    if (!ready) return res.status(503).json({ error: 'MongoDB is not configured' });

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = await ready.usersCollection.findOne({ email });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const state = (await readStateForUser(String(user._id))) || { habits: [], records: {}, theme: 'dark' };
    res.json({
      ...createSession(user),
      state,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log in', details: error.message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const state = (await readStateForUser(req.auth.userId)) || { habits: [], records: {}, theme: 'dark' };
    res.json({ user: req.auth.user, state });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load session', details: error.message });
  }
});

app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const state = await readStateForUser(req.auth.userId);
    res.json(state ? { habits: state.habits || [], records: state.records || {}, theme: state.theme || 'dark' } : { habits: [], records: {}, theme: 'dark' });
  } catch (error) {
    res.status(503).json({ error: 'MongoDB is not available', details: error.message });
  }
});

app.put('/api/state', requireAuth, async (req, res) => {
  try {
    await upsertStateForUser(req.auth.userId, {
      habits: Array.isArray(req.body?.habits) ? req.body.habits : [],
      records: req.body?.records && typeof req.body.records === 'object' ? req.body.records : {},
      theme: req.body?.theme === 'light' ? 'light' : 'dark',
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save state', details: error.message });
  }
});

app.patch('/api/state', requireAuth, async (req, res) => {
  try {
    await patchStateForUser(req.auth.userId, req.body || {});
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to patch state', details: error.message });
  }
});

app.delete('/api/state', requireAuth, async (req, res) => {
  try {
    const ready = await getDatabaseReady();
    if (!ready) return res.status(503).json({ error: 'MongoDB is not configured' });
    await ready.stateCollection.deleteOne({ user_id: req.auth.userId });
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
