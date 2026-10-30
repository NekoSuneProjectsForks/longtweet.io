import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || '/data';
const database = path.join(dataDir, 'posts.json');
const password = process.env.ADMIN_PASSWORD || '';
const secret = process.env.SESSION_SECRET || '';
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (password.length < 12 || secret.length < 32) {
  console.error('Set ADMIN_PASSWORD (12+ characters) and SESSION_SECRET (32+ characters).');
  process.exit(1);
}
fs.mkdirSync(dataDir, { recursive: true });
let posts;
try {
  posts = JSON.parse(fs.readFileSync(database, 'utf8'));
  if (!Array.isArray(posts)) throw new Error('Not an array');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  posts = [];
}
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const toJSON = (res, code, value) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const save = () => {
  const temp = database + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(posts, null, 2), { mode: 0o600 });
  fs.renameSync(temp, database);
};
const digest = input => crypto.createHmac('sha256', secret).update(input).digest('hex');
const secureEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const passwordHash = crypto.scryptSync(password, 'longtweet-selfhost-password-v1', 64);
const validPassword = value => {
  const candidate = crypto.scryptSync(String(value || '').slice(0, 1024), 'longtweet-selfhost-password-v1', 64);
  return crypto.timingSafeEqual(candidate, passwordHash);
};
const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
const authenticated = req => {
  const value = cookie(req);
  if (!value) return false;
  const [expiry, signature] = value.split('.');
  if (!/^\d{10,}$/.test(expiry || '') || !signature || Number(expiry) <= Date.now()) return false;
  return secureEqual(signature, digest(expiry));
};
const readBody = async req => {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Expected JSON'), { status: 415 });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 300_000) throw Object.assign(new Error('Post too large'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
};
const sanitize = body => {
  const title = String(body.title || '').trim().slice(0, 180);
  const content = String(body.content || '').slice(0, 100_000);
  const status = ['draft', 'published'].includes(body.status) ? body.status : 'draft';
  const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'unlisted';
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',')).map(x => String(x).trim().slice(0, 32)).filter(Boolean))].slice(0, 15);
  if (!title) throw Object.assign(new Error('Title is required'), { status: 400 });
  return { title, content, status, visibility, tags };
};
const publicPost = post => post.status === 'published' && post.visibility !== 'private';
const summarize = post => ({ id: post.id, slug: post.slug, title: post.title, status: post.status, visibility: post.visibility, tags: post.tags, createdAt: post.createdAt, updatedAt: post.updatedAt, excerpt: post.content.slice(0, 180) });
const sendHtml = (res, html) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(html);
};
const failures = new Map();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || 'GET';
    if (pathname === '/health' && method === 'GET') return toJSON(res, 200, { ok: true });
    // Same-origin custom header plus JSON content type protects cookie-authenticated mutations from cross-site forms.
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers['x-requested-with'] !== 'LongtweetStudio') return toJSON(res, 403, { error: 'Missing request verification header' });
      const origin = req.headers.origin;
      const configured = publicUrl ? new URL(publicUrl).origin : null;
      if (origin && configured && origin !== configured) return toJSON(res, 403, { error: 'Invalid origin' });
      if (origin && !configured && new URL(origin).host !== req.headers.host) return toJSON(res, 403, { error: 'Invalid origin' });
    }
    if (pathname === '/api/session' && method === 'GET') return toJSON(res, 200, { authenticated: authenticated(req) });
    if (pathname === '/api/login' && method === 'POST') {
      const ip = String(req.socket.remoteAddress || 'unknown');
      const record = failures.get(ip) || { count: 0, until: 0 };
      if (record.until > Date.now()) return toJSON(res, 429, { error: 'Too many attempts. Try later.' });
      const body = await readBody(req);
      if (!validPassword(body.password)) {
        record.count++;
        if (record.count >= 5) { record.until = Date.now() + 15 * 60_000; record.count = 0; }
        failures.set(ip, record);
        return toJSON(res, 401, { error: 'Incorrect password' });
      }
      failures.delete(ip);
      const expiry = String(Date.now() + 7 * 24 * 60 * 60_000);
      const secure = publicUrl.startsWith('https://') ? '; Secure' : '';
      res.setHeader('Set-Cookie', 'session=' + expiry + '.' + digest(expiry) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800' + secure);
      return toJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return toJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/public' && method === 'GET') {
      return toJSON(res, 200, posts.filter(p => p.status === 'published' && p.visibility === 'public').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarize));
    }
    if (pathname.startsWith('/api/public/') && method === 'GET') {
      const post = posts.find(p => p.slug === pathname.slice('/api/public/'.length));
      return post && publicPost(post) ? toJSON(res, 200, post) : toJSON(res, 404, { error: 'Post not found' });
    }
    if (pathname.startsWith('/api/posts')) {
      if (!authenticated(req)) return toJSON(res, 401, { error: 'Authentication required' });
      if (pathname === '/api/posts' && method === 'GET') return toJSON(res, 200, [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarize));
      if (pathname === '/api/posts' && method === 'POST') {
        const input = sanitize(await readBody(req));
        const now = new Date().toISOString();
        const post = { ...input, id: crypto.randomUUID(), slug: crypto.randomBytes(7).toString('hex'), createdAt: now, updatedAt: now };
        posts.push(post); save(); return toJSON(res, 201, post);
      }
      const match = pathname.match(/^\/api\/posts\/([0-9a-f-]{36})$/);
      if (match) {
        const index = posts.findIndex(p => p.id === match[1]);
        if (index < 0) return toJSON(res, 404, { error: 'Post not found' });
        if (method === 'GET') return toJSON(res, 200, posts[index]);
        if (method === 'PUT') {
          const input = sanitize(await readBody(req));
          posts[index] = { ...posts[index], ...input, updatedAt: new Date().toISOString() };
          save(); return toJSON(res, 200, posts[index]);
        }
        if (method === 'DELETE') { posts.splice(index, 1); save(); return toJSON(res, 200, { ok: true }); }
      }
    }
    if (method === 'GET' && (pathname === '/' || pathname === '/studio' || pathname === '/posts' || /^\/p\/[0-9a-f]{14}$/.test(pathname))) return sendHtml(res, indexHtml);
    return toJSON(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return toJSON(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
  }
});
server.listen(port, '0.0.0.0', () => console.log('Longtweet Studio listening on ' + port));
