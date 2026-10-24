'use strict';
// Team logo in the registration drawer: loaded through admin-access (team_logo_url, short-lived signed URL).
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, handlersFor } = require('./fixtures.cjs');
const fs = require('node:fs');
const path = require('node:path');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const withLogo = path => ({ ...team(['3.00', '3.00', '3.00', '3.00']), team_logo_path: path });

async function openDrawer(reg, more, pagePath) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, more), pagePath);
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.evaluate(id => openLiveRegistration(id), reg.id);
  await ctx.page.waitForSelector('table.live-reg-roster');
  return ctx;
}
const logoItem = page => page.locator('.summary-item').filter({ hasText: 'Team Logo' });

// The live Admin is the root page; admin/index.html is an older copy without config.js, kept in step (checked below).
for (const pagePath of ['/index.html']) {
  test(`${pagePath}: a team with a logo shows it in the drawer and opens it full size`, async () => {
    const reg = withLogo('public-registration/abc.png');
    const { page, context, calls } = await openDrawer(reg, { team_logo_url: p => ({ result: { registrationId: p.registrationId, signedUrl: PNG } }) }, pagePath);
    await page.waitForSelector('#liveTeamLogoThumb img');
    assert.strictEqual(await page.locator('#liveTeamLogoThumb img').getAttribute('src'), PNG);
    assert.deepStrictEqual(calls.filter(c => c.action === 'team_logo_url').map(c => c.payload), [{ registrationId: reg.id }]);
    await page.click('#liveTeamLogoThumb');
    await page.waitForSelector('#proofModal.open #proofLarge img');
    assert.match(await page.locator('#proofModalTitle').innerText(), /Team logo/);
    assert.strictEqual(await page.locator('#proofModalEyebrow').innerText(), 'TEAM LOGO');
    assert.strictEqual(calls.filter(c => c.action === 'team_logo_url').length, 1, 'the signed URL is reused, not fetched again');
    assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
    await context.close();
  });

  test(`${pagePath}: a team without a logo says so and asks for nothing`, async () => {
    const reg = withLogo(null);
    const { page, context, calls } = await openDrawer(reg, {}, pagePath);
    assert.match(await logoItem(page).innerText(), /None uploaded/);
    assert.strictEqual(calls.filter(c => c.action === 'team_logo_url').length, 0);
    await context.close();
  });

  test(`${pagePath}: a logo that cannot be loaded shows Unavailable, the drawer still works`, async () => {
    const reg = withLogo('public-registration/missing.png');
    const { page, context } = await openDrawer(reg, {}, pagePath);   // team_logo_url unmocked -> 404
    await page.waitForFunction(() => document.querySelector('#liveTeamLogoThumb')?.textContent === 'Unavailable');
    assert.ok(await page.locator('table.live-reg-roster').isVisible());
    await context.close();
  });
}

test('admin/index.html carries the same team logo code', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  for (const needle of ['api("team_logo_url",{registrationId})', 'id="liveTeamLogoThumb"', 'if(r.team_logo_path) loadLiveTeamLogoThumb(r.id);']) assert.ok(html.includes(needle), needle);
});
