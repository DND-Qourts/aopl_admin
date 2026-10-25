'use strict';
// Admin team registration (live): "+ Add Registration" sends the public-form fields to admin-access create_registration.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { snapshot, team, handlersFor, D14, D16 } = require('./fixtures.cjs');
const fs = require('node:fs');
const path = require('node:path');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const D12closed = { id: 'div12', code: 'D12', name: 'DUPR 12', team_rating_cap: 12, player_rating_cap: 3.49, nr_equivalent: 3, is_open: false, team_capacity: 8, reserved: 0, remaining: 8 };
const withPerms = perms => ({ ...snapshot, me: { ...snapshot.me, permissions: perms } });
const ALL = [...snapshot.me.permissions, 'communications_send'];
const NEW_ID = 'reg-new';

function handlers({ perms = ALL, eventStatus = 'registration_open', divisions = [D12closed, D14, D16], create } = {}) {
  const base = handlersFor(team(['3.00', '3.00', '3.00', '3.00']));
  const created = { ...team(['3.00', '3.00', '3.00', '3.00']), id: NEW_ID, reference: 'AOPL-14-000099', team_name: 'Walk In', source: 'admin' };
  let made = false;
  return {
    ...base,
    snapshot: withPerms(perms),
    registrations_snapshot: () => ({ ...base.registrations_snapshot, event: { id: 'ev', status: eventStatus }, divisions, registrations: made ? [created, ...base.registrations_snapshot.registrations] : base.registrations_snapshot.registrations }),
    create_registration: p => { const out = (create || (() => ({ result: { reference: 'AOPL-14-000099', statusCode: 'under_review', status: 'Under Review', teamName: 'Walk In', registrationId: NEW_ID, source: 'admin', notification: { status: p.emailTeam ? 'sent' : 'not_requested' } } })))(p); if (!out.__status) made = true; return out; }
  };
}

async function open(h) {
  const ctx = await openAdmin(browser, baseUrl, h);
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.waitForSelector('#liveRegistrationTable');
  return ctx;
}

async function fill(page, { nr = false, logo = null } = {}) {
  await page.click('#liveAdminRegOpen');
  await page.waitForSelector('#liveAdminRegistrationModal.open');
  await page.fill('#liveAdminRegTeam', 'Walk In');
  await page.fill('#liveAdminRegNote', 'Paid at the desk');
  for (let i = 1; i <= 4; i++) {
    const b = `[data-admin-reg-player="${i}"]`;
    await page.fill(`${b} [data-f=fullName]`, `Walk Player ${i}`);
    await page.fill(`${b} [data-f=email]`, `walk${i}@example.test`);
    await page.fill(`${b} [data-f=mobile]`, `0917000000${i}`);
    await page.fill(`${b} [data-f=duprId]`, `wk00${i}`);
    if (nr && i === 4) await page.check(`${b} [data-f=isNr]`); else await page.fill(`${b} [data-f=submittedDupr]`, '3.00');
    await page.selectOption(`${b} [data-f=shirtSize]`, i === 3 ? '2XS' : 'M');
  }
  if (logo) await page.setInputFiles('#liveAdminRegLogo', logo);
  await page.check('#liveAdminRegConsent');
}

test('the button shows only for registrations_edit, and the form offers only open divisions', async () => {
  let { page, context } = await open(handlers({ perms: ['registrations_view'] }));
  assert.strictEqual(await page.locator('#liveAdminRegOpen').count(), 0);
  await context.close();
  ({ page, context } = await open(handlers()));
  await page.click('#liveAdminRegOpen');
  const options = await page.locator('#liveAdminRegDivision option').evaluateAll(o => o.map(x => x.value));
  assert.deepStrictEqual(options, ['D14', 'D16'], 'D12 is closed, so it is not offered');
  assert.strictEqual(await page.locator('[data-admin-reg-player="1"] input[name="liveAdminRegCaptain"]').isChecked(), true, 'player 1 is captain by default');
  assert.ok(await page.locator('#liveAdminRegEmailRow').isVisible());
  assert.strictEqual(await page.locator('#liveAdminRegConfirm').isDisabled(), false);
  await context.close();
});

test('a complete form sends the public-form fields, note, consent and email choice, then opens the new team', async () => {
  const { page, context, calls } = await open(handlers());
  await fill(page, { nr: true });
  await page.click('#liveAdminRegConfirm');
  await page.waitForFunction(() => !document.getElementById('liveAdminRegistrationModal').classList.contains('open'));
  const sent = calls.filter(c => c.action === 'create_registration').map(c => c.payload);
  assert.strictEqual(sent.length, 1);
  const p = sent[0];
  assert.strictEqual(p.registration.divisionId, 'D14');
  assert.strictEqual(p.registration.teamName, 'Walk In');
  assert.strictEqual(p.adminNote, 'Paid at the desk');
  assert.strictEqual(p.teamConsentConfirmed, true);
  assert.strictEqual(p.emailTeam, true);
  assert.strictEqual(p.teamLogo, undefined);
  assert.deepStrictEqual(p.registration.players.map(x => [x.gender, x.captain, x.duprId, x.isNr, x.submittedDupr, x.shirtSize]), [
    ['Male', true, 'WK001', false, '3.00', 'M'], ['Male', false, 'WK002', false, '3.00', 'M'],
    ['Female', false, 'WK003', false, '3.00', '2XS'], ['Female', false, 'WK004', true, null, 'M']]);
  await page.waitForSelector('table.live-reg-roster');
  assert.strictEqual(await page.locator('#toastText').innerText(), 'AOPL-14-000099 · Walk In · Under Review · team emailed');
  assert.match(await page.locator('#drawerBody').innerText(), /REGISTRATION SOURCE\nAdmin/i, 'the new team opens, marked as added by an admin');
  assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
  await context.close();
});

test('a logo is sent as a data URL', async () => {
  const { page, context, calls } = await open(handlers());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await fill(page, { logo: { name: 'logo.png', mimeType: 'image/png', buffer: png } });
  await page.waitForTimeout(200);
  await page.click('#liveAdminRegConfirm');
  await page.waitForFunction(() => !document.getElementById('liveAdminRegistrationModal').classList.contains('open'));
  const p = calls.find(c => c.action === 'create_registration').payload;
  assert.strictEqual(p.teamLogo.fileName, 'logo.png');
  assert.strictEqual(p.teamLogo.dataUrl, 'data:image/png;base64,' + png.toString('base64'));
  await context.close();
});

test('the form checks fields before sending, and consent is required', async () => {
  const { page, context, calls } = await open(handlers());
  await fill(page);
  await page.fill('[data-admin-reg-player="2"] [data-f=mobile]', '12345');
  await page.click('#liveAdminRegConfirm');
  assert.match(await page.locator('#liveAdminRegError').innerText(), /Player 2: the mobile number/);
  await page.fill('[data-admin-reg-player="2"] [data-f=mobile]', '09170000002');
  await page.fill('[data-admin-reg-player="1"] [data-f=submittedDupr]', '3.994');
  await page.click('#liveAdminRegConfirm');
  assert.match(await page.locator('#liveAdminRegError').innerText(), /Player 1: enter a DUPR rating/);
  await page.fill('[data-admin-reg-player="1"] [data-f=submittedDupr]', '3.00');
  await page.evaluate(() => document.querySelectorAll('input[name="liveAdminRegCaptain"]').forEach(r => { r.checked = false; }));
  await page.click('#liveAdminRegConfirm');
  assert.match(await page.locator('#liveAdminRegError').innerText(), /Choose the Team Captain/);
  await page.check('[data-admin-reg-player="3"] input[name="liveAdminRegCaptain"]');
  await page.uncheck('#liveAdminRegConsent');
  await page.click('#liveAdminRegConfirm');
  assert.match(await page.locator('#liveAdminRegError').innerText(), /Confirm that the team has read the rules/);
  assert.strictEqual(calls.filter(c => c.action === 'create_registration').length, 0);
  await context.close();
});

test('a rule refusal from the server is explained and the form stays open', async () => {
  const { page, context } = await open(handlers({ create: () => ({ __status: 409, error: 'PLAYER_ALREADY_REGISTERED', detail: 'WK001' }) }));
  await fill(page);
  await page.click('#liveAdminRegConfirm');
  await page.waitForFunction(() => document.getElementById('liveAdminRegError').style.display === 'block');
  assert.strictEqual(await page.locator('#liveAdminRegError').innerText(), 'One or more players are already on another active team. (WK001)');
  assert.ok(await page.locator('#liveAdminRegistrationModal.open').isVisible());
  assert.strictEqual(await page.locator('#liveAdminRegConfirm').isDisabled(), false);
  await context.close();
});

test('while registration is closed the form says so and cannot be sent; no email option without communications_send', async () => {
  const { page, context } = await open(handlers({ eventStatus: 'registration_closed', perms: snapshot.me.permissions }));
  await page.click('#liveAdminRegOpen');
  assert.match(await page.locator('#liveAdminRegNotice').innerText(), /Registration is closed/);
  assert.ok(await page.locator('#liveAdminRegConfirm').isDisabled());
  assert.strictEqual(await page.locator('#liveAdminRegEmailRow').isVisible(), false);
  await context.close();
});

test('admin/index.html carries the same admin registration code', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  for (const needle of ['id="liveAdminRegistrationModal"', 'api("create_registration",payload)', 'openLiveAdminRegistration()', 'if(data.detail) err.detail=data.detail;']) assert.ok(html.includes(needle), needle);
});
