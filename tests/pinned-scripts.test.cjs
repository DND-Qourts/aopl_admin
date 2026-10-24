'use strict';
// The Admin pages must not load scripts from a CDN, and the vendored supabase-js must match its integrity hash.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');

for (const page of ['index.html', 'admin/index.html']) {
  test(`${page} loads no third-party scripts and pins supabase-js`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].map(m => m[0]);
    assert.deepStrictEqual(srcs.filter(s => /src="(https?:)?\/\//.test(s)), [], 'no remote script tags');
    const tag = srcs.find(s => /supabase-js-[\d.]+\.umd\.js/.test(s));
    assert.ok(tag, 'supabase-js is loaded from the vendored file');
    const file = path.join(path.dirname(path.join(ROOT, page)), tag.match(/src="([^"]+)"/)[1]);
    const sri = tag.match(/integrity="([^"]+)"/)[1];
    const digest = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64');
    assert.strictEqual(digest, sri, 'vendored file matches its integrity hash');
  });
}
