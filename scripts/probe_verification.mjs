/**
 * Throwaway probe: does creating a session from a token flip
 * `emailVerification` to true?
 *
 * This decides the login flow. `signIn` routes users to the OTP screen whenever
 * `emailVerification` is false, so if the flag never flips, every password login
 * would loop through OTP forever and "log in normally" would be impossible.
 *
 * Creates a temporary user and deletes it in a finally block.
 */
import { Client, Users, Account, ID } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT;
const project = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey);
const users = new Users(admin);

// No API key: this behaves like the phone would.
const asClient = new Client().setEndpoint(endpoint).setProject(project);
const account = new Account(asClient);

const email = `probe_${Date.now()}@dhara-probe.test`;
let userId = null;

try {
  const created = await users.create(ID.unique(), email, undefined, 'Probe-Passw0rd!', 'Probe User');
  userId = created.$id;
  console.log('1. after create           emailVerification =', created.emailVerification);

  const token = await users.createToken(userId, 6, 300);
  console.log('2. token generated        secret length =', String(token.secret ?? '').length);

  const session = await account.createSession(userId, token.secret);
  console.log('3. session created        id =', session.$id.slice(0, 8), 'provider =', session.provider);

  const after = await users.get(userId);
  console.log('4. after createSession    emailVerification =', after.emailVerification);

  console.log('\nVERDICT: token session sets emailVerification =>', after.emailVerification);
} catch (e) {
  console.error('PROBE FAILED:', e.code ?? '', e.message);
} finally {
  if (userId) {
    try {
      await users.delete(userId);
      console.log('cleanup: probe user deleted');
    } catch (e) {
      console.error('cleanup FAILED, remove user manually:', userId, e.message);
    }
  }
}
