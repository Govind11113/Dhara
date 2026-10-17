import test from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_LABEL, isAdmin, isAdminPath, logAction, requireAdmin } from './admin.js';
import { Rejected } from './context.js';
import { ADMIN_ROUTES } from '../routes/admin.js';
import main from '../main.js';

test('a user with the admin label is an admin', () => {
  assert.equal(isAdmin({ labels: [ADMIN_LABEL] }), true);
  assert.equal(isAdmin({ labels: ['beta', ADMIN_LABEL] }), true);
});

test('no labels, other labels, or a missing user is not an admin', () => {
  assert.equal(isAdmin({ labels: [] }), false);
  assert.equal(isAdmin({ labels: ['beta'] }), false);
  assert.equal(isAdmin({}), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin(undefined), false);
});

test('similar-looking labels do not count', () => {
  assert.equal(isAdmin({ labels: ['Admin'] }), false);
  assert.equal(isAdmin({ labels: ['administrator'] }), false);
  assert.equal(isAdmin({ labels: [' admin'] }), false);
});

test('requireAdmin rejects with a stable forbidden code', () => {
  assert.throws(
    () => requireAdmin({ labels: [] }),
    (e) => e instanceof Rejected && e.code === 'forbidden',
  );
});

test('requireAdmin lets an admin through and returns them', () => {
  const admin = { $id: 'a1', labels: [ADMIN_LABEL] };
  assert.equal(requireAdmin(admin), admin);
});

test('only paths under /admin/ are admin paths', () => {
  assert.equal(isAdminPath('/admin/stats'), true);
  assert.equal(isAdminPath('/admin/review/decide'), true);
  assert.equal(isAdminPath('/tree/plant'), false);
  assert.equal(isAdminPath('/administrator'), false);
  assert.equal(isAdminPath('/'), false);
});

// The gate keys off the path prefix, so a handler registered under any other
// path would be reachable by every signed-in user.
test('every admin route lives under /admin/', () => {
  const keys = Object.keys(ADMIN_ROUTES);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(isAdminPath(k), `${k} is outside /admin/`);
});

test('an audit row carries who did what to what', async () => {
  let seen;
  const db = {
    createDocument: async (database, collection, id, data) => {
      seen = { collection, data };
      return {};
    },
  };
  await logAction(db, { $id: 'a1', email: 'a@example.com' }, {
    action: 'review.approve',
    targetType: 'tree',
    targetId: 't1',
    detail: { credits: 5 },
  });
  assert.equal(seen.collection, 'admin_actions');
  assert.equal(seen.data.adminId, 'a1');
  assert.equal(seen.data.action, 'review.approve');
  assert.equal(seen.data.detail, '{"credits":5}');
});

test('a failed audit write is not swallowed', async () => {
  const db = { createDocument: async () => { throw new Error('db down'); } };
  await assert.rejects(
    logAction(db, { $id: 'a1' }, { action: 'x' }),
    /db down/,
  );
});

// Drives the real entry point. With no token the request must stop at
// authentication, before any handler or database access.
test('an admin route without a token is unauthenticated', async () => {
  const sent = [];
  const res = { json: (body, status = 200) => { sent.push({ body, status }); return body; } };
  await main({
    req: { path: '/admin/whoami', headers: {}, body: '' },
    res,
    log: () => {},
    error: () => {},
  });
  assert.equal(sent[0].body.ok, false);
  assert.equal(sent[0].body.error.code, 'unauthenticated');
});

test('an unknown admin route is not found', async () => {
  const sent = [];
  const res = { json: (body, status = 200) => { sent.push({ body, status }); return body; } };
  await main({
    req: { path: '/admin/nope', headers: {}, body: '' },
    res,
    log: () => {},
    error: () => {},
  });
  assert.equal(sent[0].status, 404);
});
