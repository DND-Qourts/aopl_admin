'use strict';
// Edit Team Name in the registration drawer: changes a team's name through admin-access (correct_team_name).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, handlersFor, snapshot } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const synthetic = (extra = {}) => ({ ...team(['3.00', '3.00', '3.00', '3.00']), team_name: 'Chingkitz', ...extra });
async function openDrawer(reg, more = {}) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, more));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.evaluate(id => openLiveRegistration(id), reg.id);
  await ctx.page.waitForSelector('table.live-reg-roster');
  return ctx;
}
const editButton = page => page.locator('#drawerBody button', { hasText: 'Edit Team Name' });
const teamCalls = calls => calls.filter(c => c.action === 'correct_team_name');

test('Edit Team Name changes the name, sends only the name and reason, and shows the new name', async () => {
  const reg = synthetic();
  let saved = null;
  const more = {
    correct_team_name: p => { saved = p; return { result: { oldName: 'Chingkitz', newName: p.teamName } }; },
    registrations_snapshot: () => {
      if (saved) reg.team_name = saved.teamName;
      return { registrations: [reg], divisions: [], summary: { total: 1, statusCounts: {} }, event: { id: 'ev' }, warnings: [] };
    }
  };
  const { page, context, calls } = await openDrawer(reg, more);
  assert.strictEqual(await editButton(page).count(), 1);
  await editButton(page).click();
  await page.waitForSelector('#liveTeamNameModal.open');
  assert.strictEqual(await page.locator('#liveTeamNameCurrent').innerText(), 'Chingkitz');
  assert.strictEqual(await page.inputValue('#liveTeamNameInput'), 'Chingkitz', 'prefilled with the current name');
  await page.fill('#liveTeamNameInput', '  Chingkits   Squad ');
  await page.fill('#liveTeamNameReason', 'Typo in the registration form');
  await page.click('#liveTeamNameConfirm');
  await page.waitForSelector('#liveTeamNameModal:not(.open)', { state: 'attached' });
  assert.deepStrictEqual(teamCalls(calls).map(c => c.payload), [{ registrationId: reg.id, teamName: 'Chingkits Squad', reason: 'Typo in the registration form' }]);
  await page.waitForFunction(() => document.getElementById('drawerTitle')?.textContent === 'Chingkits Squad');
  assert.match(await page.locator('#drawerBody .summary-item').filter({ hasText: 'Team Name' }).innerText(), /Chingkits Squad/);
  assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
  await context.close();
});

test('an unchanged, too long or unexplained name is stopped before anything is sent', async () => {
  const { page, context, calls } = await openDrawer(synthetic(), { correct_team_name: { result: {} } });
  await editButton(page).click();
  await page.fill('#liveTeamNameReason', 'Typo');
  await page.click('#liveTeamNameConfirm');
  assert.match(await page.locator('#liveTeamNameError').innerText(), /unchanged/);
  await page.fill('#liveTeamNameInput', 'C');
  await page.click('#liveTeamNameConfirm');
  assert.match(await page.locator('#liveTeamNameError').innerText(), /2 to 48/);
  assert.strictEqual(await page.getAttribute('#liveTeamNameInput', 'maxlength'), '48');
  await page.fill('#liveTeamNameInput', 'Chingkits');
  await page.fill('#liveTeamNameReason', ' ');
  await page.click('#liveTeamNameConfirm');
  assert.match(await page.locator('#liveTeamNameError').innerText(), /reason/);
  assert.strictEqual(teamCalls(calls).length, 0);
  await context.close();
});

test('a name another team uses is refused in plain words and the modal stays open', async () => {
  const { page, context } = await openDrawer(synthetic(), { correct_team_name: { __status: 400, error: 'TEAM_NAME_TAKEN' } });
  await editButton(page).click();
  await page.fill('#liveTeamNameInput', 'Other Squad');
  await page.fill('#liveTeamNameReason', 'Captain asked');
  await page.click('#liveTeamNameConfirm');
  await page.waitForFunction(() => document.getElementById('liveTeamNameError').style.display === 'block');
  assert.match(await page.locator('#liveTeamNameError').innerText(), /already uses this name/);
  assert.ok(await page.locator('#liveTeamNameModal.open').isVisible());
  assert.strictEqual(await page.locator('#liveTeamNameConfirm').isDisabled(), false);
  await context.close();
});

test('offered while a payment proof awaits review; not on a withdrawn team or without registrations_edit', async () => {
  let ctx = await openDrawer(synthetic({ status: 'confirmed', payment_status: 'submitted' }));
  assert.strictEqual(await editButton(ctx.page).count(), 1);
  await ctx.context.close();
  ctx = await openDrawer(synthetic({ status: 'withdrawn', holds_slot: false }));
  assert.strictEqual(await editButton(ctx.page).count(), 0);
  await ctx.context.close();
  const viewer = { ...snapshot, me: { ...snapshot.me, permissions: snapshot.me.permissions.filter(p => p !== 'registrations_edit') } };
  ctx = await openDrawer(synthetic(), { snapshot: viewer });
  assert.strictEqual(await editButton(ctx.page).count(), 0);
  assert.match(await ctx.page.locator('#drawerBody .summary-item').filter({ hasText: 'Team Name' }).innerText(), /Chingkitz/, 'the name is still shown');
  await ctx.context.close();
});

test('admin/index.html carries the same Edit Team Name code', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  for (const needle of ['id="liveTeamNameModal"', 'api("correct_team_name",', 'openLiveTeamName(']) assert.ok(html.includes(needle), needle);
});
