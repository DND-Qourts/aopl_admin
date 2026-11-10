'use strict';
// Reports → Team Rosters: one CSV row per active team with its players in columns.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { startServer, launch, openAdmin } = require('./helpers.cjs');
const { snapshot, D14, D16, member, registration } = require('./fixtures.cjs');

let server, browser, baseUrl;
test.before(async () => { server = await startServer(); baseUrl = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

function named(slot, name, extra = {}) {
  const m = member(slot, slot % 2 ? 'Male' : 'Female', '3.00', undefined, extra);
  m.player = { ...m.player, full_name: name };
  return m;
}
// Players are listed out of slot order on purpose; the captain is not slot 1 on the second team.
const zeta = { ...registration([named(3, 'Cara'), named(1, 'Ana'), named(2, 'Ben, Jr.'), named(4, 'Dan')], D14), id: 'r1', reference: 'AOPL-1', team_name: 'Zeta' };
const alpha = { ...registration([named(1, 'Eve', { is_captain: false }), named(2, 'Fay', { is_captain: true }), named(3, 'Gus'), named(4, 'Hal'), named(5, 'Ivy')], D14), id: 'r2', reference: 'AOPL-2', team_name: 'alpha', status: 'confirmed', payment_status: 'verified' };
const sixteen = { ...registration([named(1, 'Jo'), named(2, 'Kim'), named(3, 'Old Player', { active_entry: false }), named(4, 'Lu')], D16), id: 'r3', reference: 'AOPL-3', team_name: 'Bravo' };
const gone = { ...registration([named(1, 'Max'), named(2, 'Ned')], D14), id: 'r4', reference: 'AOPL-4', team_name: 'Cancelled Team', status: 'cancelled' };

async function openReports(perms) {
  const me = perms ? { ...snapshot.me, permissions: perms } : snapshot.me;
  const ctx = await openAdmin(browser, baseUrl, {
    snapshot: { ...snapshot, me },
    registrations_snapshot: { registrations: [zeta, alpha, sixteen, gone], divisions: [D14, D16], summary: { total: 4, statusCounts: {} }, event: { id: 'ev' }, warnings: [] }
  });
  ctx.page.setDefaultTimeout(5000);
  await ctx.page.waitForSelector('#appRoot:not(.production-hidden)');
  await ctx.page.evaluate(() => openView('reports'));
  await ctx.page.waitForSelector('.report-card');
  return ctx;
}
const parse = csv => csv.split('\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replaceAll('""', '"')));

test('Team Rosters exports one row per active team, captain first, players in slot order', async () => {
  const { page, context, calls } = await openReports();
  const card = page.locator('.report-card', { hasText: 'Team Rosters' });
  assert.match(await card.innerText(), /Active teams\s*3/);
  const [download] = await Promise.all([page.waitForEvent('download'), card.locator('button', { hasText: 'Export CSV' }).click()]);
  assert.match(download.suggestedFilename(), /^all-out-rosters-report-\d{4}-\d{2}-\d{2}\.csv$/);
  const rows = parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepStrictEqual(rows, [
    ['Reference', 'Team', 'Division', 'Status', 'Payment Status', 'Players', 'Captain', 'Player 2', 'Player 3', 'Player 4', 'Player 5'],
    ['AOPL-2', 'alpha', 'DUPR 14', 'confirmed', 'verified', '5', 'Fay', 'Eve', 'Gus', 'Hal', 'Ivy'],
    ['AOPL-1', 'Zeta', 'DUPR 14', 'under_review', 'not_requested', '4', 'Ana', 'Ben, Jr.', 'Cara', 'Dan', ''],
    ['AOPL-3', 'Bravo', 'DUPR 16', 'under_review', 'not_requested', '3', 'Jo', 'Kim', 'Lu', '', '']
  ]);
  assert.deepStrictEqual(calls.filter(c => c.pageerror), []);
  await context.close();
});

test('Team Rosters is view-only without the Export Reports permission', async () => {
  const { page, context } = await openReports(snapshot.me.permissions.filter(p => p !== 'reports_export'));
  const card = page.locator('.report-card', { hasText: 'Team Rosters' });
  assert.strictEqual(await card.locator('button').count(), 0);
  assert.match(await card.innerText(), /View only/);
  await context.close();
});
