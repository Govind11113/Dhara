/**
 * Throwaway probe: the linchpin of the signup flow.
 *
 * Plan: create the account via an email token (no password), confirm the code,
 * then set the password from inside that authenticated session. Possessing the
 * password then proves the user received the emailed code, so no "mark me
 * verified" endpoint is needed — which matters because `emailVerification`
 * provably stays false after a token session.
 *
 * Two things must hold:
 *   1. account.updatePassword works with no oldPassword on a token-made account.
 *   2. createEmailPasswordSession then works, so "log in normally" is possible.
 *
 * Uses raw REST because the Node SDK does not hand back session secrets.
 * Creates a temporary user and deletes it in a finally block.
 */
import { Client, Users, ID } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT;
const project = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

const users = new Users(
  new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey),
);

const email = `probe_${Date.now()}@dhara-probe.test`;
const password = 'Probe-Passw0rd!';
let userId = null;

/** Calls the REST API the way the phone would: project header, no API key. */
async function asClient(path, { method = 'POST', body, session } = {}) {
  const headers = {
    'content-type': 'application/json',
    'x-appwrite-project': project,
    'x-appwrite-response-format': '1.8.0',
  };
  if (session) headers['x-appwrite-session'] = session;

  const res = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));

  // Appwrite omits `secret` from the body and sets a cookie instead unless the
  // caller is a recognised native SDK, so fall back to the cookie.
  let cookieSecret = '';
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const m = /^a_session_[^=_]+=([^;]+)/.exec(raw);
    if (m && !raw.startsWith('a_session_') === false && !/_legacy=/.test(raw)) {
      cookieSecret = decodeURIComponent(m[1]);
      break;
    }
  }

  return { status: res.status, json, cookieSecret };
}

try {
  // Mirrors what createEmailToken does for a brand-new email, but lets us read
  // the secret instead of waiting for an inbox.
  userId = (await users.create(ID.unique(), email, undefined, undefined, 'Probe User')).$id;
  const created = await users.get(userId);
  console.log('1. token-made account: emailVerification =', created.emailVerification,
              '| has password =', created.password !== '' && created.password != null);

  const token = await users.createToken(userId, 6, 300);

  const sessionRes = await asClient('/account/sessions/token', {
    body: { userId, secret: token.secret },
  });
  const secret = sessionRes.json?.secret ?? '';
  console.log('2. session via OTP: status', sessionRes.status, '| secret length', secret.length);
  if (!secret) throw new Error('no session secret returned; cannot continue');

  // THE question: can a password be set with no oldPassword?
  const pwRes = await asClient('/account/password', {
    method: 'PATCH',
    body: { password },
    session: secret,
  });
  console.log('3. updatePassword (no oldPassword): status', pwRes.status,
              pwRes.status >= 400 ? `-> ${pwRes.json?.message}` : '-> OK');

  const nameRes = await asClient('/account/name', {
    method: 'PATCH',
    body: { name: 'Probe User' },
    session: secret,
  });
  console.log('4. updateName: status', nameRes.status);

  const loginRes = await asClient('/account/sessions/email', {
    body: { email, password },
  });
  console.log('5. password login afterwards: status', loginRes.status,
              loginRes.status >= 400 ? `-> ${loginRes.json?.message}` : '-> OK');

  const ok = pwRes.status < 400 && loginRes.status < 400;
  console.log(`\nVERDICT: set-password-after-OTP flow works => ${ok}`);
} catch (e) {
  console.error('PROBE FAILED:', e.message);
} finally {
  if (userId) {
    try {
      await users.delete(userId);
      console.log('cleanup: probe user deleted');
    } catch (e) {
      console.error('cleanup FAILED, remove manually:', userId, e.message);
    }
  }
}
