'use strict';
// A tab left open across a release is told to reload (a stale page once showed an NR player as 0.00 and could not verify them).
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, handlersFor } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

async function open(liveLastModified) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(team(['3.00', '3.00', '3.00', '3.00'])));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  const heads = [];
  await ctx.page.route('**/index.html', route => {
    if (route.request().method() !== 'HEAD') return route.fallback();
    heads.push(route.request().headers()['cache-control'] || '');
    return route.fulfill({ status: 200, headers: liveLastModified ? { 'last-modified': new Date(liveLastModified).toUTCString() } : {} });
  });
  return { ...ctx, heads };
}
const check = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('a newer deploy shows the reload bar', async () => {
  const { page, context, heads } = await open(Date.now() + 3600 * 1000);
  assert.strictEqual(await page.locator('#updateBar').isHidden(), true);
  await check(page);
  await page.waitForSelector('#updateBar:not([hidden])');
  assert.match(await page.locator('#updateBar').innerText(), /newer version of the Admin/);
  assert.ok(heads.length >= 1, 'it asked the server');
  await context.close();
});

test('the same deploy, or a server that sends no date, shows nothing', async () => {
  for (const live of [Date.now() - 3600 * 1000, null]) {
    const { page, context, heads } = await open(live);
    await check(page);
    await page.waitForTimeout(300);
    assert.ok(heads.length >= 1, 'it did check');
    assert.strictEqual(await page.locator('#updateBar').isHidden(), true);
    await context.close();
  }
});

test('the check bypasses the browser cache', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /fetch\(location\.pathname,\{method:"HEAD",cache:"no-store"\}\)/);
});
