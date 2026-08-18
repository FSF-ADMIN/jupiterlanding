// Jupiter site server — static pages + signup/tracking API + admin auth.
// Run: node Jupiter/server.js   (port 4960, no dependencies)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 4960;
const PUBLIC = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.JUPITER_ADMIN_PASSWORD || 'jupiter2026';
const SESSION_TTL = 12 * 60 * 60 * 1000;

// Google OAuth — set these (env vars or paste values) to enable "Sign up with Google".
// In Google Cloud console add the redirect URI:  <your-origin>/auth/google/callback
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const sessions = new Map();
const oauthStates = new Map();

function httpsPost(host, pathName, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req = https.request({
      host, path: pathName, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
    }, r => {
      let out = '';
      r.on('data', c => out += c);
      r.on('end', () => { try { resolve(JSON.parse(out)); } catch { reject(new Error('bad oauth response')); } });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function httpsGet(host, pathName, bearer) {
  return new Promise((resolve, reject) => {
    https.get({ host, path: pathName, headers: { Authorization: 'Bearer ' + bearer } }, r => {
      let out = '';
      r.on('data', c => out += c);
      r.on('end', () => { try { resolve(JSON.parse(out)); } catch { reject(new Error('bad userinfo response')); } });
    }).on('error', reject);
  });
}

function userCookie(id) {
  return `jupiter_user=${id}; HttpOnly; Path=/; Max-Age=${30 * 86400}; SameSite=Lax`;
}

function currentUser(req) {
  const id = getCookie(req, 'jupiter_user');
  return id ? db.getUserById(id) : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

function isAdmin(req) {
  const token = getCookie(req, 'jupiter_admin');
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // ---------- API ----------
    if (p === '/api/signup' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 120);
      const email = String(body.email || '').trim().slice(0, 200);
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return send(res, 400, { error: 'A valid name and email are required.' });
      const { user, existing } = db.addUser({
        name,
        email,
        company: String(body.company || '').trim().slice(0, 160),
        teamSize: String(body.teamSize || '').slice(0, 40),
        plan: String(body.plan || '').slice(0, 40),
        source: 'form'
      });
      return send(res, 200, { ok: true, id: user.id, existing }, { 'Set-Cookie': userCookie(user.id) });
    }

    if (p === '/api/me' && req.method === 'GET') {
      const user = currentUser(req);
      return send(res, 200, { user: user ? { name: user.name, email: user.email } : null });
    }

    if (p === '/api/logout-user' && req.method === 'POST')
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'jupiter_user=; Path=/; Max-Age=0' });

    if (p === '/api/demo' && req.method === 'POST') {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'Sign up first to book a demo.' });
      const { existing } = db.addDemoRequest({ userId: user.id, name: user.name, email: user.email });
      return send(res, 200, { ok: true, existing });
    }

    // ---------- Google OAuth ----------
    if (p === '/auth/google') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        res.writeHead(302, { Location: '/signup.html?google=unconfigured' });
        return res.end();
      }
      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.set(state, Date.now() + 10 * 60 * 1000);
      const origin = `http://${req.headers.host}`;
      const auth = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: origin + '/auth/google/callback',
        response_type: 'code',
        scope: 'openid email profile',
        state
      });
      res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + auth });
      return res.end();
    }

    if (p === '/auth/google/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const exp = oauthStates.get(state);
      oauthStates.delete(state);
      if (!code || !exp || exp < Date.now()) {
        res.writeHead(302, { Location: '/signup.html?google=failed' });
        return res.end();
      }
      try {
        const origin = `http://${req.headers.host}`;
        const tok = await httpsPost('oauth2.googleapis.com', '/token', {
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: origin + '/auth/google/callback',
          grant_type: 'authorization_code'
        });
        const info = await httpsGet('openidconnect.googleapis.com', '/v1/userinfo', tok.access_token);
        if (!info.email) throw new Error('no email');
        const { user } = db.addUser({ name: info.name || info.email.split('@')[0], email: info.email, source: 'google' });
        res.writeHead(302, { Location: '/?signedup=1', 'Set-Cookie': userCookie(user.id) });
        return res.end();
      } catch {
        res.writeHead(302, { Location: '/signup.html?google=failed' });
        return res.end();
      }
    }

    if (p === '/api/track' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      let page = String(body.page || '/').slice(0, 100);
      if (!page.startsWith('/')) page = '/';
      if (page === '/' || page === '/index.html') page = '/home';
      else page = page.replace(/\.html$/, '');
      if (!/^\/[a-z0-9/_-]*$/i.test(page)) page = '/other';
      db.trackVisit(page);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      const given = Buffer.from(String(body.password || ''));
      const want = Buffer.from(ADMIN_PASSWORD);
      const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
      if (!ok) return send(res, 401, { error: 'wrong password' });
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, Date.now() + SESSION_TTL);
      return send(res, 200, { ok: true }, {
        'Set-Cookie': `jupiter_admin=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`
      });
    }

    if (p === '/api/admin/logout' && req.method === 'POST') {
      const token = getCookie(req, 'jupiter_admin');
      if (token) sessions.delete(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'jupiter_admin=; Path=/; Max-Age=0' });
    }

    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });

      if (p === '/api/admin/data' && req.method === 'GET')
        return send(res, 200, { users: db.getUsers(), visits: db.getVisits(), demoRequests: db.getDemoRequests() });

      if (p === '/api/admin/export.csv' && req.method === 'GET') {
        const rows = [['Name', 'Email', 'Company', 'Team size', 'Plan', 'Signed up']];
        db.getUsers().forEach(u => rows.push([
          u.name, u.email, u.company, u.teamSize, u.plan,
          new Date(u.createdAt).toISOString()
        ]));
        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
        return send(res, 200, csv, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="jupiter-users.csv"'
        });
      }

      const del = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
      if (del && req.method === 'DELETE')
        return send(res, db.deleteUser(del[1]) ? 200 : 404, { ok: true });

      return send(res, 404, { error: 'not found' });
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });

    // ---------- Static ----------
    let file = p === '/' ? '/index.html' : p;
    if (file === '/admin') file = '/admin.html';
    if (!path.extname(file)) file += '.html';
    const full = path.join(PUBLIC, path.normalize(file));
    if (!full.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });

    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1 style="font-family:sans-serif">404 — page not found</h1><p style="font-family:sans-serif"><a href="/">Back to Jupiter</a></p>');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Jupiter running at http://localhost:${PORT}`);
  console.log(`Admin panel:      http://localhost:${PORT}/admin  (password: ${ADMIN_PASSWORD === 'jupiter2026' ? 'jupiter2026 — set JUPITER_ADMIN_PASSWORD to change' : 'from env'})`);
});
