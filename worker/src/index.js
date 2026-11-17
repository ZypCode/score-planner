/**
 * Zyp 平台云同步（Cloudflare Workers + KV）
 * 用户名 + 密码登录；会话 token 访问各子项目存档。
 *
 * GET  /health
 * POST /v1/register  { username, password }
 * POST /v1/login     { username, password }
 * GET  /v1/projects/:projectId    Authorization: Bearer <token>
 * PUT  /v1/projects/:projectId    body: { data }
 */

const SESSION_TTL_SEC = 60 * 60 * 24 * 365;
const DATA_TTL_SEC = 60 * 60 * 24 * 90;
const TOKEN_RE = /^[a-f0-9]{32,64}$/i;
const USER_RE = /^[a-z0-9_]{3,32}$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const MIN_PASSWORD_LEN = 8;
const MAX_BODY = 512 * 1024;
const PBKDF2_ITERATIONS = 100_000;

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  h['Access-Control-Allow-Origin'] = origin || '*';
  return h;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normUser(name) {
  return String(name || '').trim().toLowerCase();
}

function parseBearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return '';
  const t = m[1].trim();
  return TOKEN_RE.test(t) ? t : '';
}

function kvUserKey(userId) {
  return `user:${userId}`;
}

function kvSessKey(token) {
  return `sess:${token}`;
}

function kvProjKey(userId, projectId) {
  return `proj:${userId}:${projectId}`;
}

function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function saltFromB64(saltB64) {
  const bin = atob(saltB64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derivePasswordHash(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltFromB64(saltB64);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return b64FromBuffer(bits);
}

async function createPasswordRecord(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = b64FromBuffer(saltBytes.buffer);
  const passwordHash = await derivePasswordHash(password, salt);
  return { passwordHash, salt };
}

async function verifyPassword(password, record) {
  const hash = await derivePasswordHash(password, record.salt);
  return hash === record.passwordHash;
}

async function createSession(env, userId) {
  const token = newToken();
  const createdAt = Date.now();
  await env.SESSIONS.put(
    kvSessKey(token),
    JSON.stringify({ userId, createdAt }),
    { expirationTtl: SESSION_TTL_SEC }
  );
  return { token, createdAt };
}

async function getSession(env, token) {
  const raw = await env.SESSIONS.get(kvSessKey(token));
  if (!raw) return null;
  await env.SESSIONS.put(kvSessKey(token), raw, { expirationTtl: SESSION_TTL_SEC });
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readAuthBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { error: 'invalid json' };
  }
  const username = normUser(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USER_RE.test(username)) return { error: 'invalid username' };
  if (password.length < MIN_PASSWORD_LEN) return { error: 'password too short' };
  return { username, password };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      return json({ ok: true, service: 'zyp-platform-sync', version: 2, auth: 'password' }, 200, origin);
    }

    if (path === '/v1/register' && request.method === 'POST') {
      const auth = await readAuthBody(request);
      if (auth.error) return json({ error: auth.error }, 400, origin);
      const { username, password } = auth;
      const exist = await env.SESSIONS.get(kvUserKey(username));
      if (exist) return json({ error: 'username taken' }, 409, origin);
      const cred = await createPasswordRecord(password);
      await env.SESSIONS.put(
        kvUserKey(username),
        JSON.stringify({ ...cred, createdAt: Date.now() })
      );
      const sess = await createSession(env, username);
      return json({ token: sess.token, username, createdAt: sess.createdAt }, 201, origin);
    }

    if (path === '/v1/login' && request.method === 'POST') {
      const auth = await readAuthBody(request);
      if (auth.error) return json({ error: auth.error }, 400, origin);
      const { username, password } = auth;
      const raw = await env.SESSIONS.get(kvUserKey(username));
      if (!raw) return json({ error: 'invalid credentials' }, 401, origin);
      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        return json({ error: 'invalid credentials' }, 401, origin);
      }
      if (!(await verifyPassword(password, record))) {
        return json({ error: 'invalid credentials' }, 401, origin);
      }
      const sess = await createSession(env, username);
      return json({ token: sess.token, username, createdAt: sess.createdAt }, 200, origin);
    }

    const proj = path.match(/^\/v1\/projects\/([^/]+)$/);
    if (proj) {
      const projectId = proj[1];
      if (!PROJECT_RE.test(projectId)) return json({ error: 'invalid project' }, 400, origin);

      const token = parseBearer(request);
      if (!token) return json({ error: 'missing token' }, 401, origin);
      const session = await getSession(env, token);
      if (!session || !session.userId) return json({ error: 'invalid token' }, 401, origin);

      const key = kvProjKey(session.userId, projectId);

      if (request.method === 'GET') {
        const raw = await env.SESSIONS.get(key);
        if (!raw) {
          return json({ projectId, data: null, updatedAt: null, userId: session.userId }, 200, origin);
        }
        try {
          const doc = JSON.parse(raw);
          return json({
            projectId,
            data: doc.data ?? null,
            updatedAt: doc.updatedAt ?? null,
            userId: session.userId,
          }, 200, origin);
        } catch {
          return json({ error: 'corrupt' }, 500, origin);
        }
      }

      if (request.method === 'PUT') {
        const len = +(request.headers.get('Content-Length') || 0);
        if (len > MAX_BODY) return json({ error: 'payload too large' }, 413, origin);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid json' }, 400, origin);
        }
        const updatedAt = Date.now();
        const doc = { data: body.data ?? null, updatedAt };
        await env.SESSIONS.put(key, JSON.stringify(doc), { expirationTtl: DATA_TTL_SEC });
        return json({ projectId, updatedAt, userId: session.userId }, 200, origin);
      }
    }

    return json({ error: 'not found' }, 404, origin);
  },
};