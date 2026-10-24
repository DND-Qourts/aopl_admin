'use strict';
// Regression test for audit finding S-1: Admin Users / Role Management rendered
// server-supplied names, titles, emails and role keys without escaping.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openAdmin } = require('./helpers.cjs');

const IMG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const EVIL_KEY = "x');window.__xss=(window.__xss||0)+1;//";

const perms = ['dashboard_view', 'users_manage', 'roles_manage'];
const permissionCatalog = [
  { key: 'dashboard_view', name: 'Dashboard ' + IMG, description: 'View ' + IMG },
  { key: 'users_manage', name: 'Users', description: 'Manage users' },
  { key: 'roles_manage', name: 'Roles', description: 'Manage roles' }
];
const snapshot = {
  me: { email: 'owner' + IMG + '@example.test', roleKey: 'owner', roleName: 'Owner ' + IMG, permissions: perms },
  summary: { activeAdmins: 2, roles: 2 },
  permissions: permissionCatalog,
  roles: [
    { id: 'r1', key: 'owner', name: 'Owner', description: 'Owner role', is_system: true, is_protected: true, active: true, permissions: perms },
    { id: 'r2', key: EVIL_KEY, name: 'Role ' + IMG, description: 'Desc ' + IMG, is_system: false, is_protected: false, active: true, permissions: ['dashboard_view'] }
  ],
  users: [
    { user_id: 'u1', display_name: 'Owner Person', email: 'owner@example.test', mobile: '', title: 'Organizer', notes: '', role: { key: 'owner' }, role_id: 'r1', active: true },
    { user_id: 'u2', display_name: 'Name ' + IMG, email: 'e' + IMG + '@example.test', mobile: '0917 ' + IMG, title: 'Title ' + IMG, notes: '', role: { key: EVIL_KEY }, role_id: 'r2', active: true }
  ]
};
const handlers = {
  snapshot,
  registrations_snapshot: { registrations: [], divisions: [], summary: { total: 0, statusCounts: {} } }
};

let server, browser, baseUrl;
test.before(async () => {
  server = await startServer();
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  browser = await launch();
});
test.after(async () => { await browser.close(); server.close(); });

async function xssCount(page) { return page.evaluate(() => window.__xss || 0); }

test('hostile admin-user and role data never executes script', async () => {
  const { page, blocked } = await openAdmin(browser, baseUrl, handlers);
  await page.waitForSelector('#appRoot:not(.production-hidden)');
  assert.equal(await xssCount(page), 0, 'dashboard (signed-in email and role name) executed injected script');

  await page.evaluate(() => openView('adminusers'));
  await page.waitForSelector('.user-card');
  await page.waitForTimeout(300);
  assert.equal(await xssCount(page), 0, 'Admin Users or Role Management executed injected script');

  // Role buttons carry the hostile role key. Clicking them must not run it either.
  for (const label of ['View Protected Permissions', 'Manage Permissions', 'Edit Role', 'Delete']) {
    const btn = page.locator('.role-actions button', { hasText: label }).first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(150); await page.evaluate(() => closeRoleModal && closeRoleModal()); }
  }
  assert.equal(await xssCount(page), 0, 'role action buttons executed injected script');

  // Modals that build <option> and chip lists from role/permission data.
  await page.evaluate(() => { openChangeRoleModal(2); });
  await page.evaluate(() => { closeChangeRoleModal(); openEditAdminUser(2); });
  await page.evaluate(() => { openRoleModal(); });
  await page.waitForTimeout(300);
  assert.equal(await xssCount(page), 0, 'role/user modals executed injected script');
  assert.deepEqual(blocked, [], 'test made an unmocked network request: ' + blocked.join(', '));
});

test('hostile text is displayed as text, not markup', async () => {
  const { page } = await openAdmin(browser, baseUrl, handlers);
  await page.waitForSelector('#appRoot:not(.production-hidden)');
  await page.evaluate(() => openView('adminusers'));
  await page.waitForSelector('.user-card');
  const injected = await page.locator('#adminUsersView img').count();
  assert.equal(injected, 0, 'markup from server data became real elements');
  assert.match(await page.locator('#adminUsersView').innerText(), /Name <img src=x/);
});

test('normal data still renders and buttons still work', async () => {
  const normal = JSON.parse(JSON.stringify(snapshot).replaceAll(IMG, '').replaceAll(EVIL_KEY, 'custom_role'));
  const { page } = await openAdmin(browser, baseUrl, { ...handlers, snapshot: normal });
  await page.waitForSelector('#appRoot:not(.production-hidden)');
  await page.evaluate(() => openView('adminusers'));
  await page.waitForSelector('.user-card');
  const text = await page.locator('#adminUsersView').innerText();
  assert.match(text, /Owner Person/);
  assert.match(text, /Organizer/);
  // Owner can manage roles, so the protected Owner role offers a read-only view and the custom role offers Edit.
  await page.locator('.role-actions button', { hasText: 'View Protected Permissions' }).first().click();
  assert.ok(await page.locator('#roleModal.open').count(), 'View Protected Permissions did not open the role modal');
  await page.evaluate(() => closeRoleModal());
  await page.locator('.role-actions button', { hasText: 'Edit Role' }).first().click();
  assert.equal(await page.inputValue('#roleKeyInput'), 'custom_role', 'Edit Role opened the wrong role');
});
