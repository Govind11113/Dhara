import test from 'node:test';
import assert from 'node:assert/strict';

import { NGO_LABEL, canUseNgoArea, hasNgoLabel, isNgoPath, requireNgo } from './ngo.js';
import { isAdmin, isAdminPath, requireAdmin, ADMIN_LABEL } from './admin.js';
import { Rejected } from './context.js';
import { NGO_ROUTES } from '../routes/ngo.js';
import { PLANTING_ROUTES } from '../routes/planting.js';
import main from '../main.js';

test('the ngo label is recognised exactly', () => {
  assert.equal(hasNgoLabel({ labels: [NGO_LABEL] }), true);
  assert.equal(hasNgoLabel({ labels: ['beta', NGO_LABEL] }), true);
  assert.equal(hasNgoLabel({ labels: ['NGO'] }), false);
  assert.equal(hasNgoLabel({ labels: ['ngo '] }), false);
  assert.equal(hasNgoLabel({}), false);
  assert.equal(hasNgoLabel(null), false);
});

test('NGO staff and admins may use the NGO area; others may not', () => {
  assert.equal(canUseNgoArea({ labels: [NGO_LABEL] }), true);
  assert.equal(canUseNgoArea({ labels: [ADMIN_LABEL] }), true);
  assert.equal(canUseNgoArea({ labels: [] }), false);
  assert.equal(canUseNgoArea({ labels: ['beta'] }), false);
  assert.equal(canUseNgoArea(undefined), false);
});

test('a normal user is forbidden from the NGO area', () => {
  assert.throws(
    () => requireNgo({ labels: [] }),
    (e) => e instanceof Rejected && e.code === 'forbidden',
  );
});

test('the ngo label does not open the admin area', () => {
  const ngo = { labels: [NGO_LABEL] };
  assert.equal(isAdmin(ngo), false);
  assert.throws(
    () => requireAdmin(ngo),
    (e) => e instanceof Rejected && e.code === 'forbidden',
  );
});

test('only paths under /ngo/ are NGO paths', () => {
  assert.equal(isNgoPath('/ngo/requests'), true);
  assert.equal(isNgoPath('/ngo/reply'), true);
  assert.equal(isNgoPath('/ngoblin'), false);
  assert.equal(isNgoPath('/planting/mine'), false);
  assert.equal(isNgoPath('/admin/ngo/x'), false);
  assert.equal(isAdminPath('/ngo/requests'), false);
});

// The gate keys off the path prefix, so a handler mounted anywhere else would
// be open to every signed-in member.
test('every NGO route lives under /ngo/', () => {
  const keys = Object.keys(NGO_ROUTES);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(isNgoPath(k), `${k} is outside /ngo/`);
});

test('member routes are not under /ngo/ or /admin/', () => {
  for (const k of Object.keys(PLANTING_ROUTES)) {
    assert.ok(!isNgoPath(k) && !isAdminPath(k), `${k} would be gated as staff-only`);
    assert.ok(k.startsWith('/planting/'));
  }
});

async function call(path) {
  const sent = [];
  const res = { json: (body, status = 200) => { sent.push({ body, status }); return body; } };
  await main({ req: { path, headers: {}, body: '' }, res, log: () => {}, error: () => {} });
  return sent[0];
}

test('an NGO route without a token is unauthenticated', async () => {
  const out = await call('/ngo/requests');
  assert.equal(out.body.ok, false);
  assert.equal(out.body.error.code, 'unauthenticated');
});

test('a member route without a token is unauthenticated', async () => {
  const out = await call('/planting/mine');
  assert.equal(out.body.error.code, 'unauthenticated');
});

test('an unknown NGO route is not found', async () => {
  assert.equal((await call('/ngo/nope')).status, 404);
});
