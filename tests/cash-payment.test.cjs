'use strict';
// Record Cash Payment in the registration drawer: a team approved for payment that paid in cash is confirmed
// through admin-access (record_cash_payment).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { team, handlersFor, snapshot } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

function awaitingPayment(extra = {}) {
  const reg = team(['3.00', '3.00', '3.00', '3.00'], ['3.00', '3.00', '3.00', '3.00']);
  return Object.assign(reg, {
    team_name: 'Cash Team', status: 'approved_for_payment', payment_status: 'requested', eligibility_locked_at: '2026-11-01T00:00:00Z',
    payment_windows: [{ id: 'w1', status: 'open', opened_at: '2026-11-01T00:00:00Z', due_at: 'infinity' }], payments: []
  }, extra);
}
// The shared fixture role has no payment permissions; Finance needs payments_view and payments_verify.
const finance = { ...snapshot, me: { ...snapshot.me, permissions: [...snapshot.me.permissions, 'payments_view', 'payments_verify'] } };
async function openDrawer(reg, more = {}) {
  const ctx = await openAdmin(browser, baseUrl, handlersFor(reg, undefined, { snapshot: finance, ...more }));
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('registrations'));
  await ctx.page.evaluate(id => openLiveRegistration(id), reg.id);
  await ctx.page.waitForSelector('table.live-reg-roster');
  return ctx;
}
const cashButton = page => page.locator('#drawerFoot button', { hasText: 'Record Cash Payment' });
const cashCalls = calls => calls.filter(c => c.action === 'record_cash_payment');

test('Record Cash Payment confirms the team with the receipt and note, after the admin confirms the amount', async () => {
  const reg = awaitingPayment();
  let saved = null;
  const more = {
    record_cash_payment: p => { saved = p; return { result: { teamName: 'Cash Team', registrationStatus: 'confirmed', method: 'Cash', notification: { status: 'sent' } } }; },
    registrations_snapshot: () => {
      if (saved) Object.assign(reg, { status: 'confirmed', payment_status: 'verified',
        payments: [{ id: 'pay1', status: 'verified', amount: 7000, method: 'Cash', provider_reference: saved.receiptReference, submitted_at: '2026-11-07T00:00:00Z', verified_at: '2026-11-07T00:00:00Z', proof_path: null }] });
      return { registrations: [reg], divisions: [], summary: { total: 1, statusCounts: {} }, event: { id: 'ev' }, warnings: [] };
    }
  };
  const { page, context, calls } = await openDrawer(reg, more);
  assert.strictEqual(await cashButton(page).count(), 1);
  await cashButton(page).click();
  await page.waitForSelector('#liveCashPaymentModal.open');
  assert.strictEqual(await page.locator('#liveCashPaymentAmount').innerText(), '₱7,000.00');
  assert.match(await page.locator('#liveCashPaymentConfirmText').innerText(), /full ₱7,000\.00 was received in cash/);
  await page.click('#liveCashPaymentConfirm');
  assert.match(await page.locator('#liveCashPaymentError').innerText(), /receipt or OR number/);
  await page.fill('#liveCashPaymentReceipt', '  OR-0012 ');
  await page.click('#liveCashPaymentConfirm');
  assert.match(await page.locator('#liveCashPaymentError').innerText(), /Tick the box/);
  assert.strictEqual(cashCalls(calls).length, 0, 'nothing sent before the amount is confirmed');
  await page.fill('#liveCashPaymentNote', 'Received at the clinic');
  await page.check('#liveCashPaymentConfirmCheck');
  await page.click('#liveCashPaymentConfirm');
  await page.waitForSelector('#liveCashPaymentModal:not(.open)', { state: 'attached' });
  assert.deepStrictEqual(cashCalls(calls).map(c => c.payload), [{ registrationId: reg.id, receiptReference: 'OR-0012', note: 'Received at the clinic' }]);
  await page.waitForFunction(() => /CONFIRMED/.test(document.getElementById('drawerFoot')?.innerText || ''));
  const snap = await page.locator('.panel').filter({ hasText: 'Payment snapshot' }).innerText();
  assert.match(snap, /Cash/);
  assert.match(snap, /OR-0012/);
  assert.strictEqual(await cashButton(page).count(), 0);
  assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
  await context.close();
});

test('a team that already sent a proof gets Review & Verify, not Record Cash', async () => {
  const reg = awaitingPayment({ payment_status: 'submitted',
    payments: [{ id: 'pay1', status: 'submitted', amount: 7000, method: 'GCash', provider_reference: 'REF-1', submitted_at: '2026-11-07T00:00:00Z', proof_path: 'proofs/a.png' }] });
  const { page, context } = await openDrawer(reg);
  assert.strictEqual(await cashButton(page).count(), 0);
  assert.strictEqual(await page.locator('#drawerFoot button', { hasText: 'Review & Verify Payment' }).count(), 1);
  await context.close();
});

test('no Record Cash for a role without payments_verify, or for a team not yet approved for payment', async () => {
  const noVerify = { ...finance, me: { ...finance.me, permissions: finance.me.permissions.filter(p => p !== 'payments_verify') } };
  let ctx = await openDrawer(awaitingPayment(), { snapshot: noVerify });
  assert.strictEqual(await cashButton(ctx.page).count(), 0);
  assert.match(await ctx.page.locator('#drawerFoot').innerText(), /PAYMENT WINDOW OPEN/);
  await ctx.context.close();
  ctx = await openDrawer(awaitingPayment({ status: 'under_review', payment_status: 'not_requested', payment_windows: [], eligibility_locked_at: null }));
  assert.strictEqual(await cashButton(ctx.page).count(), 0);
  await ctx.context.close();
});

test('a refusal from the server is shown in plain words and the modal stays open', async () => {
  const { page, context } = await openDrawer(awaitingPayment(), { record_cash_payment: { __status: 400, error: 'CASH_PAYMENT_PROOF_PENDING' } });
  await cashButton(page).click();
  await page.fill('#liveCashPaymentReceipt', 'OR-0099');
  await page.check('#liveCashPaymentConfirmCheck');
  await page.click('#liveCashPaymentConfirm');
  await page.waitForFunction(() => document.getElementById('liveCashPaymentError').style.display === 'block');
  assert.match(await page.locator('#liveCashPaymentError').innerText(), /already sent a payment proof/);
  assert.ok(await page.locator('#liveCashPaymentModal.open').isVisible());
  assert.strictEqual(await page.locator('#liveCashPaymentConfirm').isDisabled(), false);
  await context.close();
});

test('admin/index.html carries the same Record Cash Payment code', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  for (const needle of ['id="liveCashPaymentModal"', 'api("record_cash_payment",', 'openLiveCashPayment(']) assert.ok(html.includes(needle), needle);
});
