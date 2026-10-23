'use strict';
// Shared test helpers. Serves the repo root locally and intercepts every
// network request, so tests can never reach the production Supabase project.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

// Minimal stand-in for supabase-js: always signed in as a fixed test user.
const FAKE_SUPABASE = `
window.supabase = { createClient: function () { return { auth: {
  getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'test-user' } } } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({}), signInWithPassword: async () => ({ data: { session: null }, error: null }),
  updateUser: async () => ({ error: null })
} }; } };`;

/**
 * Opens the admin page with all backend traffic mocked.
 * `handlers` maps an admin-access action name to a response body (or function).
 */
async function openAdmin(browser, baseUrl, handlers, pagePath = '/index.html') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const blocked = [];
  const calls = [];
  page.on('pageerror', e => calls.push({ pageerror: String(e) }));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (/supabase-js/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE });
    if (url.pathname.endsWith('/functions/v1/admin-access')) {
      const { action, ...payload } = JSON.parse(route.request().postData() || '{}');
      calls.push({ action, payload });
      const h = handlers[action];
      const body = typeof h === 'function' ? h(payload) : h;
      if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'TEST_UNMOCKED_' + action }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...body }) });
    }
    if (url.hostname === 'x' || url.pathname === '/x') return route.fulfill({ status: 404, body: '' });
    // Anything else (including any request to a real Supabase host) is blocked and recorded.
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.goto(baseUrl + pagePath);
  return { page, context, blocked, calls };
}

module.exports = { startServer, launch, openAdmin };
