/**
 * Throwaway probe: can the *user's own* credentials read which provider created
 * their session?
 *
 * The previous run proved OTP sessions report provider "token" and password
 * sessions report "email" — but only when read with an admin API key, which the
 * client never holds. This isolates whether a session secret (and a JWT derived
 * from it) can read the same field, since that is what an Appwrite Function
 * actually has to work with.
 *
 * Creates a temporary user and deletes it in a finally block.
 */
import { Client, Users, Account, ID } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT;
const project = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey);
const users = new Users(admin);

const email = `probe_${Date.now()}@dhara-probe.test`;
const password = 'Probe-Passw0rd!';
let userId = null;

const freshClient = () => new Client().setEndpoint(endpoint).setProject(project);

async function inspect(label, session) {
  const secret = session.secret ?? '';
  console.log(`   secret length        -> ${secret.length}`);
  console.log(`   provider (admin key) -> "${session.provider}"`);

  // 1. Read using the session secret directly.
  const sessionClient = freshClient();
  sessionClient.setSession(secret);
  const sessionAccount = new Account(sessionClient);

  try {
    const me = await sessionAccount.get();
    console.log(`   setSession -> account.get ok, is same user: ${me.$id === userId}`);
  } catch (e) {
    console.log(`   setSession -> account.get FAILED: ${e.message}`);
  }

  try {
    const s = await sessionAccount.getSession('current');
    console.log(`   setSession -> provider: "${s.provider}"`);
  } catch (e) {
    console.log(`   setSession -> getSession FAILED: ${e.message}`);
  }

  // 2. Read using a JWT minted from that session (what a Function receives).
  try {
    const { jwt } = await sessionAccount.createJWT();
    const jwtAccount = new Account(freshClient().setJWT(jwt));
    try {
      const s = await jwtAccount.getSession('current');
      console.log(`   JWT        -> provider: "${s.provider}"`);
    } catch (e) {
      console.log(`   JWT        -> getSession FAILED: ${e.message}`);
    }
  } catch (e) {
    console.log(`   JWT        -> createJWT FAILED: ${e.message}`);
  }
}

try {
  userId = (await users.create(ID.unique(), email, undefined, password, 'Probe User')).$id;

  console.log('A. OTP-derived session');
  const token = await users.createToken(userId, 6, 300);
  await inspect('otp', await new Account(freshClient()).createSession(userId, token.secret));

  console.log('\nB. password session');
  await inspect('pw', await new Account(freshClient()).createEmailPasswordSession(email, password));
} catch (e) {
  console.error('PROBE FAILED:', e.code ?? '', e.message);
} finally {
  if (userId) {
    try {
      await users.delete(userId);
      console.log('\ncleanup: probe user deleted');
    } catch (e) {
      console.error('cleanup FAILED, remove user manually:', userId, e.message);
    }
  }
}
