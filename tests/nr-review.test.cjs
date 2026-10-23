'use strict';
// NR (no DUPR rating) on the registration review screens, plus exact cap arithmetic.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, D14, D16, handlersFor } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

async function openDrawer(reg, handlers) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, handlers));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.waitForSelector('tbody tr', { state: 'attached' });
  await ctx.page.evaluate(id => openLiveRegistration(id), reg.id);
  await ctx.page.waitForSelector('table.live-reg-roster');
  return ctx;
}
const rosterText = page => page.locator('table.live-reg-roster').innerText();
const checklist = page => page.locator('.checkrow').allInnerTexts();

test('an NR player shows as NR and counts as the division equivalent', async () => {
  const { page, context } = await openDrawer(team(['NR', '3.00', '3.00', '3.00']));
  const text = await rosterText(page);
  assert.match(text, /\bNR\b/);
  assert.match(text, /counts 3\.50/);
  assert.match(text, /12\.50\s*cap 14\.00/);
  assert.match(await page.locator('.summary-item', { hasText: 'Current review total' }).first().innerText(), /includes 1 NR at 3\.50/);
  await context.close();
});

test('NR needs organizer confirmation: a pending NR fails the verification check', async () => {
  const { page, context } = await openDrawer(team(['NR', '3.00', '3.00', '3.00'], [false, '3.00', '3.00', '3.00']));
  assert.match((await checklist(page))[2], /Needs review/);
  assert.match(await rosterText(page), /NR · needs check/);
  assert.match(await rosterText(page), /Confirm NR/);
  await context.close();
});

test('a confirmed NR with three verified players passes verification', async () => {
  const { page, context } = await openDrawer(team(['NR', '3.00', '3.00', '3.00'], [true, '3.00', '3.00', '3.00']));
  const rows = await checklist(page);
  assert.ok(rows.every(r => /Pass/.test(r)), rows.join(' | '));
  assert.match(await rosterText(page), /NR confirmed/);
  await context.close();
});

test('a valid DUPR ID alone does not verify NR', async () => {
  // Status pending with a DUPR ID present must stay "needs check".
  const { page, context } = await openDrawer(team(['NR', '3.00', '3.00', '3.00'], [false, '3.00', '3.00', '3.00']));
  assert.doesNotMatch(await rosterText(page), /NR confirmed/);
  await context.close();
});

test('NR counts against the team cap with the division equivalent, exactly', async () => {
  let ctx = await openDrawer(team(['NR', '3.99', '3.99', '2.52'], [true, '3.99', '3.99', '2.52']));
  assert.match(await rosterText(ctx.page), /14\.00\s*cap 14\.00/);
  assert.ok((await checklist(ctx.page)).every(r => /Pass/.test(r)));
  await ctx.context.close();
  ctx = await openDrawer(team(['NR', '3.99', '3.99', '2.53'], [true, '3.99', '3.99', '2.53']));
  assert.match((await checklist(ctx.page))[4], /Needs review/);
  await ctx.context.close();
  ctx = await openDrawer(team(['NR', '4.49', '4.49', '3.02'], [true, '4.49', '4.49', '3.02'], D16));
  assert.match(await rosterText(ctx.page), /16\.00\s*cap 16\.00/);
  await ctx.context.close();
});

test('a division with no NR equivalent fails closed instead of counting NR as zero', async () => {
  const reg = team(['NR', '3.00', '3.00', '3.00'], [true, '3.00', '3.00', '3.00'], { ...D14, nr_equivalent: null });
  const { page, context } = await openDrawer(reg);
  const rows = await checklist(page);
  assert.match(rows[3], /Needs review/);
  assert.match(rows[4], /Needs review/);
  await context.close();
});

test('the review modal confirms NR without asking for a rating', async () => {
  const { page, calls, context } = await openDrawer(team(['NR', '3.00', '3.00', '3.00']), { verify_dupr_player: { result: { player: { fullName: 'Player 1' } } } });
  await page.evaluate(() => openLiveDuprReview('reg1', 'm1'));
  assert.ok(!(await page.locator('#liveDuprVerifiedInput').isVisible()));
  assert.match(await page.locator('#liveDuprNrNote').innerText(), /A valid ID alone does not verify NR/);
  assert.strictEqual(await page.locator('#liveDuprReviewConfirm').innerText(), 'Confirm NR');
  assert.strictEqual(await page.locator('#liveDuprSubmitted').innerText(), 'NR');
  await page.click('#liveDuprReviewConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveDuprReviewModal.open'));
  const sent = calls.find(c => c.action === 'verify_dupr_player').payload;
  assert.deepStrictEqual(sent, { registrationPlayerId: 'm1', confirmNr: true });
  await context.close();
});

test('rated players still get the rating box and never the NR confirmation', async () => {
  const { page, calls, context } = await openDrawer(team(['NR', '3.00', '3.00', '3.00']), { verify_dupr_player: { result: {} } });
  await page.evaluate(() => openLiveDuprReview('reg1', 'm2'));
  assert.ok(await page.locator('#liveDuprVerifiedInput').isVisible());
  assert.strictEqual(await page.locator('#liveDuprReviewConfirm').innerText(), 'Mark Verified');
  await page.fill('#liveDuprVerifiedInput', '3.00');
  await page.click('#liveDuprReviewConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveDuprReviewModal.open'));
  assert.deepStrictEqual(calls.find(c => c.action === 'verify_dupr_player').payload, { registrationPlayerId: 'm2', verifiedDupr: '3.00' });
  await context.close();
});

test('verified ratings with more than two decimals, zero or letters are refused, not rounded', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']));
  for (const bad of ['3.456', '0', '0.00', '1e1', '3.', 'abc', '9.01']) {
    await page.evaluate(() => openLiveDuprReview('reg1', 'm1'));
    await page.fill('#liveDuprVerifiedInput', bad);
    await page.click('#liveDuprReviewConfirm');
    assert.match(await page.locator('#liveDuprReviewError').innerText(), /between 0\.01 and 9\.00/, bad);
    await page.evaluate(() => document.querySelector('#liveDuprReviewCancel').click());
  }
  assert.ok(!calls.some(c => c.action === 'verify_dupr_player'));
  await context.close();
});

test('a rating is sent as typed text, not a float', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']), { verify_dupr_player: { result: {} } });
  await page.evaluate(() => openLiveDuprReview('reg1', 'm1'));
  await page.fill('#liveDuprVerifiedInput', '3.9');
  await page.click('#liveDuprReviewConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveDuprReviewModal.open'));
  assert.strictEqual(calls.find(c => c.action === 'verify_dupr_player').payload.verifiedDupr, '3.9');
  await context.close();
});

test('a replacement can be NR: no rating is sent', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']), { replace_roster_player: { result: {} } });
  await page.evaluate(() => openLiveRosterReplacement('reg1', 'm2'));
  await page.fill('#liveRosterReplacementName', 'New Player');
  await page.fill('#liveRosterReplacementEmail', 'new@example.test');
  await page.fill('#liveRosterReplacementMobile', '09171234567');
  await page.fill('#liveRosterReplacementDuprId', 'NEW001');
  await page.fill('#liveRosterReplacementDupr', '3.25');
  await page.check('#liveRosterReplacementNr');
  assert.strictEqual(await page.inputValue('#liveRosterReplacementDupr'), '');
  assert.ok(await page.locator('#liveRosterReplacementDupr').isDisabled());
  await page.fill('#liveRosterReplacementReason', 'Player has no DUPR rating yet');
  await page.click('#liveRosterReplacementConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveRosterReplacementModal.open'));
  const sent = calls.find(c => c.action === 'replace_roster_player').payload;
  assert.strictEqual(sent.isNr, true);
  assert.strictEqual(sent.submittedDupr, '');
  assert.strictEqual(sent.duprId, 'NEW001');
  await context.close();
});

test('a rated replacement with too many decimals is refused', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']));
  await page.evaluate(() => openLiveRosterReplacement('reg1', 'm2'));
  await page.fill('#liveRosterReplacementName', 'New Player');
  await page.fill('#liveRosterReplacementEmail', 'new@example.test');
  await page.fill('#liveRosterReplacementMobile', '09171234567');
  await page.fill('#liveRosterReplacementDuprId', 'NEW001');
  await page.fill('#liveRosterReplacementDupr', '3.256');
  await page.fill('#liveRosterReplacementReason', 'Injury replacement');
  await page.click('#liveRosterReplacementConfirm');
  assert.match(await page.locator('#liveRosterReplacementError').innerText(), /at most two decimals/);
  assert.ok(!calls.some(c => c.action === 'replace_roster_player'));
  await context.close();
});

test('exports show NR as NR, never as a blank or zero rating', async () => {
  const reg = team(['NR', '3.00', '3.00', '3.00'], [true, '3.00', '3.00', '3.00']);
  reg.status = 'confirmed';
  const { page, context } = await openDrawer(reg);
  const exp = async type => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(t => exportLiveReport(t), type)]);
    return require('node:fs').readFileSync(await download.path(), 'utf8').split('\n');
  };
  assert.strictEqual((await exp('dupr'))[1], '"AOPL-TEST-1","Synthetic Team","DUPR 14","Player 1","TST001","NR","","","verified"');
  assert.match((await exp('confirmed'))[1], /"TST001","NR","M"$/);
  await context.close();
});
