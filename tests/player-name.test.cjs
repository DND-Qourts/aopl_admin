'use strict';
// Edit Name in the registration drawer: corrects a player's name typo through admin-access (correct_player_name).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, handlersFor, snapshot } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

function synthetic(extra = {}) {
  const reg = { ...team(['3.64', '3.00', '2.62', '3.00']), ...extra };
  reg.players[2].player.full_name = 'Raven Dayrig';
  return reg;
}
async function openDrawer(reg, more = {}) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, more));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.evaluate(id => openLiveRegistration(id), reg.id);
  await ctx.page.waitForSelector('table.live-reg-roster');
  return ctx;
}
const row = (page, n) => page.locator('table.live-reg-roster tbody tr').nth(n);
const nameCalls = calls => calls.filter(c => c.action === 'correct_player_name');

test('Edit Name corrects the name, sends only the name and reason, and shows the new name', async () => {
  const reg = synthetic();
  let saved = null;
  const more = {
    correct_player_name: p => { saved = p; return { result: { oldName: 'Raven Dayrig', newName: p.fullName } }; },
    registrations_snapshot: () => {
      if (saved) reg.players[2].player.full_name = saved.fullName;
      return { registrations: [reg], divisions: [], summary: { total: 1, statusCounts: {} }, event: { id: 'ev' }, warnings: [] };
    }
  };
  const { page, context, calls } = await openDrawer(reg, more);
  assert.strictEqual(await page.locator('table.live-reg-roster button', { hasText: 'Edit Name' }).count(), 4, 'one Edit Name per player');
  await row(page, 2).locator('button', { hasText: 'Edit Name' }).click();
  await page.waitForSelector('#livePlayerNameModal.open');
  assert.strictEqual(await page.locator('#livePlayerNameCurrent').innerText(), 'Raven Dayrig');
  assert.strictEqual(await page.inputValue('#livePlayerNameInput'), 'Raven Dayrig', 'prefilled with the current name');
  await page.fill('#livePlayerNameInput', '  Raven   Dayrit ');
  await page.fill('#livePlayerNameReason', 'Typo in the registration form');
  await page.click('#livePlayerNameConfirm');
  await page.waitForSelector('#livePlayerNameModal:not(.open)', { state: 'attached' });
  assert.deepStrictEqual(nameCalls(calls).map(c => c.payload), [{ registrationId: reg.id, registrationPlayerId: 'm3', fullName: 'Raven Dayrit', reason: 'Typo in the registration form' }]);
  await page.waitForFunction(() => /Raven Dayrit/.test(document.querySelector('table.live-reg-roster')?.innerText || ''));
  assert.match(await row(page, 2).innerText(), /Raven Dayrit/);
  assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
  await context.close();
});

test('an unchanged name or a missing reason is stopped before anything is sent', async () => {
  const { page, context, calls } = await openDrawer(synthetic(), { correct_player_name: { result: {} } });
  await row(page, 2).locator('button', { hasText: 'Edit Name' }).click();
  await page.fill('#livePlayerNameReason', 'Typo');
  await page.click('#livePlayerNameConfirm');
  assert.match(await page.locator('#livePlayerNameError').innerText(), /unchanged/);
  await page.fill('#livePlayerNameInput', 'Raven Dayrit');
  await page.fill('#livePlayerNameReason', ' ');
  await page.click('#livePlayerNameConfirm');
  assert.match(await page.locator('#livePlayerNameError').innerText(), /reason/);
  await page.fill('#livePlayerNameInput', 'R');
  await page.fill('#livePlayerNameReason', 'Typo');
  await page.click('#livePlayerNameConfirm');
  assert.match(await page.locator('#livePlayerNameError').innerText(), /2 to 120/);
  assert.strictEqual(nameCalls(calls).length, 0);
  await context.close();
});

test('a refusal from the server is shown in plain words and the modal stays open', async () => {
  const { page, context } = await openDrawer(synthetic(), { correct_player_name: { __status: 400, error: 'PLAYER_NAME_STATUS_INVALID' } });
  await row(page, 2).locator('button', { hasText: 'Edit Name' }).click();
  await page.fill('#livePlayerNameInput', 'Raven Dayrit');
  await page.fill('#livePlayerNameReason', 'Typo');
  await page.click('#livePlayerNameConfirm');
  await page.waitForFunction(() => document.getElementById('livePlayerNameError').style.display === 'block');
  assert.match(await page.locator('#livePlayerNameError').innerText(), /closed and cannot be edited/);
  assert.ok(await page.locator('#livePlayerNameModal.open').isVisible());
  assert.strictEqual(await page.locator('#livePlayerNameConfirm').isDisabled(), false);
  await context.close();
});

test('Edit Name is offered while a payment proof awaits review, where Replace is not', async () => {
  const { page, context } = await openDrawer(synthetic({ status: 'confirmed', payment_status: 'submitted' }));
  assert.strictEqual(await page.locator('table.live-reg-roster button', { hasText: 'Edit Name' }).count(), 4);
  assert.strictEqual(await page.locator('table.live-reg-roster button', { hasText: 'Replace' }).count(), 0);
  await context.close();
});

test('no Edit Name on a withdrawn team or for a role without registrations_edit', async () => {
  let ctx = await openDrawer(synthetic({ status: 'withdrawn', holds_slot: false }));
  assert.strictEqual(await ctx.page.locator('table.live-reg-roster button', { hasText: 'Edit Name' }).count(), 0);
  await ctx.context.close();
  const viewer = { ...snapshot, me: { ...snapshot.me, permissions: snapshot.me.permissions.filter(p => p !== 'registrations_edit') } };
  ctx = await openDrawer(synthetic(), { snapshot: viewer });
  assert.strictEqual(await ctx.page.locator('table.live-reg-roster button', { hasText: 'Edit Name' }).count(), 0);
  await ctx.context.close();
});

test('admin/index.html carries the same Edit Name code', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  for (const needle of ['id="livePlayerNameModal"', 'api("correct_player_name",', 'openLivePlayerName(']) assert.ok(html.includes(needle), needle);
});
