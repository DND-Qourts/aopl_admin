'use strict';
// No payment deadline (organizer decision 23 Oct): approval and promotion promise no deadline, the payments list shows
// how long a team has been pending instead of a due date, and a team overdue under the earlier rule is reopened
// without a deadline. Action Required keeps its 24-hour protection.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { snapshot, team, handlersFor } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const PERMS = [...snapshot.me.permissions, 'payments_view', 'payments_verify', 'payments_extend'];
const withPerms = { ...snapshot, me: { ...snapshot.me, permissions: PERMS } };
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();

function approvedTeam(window, extra = {}) {
  const reg = team(['3.00', '3.00', '3.00', '3.00'], ['3.00', '3.00', '3.00', '3.00']);
  return Object.assign(reg, { status: 'approved_for_payment', payment_status: 'requested', eligibility_locked_at: daysAgo(3),
    payment_windows: [{ id: 'w1', created_at: window.opened_at, ...window }], ...extra });
}
async function open(reg, more = {}, pagePath) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, { snapshot: withPerms, ...more }), pagePath);
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  return ctx;
}

for (const pagePath of ['/index.html', '/admin/index.html']) {
  test(`${pagePath}: live Admin code promises no payment deadline`, () => {
    const s = fs.readFileSync(path.join(__dirname, '..', pagePath), 'utf8');
    const live = s.slice(s.indexOf('function paymentDeadlineText'));
    assert.ok(live.length > 1000);
    assert.doesNotMatch(live, /24-Hour Window|24-hour payment window|Extend Deadline|24 hours from (approval|promotion)/);
    assert.doesNotMatch(s, /Promote & Open 24-Hour Window|Approve & Open 24-Hour Window/);
    assert.match(live, /protected 24-hour correction window/, 'Action Required protection is unchanged');
  });

}

// The live Admin is the root page. admin/index.html is an older copy without its config.js; its text is still kept in step.
for (const pagePath of ['/index.html']) {
  test(`${pagePath}: approval modal says no deadline`, async () => {
    const reg = team(['3.00', '3.00', '3.00', '3.00'], ['3.00', '3.00', '3.00', '3.00']);
    const { page, context, calls } = await open(reg, {}, pagePath);
    await page.evaluate(() => openView('registrations'));
    await page.waitForSelector('tbody tr', { state: 'attached' });
    await page.evaluate(() => openLivePaymentApproval('reg1'));
    await page.waitForSelector('#livePaymentApprovalModal.open');
    const text = await page.locator('#livePaymentApprovalModal').innerText();
    assert.match(text, /No deadline/);
    assert.doesNotMatch(text, /24-hour|24 hours|Projected Deadline/i);
    assert.strictEqual(await page.locator('#livePaymentApprovalConfirm').innerText(), 'Approve & Request Payment');
    assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
    await context.close();
  });
}

test('payments list and drawer: an infinite window reads "No deadline" with how long it has been pending', async () => {
  const reg = approvedTeam({ status: 'open', opened_at: daysAgo(9), due_at: 'infinity' });
  const { page, context, calls } = await open(reg);
  await page.evaluate(() => openView('payments'));
  await page.waitForSelector('#livePaymentsTable tbody tr');
  const row = await page.locator('#livePaymentsTable tbody tr').first().innerText();
  assert.match(row, /9 days/);
  assert.match(row, /No deadline/);
  assert.doesNotMatch(row, /Invalid|NaN/);
  assert.match(await page.locator('#livePaymentsTable thead').innerText(), /Pending since/i);
  await page.evaluate(() => openLiveRegistration('reg1'));
  const drawer = await page.locator('body').innerText();
  assert.match(drawer, /Deadline\s*No deadline/i);
  assert.match(drawer, /Pending Since[\s\S]{0,40}9 days/i);
  assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
  await context.close();
});

test('an older window with a past due date is shown as no deadline, not as expired', async () => {
  const reg = approvedTeam({ status: 'open', opened_at: daysAgo(3), due_at: daysAgo(2) });
  const { page, context } = await open(reg);
  await page.evaluate(() => openView('payments'));
  await page.waitForSelector('#livePaymentsTable tbody tr');
  const row = await page.locator('#livePaymentsTable tbody tr').first().innerText();
  assert.match(row, /No deadline/);
  assert.match(row, /3 days/);
  await context.close();
});

test('a team overdue under the earlier rule is reopened with a reason and no deadline', async () => {
  const reg = approvedTeam({ status: 'overdue', opened_at: daysAgo(4), due_at: daysAgo(3) }, { status: 'payment_overdue', payment_status: 'overdue' });
  const { page, context, calls } = await open(reg, { extend_payment_deadline: { result: { teamName: 'Synthetic Team', dueAt: null } } });
  await page.evaluate(() => openView('payments'));
  await page.waitForSelector('#livePaymentsTable tbody tr');
  assert.match(await page.locator('#livePaymentsTable tbody tr').first().innerText(), /earlier 24-hour rule/);
  await page.evaluate(() => openLiveRegistration('reg1'));
  assert.ok(await page.getByRole('button', { name: 'Reopen Payment' }).first().isVisible());
  await page.evaluate(() => openLiveOverdueDecision('reg1', 'extend'));
  await page.waitForSelector('#liveOverdueDecisionModal.open');
  const modal = await page.locator('#liveOverdueDecisionModal').innerText();
  assert.match(modal, /Reopen Payment \(No Deadline\)/);
  assert.match(modal, /no payment deadline/i);
  assert.doesNotMatch(modal, /hours from now|Projected New Deadline/);
  await page.click('#liveOverdueConfirm');
  assert.ok(!calls.some(c => c.action === 'extend_payment_deadline'), 'a reason is required');
  await page.fill('#liveOverdueReason', 'Team asked to pay after the earlier window');
  await page.click('#liveOverdueConfirm');
  await page.waitForFunction(() => !document.querySelector('#liveOverdueDecisionModal.open'));
  assert.deepStrictEqual(calls.find(c => c.action === 'extend_payment_deadline').payload,
    { registrationId: 'reg1', reason: 'Team asked to pay after the earlier window', extensionHours: 24 });
  await context.close();
});
