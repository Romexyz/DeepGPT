const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = process.env.MONGODB_DB || 'deepgpt';

let _client = null;
async function getDb() {
  if (_client) {
    try { await _client.db('admin').command({ ping: 1 }); }
    catch { try { await _client.close(); } catch {} _client = null; }
  }
  if (!_client) {
    _client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 8000,
    });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Or-Key',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function randomToken() { return crypto.randomBytes(32).toString('hex'); }

async function handleRegister(body) {
  const { email, password, exnessPort } = body;
  if (!email || !password) return json(400, { message: 'กรุณากรอก email และ password' });
  if (!exnessPort) return json(400, { message: 'กรุณากรอกเลขพอร์ต Exness' });
  const db = await getDb();
  const portStr = String(exnessPort).trim();
  const allowed = await db.collection('exness_ports').findOne({ port: portStr });
  if (!allowed) return json(403, { message: 'เลขพอร์ต Exness ไม่ถูกต้องหรือไม่มีในระบบ' });
  if (await db.collection('users').findOne({ email })) return json(409, { message: 'อีเมลนี้มีบัญชีแล้ว' });
  if (await db.collection('users').findOne({ exnessPort: portStr })) return json(409, { message: 'เลขพอร์ต Exness นี้ถูกใช้งานแล้ว' });
  const passwordHash = await bcrypt.hash(password, 10);
  await db.collection('users').insertOne({ email, passwordHash, exnessPort: portStr, createdAt: new Date().toISOString() });
  return json(200, { ok: true });
}

async function handleLogin(body) {
  const { email, password } = body;
  if (!email || !password) return json(400, { message: 'กรุณากรอก email และ password' });
  const db = await getDb();
  const user = await db.collection('users').findOne({ email });
  if (!user) return json(401, { message: 'email หรือ password ไม่ถูกต้อง' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return json(401, { message: 'email หรือ password ไม่ถูกต้อง' });
  const token = randomToken();
  await db.collection('tokens').insertOne({ token, userId: user._id.toString(), email: user.email, createdAt: new Date().toISOString() });
  return json(200, { token, email: user.email });
}

async function handleLogout(body) {
  const { token } = body;
  if (!token) return json(400, { message: 'no token' });
  const db = await getDb();
  await db.collection('tokens').deleteOne({ token });
  return json(200, { ok: true });
}

async function handleMe(headers) {
  const auth = (headers['authorization'] || headers['Authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(401, { message: 'ไม่ได้เข้าสู่ระบบ' });
  const db = await getDb();
  const sess = await db.collection('tokens').findOne({ token });
  if (!sess) return json(401, { message: 'session หมดอายุ' });
  return json(200, { email: sess.email });
}

async function handleChat(event) {
  const { messages } = JSON.parse(event.body || '{}');
  const orKey = (event.headers['x-or-key'] || event.headers['X-Or-Key'] || '');
  if (!orKey || !orKey.startsWith('sk-or-')) return json(401, { error: 'NO_KEY' });
  const withSystem = [
    { role: 'system', content: process.env.SYSTEM_PROMPT || '' },
    ...messages.filter(m => m.role !== 'system')
  ];
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://deepgpt.netlify.app', 'X-Title': 'DeepGPT' },
    body: JSON.stringify({ model: 'openrouter/auto', messages: withSystem, temperature: 0.85, max_tokens: 4096, stream: false })
  });
  const data = await resp.json();
  if (!resp.ok) return json(resp.status, { error: data?.error?.message || 'OR error' });
  const content = data.choices?.[0]?.message?.content || '';
  return json(200, { delta: content, done: true });
}

async function handleFfEvents() {
  const FF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
    'Origin': 'https://www.forexfactory.com',
  };
  const urls = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  ];

  // try direct fetch
  let merged = [];
  try {
    const results = await Promise.all(
      urls.map(u =>
        fetch(u, { headers: FF_HEADERS })
          .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .catch(() => [])
      )
    );
    merged = results.flat().filter(e => e && e.country && e.date);
  } catch {}

  // fallback: allorigins proxy for both weeks
  if (merged.length === 0) {
    try {
      const proxyResults = await Promise.all(
        urls.map(u =>
          fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(u))
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      merged = proxyResults.flat().filter(e => e && e.country && e.date);
    } catch {}
  }

  // if we got live data → save to MongoDB cache
  if (merged.length > 0) {
    try {
      const db = await getDb();
      await db.collection('ff_events_cache').replaceOne(
        { _id: 'latest' },
        { _id: 'latest', events: merged, updatedAt: new Date() },
        { upsert: true }
      );
    } catch {}
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(merged) };
  }

  // last resort: serve from MongoDB cache
  try {
    const db = await getDb();
    const cached = await db.collection('ff_events_cache').findOne({ _id: 'latest' });
    if (cached && Array.isArray(cached.events) && cached.events.length > 0) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT' }, body: JSON.stringify(cached.events) };
    }
  } catch {}

  return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([]) };
}

async function handleOrUsage(headers) {
  const key = (headers['x-or-key'] || headers['X-Or-Key'] || '');
  if (!key) return json(401, { error: 'no key' });
  const r = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { 'Authorization': 'Bearer ' + key } });
  const data = await r.json();
  return { statusCode: r.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Or-Key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }, body: '' };
  }
  const rawPath = event.path || '';
  const path = rawPath.replace('/.netlify/functions/api', '').replace(/^\/api/, '');
  const method = event.httpMethod;
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch {}
  try {
    if (path === '/chat'          && method === 'POST') return handleChat(event);
    if (path === '/auth/register' && method === 'POST') return handleRegister(body);
    if (path === '/auth/login'    && method === 'POST') return handleLogin(body);
    if (path === '/auth/logout'   && method === 'POST') return handleLogout(body);
    if (path === '/auth/me'       && method === 'GET')  return handleMe(event.headers);
    if (path === '/ff-events'     && method === 'GET')  return handleFfEvents();
    if (path === '/or-usage'      && method === 'GET')  return handleOrUsage(event.headers);
    return json(404, { error: 'not found', path });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
