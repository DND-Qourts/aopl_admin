'use strict';
// Registration review screen for ordinary (rated) players. Written against the unmodified page first;
// it must keep passing after the NR work.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, handlersFor, D16 } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

async function openDrawer(reg, handlers) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, handlers));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.waitForSelector('#registrationsView, .live-reg-roster, tbody tr', { state: 'attached' });
  await ctx.page.evaluate(id => openLiveRegistration(id), reg.id);
  await ctx.page.waitForSelector('table.live-reg-roster');
  return ctx;
}
const drawerText = page => page.locator('table.live-reg-roster').innerText();
const checklist = page => page.locator('.checkrow').allInnerTexts();

test('a fully verified team exactly at the cap passes every check', async () => {
  const { page, context } = await openDrawer(team(['3.99', '3.99', '3.99', '2.03'], ['3.99', '3.99', '3.99', '2.03']));
  assert.match(await drawerText(page), /14\.00\s*cap 14\.00/);
  const rows = await checklist(page);
  assert.strictEqual(rows.length, 5);
  assert.ok(rows.every(r => /Pass/.test(r)), rows.join(' | '));
  assert.match(await page.locator('.panel-title').filter({ hasText: 'Roster & DUPR' }).innerText(), /Structurally eligible/);
  await context.close();
});

test('one hundredth over the team cap fails the team check', async () => {
  const { page, context } = await openDrawer(team(['3.99', '3.99', '3.99', '2.04'], ['3.99', '3.99', '3.99', '2.04']));
  const rows = await checklist(page);
  assert.match(rows[4], /Needs review/);
  assert.match(await drawerText(page), /Over cap/);
  await context.close();
});

test('a player over the individual cap fails the player check', async () => {
  const { page, context } = await openDrawer(team(['4.00', '2.00', '2.00', '2.00'], ['4.00', '2.00', '2.00', '2.00']));
  assert.match((await checklist(page))[3], /Needs review/);
  await context.close();
});

test('unverified players fail the verification check and use the submitted rating', async () => {
  const { page, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']));
  const rows = await checklist(page);
  assert.match(rows[2], /Needs review/);
  assert.match(await drawerText(page), /14\.00\s*cap 14\.00/);
  await context.close();
});

test('the verified rating wins over the submitted one', async () => {
  const { page, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50'], ['3.40', '3.40', '3.40', '3.40']));
  assert.match(await drawerText(page), /13\.60\s*cap 14\.00/);
  await context.close();
});

test('verifying a rating sends the registration player id and the rating', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']), { verify_dupr_player: { result: { player: { fullName: 'Player 1' } } } });
  await page.evaluate(() => openLiveDuprReview('reg1', 'm1'));
  assert.strictEqual(await page.inputValue('#liveDuprVerifiedInput'), '3.50');
  await page.fill('#liveDuprVerifiedInput', '3.45');
  await page.click('#liveDuprReviewConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveDuprReviewModal.open'));
  const sent = calls.find(c => c.action === 'verify_dupr_player').payload;
  assert.strictEqual(sent.registrationPlayerId, 'm1');
  assert.strictEqual(Number(sent.verifiedDupr), 3.45);
  await context.close();
});

test('an out-of-range verified rating is refused before anything is sent', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']));
  await page.evaluate(() => openLiveDuprReview('reg1', 'm1'));
  await page.fill('#liveDuprVerifiedInput', '9.5');
  await page.click('#liveDuprReviewConfirm');
  assert.match(await page.locator('#liveDuprReviewError').innerText(), /between/);
  assert.ok(!calls.some(c => c.action === 'verify_dupr_player'));
  await context.close();
});

test('replacing a player sends the new rating', async () => {
  const { page, calls, context } = await openDrawer(team(['3.50', '3.50', '3.50', '3.50']), { replace_roster_player: { result: { oldPlayerName: 'A', newPlayerName: 'B' } } });
  await page.evaluate(() => openLiveRosterReplacement('reg1', 'm2'));
  await page.fill('#liveRosterReplacementName', 'New Player');
  await page.fill('#liveRosterReplacementEmail', 'new@example.test');
  await page.fill('#liveRosterReplacementMobile', '09171234567');
  await page.fill('#liveRosterReplacementDuprId', 'NEW001');
  await page.fill('#liveRosterReplacementDupr', '3.25');
  await page.fill('#liveRosterReplacementReason', 'Injury replacement');
  await page.click('#liveRosterReplacementConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveRosterReplacementModal.open'));
  const sent = calls.find(c => c.action === 'replace_roster_player').payload;
  assert.strictEqual(sent.registrationPlayerId, 'm2');
  assert.strictEqual(Number(sent.submittedDupr), 3.25);
  assert.ok(!sent.isNr);
  await context.close();
});

async function exportCsv(page, type) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(t => exportLiveReport(t), type)]);
  return require('node:fs').readFileSync(await download.path(), 'utf8');
}

test('DUPR and confirmed-roster exports list the submitted, verified and locked ratings', async () => {
  const reg = team(['3.50', '3.50', '3.50', '3.50'], ['3.40', '3.40', '3.40', '3.40']);
  reg.status = 'confirmed';
  const { page, context } = await openDrawer(reg);
  const dupr = (await exportCsv(page, 'dupr')).split('\n');
  assert.strictEqual(dupr[0], '"Reference","Team","Division","Player","DUPR ID","Submitted DUPR","Verified DUPR","Locked DUPR","Verification Status"');
  assert.strictEqual(dupr[1], '"AOPL-TEST-1","Synthetic Team","DUPR 14","Player 1","TST001","3.5","3.4","","verified"');
  const confirmed = (await exportCsv(page, 'confirmed')).split('\n');
  assert.match(confirmed[1], /"TST001","3\.4","M"$/);
  await context.close();
});

test('D16 team uses its own caps', async () => {
  const { page, context } = await openDrawer(team(['4.49', '4.49', '4.49', '2.53'], ['4.49', '4.49', '4.49', '2.53'], D16));
  assert.match(await drawerText(page), /16\.00\s*cap 16\.00/);
  assert.ok((await checklist(page)).every(r => /Pass/.test(r)));
  await context.close();
});
