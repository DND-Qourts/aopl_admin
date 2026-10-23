'use strict';
// Rejecting a submitted payment proof from the payment review: reason required, payments_verify only.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { snapshot, team, handlersFor } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

function submittedTeam() {
  const reg = team(['3.00', '3.00', '3.00', '3.00'], ['3.00', '3.00', '3.00', '3.00']);
  return Object.assign(reg, {
    status: 'approved_for_payment', payment_status: 'submitted',
    payment_windows: [{ id: 'w1', status: 'open', opened_at: '2026-01-01T00:00:00Z', due_at: '2099-01-02T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }],
    payments: [{ id: 'pay1', status: 'submitted', amount: 7000, method: 'GCash', provider_reference: 'REF1', proof_path: 'x/p.png', submitted_at: '2026-01-01T01:00:00Z', created_at: '2026-01-01T01:00:00Z' }]
  });
}
function withPerms(perms) { return { ...snapshot, me: { ...snapshot.me, permissions: perms } }; }
async function openReview(perms, more) {
  const reg = submittedTeam();
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, { snapshot: withPerms(perms), ...more }));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.waitForSelector('tbody tr', { state: 'attached' });
  await ctx.page.evaluate(() => openLivePaymentReview('reg1'));
  await ctx.page.waitForSelector('#livePaymentVerifyModal.open');
  return ctx;
}
const ALL = ['registrations_view', 'payments_view', 'payments_verify'];

test('rejecting needs a reason the team will see, and sends it with the payment id', async () => {
  const { page, calls, context } = await openReview(ALL, { reject_payment: { result: { canResubmit: true, teamName: 'Synthetic Team', notification: { status: 'sent' } } } });
  await page.click('#livePaymentRejectConfirm');
  assert.match(await page.locator('#livePaymentVerifyError').innerText(), /reason the team will see/);
  assert.ok(!calls.some(c => c.action === 'reject_payment'), 'nothing sent without a reason');
  await page.fill('#livePaymentRejectReason', 'Reference does not match the proof');
  await page.click('#livePaymentRejectConfirm');
  await page.waitForFunction(() => !document.querySelector('#livePaymentVerifyModal.open'));
  assert.deepStrictEqual(calls.find(c => c.action === 'reject_payment').payload, { paymentId: 'pay1', reason: 'Reference does not match the proof' });
  assert.ok(!calls.some(c => c.action === 'verify_payment'), 'rejecting never verifies');
  await context.close();
});

test('a role without payments_verify sees neither verify nor reject', async () => {
  const { page, context } = await openReview(['registrations_view', 'payments_view']);
  assert.ok(!(await page.locator('#livePaymentRejectConfirm').isVisible()));
  assert.ok(!(await page.locator('#livePaymentRejectReason').isVisible()));
  assert.ok(!(await page.locator('#livePaymentVerifyConfirm').isVisible()));
  await context.close();
});

test('a server refusal is shown and the reject button comes back', async () => {
  const { page, context } = await openReview(ALL, { reject_payment: () => null });
  await page.fill('#livePaymentRejectReason', 'Blurry proof');
  await page.click('#livePaymentRejectConfirm');
  await page.waitForFunction(() => document.querySelector('#livePaymentVerifyError').style.display === 'block');
  assert.strictEqual(await page.locator('#livePaymentRejectConfirm').isEnabled(), true);
  await context.close();
});
